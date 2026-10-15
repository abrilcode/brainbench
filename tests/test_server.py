import numpy as np
import pytest
from fastapi.testclient import TestClient

from brainbench.web.server import create_app


@pytest.fixture
def client(tmp_path):
    with TestClient(create_app(tmp_path)) as c:
        yield c
        c.delete("/api/session")


def test_catalogue_and_state(client):
    keys = [s["key"] for s in client.get("/api/sources").json()]
    assert {"cyton", "cyton_daisy", "ganglion", "synthetic", "playback"} <= set(keys)
    st = client.get("/api/state").json()
    assert st["session"] is None and st["version"]
    assert client.post("/api/stream", json={"on": True}).status_code == 409


def test_session_stream_record_and_play_back(client, tmp_path):
    r = client.post("/api/session", json={"source": "synthetic", "options": {"channels": 4},
                                          "recording": {"format": "openbci_csv", "auto": True, "name": "api-test"}})
    assert r.status_code == 200, r.text
    assert len(r.json()["session"]["channels"]) == 4
    assert client.post("/api/session", json={"source": "synthetic"}).status_code == 409
    with client.websocket_connect("/ws") as ws:
        client.post("/api/stream", json={"on": True})
        frames = 0
        while frames < 3:
            m = ws.receive()
            if m.get("bytes"):
                rows, cols = np.frombuffer(m["bytes"][:8], "<u4")
                assert rows == 32 and len(m["bytes"]) == 8 + 4 * rows * cols
                frames += 1
        assert client.post("/api/marker", json={"value": 2}).json()["ok"]
        for _ in range(10):
            ws.receive()
    assert client.get("/api/focus", params={"metric": "relaxation", "seconds": 1}).json()["metric"] == "relaxation"
    st = client.post("/api/stream", json={"on": False}).json()
    assert not st["session"]["streaming"] and not st["recording"]["active"]
    recs = client.get("/api/recordings").json()
    assert recs and recs[0]["channels"] == 4 and "api-test" in recs[0]["path"]
    client.delete("/api/session")
    r = client.post("/api/session", json={"source": "playback", "options": {"file": recs[0]["path"]}})
    assert r.status_code == 200, r.text
    s = r.json()["session"]
    assert len(s["channels"]) == 4 and s["playback"]["total_samples"] > 0


def test_settings_files(client):
    assert client.put("/api/settings/My layout", json={"layout": "4"}).status_code == 200
    assert client.get("/api/settings").json()[0]["name"] == "My layout"
    assert client.get("/api/settings/My layout").json()["layout"] == "4"
    assert client.get("/api/settings/missing").status_code == 404


def test_bad_requests_explain_themselves(client):
    r = client.post("/api/session", json={"source": "playback", "options": {"file": "/no/such/file.csv"}})
    assert r.status_code == 400 and "No such file" in r.json()["detail"]
    assert client.post("/api/radio", json={"action": "status"}).status_code == 400
    assert client.post("/api/network", json={"streams": [{"protocol": "udp", "type": "nope"}]}).status_code == 400
