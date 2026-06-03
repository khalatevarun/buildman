import asyncio
import json
import os
import sys
import time
import uuid
import httpx
import modal
from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer
from pydantic import BaseModel

app = FastAPI(title="Buildman v2")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

sessions = modal.Dict.from_name("buildman-sessions", create_if_missing=True)
project_list_store = modal.Dict.from_name("buildman-project-list", create_if_missing=True)

# ---------------------------------------------------------------------------
# Clerk JWT validation
# ---------------------------------------------------------------------------

_security = HTTPBearer()
_jwks_cache: dict = {}


async def _get_public_jwks() -> dict:
    global _jwks_cache
    if _jwks_cache:
        return _jwks_cache
    jwks_url = os.environ.get("CLERK_JWKS_URL")
    if not jwks_url:
        raise HTTPException(status_code=500, detail="CLERK_JWKS_URL is not configured")
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(jwks_url)
        r.raise_for_status()
    _jwks_cache = r.json()
    return _jwks_cache


async def get_current_user_id(credentials=Depends(_security)) -> str:
    token = credentials.credentials
    try:
        from jose import jwt as _jwt  # noqa: PLC0415
        header = _jwt.get_unverified_header(token)
        kid = header.get("kid")
        jwks = await _get_public_jwks()
        key = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
        if key is None:
            # JWKS may have rotated — clear cache and retry once
            _jwks_cache.clear()
            jwks = await _get_public_jwks()
            key = next((k for k in jwks.get("keys", []) if k.get("kid") == kid), None)
        if key is None:
            raise HTTPException(status_code=401, detail="Unrecognized token key")
        payload = _jwt.decode(token, key, algorithms=["RS256"])
        user_id: str | None = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Token missing subject")
        return user_id
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=401, detail=f"Unauthorized: {exc}") from exc


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"

_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


def _modal_app_dir() -> str:
    return os.path.dirname(os.path.dirname(__file__))


def _create_sandbox(project_id: str, user_id: str) -> dict:
    sys.path.insert(0, _modal_app_dir())
    from modal_app import sandbox_image, netlify_secret  # noqa: PLC0415

    secrets = [s for s in [netlify_secret] if s is not None]

    sandbox = modal.Sandbox.create(
        "node", "/app/agent-server.js",
        image=sandbox_image,
        secrets=secrets,
        cpu=1.0,
        memory=1024,
        timeout=3600,
        idle_timeout=900,
        encrypted_ports=[3001, 5173],
    )
    tunnels = sandbox.tunnels()
    return {
        "sandbox_id": sandbox.object_id,
        "agent_url": tunnels[3001].url,
        "preview_url": tunnels[5173].url,
    }


def _restore_from_snapshot(snapshot_id: str) -> dict:
    sys.path.insert(0, _modal_app_dir())
    from modal_app import netlify_secret  # noqa: PLC0415

    image = modal.Image.from_id(snapshot_id)
    secrets = [s for s in [netlify_secret] if s is not None]

    sandbox = modal.Sandbox.create(
        "node", "/app/agent-server.js",
        image=image,
        secrets=secrets,
        cpu=2.0,
        memory=2048,
        timeout=3600,
        idle_timeout=900,
        encrypted_ports=[3001, 5173],
    )
    tunnels = sandbox.tunnels()
    return {
        "sandbox_id": sandbox.object_id,
        "agent_url": tunnels[3001].url,
        "preview_url": tunnels[5173].url,
    }


def _claim_from_pool() -> dict | None:
    sys.path.insert(0, _modal_app_dir())
    from modal_app import sandbox_pool_queue  # noqa: PLC0415

    while True:
        ref = sandbox_pool_queue.get(block=False)
        if ref is None:
            return None

        if ref["expires_at"] < time.time() + (5 * 60):
            try:
                modal.Sandbox.from_id(ref["sandbox_id"]).terminate()
            except Exception:
                pass
            continue

        try:
            r = httpx.get(f"{ref['agent_url']}/healthz", timeout=3)
            if r.status_code == 200:
                return {
                    "sandbox_id": ref["sandbox_id"],
                    "agent_url": ref["agent_url"],
                    "preview_url": ref["preview_url"],
                }
        except Exception:
            pass


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
    """Returns deploy metadata for a project. Does NOT include netlify_site_id."""
    projects = await project_list_store.get.aio(user_id) or []
    for p in projects:
        if p["project_id"] == project_id:
            return {
                "deployed_hash": p.get("deployed_hash"),
                "deployed_url": p.get("deployed_url"),
            }
    return {"deployed_hash": None, "deployed_url": None}


