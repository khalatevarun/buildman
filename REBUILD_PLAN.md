# Buildman v2 — Full Rebuild Plan

## What We're Building

A Bolt.new / Lovable / v0 competitor for building web apps. User describes what they want, an AI agent writes the code inside an isolated cloud sandbox, and the result runs live in a preview iframe. Built from scratch with Modal Sandboxes + Claude Code CLI as the agent.

---

## Final Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     FRONTEND                            │
│         React + Vite + Tailwind + Clerk Auth            │
│   Chat panel | File explorer | Live preview iframe      │
└───────────────────┬─────────────────────────────────────┘
                    │ HTTP + SSE
┌───────────────────▼─────────────────────────────────────┐
│              PYTHON FASTAPI BACKEND                     │
│              (Modal web endpoint, serverless)           │
│  - Creates / destroys sandboxes                         │
│  - Manages Modal Volumes (project persistence)          │
│  - Forwards prompts to sandbox agent server             │
│  - Proxies SSE stream to frontend                       │
│  - Returns Vite preview URL to frontend                 │
└───────────────────┬─────────────────────────────────────┘
                    │ HTTP (internal Modal network)
┌───────────────────▼─────────────────────────────────────┐
│           MODAL SANDBOX (one per user session)          │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Node.js Agent Server (~30 lines, port 3001)    │   │
│  │  POST /prompt  → spawn claude --print --bare    │   │
│  │  GET  /checkpoints → git log                    │   │
│  │  POST /restore → git checkout <hash>            │   │
│  │  GET  /files   → list /workspace files          │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Claude Code CLI (npm i -g @anthropic-ai/claude-code)│
│  │  Runs with ANTHROPIC_API_KEY from Modal secret  │   │
│  │  cwd = /workspace                               │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │  Vite Dev Server (port 5173)                    │   │
│  │  Started after first agent turn completes       │   │
│  │  HMR picks up file changes on subsequent turns  │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  /workspace/  ←──── Modal Volume mount                  │
│  ├── .git/           (full checkpoint history)          │
│  ├── src/            (generated files)                  │
│  ├── package.json                                       │
│  └── ...                                                │
└─────────────────────────────────────────────────────────┘
```

---

## Key Design Decisions (and why)

| Decision | Choice | Reason |
|---|---|---|
| Agent | Claude Code CLI | Coding-specialized, headless mode, no SDK needed |
| Execution | Modal Sandbox | Isolated cloud container, port exposure, ephemeral |
| Persistence | Modal Volume | Mounts as filesystem, survives sandbox death, git history preserved |
| Session memory | `CLAUDE_CONFIG_DIR=/workspace/.claude-data` | Redirects Claude's session JSONL onto Modal Volume — full conversation history survives sandbox restarts without symlinks or custom memory |
| Auth | Clerk | 30min integration, handles everything |
| Versioning | Git inside sandbox | Free, checkpoints = commits, restore = git checkout |
| Backend | Python FastAPI on Modal | Thin orchestrator, Modal SDK is Python-native |
| Agent server | Node.js (~30 lines) | Thin subprocess wrapper for Claude Code CLI |
| Preview | Vite dev server + sandbox.expose_port() | Standard, HMR works across turns |
| Model | Claude Sonnet 4.6 via ANTHROPIC_API_KEY | Best coding model, already familiar |

---

## Project Structure

```
buildman-v2/
├── backend/
│   ├── main.py                  # FastAPI app (Modal web endpoint)
│   ├── sandbox_manager.py       # Modal sandbox lifecycle
│   ├── volume_manager.py        # Modal volume CRUD
│   ├── routes/
│   │   ├── projects.py          # GET/POST /projects
│   │   ├── prompt.py            # POST /prompt (SSE)
│   │   └── sandbox.py           # GET /sandbox/status, DELETE /sandbox
│   └── sandbox_image/
│       ├── agent-server.js      # Node.js agent server (baked into Modal image)
│       ├── package.json         # { "dependencies": { "express": "^4" } }
│       └── start.sh             # Starts agent server + waits
├── frontend/
│   ├── src/
│   │   ├── pages/
│   │   │   ├── Home.tsx         # Prompt input + new project flow
│   │   │   └── Workspace.tsx    # Three-panel IDE layout
│   │   ├── components/
│   │   │   ├── ChatPanel.tsx    # Conversation history + prompt input
│   │   │   ├── FileExplorer.tsx # File tree of /workspace
│   │   │   ├── CodeEditor.tsx   # Monaco editor (read-only view)
│   │   │   ├── PreviewPane.tsx  # iframe pointing at Vite URL
│   │   │   └── CheckpointList.tsx # Sidebar with git checkpoints
│   │   ├── hooks/
│   │   │   ├── useSandbox.ts    # Sandbox lifecycle management
│   │   │   ├── usePrompt.ts     # SSE stream handling
│   │   │   └── useCheckpoints.ts# Checkpoint list + restore
│   │   ├── store/
│   │   │   └── index.ts         # Redux store (or Zustand)
│   │   └── utility/
│   │       └── api.ts           # Axios client
│   └── vite.config.ts
├── modal_app.py                 # Modal app definition + image build
└── .env                        # ANTHROPIC_API_KEY, CLERK keys
```

---

## Phase 1 — Modal Infrastructure

### 1.1 Modal Image Definition (`modal_app.py`)

```python
import modal

