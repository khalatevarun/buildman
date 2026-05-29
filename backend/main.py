import asyncio
import json
import os
import sys
import time
import uuid
import httpx
import modal
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="Buildman v2")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:5174",
        "https://khalatevarun--buildman-v2-fastapi-app.modal.run",
        "https://khalatevarun--buildman-v3-fastapi-app.modal.run",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)

sessions = modal.Dict.from_name("buildman-sessions", create_if_missing=True)
project_list_store = modal.Dict.from_name("buildman-project-list", create_if_missing=True)


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"

_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _create_sandbox(project_id: str, user_id: str) -> dict:
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(__file__))))
    from modal_app import sandbox_image, claude_secret, netlify_secret  # noqa: PLC0415

    workspace_volume = modal.Volume.from_name(f"buildman-proj-{project_id}", create_if_missing=True)
    secrets = [s for s in [claude_secret, netlify_secret] if s is not None]

    sandbox = modal.Sandbox.create(
        "node", "/app/agent-server.js",
        image=sandbox_image,
        secrets=secrets,
        cpu=2.0,
        memory=2048,
        timeout=3600,
        idle_timeout=900,
        encrypted_ports=[3001, 5173],
        volumes={"/data": workspace_volume},
    )
    tunnels = sandbox.tunnels()
    return {
        "sandbox_id": sandbox.object_id,
        "agent_url": tunnels[3001].url,
        "preview_url": tunnels[5173].url,
    }


def _destroy_sandbox(sandbox_id: str) -> None:
    modal.Sandbox.from_id(sandbox_id).terminate()


async def _wait_for_sandbox(agent_url: str, retries: int = 30, delay: float = 2.0) -> None:
    async with httpx.AsyncClient(timeout=5) as client:
        for _ in range(retries):
            try:
                r = await client.get(f"{agent_url}/healthz")
                if r.status_code == 200:
                    return
            except Exception:
                pass
            await asyncio.sleep(delay)
    raise TimeoutError("Sandbox did not become ready in time")


async def _init_workspace(agent_url: str) -> None:
    async with httpx.AsyncClient(timeout=300) as client:
        r = await client.post(f"{agent_url}/init-workspace")
        if r.status_code >= 400:
            raise RuntimeError(f"init-workspace failed: {r.status_code} {r.text}")


async def _touch_project(user_id: str, project_id: str) -> None:
    projects = await project_list_store.get.aio(user_id) or []
    now = int(time.time())
    for p in projects:
        if p["project_id"] == project_id:
            p["last_used_at"] = now
            break
    await project_list_store.put.aio(user_id, projects)


async def _get_deploy_info(user_id: str, project_id: str) -> dict:
    projects = await project_list_store.get.aio(user_id) or []
    for p in projects:
        if p["project_id"] == project_id:
            return {
                "deployed_hash": p.get("deployed_hash"),
                "deployed_url": p.get("deployed_url"),
                "netlify_site_id": p.get("netlify_site_id"),
            }
    return {"deployed_hash": None, "deployed_url": None, "netlify_site_id": None}


class CreateProjectRequest(BaseModel):
    user_id: str
    project_name: str


class PromptRequest(BaseModel):
    user_id: str
    text: str


class CheckpointRequest(BaseModel):
    user_id: str
    hash: str


class SetEnvRequest(BaseModel):
    user_id: str
    vars: dict[str, str]


class DeployRequest(BaseModel):
    user_id: str
    hash: str | None = None


class SaveChatRequest(BaseModel):
    user_id: str
    messages: list[dict]
    checkpoints: list[dict]


@app.get("/projects")
async def list_projects(user_id: str):
    projects = await project_list_store.get.aio(user_id) or []
    projects = [p for p in projects if p.get("name") != "__prewarm__"]
    projects.sort(key=lambda p: p.get("last_used_at", 0), reverse=True)
    return {"projects": projects}