async def _get_netlify_site_id(user_id: str, project_id: str) -> str | None:
    projects = await project_list_store.get.aio(user_id) or []
    for p in projects:
        if p["project_id"] == project_id:
            return p.get("netlify_site_id")
    return None


async def _assert_project_owner(user_id: str, project_id: str) -> None:
    """Raises 403 if the project does not belong to this user."""
    projects = await project_list_store.get.aio(user_id) or []
    if not any(p["project_id"] == project_id for p in projects):
        raise HTTPException(status_code=403, detail="Not your project")


async def _take_snapshot(user_id: str, sandbox_id: str, project_id: str) -> None:
    try:
        def _snap() -> str:
            sb = modal.Sandbox.from_id(sandbox_id)
            image = sb.snapshot_filesystem()
            return image.object_id

        image_id = await asyncio.to_thread(_snap)

        projects = await project_list_store.get.aio(user_id) or []
        for p in projects:
            if p["project_id"] == project_id:
                p["snapshot_id"] = image_id
                p["snapshot_at"] = int(time.time())
                break
        await project_list_store.put.aio(user_id, projects)
        print(f"[snapshot] project={project_id} image={image_id}")
    except Exception as e:
        print(f"[snapshot] failed for project={project_id}: {e}")


# ---------------------------------------------------------------------------
# Request models — user_id is optional since it is now derived from the JWT
# ---------------------------------------------------------------------------

class CreateProjectRequest(BaseModel):
    user_id: str | None = None
    project_name: str


class PromptRequest(BaseModel):
    user_id: str | None = None
    text: str


class CheckpointRequest(BaseModel):
    user_id: str | None = None
    hash: str


class SetEnvRequest(BaseModel):
    user_id: str | None = None
    vars: dict[str, str]


class DeployRequest(BaseModel):
    user_id: str | None = None
    hash: str | None = None


class SaveChatRequest(BaseModel):
    user_id: str | None = None
    messages: list[dict]
    checkpoints: list[dict]


class StopRequest(BaseModel):
    user_id: str | None = None


class UpdateProjectRequest(BaseModel):
    user_id: str | None = None
    name: str


class OpenProjectRequest(BaseModel):
    user_id: str | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------

@app.get("/projects")
async def list_projects(user_id: str = Depends(get_current_user_id)):
    projects = await project_list_store.get.aio(user_id) or []
    projects = [p for p in projects if p.get("name") != "__prewarm__"]
    projects.sort(key=lambda p: p.get("last_used_at", 0), reverse=True)
    return {"projects": projects}


@app.post("/projects")
async def create_project(req: CreateProjectRequest, user_id: str = Depends(get_current_user_id)):
    project_id = str(uuid.uuid4())[:8]

    async def stream():
        yield _sse({"type": "phase", "text": "Building your workspace…"})
        try:
            info = await asyncio.to_thread(_claim_from_pool)

            if info is not None:
                sys.path.insert(0, _modal_app_dir())
                from modal_app import spawn_sandbox  # noqa: PLC0415
                spawn_sandbox.spawn()
            else:
                info = await asyncio.to_thread(_create_sandbox, project_id, user_id)
                yield _sse({"type": "phase", "text": "Warming things up…"})
                await _wait_for_sandbox(info["agent_url"])
                yield _sse({"type": "phase", "text": "Laying the groundwork…"})
                await _init_workspace(info["agent_url"])

            now = int(time.time())
            name = req.project_name[:80] if req.project_name else f"Project {project_id}"
            await sessions.put.aio(user_id, {"project_id": project_id, **info})
            projects = await project_list_store.get.aio(user_id) or []
            projects.insert(0, {
                "project_id": project_id,
                "name": name,
                "created_at": now,
                "last_used_at": now,
                "deployed_url": None,
                "deployed_hash": None,
            })
            await project_list_store.put.aio(user_id, projects)

            yield _sse({"type": "done", "project_id": project_id, "preview_url": info["preview_url"], "deployed_hash": None})
        except Exception as e:
            yield _sse({"type": "error", "text": str(e)})

    return StreamingResponse(stream(), media_type="text/event-stream", headers=_SSE_HEADERS)