app = modal.App("buildman-v2")

# Pre-built image with everything the sandbox needs
sandbox_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "curl")
    .run_commands(
        # Install Node.js 20
        "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
        "apt-get install -y nodejs",
        # Install Claude Code CLI globally
        "npm install -g @anthropic-ai/claude-code",
    )
    # Copy agent server into image
    .copy_local_file("backend/sandbox_image/agent-server.js", "/app/agent-server.js")
    .copy_local_file("backend/sandbox_image/package.json", "/app/package.json")
    .run_commands("cd /app && npm install")
)
```

### 1.2 Sandbox Lifecycle (`backend/sandbox_manager.py`)

```python
import modal
from modal_app import app, sandbox_image

anthropic_secret = modal.Secret.from_name("anthropic-secret")

def create_sandbox(project_id: str, user_id: str) -> dict:
    volume = modal.Volume.from_name(
        f"project-{user_id}-{project_id}",
        create_if_missing=True
    )

    # *args positional = the CMD to run on boot (not 'entrypoint=' — that param doesn't exist)
    # Ports must be declared at creation time via unencrypted_ports; tunnels() won't have them otherwise
    # idle_timeout auto-terminates after inactivity; no need for manual cleanup loop in Python
    sandbox = modal.Sandbox.create(
        "node", "/app/agent-server.js",
        image=sandbox_image,
        secrets=[anthropic_secret],
        volumes={"/workspace": volume},
        cpu=0.5,
        memory=1024,
        timeout=3600,
        idle_timeout=900,  # auto-terminate after 15min idle (replaces manual cleanup loop)
        unencrypted_ports=[3001, 5173],  # must declare ports here; tunnels() key on these
    )

    # tunnels() returns dict[int, Tunnel] keyed by port — ports must be in unencrypted_ports above
    # preview_url stored now; iframe will be blank until POST /start-vite fires Vite on 5173
    tunnels = sandbox.tunnels()

    return {
        "sandbox_id": sandbox.object_id,
        "agent_url": tunnels[3001].url,
        "preview_url": tunnels[5173].url,
    }

def destroy_sandbox(sandbox_id: str):
    sandbox = modal.Sandbox.from_id(sandbox_id)
    sandbox.terminate()
```

### 1.3 Volume Manager (`backend/volume_manager.py`)

```python
import modal

def get_or_create_volume(user_id: str, project_id: str) -> modal.Volume:
    return modal.Volume.from_name(
        f"project-{user_id}-{project_id}",
        create_if_missing=True
    )