@app.post("/projects")
async def create_project(req: CreateProjectRequest):
    project_id = str(uuid.uuid4())[:8]

    async def stream():
        yield _sse({"type": "phase", "text": "Provisioning sandbox…"})
        try:
            info = await asyncio.to_thread(_create_sandbox, project_id, req.user_id)

            # Persist session immediately; only add to project list for real (non-prewarm) projects
            now = int(time.time())
            name = req.project_name[:80] if req.project_name else f"Project {project_id}"
            await sessions.put.aio(req.user_id, {"project_id": project_id, **info})
            if name != "__prewarm__":
                projects = await project_list_store.get.aio(req.user_id) or []
                projects.insert(0, {
                    "project_id": project_id,
                    "name": name,
                    "created_at": now,
                    "last_used_at": now,
                    "deployed_url": None,
                    "deployed_hash": None,
                })
                await project_list_store.put.aio(req.user_id, projects)

            yield _sse({"type": "phase", "text": "Waiting for agent…"})
            await _wait_for_sandbox(info["agent_url"])

            yield _sse({"type": "phase", "text": "Preparing workspace…"})
            await _init_workspace(info["agent_url"])

            yield _sse({"type": "done", "project_id": project_id, "preview_url": info["preview_url"], "deployed_hash": None})
        except Exception as e:
            yield _sse({"type": "error", "text": str(e)})

    return StreamingResponse(stream(), media_type="text/event-stream", headers=_SSE_HEADERS)


class UpdateProjectRequest(BaseModel):
    user_id: str
    name: str


@app.patch("/projects/{project_id}")
async def update_project(project_id: str, req: UpdateProjectRequest):
    projects = await project_list_store.get.aio(req.user_id) or []
    for p in projects:
        if p["project_id"] == project_id:
            p["name"] = req.name[:80]
            break
    else:
        # Project not in list yet (was a prewarm) — insert it now
        now = int(time.time())
        projects.insert(0, {
            "project_id": project_id,
            "name": req.name[:80],
            "created_at": now,
            "last_used_at": now,
            "deployed_url": None,
            "deployed_hash": None,
        })
    await project_list_store.put.aio(req.user_id, projects)
    return {"ok": True}


class OpenProjectRequest(BaseModel):
    user_id: str


@app.post("/projects/{project_id}/open")
async def open_project(project_id: str, req: OpenProjectRequest):
    async def stream():
        session = await sessions.get.aio(req.user_id)

        # Reuse existing sandbox if it's already running this exact project
        if session and session.get("project_id") == project_id:
            try:
                async with httpx.AsyncClient(timeout=3) as client:
                    await client.get(f"{session['agent_url']}/healthz")
                await _touch_project(req.user_id, project_id)
                deploy_info = await _get_deploy_info(req.user_id, project_id)
                yield _sse({"type": "done", "project_id": project_id, "preview_url": session["preview_url"], **deploy_info})
                return
            except Exception:
                pass  # sandbox dead — fall through

        # Terminate stale sandbox for a different project
        if session:
            try:
                _destroy_sandbox(session["sandbox_id"])
            except Exception:
                pass

        # Spin up a fresh sandbox for this project
        yield _sse({"type": "phase", "text": "Starting sandbox…"})
        try:
            info = await asyncio.to_thread(_create_sandbox, project_id, req.user_id)
            await sessions.put.aio(req.user_id, {"project_id": project_id, **info})

            yield _sse({"type": "phase", "text": "Waiting for agent…"})
            await _wait_for_sandbox(info["agent_url"])

            yield _sse({"type": "phase", "text": "Restoring workspace…"})
            await _init_workspace(info["agent_url"])

            await _touch_project(req.user_id, project_id)
            deploy_info = await _get_deploy_info(req.user_id, project_id)
            yield _sse({"type": "done", "project_id": project_id, "preview_url": info["preview_url"], **deploy_info})
        except Exception as e:
            yield _sse({"type": "error", "text": str(e)})

    return StreamingResponse(stream(), media_type="text/event-stream", headers=_SSE_HEADERS)


