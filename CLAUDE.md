# CLAUDE.md

## Deployment Rule — ALWAYS follow this after any backend change

**Any change to `backend/main.py`, `backend/sandbox_image/agent-server.js`, `backend/sandbox_image/package.json`, or `backend/sandbox_image/starter/*` MUST be deployed to Modal before the work is considered done.**

Steps (always run from `v2/`):
1. If `agent-server.js`, `package.json`, or `starter/*` changed → rebuild `sandbox_embedded.py` first (see command below)
2. Activate venv: `source .venv/bin/activate`
3. Deploy: `.venv/bin/modal deploy modal_app.py`

Do not wait for the user to ask — deploy immediately after making backend changes.

## Development Commands

### Backend (Python / FastAPI)
```bash
cd v2
source .venv/bin/activate

# Run locally (not typical — backend is designed to run on Modal)
uvicorn backend.main:app --port 8000

# Deploy to Modal (REQUIRED after every backend change)
.venv/bin/modal deploy modal_app.py

# After editing agent-server.js or starter/*, rebuild sandbox_embedded.py first:
python3 -c "
import base64, subprocess
result = subprocess.run(['tar','-czf','-','--exclude=./node_modules','-C','backend/sandbox_image/starter','.'], capture_output=True)
starter_b64 = base64.b64encode(result.stdout).decode()
with open('backend/sandbox_image/agent-server.js','rb') as f: agent_b64 = base64.b64encode(f.read()).decode()
with open('backend/sandbox_image/package.json','rb') as f: pkg_b64 = base64.b64encode(f.read()).decode()
with open('sandbox_embedded.py','w') as f:
    f.write(f'AGENT_SERVER_B64 = \"{agent_b64}\"\nPACKAGE_JSON_B64 = \"{pkg_b64}\"\nSTARTER_TAR_GZ_B64 = \"{starter_b64}\"\n')
print('Done')
"
```

### Frontend (React + Vite)
```bash
cd v2/frontend
npm run dev       # Vite dev server (port 5173)
npm run build     # tsc -b && vite build (ALWAYS use this to verify frontend changes — not npx tsc --noEmit, which skips unused-locals checks)
npm run lint      # ESLint
```

### Environment
Copy `frontend/.env.example` → `frontend/.env` and fill in:
- `VITE_CLERK_PUBLISHABLE_KEY` — Clerk publishable key
- `VITE_API_URL` — Backend URL (Modal deploy URL or `http://localhost:8000` for local)

Modal secrets required: `claude-credentials` containing `CLAUDE_CODE_OAUTH_TOKEN`.

## Architecture

### The Three Layers

**1. Frontend** (`frontend/src/`) — React + Redux Toolkit + Tailwind + Clerk auth

**Pages:**
- `pages/Home.tsx` — prompt input + example prompts only; calls `POST /projects` on Build; prewarms sandbox immediately on sign-in; navigates to `/workspace/:id` on submit
- `pages/Projects.tsx` — `/projects` route; lists all user projects from `GET /projects`; navigates to `/workspace/:id` on open
- `pages/Workspace.tsx` — chat panel (left) + preview iframe (right); calls `ensureSandbox(projectId)` on mount then fires `initialPrompt` if present in location state

**Hooks:**
- `hooks/useSandbox.ts` — sandbox lifecycle manager:
  - `prewarm()`: fires background `POST /projects` with name `__prewarm__`; stores promise in ref; not added to project list
  - `createProject(name)`: if prewarm resolved, PATCHes the name (which inserts it into the project list) and reuses sandbox; otherwise streams a fresh creation with phase updates
  - `ensureSandbox(projectId)`: fast-path via `GET /sandbox/status` if same project already running; otherwise SSE `POST /projects/{id}/open`
  - `cancelPrewarm()`: terminates the prewarm sandbox if `createProject` was never called — call this on Home unmount
  - Returns `{ previewUrl, status, phase, prewarm, createProject, ensureSandbox, destroySandbox, cancelPrewarm }`
- `hooks/usePrompt.ts` — sends prompt via native `fetch` SSE stream; accumulates activities per-message; dispatches `finalizeMessage(activities)` on done
- `hooks/useProjects.ts` — fetches `GET /projects` for the Projects page

**State (Redux — `store/index.ts`):**
- `messages: ChatMessage[]` — each message has `{ role, text, activities: string[] }`
- `liveActivity: string[]` — activities for the currently streaming message (cleared by `finalizeMessage`)
- `checkpoints: Checkpoint[]` — one per completed prompt, keyed by `commitHash`
- `streaming: boolean`
- `previewingHash: string | null` — set when user clicks a past checkpoint to preview
- `deployedHash: string | null` — hash of the last deployed version; shown as "LIVE" on matching checkpoint

**Components:**
- `ChatPanel.tsx` — renders messages + `ActivityTicker` per message + `CheckpointCard` with deploy button
- `CheckpointCard.tsx` — shows commit summary, "LIVE" pill if `isDeployed`, Deploy/Redeploy button
- `ActivityTicker.tsx` — collapsed: shows latest action (streaming) or "N actions" count (done); expandable
- `PreviewPane.tsx` — iframe wrapper with reload/fullscreen toolbar icons (CSS `group/preview` hover, no React state); single loading word picked per prompt from a 70-word list
- `utility/api.ts` — axios instance at `VITE_API_URL`; native `fetch` used for SSE endpoints