@app.patch("/projects/{project_id}")
async def update_project(project_id: str, req: UpdateProjectRequest, user_id: str = Depends(get_current_user_id)):
    projects = await project_list_store.get.aio(user_id) or []
    for p in projects:
        if p["project_id"] == project_id:
            p["name"] = req.name[:80]
            break
    else:
        raise HTTPException(status_code=403, detail="Not your project")
    await project_list_store.put.aio(user_id, projects)
    return {"ok": True}


@app.post("/projects/{project_id}/open")
async def open_project(project_id: str, req: OpenProjectRequest, user_id: str = Depends(get_current_user_id)):
    await _assert_project_owner(user_id, project_id)

    async def stream():
        session = await sessions.get.aio(user_id)

        if session and session.get("project_id") == project_id:
            try:
                async with httpx.AsyncClient(timeout=3) as client:
                    await client.get(f"{session['agent_url']}/healthz")
                await _touch_project(user_id, project_id)
                deploy_info = await _get_deploy_info(user_id, project_id)
                yield _sse({"type": "done", "project_id": project_id, "preview_url": session["preview_url"], **deploy_info})
                return
            except Exception:
                pass

        if session:
            try:
                _destroy_sandbox(session["sandbox_id"])
            except Exception:
                pass

        projects = await project_list_store.get.aio(user_id) or []
        project = next((p for p in projects if p["project_id"] == project_id), None)
        snapshot_id = project.get("snapshot_id") if project else None

        if snapshot_id:
            yield _sse({"type": "phase", "text": "Picking up where you left off…"})
            try:
                info = await asyncio.to_thread(_restore_from_snapshot, snapshot_id)
                await sessions.put.aio(user_id, {"project_id": project_id, **info})

                yield _sse({"type": "phase", "text": "Waiting for agent…"})
                await _wait_for_sandbox(info["agent_url"])

                yield _sse({"type": "phase", "text": "Almost there…"})
                await _init_workspace(info["agent_url"])

                await _touch_project(user_id, project_id)
                deploy_info = await _get_deploy_info(user_id, project_id)
                yield _sse({"type": "done", "project_id": project_id, "preview_url": info["preview_url"], **deploy_info})
                return
            except Exception as e:
                print(f"[restore] snapshot restore failed for project={project_id}: {e}")

        yield _sse({"type": "phase", "text": "Building your workspace…"})
        try:
            info = await asyncio.to_thread(_create_sandbox, project_id, user_id)
            await sessions.put.aio(user_id, {"project_id": project_id, **info})

            yield _sse({"type": "phase", "text": "Waiting for agent…"})
            await _wait_for_sandbox(info["agent_url"])

            yield _sse({"type": "phase", "text": "Laying the groundwork…"})
            await _init_workspace(info["agent_url"])

            await _touch_project(user_id, project_id)
            deploy_info = await _get_deploy_info(user_id, project_id)
            yield _sse({"type": "done", "project_id": project_id, "preview_url": info["preview_url"], **deploy_info})
        except Exception as e:
            yield _sse({"type": "error", "text": str(e)})

    return StreamingResponse(stream(), media_type="text/event-stream", headers=_SSE_HEADERS)


_AGENT_RULES = (
    "Never tell the user to run any commands (e.g. 'npm run dev', 'npm start', 'node server.js'). "
    "You are an agent running inside a sandbox where the dev server is already running — "
    "the user sees a live preview automatically. Just describe what you built.\n\n"
)

