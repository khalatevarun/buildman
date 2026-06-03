"""
Integration tests for the Buildman v2 backend.

Run:  pytest tests/test_backend_flow.py -v -s
These tests hit the live Modal deployment and spin up real sandboxes,
so they can take 1-3 minutes.
"""

import json
import time
import httpx
import pytest

API_URL = "https://khalatevarun--buildman-api.modal.run"
TEST_USER_ID = "test_flow_user"
TIMEOUT = httpx.Timeout(connect=30.0, read=300.0, write=30.0, pool=30.0)


def collect_sse(response: httpx.Response) -> list[dict]:
    """Parse all SSE data lines from a streaming response into a list of dicts."""
    events = []
    for line in response.iter_lines():
        if line.startswith("data: "):
            events.append(json.loads(line[6:]))
    return events


@pytest.fixture(scope="module")
def project_id():
    """Create a project once for all tests in this module."""
    with httpx.Client(timeout=TIMEOUT) as client:
        with client.stream(
            "POST",
            f"{API_URL}/projects",
            json={"user_id": TEST_USER_ID, "project_name": "Test Project"},
        ) as r:
            assert r.status_code == 200
            events = collect_sse(r)

    done = next((e for e in events if e.get("type") == "done"), None)
    assert done is not None, f"No done event. Got: {events}"
    assert "project_id" in done
    assert "preview_url" in done
    return done["project_id"]


def test_create_project(project_id):
    """Fixture ran successfully — project was created."""
    assert project_id is not None
    assert len(project_id) > 0


def test_project_appears_in_list():
    with httpx.Client(timeout=TIMEOUT) as client:
        r = client.get(f"{API_URL}/projects", params={"user_id": TEST_USER_ID})
    assert r.status_code == 200
    projects = r.json()["projects"]
    assert any(p["name"] == "Test Project" for p in projects)


def test_sandbox_status_ready():
    with httpx.Client(timeout=TIMEOUT) as client:
        r = client.get(f"{API_URL}/sandbox/status", params={"user_id": TEST_USER_ID})
    assert r.status_code == 200
    data = r.json()
    assert data["status"] == "ready"
    assert data["preview_url"].startswith("https://")


def test_send_prompt_gets_response(project_id):
    """Send a simple prompt and verify activities, output text, and a done event."""
    events = []
    with httpx.Client(timeout=TIMEOUT) as client:
        with client.stream(
            "POST",
            f"{API_URL}/prompt",
            json={"user_id": TEST_USER_ID, "text": "Add a button that says Hello World"},
        ) as r:
            assert r.status_code == 200
            events = collect_sse(r)

    types = [e.get("type") for e in events]
    assert "done" in types, f"No done event. Events: {events}"

    done = next(e for e in events if e.get("type") == "done")
    assert done.get("commitHash") is not None, f"commitHash missing from done event: {done}"

    # Output text should be present
    output_events = [e for e in events if e.get("type") == "output"]
    assert output_events, "No output text received from model"


def test_cleanup():
    """Delete the sandbox after tests."""
    with httpx.Client(timeout=TIMEOUT) as client:
        r = client.delete(f"{API_URL}/sandbox", params={"user_id": TEST_USER_ID})
    assert r.status_code == 200
    assert r.json()["ok"] is True
