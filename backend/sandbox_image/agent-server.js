const express = require('express')
const { spawn, exec, execSync } = require('child_process')
const { promisify } = require('util')
const fs = require('fs')
const path = require('path')
const execAsync = promisify(exec)

const app = express()
app.use(express.json())

const WORKSPACE = '/workspace'      // local disk — fast for Claude file I/O
const DATA_DIR = '/data'             // volume mount — persists across sandbox restarts
const BUNDLE_PATH = '/data/workspace.bundle'  // git bundle saved here after each prompt
const CHAT_PATH = '/data/chat.json'           // chat history persisted on volume
const STARTER_DIR = '/opt/starter'
const CLAUDE_CONFIG_DIR = '/workspace/.claude-data'
const SESSION_ID_FILE = '/workspace/.claude-session-id'

// Rolling buffer of Vite stdout/stderr — last 150 lines, in-memory only
const VITE_LOG = []
function pushViteLog(line) {
  if (!line) return
  VITE_LOG.push(line)
  if (VITE_LOG.length > 150) VITE_LOG.shift()
}

function spawnVite() {
  const proc = spawn('npm', ['run', 'dev', '--', '--host', '0.0.0.0', '--port', '5173'], {
    cwd: WORKSPACE,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout.on('data', d => d.toString().split('\n').forEach(pushViteLog))
  proc.stderr.on('data', d => d.toString().split('\n').forEach(pushViteLog))
  proc.unref()
}

let claudeSessionId = fs.existsSync(SESSION_ID_FILE)
  ? fs.readFileSync(SESSION_ID_FILE, 'utf8').trim()
  : null

let claudeUid = null
let claudeGid = null

function initNonRootUser() {
  try {
    execSync('id buildman', { stdio: 'pipe' })
  } catch {
    execSync('useradd -m -u 1000 -s /bin/bash buildman', { stdio: 'pipe' })
  }
  claudeUid = parseInt(execSync('id -u buildman', { encoding: 'utf8' }).trim())
  claudeGid = parseInt(execSync('id -g buildman', { encoding: 'utf8' }).trim())
  fs.mkdirSync(WORKSPACE, { recursive: true })
  execSync(`chown -R buildman:buildman ${WORKSPACE}`, { stdio: 'pipe' })
  execSync('su buildman -c "git config --global user.email agent@buildman.dev"', { stdio: 'pipe' })
  execSync('su buildman -c "git config --global user.name \'Buildman Agent\'"', { stdio: 'pipe' })
  execSync('su buildman -c "git config --global safe.directory \'*\'"', { stdio: 'pipe' })
}

function getAuthMode() {
  if (process.env.ANTHROPIC_API_KEY?.trim()) return 'api_key'
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN?.trim()) return 'oauth_token'
  if (fs.existsSync(`${CLAUDE_CONFIG_DIR}/.credentials.json`)) return 'credentials_file'
  return null
}

function initCredentials() {
  if (process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_CODE_OAUTH_TOKEN) return
  const creds = process.env.CLAUDE_CREDENTIALS
  if (!creds) return
  fs.mkdirSync(CLAUDE_CONFIG_DIR, { recursive: true })
  const credPath = `${CLAUDE_CONFIG_DIR}/.credentials.json`
  if (!fs.existsSync(credPath)) {
    fs.writeFileSync(credPath, creds, { mode: 0o600 })
  }
  if (claudeUid !== null) {
    execSync(`chown -R buildman:buildman ${CLAUDE_CONFIG_DIR}`, { stdio: 'pipe' })
  }
}

async function ensureGitRepo() {
  fs.mkdirSync(WORKSPACE, { recursive: true })
  try {
    await execAsync('git rev-parse --git-dir', { cwd: WORKSPACE })
  } catch {
    const gitDir = path.join(WORKSPACE, '.git')
    if (fs.existsSync(gitDir)) {
      fs.rmSync(gitDir, { recursive: true, force: true })
    }
    await execAsync('git init -b main', { cwd: WORKSPACE })
  }
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

function formatToolLabel(name, input) {
  if (!input || typeof input !== 'object') return name
  if (name === 'Bash' && input.command) {
    const cmd = String(input.command).trim()
    return `Bash: ${cmd.length > 80 ? cmd.slice(0, 77) + '…' : cmd}`
  }
  if (name === 'Write' && input.file_path) return `Write: ${input.file_path}`
  if (name === 'Edit' && input.file_path) return `Edit: ${input.file_path}`
  if (name === 'Read' && input.file_path) return `Read: ${input.file_path}`
  return name
}

function scanEnvPlaceholders() {
  const envPath = path.join(WORKSPACE, '.env')
  if (!fs.existsSync(envPath)) return []
  const lines = fs.readFileSync(envPath, 'utf8').split('\n')
  const results = []
  let lastMeta = null
  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('# service:')) {
      // parse: # service: OpenAI | url: https://... | hint: starts with sk-
      const meta = {}
      for (const part of trimmed.slice(1).split('|')) {
        const idx = part.indexOf(':')
        if (idx === -1) continue
        const key = part.slice(0, idx).trim()
        const val = part.slice(idx + 1).trim()
        meta[key] = val
      }
      lastMeta = meta
      continue
    }
    const match = trimmed.match(/^([^=]+)=__NEEDS_USER_VALUE__$/)
    if (match) {
      results.push({
        name: match[1].trim(),
        service: lastMeta?.service || null,
        url: lastMeta?.url || null,
        hint: lastMeta?.hint || null,
      })
    }
    lastMeta = null
  }
  return results
}