**2. Backend** (`backend/main.py`) — FastAPI served on Modal via `@modal.asgi_app()`

Sessions stored in `modal.Dict("buildman-sessions")`, keyed by `user_id`.
Project metadata stored in `modal.Dict("buildman-project-list")`, keyed by `user_id`.

**Endpoints:**
- `POST /projects` — streams phases ("Provisioning sandbox…" → "Waiting for agent…" → "Preparing workspace…" → `done`); skips adding to project list if `project_name == "__prewarm__"`
- `PATCH /projects/{id}` — renames a project; inserts into project list if not already there (handles prewarm → real project promotion)
- `GET /projects` — returns project list sorted by `last_used_at`; filters out any stale `__prewarm__` entries
- `POST /projects/{id}/open` — streams phases to reconnect to or recreate a sandbox for an existing project; fast-paths if sandbox already alive for same project
- `POST /prompt` — proxies SSE stream from `agent_url/prompt` (30-min read timeout)
- `GET /sandbox/status` — pings `/healthz`; returns `{ status, preview_url, project_id, deployed_hash }`
- `DELETE /sandbox` — terminates sandbox, removes session
- `POST /preview`, `/preview-exit`, `/restore` — git checkout/stash/reset operations
- `POST /deploy` — deploys a specific commit hash to Netlify; stores `deployed_url` and `deployed_hash` in project metadata
- `POST /set-env` — sets env vars in the sandbox workspace

**SSE format:** all streaming endpoints yield `data: {json}\n\n`. Events: `{ type: "phase", text }`, `{ type: "done", ...payload }`, `{ type: "error", text }`.

**System prompt (`_wrap_prompt`):** prepended to every user prompt before forwarding to Claude. Enforces 2-3 sentence replies in plain English, no technical jargon, no mention of file names / env vars / `__NEEDS_USER_VALUE__` / `.env` files. Edit this to change Claude's persona.

**3. Modal Sandbox** — ephemeral VM per user running `node /app/agent-server.js`
- Port 3001: `agent-server.js` (Express)
- Port 5173: Vite dev server (started by `/init-workspace`)
- Both ports tunnelled via Modal encrypted tunnel URLs (`*.modal.host`)
- Idle timeout: 15 min. Dead sandboxes return `status: "cold"` from `/sandbox/status`.
- One sandbox per user — opening a new project terminates the previous one

### Agent Server (`backend/sandbox_image/agent-server.js`)

The control plane inside each sandbox. Key behaviors:
- Claude runs as user `buildman` (uid 1000) to avoid root permission issues
- Session continuity: Claude's `--resume <sessionId>` flag persists conversation across prompts; session ID stored at `/workspace/.claude-session-id`
- After each `/prompt` completes, makes a `git commit` checkpoint; hash returned in `{ type: "done", commitHash }`
- `/deploy`: accepts optional `hash`; if given, stashes dirty state, checks out that hash, builds + deploys to Netlify, then restores to `main` in a `finally` block. Returns `{ ok, url, deployedHash }`
- Auth priority: `ANTHROPIC_API_KEY` → `CLAUDE_CODE_OAUTH_TOKEN` → `CLAUDE_CONFIG_DIR/.credentials.json`

### Persistence

Each project gets its own Modal Volume (`buildman-proj-{project_id}`), mounted at `/data`. After each prompt, the workspace is bundled with `git bundle create /data/workspace.bundle --all`. On sandbox startup, `/init-workspace` restores from the bundle via `git clone`. This keeps `/workspace` on fast local disk (no NFS latency during Claude's file I/O) while surviving sandbox restarts.

### `sandbox_embedded.py`

Auto-generated file — do not edit manually. Contains base64-encoded `agent-server.js`, `package.json`, and the starter template tarball. Baked into the Modal image at build time. Must be regenerated before `modal deploy` whenever sandbox image files change.

### Modal App (`modal_app.py`)

Defines two images:
- `sandbox_image` — the per-user VM image (Debian + Node 20 + Claude Code + Netlify CLI + pre-installed starter)
- `backend_image` — the FastAPI host image (Python + FastAPI + httpx + modal)

The FastAPI function runs with `min_containers=1` (always-warm) and `timeout=1800` to handle long Claude codegen sessions.

## Key Constraints

- **One sandbox per user** — opening a different project terminates the running one
- **Prewarm is invisible** — prewarm sandboxes are never added to `buildman-project-list`; the project only appears in the list after the user submits a prompt (via PATCH rename)
- **`cancelPrewarm()` must be called on Home unmount** — otherwise the prewarm sandbox leaks; it calls `DELETE /sandbox` only if the prewarm was never consumed
- **Per-project Netlify sites** — each project deploys to its own Netlify site; `deployed_hash` and `deployed_url` are stored in the project metadata and returned on sandbox open/status
- Frontend uses native `fetch` (not axios) for SSE endpoints because axios does not support streaming SSE
