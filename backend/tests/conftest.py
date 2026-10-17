import os
import sys
from pathlib import Path

os.environ["INTENTGATE_DB_PATH"] = ":memory:"
os.environ.setdefault("INTENTGATE_OPERATOR_TOKEN", "test-operator-token")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture(scope="session")
def client():
    from intentgate.api import app

    with TestClient(app) as c:
        yield c


@pytest.fixture()
def sandbox(client):
    s = client.post("/api/session").json()
    return {"H": {"X-IG-Session": s["session_id"]}, "sup": s["supervisor"]["credential"], "raw": s}


def run(client, sb, scenario):
    r = client.post(f"/api/scenarios/{scenario}/run", headers=sb["H"])
    assert r.status_code == 200, r.text
    return r.json()


def state(client, sb):
    return client.get("/api/simulation/state", headers=sb["H"]).json()
