import sys
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

# Pro/Max: CLAUDE_CODE_OAUTH_TOKEN from `claude setup-token`
claude_secret = modal.Secret.from_name("claude-credentials")

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
        "npm install -g @anthropic-ai/claude-code netlify-cli",
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
        "echo buildman-sandbox-v8-tailwind-lucide-inter > /app/.build-id",
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
    secrets=[claude_secret],
    min_containers=1,
    timeout=1800,  # Claude codegen can exceed 5 min; default 300s was cancelling /prompt
)
@modal.asgi_app()
def fastapi_app():
    from backend.main import app as _app
    return _app
