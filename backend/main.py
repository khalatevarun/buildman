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


def _modal_app_dir() -> str:
    # modal_app.py lives two levels above backend/main.py
    return os.path.dirname(os.path.dirname(os.path.dirname(__file__)))


def _create_sandbox(project_id: str, user_id: str) -> dict:
    sys.path.insert(0, _modal_app_dir())
    from modal_app import sandbox_image, claude_secret, netlify_secret  # noqa: PLC0415

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
    )
    tunnels = sandbox.tunnels()
    return {
        "sandbox_id": sandbox.object_id,
        "agent_url": tunnels[3001].url,
        "preview_url": tunnels[5173].url,
    }


def _restore_from_snapshot(snapshot_id: str) -> dict:
    """Create a new sandbox using a filesystem snapshot image as the base.

    Verified against Modal docs:
    https://modal.com/docs/guide/sandbox-snapshots
    https://modal.com/docs/reference/modal.Image (from_id method)
    """
    sys.path.insert(0, _modal_app_dir())
    from modal_app import claude_secret, netlify_secret  # noqa: PLC0415

    # modal.Image.from_id() reconstructs an Image object from a stored ID.
    # Confirmed available: modal.com/docs/reference/modal.Image
    image = modal.Image.from_id(snapshot_id)
    secrets = [s for s in [claude_secret, netlify_secret] if s is not None]

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
    """Pop one healthy sandbox from the warm pool queue.

    Returns None if pool is empty or all entries are stale/unhealthy.
    Pattern follows Modal's official sandbox_pool.py example.
    """
    sys.path.insert(0, _modal_app_dir())
    from modal_app import sandbox_pool_queue  # noqa: PLC0415

    while True:
        ref = sandbox_pool_queue.get(block=False)
        if ref is None:
            return None

        # Discard if < 5 min remaining on the sandbox clock
        if ref["expires_at"] < time.time() + (5 * 60):
            try:
                modal.Sandbox.from_id(ref["sandbox_id"]).terminate()
            except Exception:
                pass
            continue

        # Quick health check before handing to user
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
        # Unhealthy — discard and try next entry


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


async def _take_snapshot(user_id: str, sandbox_id: str, project_id: str) -> None:
    """Take a filesystem snapshot of the sandbox after a prompt completes.

    Runs in the background — does not block the user's response stream.
    snapshot_filesystem() is a synchronous Modal SDK call (up to 55s), so we
    run it in a thread. API verified at:
    https://modal.com/docs/guide/sandbox-snapshots
    """
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


class StopRequest(BaseModel):
    user_id: str


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
            # Try the warm pool first (instant if pool has a healthy entry)
            info = await asyncio.to_thread(_claim_from_pool)

            if info is not None:
                # Pool hit — spawn a replacement in the background to keep pool full
                sys.path.insert(0, _modal_app_dir())
                from modal_app import add_sandbox_to_pool  # noqa: PLC0415
                add_sandbox_to_pool.spawn()
            else:
                # Pool empty — cold create
                info = await asyncio.to_thread(_create_sandbox, project_id, req.user_id)
                yield _sse({"type": "phase", "text": "Waiting for agent…"})
                await _wait_for_sandbox(info["agent_url"])
                yield _sse({"type": "phase", "text": "Preparing workspace…"})
                await _init_workspace(info["agent_url"])

            now = int(time.time())
            name = req.project_name[:80] if req.project_name else f"Project {project_id}"
            await sessions.put.aio(req.user_id, {"project_id": project_id, **info})
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

        # Look up the project's snapshot (taken after each prompt)
        projects = await project_list_store.get.aio(req.user_id) or []
        project = next((p for p in projects if p["project_id"] == project_id), None)
        snapshot_id = project.get("snapshot_id") if project else None

        if snapshot_id:
            # Fast path: restore workspace from filesystem snapshot.
            # Creates a new sandbox using the snapshot image as the base.
            # Verified against: https://modal.com/docs/guide/sandbox-snapshots
            yield _sse({"type": "phase", "text": "Restoring your workspace…"})
            try:
                info = await asyncio.to_thread(_restore_from_snapshot, snapshot_id)
                await sessions.put.aio(req.user_id, {"project_id": project_id, **info})

                yield _sse({"type": "phase", "text": "Waiting for agent…"})
                await _wait_for_sandbox(info["agent_url"])

                yield _sse({"type": "phase", "text": "Finishing restore…"})
                await _init_workspace(info["agent_url"])

                await _touch_project(req.user_id, project_id)
                deploy_info = await _get_deploy_info(req.user_id, project_id)
                yield _sse({"type": "done", "project_id": project_id, "preview_url": info["preview_url"], **deploy_info})
                return
            except Exception as e:
                print(f"[restore] snapshot restore failed for project={project_id}: {e}")
                # Fall through to cold create

        # Cold create fallback (no snapshot yet, or snapshot restore failed)
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