def list_user_projects(user_id: str) -> list[dict]:
    # modal.Volume.list() does not exist — correct API is modal.Volume.objects.list()
    volumes = modal.Volume.objects.list()
    user_volumes = [v for v in volumes if v.name.startswith(f"project-{user_id}-")]
    return [
        {
            "project_id": v.name.split(f"project-{user_id}-")[1],
            "name": v.name,
            # created_at not a direct attribute — omit or call v.info() if needed later
        }
        for v in user_volumes
    ]

def commit_volume(user_id: str, project_id: str):
    vol = modal.Volume.from_name(f"project-{user_id}-{project_id}")
    vol.commit()  # persist latest writes from sandbox
```

---

## Phase 2 — Agent Server (inside sandbox)

### `backend/sandbox_image/agent-server.js`

```javascript
const express = require('express')
const { spawn, exec } = require('child_process')
const { promisify } = require('util')
const fs = require('fs')
const execAsync = promisify(exec)

const app = express()
app.use(express.json())

const WORKSPACE = '/workspace'

// Sessions stored on Modal Volume — survive sandbox restarts
// Docs: set CLAUDE_CONFIG_DIR to redirect ~/.claude away from ephemeral sandbox FS
// Ref: https://code.claude.com/docs/en/sessions
const CLAUDE_CONFIG_DIR = '/workspace/.claude-data'
const SESSION_ID_FILE = '/workspace/.claude-session-id'

// Load session ID from volume if sandbox restarted
let claudeSessionId = fs.existsSync(SESSION_ID_FILE)
  ? fs.readFileSync(SESSION_ID_FILE, 'utf8').trim()
  : null

async function initGit() {
  try {
    await execAsync('git rev-parse --git-dir', { cwd: WORKSPACE })
  } catch {
    await execAsync(
      'git init && git config user.email "agent@buildman.dev" && git config user.name "Buildman Agent"',
      { cwd: WORKSPACE }
    )
  }
}

// POST /prompt — run Claude Code, stream output, commit checkpoint
app.post('/prompt', async (req, res) => {
  const { text } = req.body

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')

  // --output-format stream-json: newline-delimited JSON events, each carries session_id
  // --dangerously-skip-permissions: safe inside Modal sandbox (container boundary does the security work)
  // CI=1: skips first-run interactive setup wizard
  // CLAUDE_CONFIG_DIR: redirects session storage onto Modal Volume for persistence across sandbox restarts
  const args = [
    '--print', '--bare',
    '--dangerously-skip-permissions',
    '--output-format', 'stream-json',
    '--verbose',
    ...(claudeSessionId ? ['--resume', claudeSessionId] : []),
    text
  ]

  const proc = spawn('claude', args, {
    cwd: WORKSPACE,
    env: {
      ...process.env,
      CI: '1',
      CLAUDE_CONFIG_DIR,
    },
  })

  let buffer = ''

  proc.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    const lines = buffer.split('\n')
    buffer = lines.pop() // hold incomplete last line

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)

        // Capture session_id from first event that carries it, persist to volume
        if (event.session_id && !claudeSessionId) {
          claudeSessionId = event.session_id
          fs.writeFileSync(SESSION_ID_FILE, claudeSessionId)
        }

        // Forward assistant text to frontend
        if (event.type === 'assistant' && event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text') {
              res.write(`data: ${JSON.stringify({ type: 'output', text: block.text })}\n\n`)
            }
          }
        }
      } catch { /* incomplete JSON line, skip */ }
    }
  })

  proc.stderr.on('data', (chunk) => {
    res.write(`data: ${JSON.stringify({ type: 'error', text: chunk.toString() })}\n\n`)
  })

  proc.on('close', async (code) => {
    try {
      await execAsync('git add -A', { cwd: WORKSPACE })
      await execAsync(`git commit -m "checkpoint-${Date.now()}" --allow-empty`, { cwd: WORKSPACE })
      const { stdout } = await execAsync('git rev-parse HEAD', { cwd: WORKSPACE })
      res.write(`data: ${JSON.stringify({ type: 'checkpoint', hash: stdout.trim() })}\n\n`)
    } catch { /* nothing to commit */ }

    res.write(`data: ${JSON.stringify({ type: 'done', code, sessionId: claudeSessionId })}\n\n`)
    res.end()
  })
})