function attachClaudeStdout(res, proc) {
  let buffer = ''
  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        if (event.session_id && !claudeSessionId) {
          claudeSessionId = event.session_id
          fs.writeFileSync(SESSION_ID_FILE, claudeSessionId)
        }
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              writeSse(res, { type: 'output', text: block.text })
            }
            if (block.type === 'tool_use' && block.name) {
              writeSse(res, { type: 'activity', text: formatToolLabel(block.name, block.input) })
            }
          }
        }
        if (event.type === 'result' && event.subtype === 'success') {
          const cost = event.total_cost_usd
          if (typeof cost === 'number') {
            writeSse(res, { type: 'activity', text: `Done ($${cost.toFixed(4)})` })
          }
        }
      } catch { /* incomplete JSON line */ }
    }
  })
}

app.get('/healthz', (_, res) => {
  const mode = getAuthMode()
  res.json({ ok: true, auth_mode: mode, authenticated: mode !== null })
})

function ensureNodeModules() {
  // node_modules live on local disk as a symlink to the image's pre-installed copy.
  // Never stored in the volume or the git bundle.
  const nm = path.join(WORKSPACE, 'node_modules')
  try {
    const stat = fs.lstatSync(nm)
    if (!stat.isSymbolicLink()) {
      fs.rmSync(nm, { recursive: true, force: true })
      execSync(`ln -sf /opt/starter/node_modules ${nm}`, { stdio: 'pipe' })
    }
  } catch {
    execSync(`ln -sf /opt/starter/node_modules ${nm}`, { stdio: 'pipe' })
  }
}

async function saveBundle() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    await execAsync(`git bundle create ${BUNDLE_PATH} --all`, { cwd: WORKSPACE })
  } catch (e) {
    console.error('saveBundle failed:', e.message)
  }
}