def _wrap_prompt(text: str, is_first_prompt: bool = False) -> str:
    name_rule = (
        "- VERY FIRST TOKENS: Write exactly <name>2-4 word title</name> on its own line before anything else. "
        "Title-case the name. Describe the app in 2-4 words (e.g. <name>Multi Timer App</name>). "
        "This tag is stripped before display — it is only for internal bookkeeping.\n"
    ) if is_first_prompt else "- Do NOT emit a <name> tag.\n"

    return (
        "STRICT RULES FOR YOUR REPLY TEXT (violating these is a failure):\n"
        f"{name_rule}"
        "- Never mention file names, paths, components, JSX, CSS, or any technical term.\n"
        "- Never mention environment variables or .env files in your reply text.\n"
        "- If the app needs an API key, say only: 'You'll be prompted to add your API key to complete the setup.'\n"
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
    sandbox_id = session["sandbox_id"]
    project_id = session.get("project_id")

    prompt_count = session.get("prompt_count", 0)
    is_first_prompt = prompt_count == 0
    session["prompt_count"] = prompt_count + 1
    await sessions.put.aio(req.user_id, session)

    async def stream():
        prompt_timeout = httpx.Timeout(connect=30.0, read=1800.0, write=30.0, pool=30.0)
        done_seen = False
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
async def stop_prompt(req: StopRequest):
    session = await sessions.get.aio(req.user_id)
    if not session:
        return {"ok": True}
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.post(f"{session['agent_url']}/stop")
        return r.json()


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
    # Chat is now on disk — safe to snapshot. Fire-and-forget.
    asyncio.create_task(_take_snapshot(req.user_id, session["sandbox_id"], project_id))
    return {"ok": True}


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


@app.delete("/projects/{project_id}")
async def delete_project(project_id: str, user_id: str):
    # Collect metadata before removing from list
    projects = await project_list_store.get.aio(user_id) or []
    project = next((p for p in projects if p["project_id"] == project_id), None)
    snapshot_id = project.get("snapshot_id") if project else None
    netlify_site_id = project.get("netlify_site_id") if project else None

    # Terminate sandbox if it's running this project
    session = await sessions.get.aio(user_id)
    if session and session.get("project_id") == project_id:
        try:
            _destroy_sandbox(session["sandbox_id"])
        except Exception:
            pass
        await sessions.pop.aio(user_id, None)

    # Remove from project list
    projects = [p for p in projects if p["project_id"] != project_id]
    await project_list_store.put.aio(user_id, projects)

    # Clean up snapshot image so it doesn't accumulate indefinitely.
    # API: modal.experimental.image_delete(image_id)
    # Verified at: https://modal.com/docs/guide/sandbox-snapshots
    if snapshot_id:
        def _delete_snapshot() -> None:
            try:
                modal.experimental.image_delete(snapshot_id)
            except Exception:
                pass
        await asyncio.to_thread(_delete_snapshot)

    # Delete the Netlify site if one was created for this project
    if netlify_site_id:
        import subprocess
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
                pass  # best effort — don't fail the delete if Netlify cleanup fails

    return {"ok": True}
