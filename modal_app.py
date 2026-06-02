import sys
import time
from pathlib import Path

import modal

# Available at /root/sandbox_embedded.py in the backend container for lazy import
sys.path.insert(0, "/root")
from sandbox_embedded import (  # noqa: E402
    AGENT_SERVER_B64,
    PACKAGE_JSON_B64,
    STARTER_TAR_GZ_B64,
)

_EMBED_FILE = Path(__file__).parent / "sandbox_embedded.py"

app = modal.App("buildman-v3")

# Netlify deploy token — create with: modal secret create netlify-credentials NETLIFY_AUTH_TOKEN=<token>
try:
    netlify_secret = modal.Secret.from_name("netlify-credentials")
except Exception:
    netlify_secret = None


sandbox_image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git", "curl")
    .run_commands(
        "curl -fsSL https://deb.nodesource.com/setup_20.x | bash -",
        "apt-get install -y nodejs",
        "npm install -g opencode-ai netlify-cli",
        # Bake git identity globally so runtime never needs to set it per-repo.
        # safe.directory=* lets root operate on volumes owned by other users.
        "git config --global user.email agent@buildman.dev",
        "git config --global user.name 'Buildman Agent'",
        "git config --global safe.directory '*'",
        "mkdir -p /app /opt/starter",
        f"echo '{PACKAGE_JSON_B64}' | base64 -d > /app/package.json",
        f"echo '{AGENT_SERVER_B64}' | base64 -d > /app/agent-server.js",
        f"echo '{STARTER_TAR_GZ_B64}' | base64 -d | tar -xzf - -C /opt/starter",
        "cd /app && npm install",
        "cd /opt/starter && npm install",
        "echo buildman-sandbox-v11-opencode > /app/.build-id",
    )
)

backend_image = (
    modal.Image.debian_slim(python_version="3.12")
    .pip_install("fastapi", "httpx", "uvicorn", "pydantic", "modal")
    .add_local_file(str(_EMBED_FILE), "/root/sandbox_embedded.py", copy=True)
    .add_local_python_source("backend")
)


@app.function(
    image=backend_image,
    secrets=[],
    min_containers=1,
    timeout=1800,
)
@modal.asgi_app()
def fastapi_app():
    from backend.main import app as _app
    return _app


# ---------------------------------------------------------------------------
# Sandbox warm pool — verified against Modal's official example:
# https://github.com/modal-labs/modal-examples/blob/main/13_sandboxes/sandbox_pool.py
# ---------------------------------------------------------------------------

POOL_SIZE = 2
POOL_SANDBOX_TIMEOUT = 3600       # 1 h — matches existing sandbox timeout
POOL_MIN_REMAINING_SECS = 5 * 60  # discard pool entry if < 5 min left on its clock

# Queue stores plain dicts: {sandbox_id, agent_url, preview_url, expires_at}
sandbox_pool_queue = modal.Queue.from_name("buildman-sandbox-pool", create_if_missing=True)


@app.function(image=backend_image, retries=2)
def add_sandbox_to_pool() -> None:
    """Create one pre-warmed sandbox and push it onto the pool queue."""
    import httpx

    # Sandboxes live in a separate app so they don't pollute the control-plane logs.
    # Pattern from Modal's official sandbox_pool.py example.
    sandbox_app = modal.App.lookup("buildman-sandbox-pool-sandboxes", create_if_missing=True)
    secrets = [s for s in [netlify_secret] if s is not None]

    sb = modal.Sandbox.create(
        "node", "/app/agent-server.js",
        app=sandbox_app,
        image=sandbox_image,
        secrets=secrets,
        cpu=1.0,
        memory=1024,
        timeout=POOL_SANDBOX_TIMEOUT,
        idle_timeout=900,
        encrypted_ports=[3001, 5173],
    )
    expires_at = int(time.time()) + POOL_SANDBOX_TIMEOUT
    tunnels = sb.tunnels()
    agent_url = tunnels[3001].url
    preview_url = tunnels[5173].url

    # Wait for agent-server.js to be ready (same pattern as _wait_for_sandbox in main.py)
    for _ in range(60):
        try:
            r = httpx.get(f"{agent_url}/healthz", timeout=5)
            if r.status_code == 200:
                break
        except Exception:
            pass
        time.sleep(2)
    else:
        sb.terminate()
        raise RuntimeError("Pool sandbox health check timed out after 120s")

    # Initialize workspace: copies starter template and starts Vite
    httpx.post(f"{agent_url}/init-workspace", timeout=120)

    sandbox_pool_queue.put({
        "sandbox_id": sb.object_id,
        "agent_url": agent_url,
        "preview_url": preview_url,
        "expires_at": expires_at,
    })
    sb.detach()  # keep sandbox running independently (from Modal's example)


@app.function(image=backend_image, schedule=modal.Period(minutes=5))
def maintain_sandbox_pool() -> None:
    """Drain expired/unhealthy pool entries and top up to POOL_SIZE.

    Runs every 5 minutes. Pattern from Modal's official sandbox_pool.py example.
    """
    import httpx

    valid: list[dict] = []

    # Drain entire queue, health-check each entry
    while True:
        ref = sandbox_pool_queue.get(block=False)
        if ref is None:
            break
        if ref["expires_at"] < time.time() + POOL_MIN_REMAINING_SECS:
            try:
                modal.Sandbox.from_id(ref["sandbox_id"]).terminate()
            except Exception:
                pass
            continue
        try:
            r = httpx.get(f"{ref['agent_url']}/healthz", timeout=3)
            if r.status_code == 200:
                valid.append(ref)
                continue
        except Exception:
            pass
        # Unhealthy — terminate
        try:
            modal.Sandbox.from_id(ref["sandbox_id"]).terminate()
        except Exception:
            pass

    # Put healthy ones back
    for ref in valid:
        sandbox_pool_queue.put(ref)

    # Top up to target size
    needed = POOL_SIZE - len(valid)
    for _ in range(max(0, needed)):
        add_sandbox_to_pool.spawn()

    print(f"Pool maintenance: {len(valid)} healthy, spawning {max(0, needed)} new")