def _wrap_prompt(text: str) -> str:
    return (
        "You are editing an existing Vite + React + TypeScript project in /workspace. "
        "Read CLAUDE.md first — it defines the full tech stack and every coding rule.\n\n"

        "TECH STACK REMINDER (all pre-installed, no npm install needed):\n"
        "- Tailwind CSS v4 for all styling — never write inline styles or custom CSS\n"
        "- lucide-react for all icons — never use emoji as icons\n"
        "- sonner for toasts — toast.success(), toast.error(), toast.promise()\n"
        "- motion/react for animations — motion.div, useAnimate, etc.\n"
        "- react-router-dom v6 for routing when the app needs multiple pages\n"
        "- cn() from @/lib/utils for conditional Tailwind classes\n"
        "- CSS custom properties: bg-background, bg-card, bg-muted, text-foreground, text-muted-foreground, "
        "text-primary, border-border, bg-primary, bg-destructive — use these, never hardcode colors\n\n"

        "DESIGN QUALITY STANDARDS (every output must meet these):\n"
        "- Mobile-first: every layout must work at 375px width; use sm: md: lg: breakpoints\n"
        "- Spacing: generous padding (p-6 p-8), consistent gap (gap-4 gap-6) — never cramped\n"
        "- Typography: font-bold tracking-tight for headings; text-muted-foreground for supporting text\n"
        "- Interactions: every button/link must have hover: and active: states with transition-colors\n"
        "- Cards: rounded-xl border border-border bg-card shadow-sm — always\n"
        "- Empty states: never show a blank area — always show a helpful empty state with an icon\n"
        "- Loading states: show skeletons or spinners (Loader2 from lucide + animate-spin) during async ops\n"
        "- The app should look like it was designed by a professional designer, not a developer\n\n"

        "STRICT RULES FOR YOUR REPLY TEXT (violating these is a failure):\n"
        "- VERY FIRST TOKENS: Write exactly <name>2-4 word title</name> on its own line before anything else. "
        "Title-case the name. Describe the app in 2-4 words (e.g. <name>Multi Timer App</name>). "
        "This tag is stripped before display — it is only for internal bookkeeping.\n"
        "- Write 2-3 sentences max. No more.\n"
        "- Never mention file names, paths, components, JSX, CSS, or any technical term.\n"
        "- Never mention environment variables, .env files, or placeholder values like __NEEDS_USER_VALUE__.\n"
        "- If the app needs an API key, say only: 'You'll be prompted to add your API key to complete the setup.'\n"
        "- Never narrate what you are about to do.\n"
        "- Never tell the user to open a browser, refresh, or take any action.\n"
        "- Speak only about what the user can now SEE or DO in their app, in plain everyday English.\n"
        "- Write as if describing the finished thing to a friend who has never written code.\n\n"
        f"User request: {text}"
    )


