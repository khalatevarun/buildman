const express = require('express')
const { spawn, exec, execSync } = require('child_process')
const { promisify } = require('util')
const fs = require('fs')
const path = require('path')
const http = require('http')
const execAsync = promisify(exec)

const app = express()
app.use(express.json())

const WORKSPACE = '/workspace'
const DATA_DIR = '/data'
const BUNDLE_PATH = '/data/workspace.bundle'
const CHAT_PATH = '/data/chat.json'
const STARTER_DIR = '/opt/starter'
const OC_SESSION_FILE = '/workspace/.opencode-session-id'
const OC_PORT = 4096
const OC_BASE = `http://127.0.0.1:${OC_PORT}`
const OC_PROVIDER = 'opencode'
const OC_MODEL = 'deepseek-v4-flash-free'

function spawnVite() {
  const logDir = path.join(WORKSPACE, 'tmp')
  fs.mkdirSync(logDir, { recursive: true })
  const logStream = fs.createWriteStream(path.join(logDir, 'vite.log'), { flags: 'a' })
  const proc = spawn('npm', ['run', 'dev', '--', '--host', '0.0.0.0', '--port', '5173'], {
    cwd: WORKSPACE,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  proc.stdout.pipe(logStream)
  proc.stderr.pipe(logStream)
  proc.unref()
}

let opencodeSessionId = fs.existsSync(OC_SESSION_FILE)
  ? fs.readFileSync(OC_SESSION_FILE, 'utf8').trim()
  : null
let activePromptRes = null  // current streaming /prompt SSE response
let wasStopped = false
let sseEventListeners = []  // callbacks receiving OpenCode /event stream

function initGitConfig() {
  execSync('git config --global user.email agent@buildman.dev', { stdio: 'pipe' })
  execSync('git config --global user.name "Buildman Agent"', { stdio: 'pipe' })
  execSync('git config --global safe.directory "*"', { stdio: 'pipe' })
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

// Map OpenCode tool names (from packages/opencode/src/tool/) to human-readable labels
function formatToolLabel(toolName, input) {
  const n = String(toolName || '').toLowerCase()
  if (n === 'bash') {
    const cmd = input?.command ? String(input.command).trim() : ''
    return cmd ? `Bash: ${cmd.length > 60 ? cmd.slice(0, 57) + '…' : cmd}` : 'Running command'
  }
  if (n === 'edit') return input?.filePath ? `Edit: ${input.filePath}` : 'Editing file'
  if (n === 'write') return input?.filePath ? `Write: ${input.filePath}` : 'Writing file'
  if (n === 'read') return input?.filePath ? `Read: ${input.filePath}` : 'Reading file'
  if (n === 'apply_patch') return 'Applying patch'
  if (n === 'glob') return 'Searching files'
  if (n === 'grep') return 'Searching code'
  if (n === 'webfetch') return 'Fetching URL'
  if (n === 'websearch') return 'Searching web'
  if (n === 'todo' || n === 'todowrite') return null
  if (n === 'task') return 'Running task'
  if (n === 'lsp') return 'Code analysis'
  if (n === 'repo_overview') return 'Reading codebase'
  if (n === 'repo_clone') return 'Cloning repo'
  // Prettify unknown tool names: snake_case → Title Case
  return n.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

function deriveService(varName) {
  const stripped = varName.replace(/^VITE_/, '')
  const segment = stripped.split('_')[0]
  return segment.charAt(0) + segment.slice(1).toLowerCase()
}

const PLACEHOLDER_RE = /^(your[-_\s].*|placeholder|todo|xxx+|<[^>]+>|api[-_]key[-_]here|add[-_]your.*|insert[-_].*|replace[-_].*|enter[-_].*|my[-_].*key.*)$/i

function isPlaceholderValue(val) {
  const v = val.trim()
  return v === '' || v === '""' || v === "''" || PLACEHOLDER_RE.test(v)
}

function scanEnvPlaceholders() {
  const envPath = path.join(WORKSPACE, '.env')
  if (!fs.existsSync(envPath)) return []
  const lines = fs.readFileSync(envPath, 'utf8').split('\n')
  const groups = []
  let pendingUrl = null
  let currentVars = []
  let currentUrl = null

  const flushGroup = () => {
    if (currentVars.length > 0) {
      groups.push({ service: deriveService(currentVars[0]), url: currentUrl, vars: currentVars })
      currentVars = []
      currentUrl = null
    }
    pendingUrl = null
  }

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed.startsWith('# http')) {
      flushGroup()
      pendingUrl = trimmed.slice(2).trim()
      continue
    }
    const match = trimmed.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (match && isPlaceholderValue(match[2])) {
      if (currentVars.length === 0) currentUrl = pendingUrl
      currentVars.push(match[1])
      continue
    }
    flushGroup()
  }
  flushGroup()
  return groups
}

app.get('/healthz', async (_, res) => {
  let ocHealthy = false
  try {
    const r = await fetch(`${OC_BASE}/global/health`)
    ocHealthy = r.ok
  } catch {}
  res.json({ ok: true, opencode_healthy: ocHealthy, session_id: opencodeSessionId })
})

app.get('/env-status', (_, res) => {
  res.json({ env_needed: scanEnvPlaceholders() })
})

function ensureNodeModules() {
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

// ---------------------------------------------------------------------------
// OpenCode server management
// ---------------------------------------------------------------------------

function writeOpencodeConfig() {
  const configDir = '/root/.config/opencode'
  fs.mkdirSync(configDir, { recursive: true })

  const config = {
    $schema: 'https://opencode.ai/config.json',
    model: `${OC_PROVIDER}/${OC_MODEL}`,
    permission: { '*': 'allow' },
  }
  fs.writeFileSync(path.join(configDir, 'opencode.json'), JSON.stringify(config, null, 2))

  // Global AGENTS.md — loaded by OpenCode alongside the workspace AGENTS.md.
  // Controls reply format for all sessions.
  const globalAgentsMd = `# Reply Format Rules

After completing any task, write your reply following these rules exactly.

**Every reply:**
- 1-3 sentences maximum
- Start directly with what the user sees or can do — use "you" or "the app", never "I"
- NEVER begin with: "All done", "Done", "No errors", "No type errors", "No TypeScript errors", "I've", "I have", "Let me", "Now I", "I will"
- NEVER mention TypeScript, type errors, or results of any checks you ran internally
- NEVER mention file names, component names, CSS classes, JSX, or any technical term
- NEVER mention environment variable names (like VITE_API_KEY or OPENAI_API_KEY) or configuration files (like .env) — the UI handles prompting the user for any keys they need
- Write as if describing the finished result to a friend who has never written code
`
  fs.writeFileSync(path.join(configDir, 'AGENTS.md'), globalAgentsMd)
}

function startOpencodeServer() {
  writeOpencodeConfig()

  const env = {
    ...process.env,
    HOME: '/root',
    XDG_CONFIG_HOME: '/root/.config',
    XDG_DATA_HOME: '/root/.local/share',
    // Ollama fallback: if set, opencode will use the local Ollama server instead
    ...(process.env.OLLAMA_BASE_URL ? { OLLAMA_BASE_URL: process.env.OLLAMA_BASE_URL } : {}),
  }

  const proc = spawn('opencode', ['serve', '--port', String(OC_PORT)], {
    cwd: WORKSPACE,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  proc.stdout.on('data', d => console.log('[opencode]', d.toString().trimEnd()))
  proc.stderr.on('data', d => console.error('[opencode]', d.toString().trimEnd()))
  proc.on('exit', code => console.log('[opencode] server exited', code))
  proc.unref()
  return proc
}

async function waitForOpencode(maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const r = await fetch(`${OC_BASE}/global/health`)
      if (r.ok) { console.log('[opencode] server ready'); return }
    } catch {}
    await new Promise(r => setTimeout(r, 1000))
  }
  throw new Error('OpenCode server failed to start within 30s')
}

// Connect to GET /event and fan out to registered listeners.
// Reconnects automatically on disconnect.
function connectOpencodeEvents() {
  const tryConnect = () => {
    const req = http.request(
      { hostname: '127.0.0.1', port: OC_PORT, path: '/event', method: 'GET',
        headers: { Accept: 'text/event-stream', Connection: 'keep-alive' } },
      (res) => {
        let buf = ''
        res.on('data', chunk => {
          buf += chunk.toString()
          const blocks = buf.split('\n\n')
          buf = blocks.pop()  // keep incomplete trailing block
          for (const block of blocks) {
            if (!block.trim()) continue
            const dataLine = block.split('\n').find(l => l.startsWith('data: '))
            if (!dataLine) continue
            try {
              const event = JSON.parse(dataLine.slice(6))
              for (const cb of sseEventListeners) cb(event)
            } catch {}
          }
        })
        res.on('end', () => { console.log('[opencode] SSE stream ended, reconnecting'); setTimeout(tryConnect, 2000) })
        res.on('error', () => setTimeout(tryConnect, 2000))
      }
    )
    req.on('error', () => setTimeout(tryConnect, 2000))
    req.end()
  }
  tryConnect()
}

async function ensureOpencodeSession() {
  if (opencodeSessionId) {
    try {
      const r = await fetch(`${OC_BASE}/session/${opencodeSessionId}`)
      if (r.ok) return opencodeSessionId
    } catch {}
    console.log('[opencode] session gone, creating new one')
    opencodeSessionId = null
  }

  const r = await fetch(`${OC_BASE}/session`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  })
  if (!r.ok) throw new Error(`create session failed: ${r.status}`)
  const session = await r.json()
  opencodeSessionId = session.id
  fs.writeFileSync(OC_SESSION_FILE, opencodeSessionId)
  console.log('[opencode] created session', opencodeSessionId)
  return opencodeSessionId
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.post('/init-workspace', async (req, res) => {
  try {
    fs.mkdirSync(WORKSPACE, { recursive: true })

    const hasGitRepo = fs.existsSync(path.join(WORKSPACE, '.git'))

    if (hasGitRepo) {
      opencodeSessionId = null
      if (fs.existsSync(OC_SESSION_FILE)) fs.unlinkSync(OC_SESSION_FILE)
    } else if (fs.existsSync(BUNDLE_PATH)) {
      const entries = fs.readdirSync(WORKSPACE).filter(e => e !== 'lost+found')
      if (entries.length === 0) {
        await execAsync(`git clone ${BUNDLE_PATH} ${WORKSPACE}`)
        opencodeSessionId = null
        if (fs.existsSync(OC_SESSION_FILE)) fs.unlinkSync(OC_SESSION_FILE)
      }
    } else {
      if (!fs.existsSync(STARTER_DIR)) {
        return res.status(500).json({ error: 'Starter template not found at /opt/starter' })
      }
      execSync(`cp -a ${STARTER_DIR}/. ${WORKSPACE}/`, { stdio: 'pipe' })
      execSync(`rm -rf ${path.join(WORKSPACE, 'node_modules')}`, { stdio: 'pipe' })
      opencodeSessionId = null
      if (fs.existsSync(OC_SESSION_FILE)) fs.unlinkSync(OC_SESSION_FILE)
      await ensureGitRepo()
      await execAsync('git add -A', { cwd: WORKSPACE })
      await execAsync('git commit -m "Initial template"', { cwd: WORKSPACE })
      await saveBundle()
    }

    ensureNodeModules()
    spawnVite()

    // Start OpenCode server and connect event stream
    startOpencodeServer()
    try {
      await waitForOpencode()
      connectOpencodeEvents()
      await ensureOpencodeSession()
    } catch (e) {
      // Non-fatal: first /prompt will retry
      console.error('[opencode] startup error:', e.message)
    }

    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
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

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  activePromptRes = res
  wasStopped = false

  let sessionId
  try {
    sessionId = await ensureOpencodeSession()
  } catch (e) {
    writeSse(res, { type: 'error', text: `OpenCode session error: ${e.message}` })
    writeSse(res, { type: 'done', code: 1, sessionId: null, commitHash: null })
    res.end()
    activePromptRes = null
    return
  }

  const body = {
    parts: [{ type: 'text', text }],
  }

  // Register event listener before posting so we don't miss early events
  let firstTextSeen = false

  const listener = async (event) => {
    if (!event || !event.type) return

    // Text streaming — real-time deltas from the model
    if (event.type === 'message.part.delta') {
      const props = event.properties || {}
      if (props.sessionID !== sessionId) return
      if (props.field === 'text' && props.delta) {
        if (!firstTextSeen) {
          firstTextSeen = true
          writeSse(res, { type: 'new_turn' })
        }
        writeSse(res, { type: 'output', text: props.delta })
      }
    }

    // Tool use activity — emit when tool starts running
    if (event.type === 'message.part.updated') {
      const props = event.properties || {}
      const part = props.part || {}
      if (part.sessionID !== sessionId) return
      if (part.type === 'tool' && part.state && part.state.status === 'running') {
        const label = formatToolLabel(part.tool, part.state.input)
        if (label) writeSse(res, { type: 'activity', text: label })
      }
    }

    // Session finished generating
    if (event.type === 'session.idle' && (event.properties || {}).sessionID === sessionId) {
      sseEventListeners = sseEventListeners.filter(l => l !== listener)

      await onPromptComplete()
    }

    if (event.type === 'session.error' && (event.properties || {}).sessionID === sessionId) {
      sseEventListeners = sseEventListeners.filter(l => l !== listener)
      const errMsg = (event.properties || {}).error || 'Session error'
      writeSse(res, { type: 'error', text: errMsg })
      writeSse(res, { type: 'done', code: 1, sessionId, commitHash: null })
      res.end()
      activePromptRes = null
    }
  }

  sseEventListeners.push(listener)

  // Fire the prompt (async — response comes via SSE stream)
  try {
    const r = await fetch(`${OC_BASE}/session/${sessionId}/prompt_async`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) {
      const errBody = await r.text()
      throw new Error(`prompt_async ${r.status}: ${errBody}`)
    }
  } catch (e) {
    sseEventListeners = sseEventListeners.filter(l => l !== listener)
    writeSse(res, { type: 'error', text: e.message })
    writeSse(res, { type: 'done', code: 1, sessionId, commitHash: null })
    res.end()
    activePromptRes = null
  }

  async function onPromptComplete() {
    if (wasStopped) {
      wasStopped = false
      try {
        await execAsync('git reset --hard HEAD', { cwd: WORKSPACE })
      } catch (e) {
        console.error('reset on stop failed:', e.message)
      }
      // Discard session so next prompt starts fresh after a stop
      opencodeSessionId = null
      if (fs.existsSync(OC_SESSION_FILE)) fs.unlinkSync(OC_SESSION_FILE)
      writeSse(res, { type: 'stopped' })
      res.end()
      activePromptRes = null
      return
    }

    // Passive build check — if agent followed AGENTS.md this should already pass
    let buildPassed = false
    let buildErrors = ''
    try {
      await execAsync('npm run build', { cwd: WORKSPACE, timeout: 90000 })
      buildPassed = true
    } catch (e) {
      buildErrors = [e.stdout, e.stderr].filter(Boolean).join('\n')
        .split('\n').filter(l => l.trim()).slice(-30).join('\n')
      console.error('[build-check] failed:', buildErrors.slice(0, 500))
    }

    let commitHash = null
    try {
      await ensureGitRepo()
      await execAsync('git add -A', { cwd: WORKSPACE })
      await execAsync(`git commit -m "checkpoint-${Date.now()}" --allow-empty`, { cwd: WORKSPACE })
      commitHash = (await execAsync('git rev-parse HEAD', { cwd: WORKSPACE })).stdout.trim()
    } catch {}

    await saveBundle()

    if (!buildPassed && buildErrors) {
      writeSse(res, { type: 'build_error', text: buildErrors })
    }

    // env_needed must fire BEFORE done so the frontend dispatches setEnvNeeded
    // before streaming flips to false and the card renders correctly.
    const envNeeded = scanEnvPlaceholders()
    if (envNeeded.length > 0) {
      writeSse(res, { type: 'env_needed', vars: envNeeded })
    }

    writeSse(res, { type: 'done', code: 0, sessionId, commitHash, buildStatus: buildPassed ? 'ok' : 'broken', envNeeded: envNeeded.length > 0 ? envNeeded : undefined })
    res.end()
    activePromptRes = null
  }
})

app.post('/stop', async (req, res) => {
  wasStopped = true
  if (activePromptRes) {
    // Force-end the stream immediately; onPromptComplete will fire when session.idle arrives
    // but we clear the response handle so it no longer writes to the client
    sseEventListeners = []
    try { await execAsync('git reset --hard HEAD', { cwd: WORKSPACE }) } catch {}
    opencodeSessionId = null
    if (fs.existsSync(OC_SESSION_FILE)) fs.unlinkSync(OC_SESSION_FILE)
    writeSse(activePromptRes, { type: 'stopped' })
    activePromptRes.end()
    activePromptRes = null
  }
  wasStopped = false
  res.json({ ok: true })
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

    // Discard session so next prompt starts fresh from the restored state
    opencodeSessionId = null
    if (fs.existsSync(OC_SESSION_FILE)) fs.unlinkSync(OC_SESSION_FILE)

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
      if (hash !== currentHead) {
        const dirty = (await execAsync('git status --porcelain', { cwd: WORKSPACE })).stdout.trim().length > 0
        if (dirty) { await execAsync('git stash', { cwd: WORKSPACE }); stashed = true }
        await execAsync(`git checkout ${hash}`, { cwd: WORKSPACE })
        checkedOut = true
      }
    }

    const deployedHash = (await execAsync('git rev-parse HEAD', { cwd: WORKSPACE })).stdout.trim()
    const { stderr: buildStderr } = await execAsync('npm run build', { cwd: WORKSPACE, timeout: 120000, env: buildEnv })
    if (buildStderr) console.error('build stderr:', buildStderr)

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

    let siteId = result.site_id || null
    if (!siteId) {
      try { siteId = JSON.parse(fs.readFileSync(netlifyStatePath, 'utf8')).siteId || null } catch {}
    }

    const url = result.url || result.site_url || result.deploy_url
    if (!url) throw new Error(`Deploy succeeded but no URL returned: ${JSON.stringify(result)}`)

    res.json({ ok: true, url, deployedHash, siteId })
  } catch (e) {
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
  const { vars } = req.body
  if (!vars || typeof vars !== 'object') {
    return res.status(400).json({ error: 'vars must be an object' })
  }

  try {
    const envPath = path.join(WORKSPACE, '.env')
    let content = fs.existsSync(envPath) ? fs.readFileSync(envPath, 'utf8') : ''

    for (const [name, value] of Object.entries(vars)) {
      const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const placeholderRe = new RegExp(`^${escapedName}=\\s*$`, 'm')
      if (placeholderRe.test(content)) {
        content = content.replace(placeholderRe, `${name}=${value}`)
      } else {
        const existsRe = new RegExp(`^${escapedName}=`, 'm')
        if (!existsRe.test(content)) {
          content += (content.endsWith('\n') || content === '' ? '' : '\n') + `${name}=${value}\n`
        }
      }
    }

    fs.writeFileSync(envPath, content)

    // Restart Vite so it picks up the new .env values
    try { execSync('pkill -f "vite" || true', { stdio: 'pipe' }) } catch {}
    await new Promise(r => setTimeout(r, 500))
    spawnVite()

    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

initGitConfig()
app.listen(3001, () => console.log('Agent server ready on :3001'))