_QUALITY_BAR = (
    "Build as if this is a real product. "
    "No placeholder text, no 'Lorem ipsum', no 'Coming soon', no 'TODO'. "
    "Every button, label, heading, and message should be what the real app would show. "
    "Every layout must work on both mobile and desktop.\n\n"
)

def _wrap_prompt(text: str, is_first_prompt: bool = False) -> str:
    if is_first_prompt:
        return (
            "Begin your reply with exactly `<name>2-4 word title</name>` on its own line "
            "before anything else. Title-case it (e.g. `<name>Todo List App</name>`).\n\n"
            "Go straight to implementation — no planning narration, no commentary before code. "
            "Build one file at a time, complete and working.\n\n"
            + _QUALITY_BAR
            + _AGENT_RULES
            + "Build a complete, fully working version — all core flows functional, "
            "no skeleton screens with TODO comments, no half-built features.\n\n"
            + text
        )
    return (
        _AGENT_RULES
        + "The existing app already works. Make only the changes the user is asking for — "
        "do not rewrite or restructure what already exists. Extend it cleanly.\n\n"
        + _QUALITY_BAR
        + text
    )


@app.post("/prompt")
async def send_prompt(req: PromptRequest, user_id: str = Depends(get_current_user_id)):
    session = await sessions.get.aio(user_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active sandbox. Create a project first.")

    agent_url = session["agent_url"]
    sandbox_id = session["sandbox_id"]
    project_id = session.get("project_id")

    prompt_count = session.get("prompt_count", 0)
    is_first_prompt = prompt_count == 0
    session["prompt_count"] = prompt_count + 1
    await sessions.put.aio(user_id, session)

    async def stream():
        prompt_timeout = httpx.Timeout(connect=30.0, read=1800.0, write=30.0, pool=30.0)
        async with httpx.AsyncClient(timeout=prompt_timeout) as client:
            async with client.stream(
                "POST", f"{agent_url}/prompt", json={"text": _wrap_prompt(req.text, is_first_prompt=is_first_prompt)}
            ) as r:
                async for chunk in r.aiter_text():
                    yield chunk

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
    )


@app.post("/stop")
async def stop_prompt(req: StopRequest, user_id: str = Depends(get_current_user_id)):
    session = await sessions.get.aio(user_id)
    if not session:
        return {"ok": True}
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{session['agent_url']}/stop")
        return r.json()


@app.get("/sandbox/status")
async def sandbox_status(user_id: str = Depends(get_current_user_id)):
    session = await sessions.get.aio(user_id)
    if not session:
        return {"status": "cold"}
    try:
        async with httpx.AsyncClient(timeout=3) as client:
            await client.get(f"{session['agent_url']}/healthz")
        project_id = session.get("project_id")
        deploy_info = await _get_deploy_info(user_id, project_id) if project_id else {"deployed_hash": None, "deployed_url": None}
        env_needed = []
        try:
            async with httpx.AsyncClient(timeout=3) as client:
                r = await client.get(f"{session['agent_url']}/env-status")
                if r.status_code == 200:
                    env_needed = r.json().get("env_needed", [])
        except Exception:
            pass
        return {
            "status": "ready",
            "preview_url": session["preview_url"],
            "project_id": project_id,
            "env_needed": env_needed,
            **deploy_info,
        }
    except Exception:
        await sessions.pop.aio(user_id, None)
        return {"status": "cold"}