@app.post("/prompt")
async def send_prompt(req: PromptRequest):
    session = await sessions.get.aio(req.user_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active sandbox. Create a project first.")

    agent_url = session["agent_url"]

    async def stream():
        prompt_timeout = httpx.Timeout(connect=30.0, read=1800.0, write=30.0, pool=30.0)
        async with httpx.AsyncClient(timeout=prompt_timeout) as client:
            async with client.stream(
                "POST", f"{agent_url}/prompt", json={"text": _wrap_prompt(req.text)}
            ) as r:
                async for chunk in r.aiter_text():
                    yield chunk

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


@app.get("/sandbox/status")
async def sandbox_status(user_id: str):
    session = await sessions.get.aio(user_id)
    if not session:
        return {"status": "cold"}
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            await client.get(f"{session['agent_url']}/healthz")
        project_id = session.get("project_id")
        deploy_info = await _get_deploy_info(user_id, project_id) if project_id else {"deployed_hash": None, "deployed_url": None}
        return {
            "status": "ready",
            "preview_url": session["preview_url"],
            "project_id": project_id,
            **deploy_info,
        }
    except Exception:
        await sessions.pop.aio(user_id, None)
        return {"status": "cold"}


@app.post("/preview")
async def preview_checkpoint(req: CheckpointRequest):
    session = await sessions.get.aio(req.user_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active sandbox.")
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(f"{session['agent_url']}/preview", json={"hash": req.hash})
        return r.json()


@app.post("/preview-exit")
async def preview_exit(user_id: str):
    session = await sessions.get.aio(user_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active sandbox.")
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(f"{session['agent_url']}/preview-exit")
        return r.json()


@app.post("/restore")
async def restore_checkpoint(req: CheckpointRequest):
    session = await sessions.get.aio(req.user_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active sandbox.")
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(f"{session['agent_url']}/restore", json={"hash": req.hash})
        return r.json()


@app.post("/set-env")
async def set_env(req: SetEnvRequest):
    session = await sessions.get.aio(req.user_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active sandbox.")
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{session['agent_url']}/set-env", json={"vars": req.vars})
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.text)
        return r.json()


@app.post("/deploy")
async def deploy_project(req: DeployRequest):
    session = await sessions.get.aio(req.user_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active sandbox.")
    project_id = session.get("project_id")
    # Look up existing Netlify site ID to reuse the same site on republish
    deploy_info = await _get_deploy_info(req.user_id, project_id) if project_id else {}
    netlify_site_id = deploy_info.get("netlify_site_id")
    async with httpx.AsyncClient(timeout=180) as client:
        r = await client.post(
            f"{session['agent_url']}/deploy",
            json={"hash": req.hash, "netlify_site_id": netlify_site_id},
        )
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.text)
        result = r.json()
        if result.get("url") and project_id:
            projects = await project_list_store.get.aio(req.user_id) or []
            for p in projects:
                if p["project_id"] == project_id:
                    p["deployed_url"] = result["url"]
                    p["deployed_hash"] = result.get("deployedHash")
                    if result.get("siteId"):
                        p["netlify_site_id"] = result["siteId"]
                    break
            await project_list_store.put.aio(req.user_id, projects)
        return result


@app.post("/projects/{project_id}/chat")
async def save_chat(project_id: str, req: SaveChatRequest):
    session = await sessions.get.aio(req.user_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active sandbox.")
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{session['agent_url']}/save-chat", json={"messages": req.messages, "checkpoints": req.checkpoints})
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.text)
        return r.json()


@app.get("/projects/{project_id}/chat")
async def load_chat(project_id: str, user_id: str):
    session = await sessions.get.aio(user_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active sandbox.")
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{session['agent_url']}/load-chat")
        return r.json()


@app.get("/vite-logs")
async def vite_logs(user_id: str):
    session = await sessions.get.aio(user_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active sandbox.")
    async with httpx.AsyncClient(timeout=5) as client:
        r = await client.get(f"{session['agent_url']}/vite-logs")
        return r.json()


@app.delete("/sandbox")
async def destroy_sandbox_endpoint(user_id: str):
    session = await sessions.get.aio(user_id)
    if not session:
        return {"ok": True}
    _destroy_sandbox(session["sandbox_id"])
    await sessions.pop.aio(user_id)
    return {"ok": True}


def _delete_volume(project_id: str) -> None:
    try:
        vol = modal.Volume.from_name(f"buildman-proj-{project_id}")
        vol.delete()
    except Exception:
        pass  # volume may not exist if project never ran a prompt


@app.delete("/projects/{project_id}")
async def delete_project(project_id: str, user_id: str):
    # Terminate sandbox if it's running this project
    session = await sessions.get.aio(user_id)
    if session and session.get("project_id") == project_id:
        try:
            _destroy_sandbox(session["sandbox_id"])
        except Exception:
            pass
        await sessions.pop.aio(user_id, None)

    # Remove from project list
    projects = await project_list_store.get.aio(user_id) or []
    projects = [p for p in projects if p["project_id"] != project_id]
    await project_list_store.put.aio(user_id, projects)

    # Delete the Modal volume (blocks briefly — run in thread)
    await asyncio.to_thread(_delete_volume, project_id)

    return {"ok": True}