// GET /checkpoints — full git log
app.get('/checkpoints', async (req, res) => {
  try {
    const { stdout } = await execAsync(
      'git log --oneline --format="%H|%s|%ai"',
      { cwd: WORKSPACE }
    )
    const checkpoints = stdout.trim().split('\n').filter(Boolean).map(line => {
      const [hash, message, date] = line.split('|')
      return { hash, message, date }
    })
    res.json(checkpoints)
  } catch {
    res.json([])
  }
})

// POST /restore — checkout a checkpoint
app.post('/restore', async (req, res) => {
  const { hash } = req.body
  try {
    await execAsync(`git checkout ${hash} -- .`, { cwd: WORKSPACE })
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

// GET /files — list all files in workspace
app.get('/files', async (req, res) => {
  try {
    const { stdout } = await execAsync(
      'find . -type f -not -path "./.git/*" -not -path "./node_modules/*"',
      { cwd: WORKSPACE }
    )
    res.json(stdout.trim().split('\n').filter(Boolean))
  } catch {
    res.json([])
  }
})

// POST /start-vite — npm install + npm run dev
app.post('/start-vite', async (req, res) => {
  try {
    await execAsync('npm install', { cwd: WORKSPACE })
    spawn('npm', ['run', 'dev', '--', '--host', '0.0.0.0', '--port', '5173'], {
      cwd: WORKSPACE,
      detached: true,
      stdio: 'ignore',
    }).unref()
    res.json({ ok: true })
  } catch (e) {
    res.status(500).json({ error: e.message })
  }
})

initGit().then(() => {
  app.listen(3001, () => console.log('Agent server ready on :3001'))
})
```

---

## Phase 3 — Python FastAPI Backend

### `backend/main.py`

```python
from fastapi import FastAPI, HTTPException, Depends
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
import httpx
import modal

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "https://your-frontend.com"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# In-memory session store: user_id -> { sandbox_id, agent_url, preview_url }
# Replace with Redis for production
sessions: dict[str, dict] = {}

@app.post("/projects")
async def create_project(user_id: str, project_name: str):
    """Create a new project — provisions sandbox + volume."""
    from sandbox_manager import create_sandbox
    import uuid
    project_id = str(uuid.uuid4())[:8]
    info = create_sandbox(project_id, user_id)
    sessions[user_id] = {
        "project_id": project_id,
        **info
    }
    return { "project_id": project_id, "preview_url": info["preview_url"] }

@app.get("/projects")
async def list_projects(user_id: str):
    """List all projects for a user (from Modal Volume names)."""
    from volume_manager import list_user_projects
    return list_user_projects(user_id)

@app.post("/prompt")
async def send_prompt(user_id: str, text: str):
    """Forward prompt to sandbox agent, stream SSE response back."""
    session = sessions.get(user_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active sandbox. Create a project first.")

    agent_url = session["agent_url"]

    async def stream():
        async with httpx.AsyncClient(timeout=300) as client:
            async with client.stream("POST", f"{agent_url}/prompt", json={"text": text}) as r:
                async for chunk in r.aiter_text():
                    yield chunk
        # Commit volume after agent finishes
        from volume_manager import commit_volume
        commit_volume(user_id, session["project_id"])

    return StreamingResponse(stream(), media_type="text/event-stream")

@app.post("/start-preview")
async def start_preview(user_id: str):
    """Trigger npm install + vite dev server inside sandbox."""
    session = sessions.get(user_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active sandbox.")
    agent_url = session["agent_url"]
    async with httpx.AsyncClient() as client:
        await client.post(f"{agent_url}/start-vite")
    return { "preview_url": session["preview_url"] }

@app.get("/checkpoints")
async def get_checkpoints(user_id: str):
    session = sessions.get(user_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active sandbox.")
    async with httpx.AsyncClient() as client:
        r = await client.get(f"{session['agent_url']}/checkpoints")
        return r.json()

@app.post("/restore")
async def restore_checkpoint(user_id: str, hash: str):
    session = sessions.get(user_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active sandbox.")
    async with httpx.AsyncClient() as client:
        r = await client.post(f"{session['agent_url']}/restore", json={"hash": hash})
        return r.json()

@app.delete("/sandbox")
async def destroy_sandbox(user_id: str):
    session = sessions.get(user_id)
    if not session:
        return { "ok": True }
    from sandbox_manager import destroy_sandbox as _destroy
    _destroy(session["sandbox_id"])
    del sessions[user_id]
    return { "ok": True }

@app.get("/sandbox/status")
async def sandbox_status(user_id: str):
    """Frontend calls this on workspace load to check if sandbox is alive."""
    session = sessions.get(user_id)
    if not session:
        return { "status": "cold" }
    # Ping the agent server to verify it's actually responsive
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            await client.get(f"{session['agent_url']}/healthz")
        return { "status": "ready", "preview_url": session["preview_url"] }
    except Exception:
        del sessions[user_id]
        return { "status": "cold" }

@app.post("/sandbox/restore")
async def restore_sandbox(user_id: str, project_id: str):
    """Re-create sandbox for an existing project, mount its volume, restart Vite.
    Called by frontend when status is 'cold'. Blocks until ready (~30-60s)."""
    from sandbox_manager import create_sandbox
    info = create_sandbox(project_id, user_id)  # volume already has all files + .claude-data
    sessions[user_id] = { "project_id": project_id, **info }
    # Restart Vite (node_modules already on volume, so npm install is fast)
    async with httpx.AsyncClient(timeout=120) as client:
        await client.post(f"{info['agent_url']}/start-vite")
    return { "status": "ready", "preview_url": info["preview_url"] }
```

> Add `GET /healthz` to agent server (one-liner: `app.get('/healthz', (_, res) => res.json({ ok: true }))`)

### Deploy Backend to Modal

```python
# modal_app.py — add web endpoint
@app.function(
    image=modal.Image.debian_slim().pip_install("fastapi", "httpx", "uvicorn"),
    secrets=[modal.Secret.from_name("anthropic-secret")],
    keep_warm=1,  # keep one instance warm for fast response
)
@modal.web_endpoint(method="POST")
def fastapi_app():
    import uvicorn
    from backend.main import app as fastapi_app
    uvicorn.run(fastapi_app, host="0.0.0.0", port=8000)
```

---

## Phase 4 — Frontend

### Tech Stack
- React 18 + Vite
- TypeScript
- Tailwind CSS
- Clerk (auth)
- Redux Toolkit (state)
- Axios (HTTP)
- ~~Monaco Editor~~ — deferred until file explorer is built

### Key Components

#### `src/pages/Home.tsx`
- Clerk `<SignIn />` / `<UserButton />`
- Text prompt input
- "Start Building" button → calls `POST /projects` → navigates to `/workspace/:projectId`

#### `src/pages/Workspace.tsx`
Two-panel layout (no code editor in v1):
```
┌──────────────────────┬──────────────────────┐
│  LEFT PANEL          │  RIGHT PANEL         │
│                      │                      │
│  Chat Timeline       │  Preview             │
│  + Checkpoint list   │  (iframe)            │
│  + Prompt input      │                      │
│                      │                      │
└──────────────────────┴──────────────────────┘
```

On mount, calls `resumeProject(projectId)`. While `status === 'restoring'` or `status === 'creating'`, renders a full-screen overlay:
```
┌─────────────────────────────────────────────┐
│                                             │
│   ⟳  Restoring your project...             │
│      This takes about 30 seconds.           │
│                                             │
└─────────────────────────────────────────────┘
```
Overlay lifts when `status === 'ready'` and `previewUrl` is set.

> File explorer + Monaco editor deferred. `GET /files` endpoint exists in agent server but is not called by the frontend in v1.

#### `src/hooks/useSandbox.ts`
```typescript
type SandboxStatus = 'idle' | 'creating' | 'restoring' | 'ready'

export function useSandbox(userId: string) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<SandboxStatus>('idle')

  // New project: create sandbox + volume from scratch
  const createProject = async (name: string) => {
    setStatus('creating')
    const { data } = await api.post('/projects', { user_id: userId, project_name: name })
    setPreviewUrl(data.preview_url)
    setStatus('ready')
    return data.project_id
  }

  // Returning user: check if sandbox is alive, restore if not
  const resumeProject = async (projectId: string) => {
    const { data: statusData } = await api.get(`/sandbox/status?user_id=${userId}`)
    if (statusData.status === 'ready') {
      setPreviewUrl(statusData.preview_url)
      setStatus('ready')
      return
    }
    // Sandbox is cold — restore it (modal volume has all files)
    setStatus('restoring')
    const { data } = await api.post(`/sandbox/restore?user_id=${userId}&project_id=${projectId}`)
    setPreviewUrl(data.preview_url)
    setStatus('ready')
  }

  useEffect(() => {
    return () => { api.delete(`/sandbox?user_id=${userId}`) }
  }, [userId])

  return { previewUrl, status, createProject, resumeProject }
}
```

#### `src/hooks/usePrompt.ts`
```typescript
export function usePrompt(userId: string) {
  const [streaming, setStreaming] = useState(false)
  const dispatch = useDispatch()

  const sendPrompt = async (text: string) => {
    setStreaming(true)
    const response = await fetch(`${API_URL}/prompt?user_id=${userId}&text=${encodeURIComponent(text)}`)
    const reader = response.body!.getReader()
    const decoder = new TextDecoder()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const chunk = decoder.decode(value)
      const lines = chunk.split('\n').filter(l => l.startsWith('data: '))
      for (const line of lines) {
        const event = JSON.parse(line.slice(6))
        if (event.type === 'output') dispatch(appendChatOutput(event.text))
        if (event.type === 'checkpoint') dispatch(addCheckpoint(event))
        if (event.type === 'done') setStreaming(false)
      }
    }
  }

  return { sendPrompt, streaming }
}
```

#### `src/hooks/useCheckpoints.ts`
```typescript
export function useCheckpoints(userId: string) {
  const [checkpoints, setCheckpoints] = useState([])

  const fetchCheckpoints = async () => {
    const { data } = await api.get(`/checkpoints?user_id=${userId}`)
    setCheckpoints(data)
  }

  const restoreCheckpoint = async (hash: string) => {
    await api.post('/restore', { user_id: userId, hash })
    // Vite HMR fires automatically — preview updates
  }

  return { checkpoints, fetchCheckpoints, restoreCheckpoint }
}
```

---

## Phase 5 — Clerk Auth Integration

### Install
```bash
npm install @clerk/clerk-react
```

### Setup (`src/main.tsx`)
```tsx
import { ClerkProvider } from '@clerk/clerk-react'

<ClerkProvider publishableKey={import.meta.env.VITE_CLERK_PUBLISHABLE_KEY}>
  <App />
</ClerkProvider>
```

### Get user ID in components
```tsx
import { useUser } from '@clerk/clerk-react'

const { user } = useUser()
const userId = user?.id  // pass this to all API calls
```

---

## Phase 6 — Modal Secrets Setup

```bash
# One-time setup
modal secret create anthropic-secret ANTHROPIC_API_KEY=sk-ant-...

# Verify
modal secret list
```

---

## Phase 7 — Sandbox Lifecycle & Inactivity Timeout

### Modal handles this natively via `idle_timeout`

`idle_timeout=900` (15 min) is set directly in `Sandbox.create()` — Modal auto-terminates the sandbox after 15 minutes of no activity. No keepalive ping, no background cleanup loop, no `/sandbox/ping` endpoint needed.

The manual cleanup loop from the original design is **removed** — it was reimplementing what `idle_timeout` already does.

When the sandbox dies, the Modal Volume survives with all files + session JSONL intact. The user returns, `GET /sandbox/status` returns `"cold"`, frontend shows "Restoring your project...", `POST /sandbox/restore` spins up a fresh sandbox on the same volume.

---

## Phase 8 — First Run Flow (Turn 1)

```
1. User enters prompt on Home page
2. Frontend calls POST /projects → backend creates sandbox + mounts volume
3. Backend starts agent server inside sandbox
4. Frontend navigates to /workspace
5. Frontend calls POST /prompt with user text
6. Backend forwards to sandbox POST /prompt
7. Claude Code runs: claude --print --bare --dangerously-skip-permissions --output-format stream-json "Build a React todo app..."
8. Claude writes files to /workspace (which IS the Modal Volume)
9. Agent server streams output back → SSE → frontend chat panel
10. On 'done' event: frontend calls POST /start-preview
11. Backend calls sandbox POST /start-vite
12. npm install + npm run dev starts in /workspace
13. Vite serves on port 5173, sandbox exposes tunnel URL
14. Frontend loads preview URL in iframe
15. Agent server commits: git add -A && git commit -m "checkpoint-1"
16. Backend calls volume.commit() to persist to Modal storage
17. Checkpoint appears in sidebar
```

## Subsequent Turns (Turn 2+)

```
1. User types follow-up ("make the button blue")
2. POST /prompt → claude --print --bare --resume <session-id> "make the button blue"
3. Claude has full conversation history from session JSONL on /workspace/.claude-data
4. Claude edits only Button.tsx (surgical edit, not full rewrite)
5. Vite HMR detects file change → preview updates instantly
6. New git commit → new checkpoint
7. volume.commit() persists changes (including updated session JSONL)
```

### Session persistence across sandbox restarts
- Session JSONL lives at `/workspace/.claude-data/` (on Modal Volume, not sandbox FS)
- Session ID written to `/workspace/.claude-session-id` after turn 1
- On sandbox cold-start, agent server reads session ID from file → `--resume` picks up full history
- No symlinks, no custom memory system needed

---

## Environment Variables

```bash
# Backend (.env)
ANTHROPIC_API_KEY=sk-ant-...          # injected via Modal secret

# Frontend (.env)
VITE_CLERK_PUBLISHABLE_KEY=pk_...
VITE_API_URL=https://your-modal-backend.modal.run
```

---

## Python Environment — Always Use venv

All Python work must use a virtual environment. Never install packages globally.

```bash
# Create venv at project root (one-time)
python3 -m venv .venv

# Activate before any Python work
source .venv/bin/activate          # macOS/Linux
# .venv\Scripts\activate           # Windows

# Install backend deps
pip install fastapi httpx uvicorn modal

# Freeze deps
pip freeze > requirements.txt

# Deactivate when done
deactivate
```

Add `.venv/` to `.gitignore`.

Every `modal deploy`, `modal run`, and `pip install` must be run with the venv active.

---

## Build Order

1. **Modal image** — get Claude Code running inside a container locally first
2. **Agent server** — test `POST /prompt` manually with curl, verify git commits
3. **Python backend** — sandbox creation, volume mounting, SSE proxy
4. **Frontend skeleton** — Home page + Workspace layout, no functionality
5. **Wire up prompt flow** — SSE streaming end to end
6. **Preview** — start-vite endpoint + iframe
7. **Checkpoints** — git log sidebar + restore
8. **Auth** — Clerk integration
9. **Project list** — load existing volumes on login
10. **Inactivity timeout** — keepalive + cleanup

---

## Open Questions for Later

- **Rate limiting** — one sandbox per user enforced?
- **File editor** — read-only Monaco viewer or allow manual edits?
- **Export** — ZIP download of /workspace?
- **Framework templates** — start with React/Vite boilerplate or truly empty dir?
- **Multi-project** — switch between projects without losing sandbox state?
- **Cross-device** — volume restores on new device but needs new sandbox spin-up

---

## Cost Estimate (with $280 Modal credits)

```
Sandbox compute:  ~$0.048/hour per session
15min idle limit: ~$0.012 per abandoned session

If avg session = 45min active:
  $0.048 × 0.75hr = $0.036 per session
  $280 ÷ $0.036 ≈ ~7,700 sessions of runway

Modal Volumes:    First 1 TiB free → effectively $0 for personal use
```