@app.post("/preview")
async def preview_checkpoint(req: CheckpointRequest, user_id: str = Depends(get_current_user_id)):
    session = await sessions.get.aio(user_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active sandbox.")
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(f"{session['agent_url']}/preview", json={"hash": req.hash})
        return r.json()


@app.post("/preview-exit")
async def preview_exit(user_id: str = Depends(get_current_user_id)):
    session = await sessions.get.aio(user_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active sandbox.")
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(f"{session['agent_url']}/preview-exit")
        return r.json()


@app.post("/restore")
async def restore_checkpoint(req: CheckpointRequest, user_id: str = Depends(get_current_user_id)):
    session = await sessions.get.aio(user_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active sandbox.")
    async with httpx.AsyncClient(timeout=15) as client:
        r = await client.post(f"{session['agent_url']}/restore", json={"hash": req.hash})
        return r.json()


@app.post("/set-env")
async def set_env(req: SetEnvRequest, user_id: str = Depends(get_current_user_id)):
    session = await sessions.get.aio(user_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active sandbox.")
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.post(f"{session['agent_url']}/set-env", json={"vars": req.vars})
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.text)
        return r.json()


@app.post("/deploy")
async def deploy_project(req: DeployRequest, user_id: str = Depends(get_current_user_id)):
    session = await sessions.get.aio(user_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active sandbox.")
    project_id = session.get("project_id")
    netlify_site_id = await _get_netlify_site_id(user_id, project_id) if project_id else None
    async with httpx.AsyncClient(timeout=180) as client:
        r = await client.post(
            f"{session['agent_url']}/deploy",
            json={"hash": req.hash, "netlify_site_id": netlify_site_id},
        )
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.text)
        result = r.json()
        if result.get("url") and project_id:
            projects = await project_list_store.get.aio(user_id) or []
            for p in projects:
                if p["project_id"] == project_id:
                    p["deployed_url"] = result["url"]
                    p["deployed_hash"] = result.get("deployedHash")
                    if result.get("siteId"):
                        p["netlify_site_id"] = result["siteId"]
                    break
            await project_list_store.put.aio(user_id, projects)
        return result


@app.post("/projects/{project_id}/chat")
async def save_chat(project_id: str, req: SaveChatRequest, user_id: str = Depends(get_current_user_id)):
    await _assert_project_owner(user_id, project_id)
    session = await sessions.get.aio(user_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active sandbox.")
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{session['agent_url']}/save-chat", json={"messages": req.messages, "checkpoints": req.checkpoints})
        if r.status_code >= 400:
            raise HTTPException(status_code=r.status_code, detail=r.text)
    asyncio.create_task(_take_snapshot(user_id, session["sandbox_id"], project_id))
    return {"ok": True}


@app.get("/projects/{project_id}/chat")
async def load_chat(project_id: str, user_id: str = Depends(get_current_user_id)):
    await _assert_project_owner(user_id, project_id)
    session = await sessions.get.aio(user_id)
    if not session:
        raise HTTPException(status_code=404, detail="No active sandbox.")
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(f"{session['agent_url']}/load-chat")
        return r.json()


@app.delete("/sandbox")
async def destroy_sandbox_endpoint(user_id: str = Depends(get_current_user_id)):
    session = await sessions.get.aio(user_id)
    if not session:
        return {"ok": True}
    _destroy_sandbox(session["sandbox_id"])
    await sessions.pop.aio(user_id)
    return {"ok": True}


@app.delete("/projects/{project_id}")
async def delete_project(project_id: str, user_id: str = Depends(get_current_user_id)):
    projects = await project_list_store.get.aio(user_id) or []
    project = next((p for p in projects if p["project_id"] == project_id), None)
    if not project:
        raise HTTPException(status_code=403, detail="Not your project")

    snapshot_id = project.get("snapshot_id")
    netlify_site_id = project.get("netlify_site_id")

    session = await sessions.get.aio(user_id)
    if session and session.get("project_id") == project_id:
        try:
            _destroy_sandbox(session["sandbox_id"])
        except Exception:
            pass
        await sessions.pop.aio(user_id, None)

    projects = [p for p in projects if p["project_id"] != project_id]
    await project_list_store.put.aio(user_id, projects)

    if snapshot_id:
        def _delete_snapshot() -> None:
            try:
                modal.experimental.image_delete(snapshot_id)
            except Exception:
                pass
        await asyncio.to_thread(_delete_snapshot)

    if netlify_site_id:
        import subprocess  # noqa: PLC0415
        token = os.environ.get("NETLIFY_AUTH_TOKEN")
        if token:
            try:
                await asyncio.to_thread(
                    lambda: subprocess.run(
                        ["netlify", "sites:delete", netlify_site_id, "--force"],
                        env={**os.environ, "NETLIFY_AUTH_TOKEN": token},
                        capture_output=True,
                        timeout=30,
                    )
                )
            except Exception:
                pass

    return {"ok": True}
