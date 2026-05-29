# Buildman v2 — Architecture

## What This Is

Buildman v2 is an AI-powered web app builder where:
1. User types a prompt on the Home page
2. A warm cloud sandbox (Node.js + git + Claude Code) is created on Modal
3. Claude Code runs inside the sandbox, edits a live React/Vite project
4. The user sees Claude's activity streamed in real time and the result in a preview iframe

## Request Flow

```
Home page
  → POST /projects          create sandbox + seed React template + start Vite
  → navigate /workspace/:id

Workspace page mounts
  → GET /sandbox/status     get preview URL for the iframe
  → user types prompt
  → POST /prompt            stream SSE: Claude edits files → Vite HMR updates preview
```

## Directory Structure

```
v2/
├── modal_app.py                   Modal app definition (images, functions)
├── sandbox_embedded.py            Auto-generated: base64 of agent-server.js + starter tar
├── backend/
│   ├── main.py                    FastAPI app (4 endpoints)
│   ├── sandbox_manager.py         Thin wrapper: calls create_sandbox_fn.remote()
│   ├── volume_manager.py          Unused — kept for reference, can be deleted
│   └── sandbox_image/
│       ├── agent-server.js        Express server that runs INSIDE the sandbox
│       ├── package.json           Dependencies for agent-server.js (express only)
│       └── starter/               React + Vite + TypeScript starter template
│           ├── vite.config.ts     Has allowedHosts: true for Modal tunnel URLs
│           └── src/App.tsx        Default app entry point
└── frontend/
    ├── src/
    │   ├── pages/
    │   │   ├── Home.tsx           Prompt input + "Start Building" → POST /projects
    │   │   └── Workspace.tsx      Chat panel + preview iframe
    │   ├── hooks/
    │   │   ├── useSandbox.ts      createProject(), resumeIfAlive(), destroySandbox()
    │   │   └── usePrompt.ts       sendPrompt() → SSE stream → Redux dispatch
    │   ├── components/
    │   │   ├── ChatPanel.tsx      Renders output/activity events from Claude
    │   │   └── PreviewPane.tsx    iframe pointed at the Modal sandbox tunnel URL
    │   └── utility/api.ts         axios instance pointed at VITE_API_URL
```

## Backend API (FastAPI on Modal)

Deployed at: `https://khalatevarun--buildman-v3-fastapi-app.modal.run`

| Method | Path | What it does |
|--------|------|--------------|
| POST | `/projects` | Creates a Modal Sandbox, waits for `/healthz`, calls `/init-workspace`, returns `{project_id, preview_url}` |
| POST | `/prompt` | Proxies SSE stream from the sandbox's `/prompt` endpoint (Claude running inside) |
| GET | `/sandbox/status` | Pings sandbox `/healthz`; returns `{status: "ready", preview_url}` or `{status: "cold"}` |
| DELETE | `/sandbox` | Terminates the sandbox and removes the session |

Sessions are stored in `modal.Dict("buildman-sessions")` — a shared KV store across Modal container instances, keyed by `user_id`.

## Modal Sandbox

Each user gets one sandbox: a Modal ephemeral VM running `node /app/agent-server.js`.

**Image contents** (`sandbox_image` in `modal_app.py`):
- Debian slim + git + Node 20
- `@anthropic-ai/claude-code` installed globally
- Global git identity (`agent@buildman.dev`) and `safe.directory = *` baked in
- `/app/agent-server.js` and its `node_modules` (express)
- `/opt/starter/` — the React template with `node_modules` pre-installed

**Ports exposed:** `3001` (agent-server) and `5173` (Vite dev server), both tunnelled via Modal's encrypted tunnel URLs (`*.modal.host`).

## Agent Server (`agent-server.js`)

Runs inside the sandbox on port 3001. Three endpoints:

**`GET /healthz`** — Returns `{ok: true, auth_mode: "oauth_token"|"api_key"|null}`. Used by `_wait_for_sandbox` to know when the container is ready.

**`POST /init-workspace`** — Called once after sandbox creation:
1. If `/workspace` is empty: copies `/opt/starter/.` → `/workspace`, runs `npm install`, `git init -b main`, makes initial commit
2. Always: spawns `npm run dev -- --host 0.0.0.0 --port 5173` (Vite, detached)

**`POST /prompt`** — Receives `{text}`, spawns:
```
claude --print --dangerously-skip-permissions --output-format stream-json --verbose [--resume <sessionId>] "<text>"
```
Streams JSON events as SSE back to the caller:
- `{type: "output", text}` — Claude's text response
- `{type: "activity", text}` — tool use labels (e.g. `Edit: src/App.tsx`)
- `{type: "error", text}` — stderr
- `{type: "done", code, sessionId}` — stream end; after this a git checkpoint commit is made

Claude runs as the `buildman` user (uid 1000). Session ID is persisted to `/workspace/.claude-session-id` so follow-up prompts continue the same conversation.

## Deploying Changes

```bash
cd v2

# 1. Edit backend/sandbox_image/agent-server.js or backend/sandbox_image/starter/*

# 2. Rebuild sandbox_embedded.py (re-encodes agent-server.js + starter tar)
python3 -c "
import base64, subprocess, re
result = subprocess.run(['tar','-czf','-','-C','backend/sandbox_image/starter','.'], capture_output=True)
starter_b64 = base64.b64encode(result.stdout).decode()
with open('backend/sandbox_image/agent-server.js','rb') as f: agent_b64 = base64.b64encode(f.read()).decode()
with open('backend/sandbox_image/package.json','rb') as f: pkg_b64 = base64.b64encode(f.read()).decode()
with open('sandbox_embedded.py','w') as f:
    f.write(f'AGENT_SERVER_B64 = \"{agent_b64}\"\nPACKAGE_JSON_B64 = \"{pkg_b64}\"\nSTARTER_TAR_GZ_B64 = \"{starter_b64}\"\n')
print('Done')
"

# 3. Deploy
.venv/bin/modal deploy modal_app.py
```

## Auth

- **Clerk** — frontend auth (`useUser()` provides `user.id` which is the `user_id` for all API calls)
- **Claude** — `CLAUDE_CODE_OAUTH_TOKEN` stored as a Modal secret named `claude-credentials`

## Known Limitations / Next Steps

- Sandboxes are ephemeral — if a sandbox dies (Modal idle timeout = 15 min), the session is lost. The frontend shows "cold" and the user needs to create a new project.
- One sandbox per user — creating a new project terminates the previous one implicitly (the session entry is overwritten).
- `volume_manager.py` is unused dead code.
- `useCheckpoints.ts` and `CheckpointList.tsx` in the frontend are unused (checkpoint/restore endpoints were removed during simplification).