app.post('/init-workspace', async (req, res) => {
  try {
    fs.mkdirSync(WORKSPACE, { recursive: true })

    if (fs.existsSync(BUNDLE_PATH)) {
      // Restore from persisted git bundle onto LOCAL disk
      const entries = fs.readdirSync(WORKSPACE).filter(e => e !== 'lost+found')
      if (entries.length === 0) {
        await execAsync(`git clone ${BUNDLE_PATH} ${WORKSPACE}`)
        // Wipe stale Claude session state from the bundle. The previous sandbox's
        // Claude process is gone — any .claude-data from it causes EACCES on resume.
        if (fs.existsSync(CLAUDE_CONFIG_DIR)) {
          fs.rmSync(CLAUDE_CONFIG_DIR, { recursive: true, force: true })
        }
        if (claudeUid !== null) {
          execSync(`chown -R buildman:buildman ${WORKSPACE}`, { stdio: 'pipe' })
        }
        claudeSessionId = null
        if (fs.existsSync(SESSION_ID_FILE)) fs.unlinkSync(SESSION_ID_FILE)
        // Re-seed credentials into the fresh config dir
        initCredentials()
      }
    } else {
      // Brand new project — seed from starter onto LOCAL disk
      if (!fs.existsSync(STARTER_DIR)) {
        return res.status(500).json({ error: 'Starter template not found at /opt/starter' })
      }
      execSync(`cp -a ${STARTER_DIR}/. ${WORKSPACE}/`, { stdio: 'pipe' })
      execSync(`rm -rf ${path.join(WORKSPACE, 'node_modules')}`, { stdio: 'pipe' })
      if (claudeUid !== null) {
        execSync(`chown -R buildman:buildman ${WORKSPACE}`, { stdio: 'pipe' })
      }
      claudeSessionId = null
      if (fs.existsSync(SESSION_ID_FILE)) fs.unlinkSync(SESSION_ID_FILE)
      await ensureGitRepo()
      await execAsync('git add -A', { cwd: WORKSPACE })
      await execAsync('git commit -m "Initial template"', { cwd: WORKSPACE })
      await saveBundle()
    }

    ensureNodeModules()

    spawnVite()

    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/vite-logs', (req, res) => {
  const recent = VITE_LOG.slice(-50).join('\n')
  const ENV_RE = /import\.meta\.env\.\w+ is not defined|VITE_[A-Z_]+.*undefined|401|403|api.?key.*undefined/i
  const CODE_RE = /SyntaxError|Cannot find module|Transform failed|Failed to compile/i
  const isEnvError = ENV_RE.test(recent)
  const isCodeError = !isEnvError && CODE_RE.test(recent)
  res.json({ logs: recent, isEnvError, isCodeError })
})

app.post('/save-chat', (req, res) => {
  try {
    const { messages, checkpoints } = req.body
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(CHAT_PATH, JSON.stringify({ messages: messages || [], checkpoints: checkpoints || [] }))
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.get('/load-chat', (req, res) => {
  try {
    if (!fs.existsSync(CHAT_PATH)) return res.json({ messages: [], checkpoints: [] })
    const data = JSON.parse(fs.readFileSync(CHAT_PATH, 'utf8'))
    res.json({ messages: data.messages || [], checkpoints: data.checkpoints || [] })
  } catch {
    res.json({ messages: [], checkpoints: [] })
  }
})

app.post('/prompt', async (req, res) => {
  const { text } = req.body
  const authMode = getAuthMode()

  if (!authMode) {
    res.status(503).json({
      error: 'No Claude auth configured. Run: modal secret create claude-credentials CLAUDE_CODE_OAUTH_TOKEN=<token>',
    })
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  const spawnOpts = {
    cwd: WORKSPACE,
    env: {
      ...process.env,
      CI: '1',
      CLAUDE_CONFIG_DIR,
      HOME: '/home/buildman',
      ...(process.env.ANTHROPIC_API_KEY ? { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY } : {}),
      ...(process.env.CLAUDE_CODE_OAUTH_TOKEN ? { CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN } : {}),
    },
    ...(claudeUid !== null ? { uid: claudeUid, gid: claudeGid } : {}),
  }

  const runArgs = [
    '--print',
    ...(authMode === 'api_key' ? ['--bare'] : []),
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--verbose',
    ...(claudeSessionId ? ['--resume', claudeSessionId] : []),
    text,
  ]

  const proc = spawn('claude', runArgs, spawnOpts)
  proc.stdin.end()  // prevent "no stdin data received" warning
  attachClaudeStdout(res, proc)

  proc.stderr.on('data', (chunk) => {
    const text = chunk.toString()
    if (text.includes('no stdin data received')) return  // suppress startup noise
    writeSse(res, { type: 'error', text })
  })

  proc.on('close', async (code) => {
    let commitHash = null
    try {
      await ensureGitRepo()
      await execAsync('git add -A', { cwd: WORKSPACE })
      await execAsync(`git commit -m "checkpoint-${Date.now()}" --allow-empty`, { cwd: WORKSPACE })
      commitHash = (await execAsync('git rev-parse HEAD', { cwd: WORKSPACE })).stdout.trim()
    } catch { /* nothing to commit */ }

    // Persist workspace to volume as a git bundle — fast single-file save
    await saveBundle()

    const envNeeded = scanEnvPlaceholders()
    if (envNeeded.length > 0) {
      writeSse(res, { type: 'env_needed', vars: envNeeded })
    }

    writeSse(res, { type: 'done', code, sessionId: claudeSessionId, commitHash })
    res.end()
  })
})

app.post('/preview', async (req, res) => {
  const { hash } = req.body
  try {
    const dirty = (await execAsync('git status --porcelain', { cwd: WORKSPACE })).stdout.trim().length > 0
    if (dirty) await execAsync('git stash', { cwd: WORKSPACE })
    await execAsync(`git checkout ${hash}`, { cwd: WORKSPACE })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/preview-exit', async (_, res) => {
  try {
    await execAsync('git checkout main', { cwd: WORKSPACE })
    await execAsync('git stash pop', { cwd: WORKSPACE }).catch(() => {})
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/restore', async (req, res) => {
  const { hash } = req.body
  try {
    await execAsync('git checkout main', { cwd: WORKSPACE }).catch(() => {})
    await execAsync(`git reset --hard ${hash}`, { cwd: WORKSPACE })

    // Truncate chat.json to only the history that existed at this checkpoint.
    // checkpoint[i] pairs with messages[2i] (user) + messages[2i+1] (assistant).
    let messages = []
    let checkpoints = []
    if (fs.existsSync(CHAT_PATH)) {
      const saved = JSON.parse(fs.readFileSync(CHAT_PATH, 'utf8'))
      checkpoints = saved.checkpoints || []
      messages = saved.messages || []
      const cpIndex = checkpoints.findIndex(cp => cp.hash === hash)
      if (cpIndex !== -1) {
        checkpoints = checkpoints.slice(0, cpIndex + 1)
        messages = messages.slice(0, 2 * (cpIndex + 1))
        fs.writeFileSync(CHAT_PATH, JSON.stringify({ messages, checkpoints }))
      }
    }

    // Reset Claude session so next prompt starts fresh from restored state
    claudeSessionId = null
    if (fs.existsSync(SESSION_ID_FILE)) fs.unlinkSync(SESSION_ID_FILE)

    res.json({ ok: true, messages, checkpoints })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

app.post('/deploy', async (req, res) => {
  const token = process.env.NETLIFY_AUTH_TOKEN
  if (!token) {
    return res.status(503).json({ error: 'NETLIFY_AUTH_TOKEN not configured in Modal secrets.' })
  }

  const { hash, netlify_site_id } = req.body || {}
  const buildEnv = { ...process.env, CI: 'true' }
  let checkedOut = false
  let stashed = false

  try {
    if (hash) {
      const currentHead = (await execAsync('git rev-parse HEAD', { cwd: WORKSPACE })).stdout.trim()
      const needsCheckout = hash !== currentHead
      if (needsCheckout) {
        const dirty = (await execAsync('git status --porcelain', { cwd: WORKSPACE })).stdout.trim().length > 0
        if (dirty) {
          await execAsync('git stash', { cwd: WORKSPACE })
          stashed = true
        }
        await execAsync(`git checkout ${hash}`, { cwd: WORKSPACE })
        checkedOut = true
      }
    }

    const deployedHash = (await execAsync('git rev-parse HEAD', { cwd: WORKSPACE })).stdout.trim()

    const { stderr: buildStderr } = await execAsync('npm run build', { cwd: WORKSPACE, timeout: 120000, env: buildEnv })
    if (buildStderr) console.error('build stderr:', buildStderr)

    // Write .netlify/state.json before deploying so Netlify CLI always reuses the same site.
    // This file is gitignored and lost on sandbox restart, so we restore it from stored metadata.
    const netlifyStateDir = path.join(WORKSPACE, '.netlify')
    const netlifyStatePath = path.join(netlifyStateDir, 'state.json')
    if (netlify_site_id) {
      fs.mkdirSync(netlifyStateDir, { recursive: true })
      fs.writeFileSync(netlifyStatePath, JSON.stringify({ siteId: netlify_site_id }))
    }

    const { stdout, stderr } = await execAsync(
      `netlify deploy --dir=dist --prod --auth=${token} --json`,
      { cwd: WORKSPACE, timeout: 180000, env: buildEnv }
    )
    if (stderr) console.error('netlify stderr:', stderr)

    const jsonMatch = stdout.match(/\{[\s\S]*\}/)
    if (!jsonMatch) throw new Error(`Unexpected netlify output: ${stdout.slice(0, 500)}`)
    const result = JSON.parse(jsonMatch[0])

    // Prefer site_id from JSON output; fall back to reading .netlify/state.json.
    // result.site_id is the stable Netlify site ID used to redeploy to the same site.
    let siteId = result.site_id || null
    if (!siteId) {
      try {
        const state = JSON.parse(fs.readFileSync(netlifyStatePath, 'utf8'))
        siteId = state.siteId || null
      } catch { /* state file missing */ }
    }

    // result.url is the permanent site URL; result.deploy_url is unique per deploy (has hash prefix).
    const url = result.url || result.site_url || result.deploy_url
    if (!url) throw new Error(`Deploy succeeded but no URL returned: ${JSON.stringify(result)}`)

    res.json({ ok: true, url, deployedHash, siteId })
  } catch (e) {
    console.error('deploy error:', e)
    const detail = [e.stderr, e.stdout, e.message].filter(Boolean).join('\n').trim()
    res.status(500).json({ error: detail || String(e) })
  } finally {
    if (checkedOut) {
      await execAsync('git checkout main', { cwd: WORKSPACE }).catch(() => {})
      if (stashed) await execAsync('git stash pop', { cwd: WORKSPACE }).catch(() => {})
    }
  }
})

app.post('/set-env', async (req, res) => {
  // req.body.vars: { VITE_OPENAI_API_KEY: "sk-real-value", ... }
  const { vars } = req.body
  if (!vars || typeof vars !== 'object') {
    return res.status(400).json({ error: 'vars must be an object' })
  }

  try {
    const envPath = path.join(WORKSPACE, '.env')
    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''

    for (const [name, value] of Object.entries(vars)) {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      // Replace placeholder line (with or without preceding meta comment)
      const placeholderRe = new RegExp(`^${escapedName}=__NEEDS_USER_VALUE__$`, 'm')
      if (placeholderRe.test(content)) {
        content = content.replace(placeholderRe, `${name}=${value}`)
      } else {
        // Append if not already present
        const existsRe = new RegExp(`^${escapedName}=`, 'm')
        if (!existsRe.test(content)) {
          content += (content.endsWith('\n') || content === '' ? '' : '\n') + `${name}=${value}\n`
        }
      }
    }

    fs.writeFileSync(envPath, content)
    if (claudeUid !== null) {
      execSync(`chown buildman:buildman ${envPath}`, { stdio: 'pipe' })
    }

    // Restart Vite so it picks up the new .env values
    try {
      execSync('pkill -f "vite" || true', { stdio: 'pipe' })
    } catch {}
    await new Promise(r => setTimeout(r, 500))
    spawnVite()

    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

initNonRootUser()
initCredentials()
app.listen(3001, () => console.log('Agent server ready on :3001'))
