"""The local web app: a FastAPI server that owns the board, and a browser UI.

The browser does the display processing (filters, FFT, band power, ...). The
server keeps everything that must not depend on a browser tab: the board
connection, recording to disk, and the network outputs.

    brainbench            # opens http://127.0.0.1:8800
"""

from __future__ import annotations

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from pathlib import Path

import numpy as np
from fastapi import Body, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from .. import __version__, boards, hardware
from ..focus import FocusModel
from .. import radio
from ..network import MarkerListener, Network
from ..recording import Recorder, list_recordings
from ..session import Session
from ..settings import SettingsStore

log = logging.getLogger("brainbench")
STATIC = Path(__file__).parent / "static"


class Hub:
    """The one session, the connected browsers, and the outputs fed from the stream."""

    def __init__(self, data_dir: Path):
        self.session: Session | None = None
        self.clients: set[asyncio.Queue] = set()
        self.loop: asyncio.AbstractEventLoop | None = None
        self.recorder = Recorder(data_dir / "Recordings")
        self.network = Network()
        self.settings = SettingsStore(data_dir / "Settings")
        self.focus = FocusModel()
        self.log: list[str] = []
        self.markers = MarkerListener(self.external_marker)

    def external_marker(self, value: float) -> None:
        """A marker from another program (UDP 127.0.0.1:12350)."""
        if self.session and self.session.streaming:
            self.session.insert_marker(value)
            self.note(f"Marker {value:g} received over UDP")

    # Called on the acquisition thread for every chunk.
    def on_chunk(self, chunk: np.ndarray) -> None:
        self.recorder.write(chunk)
        self.network.raw(chunk, self.session.layout)
        if self.loop and self.clients:
            frame = encode(chunk)
            for q in list(self.clients):
                self.loop.call_soon_threadsafe(_offer, q, frame)

    def broadcast(self, message: dict) -> None:
        if self.loop:
            text = json.dumps(message)
            for q in list(self.clients):
                self.loop.call_soon_threadsafe(_offer, q, text)

    def note(self, text: str) -> None:
        """Adds a line to the console shown at the bottom of the window."""
        self.log.append(text)
        del self.log[:-200]
        self.broadcast({"type": "log", "text": text})

    def state(self) -> dict:
        return {
            "version": __version__,
            "session": self.session.describe() if self.session else None,
            "recording": self.recorder.status(),
            "network": self.network.status(),
            "focus_available": self.focus.available,
        }


def _offer(q: asyncio.Queue, item) -> None:
    # Slow clients lose frames instead of growing an unbounded queue.
    if q.qsize() < 120:
        q.put_nowait(item)


def encode(chunk: np.ndarray) -> bytes:
    """Binary frame: two little-endian uint32 (rows, samples), then float32 data, row-major."""
    rows, cols = chunk.shape
    return np.array([rows, cols], dtype="<u4").tobytes() + chunk.astype("<f4").tobytes()


def create_app(data_dir: Path | None = None) -> FastAPI:
    data_dir = data_dir or Path.home() / "Documents" / "BrainBench"
    hub = Hub(data_dir)

    @asynccontextmanager
    async def lifespan(_app):
        hub.loop = asyncio.get_running_loop()
        status = asyncio.create_task(_status_loop(hub))
        yield
        status.cancel()
        hub.recorder.stop()
        hub.network.close()
        hub.markers.stop()
        hub.focus.close()
        if hub.session:
            hub.session.disconnect()
            hub.session = None

    app = FastAPI(title="BrainBench", version=__version__, lifespan=lifespan)
    app.state.hub = hub

    def need_session() -> Session:
        if hub.session is None:
            raise HTTPException(409, "No session. Choose a data source and start a session first.")
        return hub.session


    # ------------------------------------------------------------ discovery

    @app.get("/api/state")
    def state():
        return hub.state()

    @app.get("/api/sources")
    def sources():
        return boards.catalogue()

    @app.get("/api/ports")
    def ports():
        return boards.list_serial_ports()

    @app.get("/api/recordings")
    def recordings():
        return list_recordings(hub.recorder.root)

    @app.get("/api/log")
    def console():
        return hub.log

    # ------------------------------------------------------------ session

    @app.post("/api/session")
    def start_session(body: dict = Body(...)):
        if hub.session is not None:
            raise HTTPException(409, "A session is already open. End it first.")
        try:
            s = Session(body.get("source", "synthetic"), body.get("options", {}))
            s.connect()
        except (ConnectionError, ValueError, FileNotFoundError, KeyError) as e:
            raise HTTPException(400, str(e)) from e
        s.listeners.append(hub.on_chunk)
        hub.session = s
        hub.markers.start()
        hub.recorder.configure(s, body.get("recording", {}))
        hub.note(f"Session started: {s.source.label}, {len(s.layout.eeg)} channels at {s.layout.sampling_rate} Hz")
        hub.broadcast({"type": "session", "session": s.describe()})
        return hub.state()

    @app.delete("/api/session")
    def end_session():
        if hub.session:
            hub.recorder.stop()
            hub.network.close()
            hub.session.disconnect()
            hub.note("Session ended")
        hub.session = None
        hub.broadcast({"type": "session", "session": None})
        return hub.state()

    @app.post("/api/stream")
    def stream(body: dict = Body(...)):
        s = need_session()
        if body.get("on"):
            s.start_stream()
            if hub.recorder.auto:
                hub.recorder.start()
            hub.note("Data stream started")
        else:
            s.stop_stream()
            if hub.recorder.auto:
                hub.recorder.stop()
            hub.note("Data stream stopped")
        hub.broadcast({"type": "session", "session": s.describe()})
        return hub.state()

    @app.post("/api/channel/{index}")
    def channel(index: int, body: dict = Body(...)):
        s = need_session()
        if not 0 <= index < len(s.channels):
            raise HTTPException(404, "no such channel")
        try:
            settings = hardware.ChannelSettings.from_json({**s.channels[index].to_json(), **body})
            reply = s.set_channel(index, settings)
        except (ValueError, RuntimeError) as e:
            raise HTTPException(400, str(e)) from e
        if reply:
            hub.note(reply.strip())
        return s.describe()

    @app.post("/api/channels")
    def channels(body: dict = Body(...)):
        """Applies one change to several channels at once (e.g. gain for all)."""
        s = need_session()
        for i in body.get("indices", range(len(s.channels))):
            settings = hardware.ChannelSettings.from_json({**s.channels[i].to_json(), **body.get("settings", {})})
            try:
                s.set_channel(i, settings)
            except (ValueError, RuntimeError) as e:
                raise HTTPException(400, str(e)) from e
        return s.describe()

    @app.post("/api/board-mode")
    def board_mode(body: dict = Body(...)):
        s = need_session()
        try:
            reply = s.set_board_mode(body["mode"])
        except (ValueError, RuntimeError, KeyError) as e:
            raise HTTPException(400, str(e)) from e
        hub.note(f"Board mode: {body['mode']}" + (f" ({reply.strip()})" if reply else ""))
        return s.describe()

    @app.post("/api/impedance")
    def impedance(body: dict = Body(...)):
        s = need_session()
        try:
            reply = s.impedance(body.get("index"), bool(body.get("on")), str(body.get("pin", "p")))
        except RuntimeError as e:
            raise HTTPException(400, str(e)) from e
        return {"reply": reply}

    @app.post("/api/command")
    def command(body: dict = Body(...)):
        s = need_session()
        try:
            reply = s.configure(str(body["command"]))
        except (RuntimeError, KeyError) as e:
            raise HTTPException(400, str(e)) from e
        hub.note(f"> {body['command']}" + (f"  {reply.strip()}" if reply else ""))
        return {"reply": reply}

    @app.post("/api/marker")
    def marker(body: dict = Body(...)):
        s = need_session()
        value = float(body.get("value", 1))
        s.insert_marker(value)
        hub.network.marker(value)
        return {"ok": True}

    @app.post("/api/seek")
    def seek(body: dict = Body(...)):
        need_session().seek(float(body.get("fraction", 0)))
        return {"ok": True}

    # ------------------------------------------------------------ recording

    @app.post("/api/record")
    def record(body: dict = Body(...)):
        s = need_session()
        if body.get("format"):
            hub.recorder.configure(s, {"format": body["format"], "auto": hub.recorder.auto, "name": hub.recorder.name})
        if body.get("on"):
            path = hub.recorder.start()
            hub.note(f"Recording to {path}")
        else:
            path = hub.recorder.stop()
            if path:
                hub.note(f"Saved {path}")
        return hub.state()

    # ------------------------------------------------------------ analysis and outputs

    @app.get("/api/focus")
    def focus(metric: str = "concentration", seconds: float = 10.0, channels: str = ""):
        s = need_session()
        chans = [int(c) for c in channels.split(",") if c.strip().isdigit()] or None
        try:
            return hub.focus.predict(s.recent(seconds), s.layout, metric, chans)
        except ValueError as e:
            raise HTTPException(400, str(e)) from e

    @app.post("/api/smoothing")
    def smoothing(body: dict = Body(...)):
        s = need_session()
        s.smoothing = bool(body.get("on")) and s.source.key in ("cyton", "cyton_daisy")
        return s.describe()

    # ------------------------------------------------------------ Cyton dongle radio

    @app.post("/api/radio")
    def radio_action(body: dict = Body(...)):
        if hub.session is not None:
            raise HTTPException(409, "End the session first: the radio tools talk to the dongle directly.")
        port, action = body.get("port"), body.get("action")
        if not port:
            raise HTTPException(400, "Choose the dongle's serial port.")
        try:
            if action == "status":
                return radio.status(port)
            if action == "get":
                return radio.get_channel(port)
            if action in ("set", "override"):
                return radio.set_channel(port, int(body["channel"]), dongle_only=action == "override")
            if action == "scan":
                return radio.auto_scan(port)
        except (OSError, ValueError, KeyError) as e:
            raise HTTPException(400, str(e)) from e
        raise HTTPException(400, f"unknown radio action {action!r}")

    @app.post("/api/network")
    def network(body: dict = Body(...)):
        try:
            hub.network.configure(body.get("streams", []), hub.session.layout if hub.session else None)
        except (RuntimeError, ValueError, OSError) as e:
            raise HTTPException(400, str(e)) from e
        return hub.network.status()

    # ------------------------------------------------------------ settings files

    @app.get("/api/settings")
    def list_settings():
        return hub.settings.list()

    @app.get("/api/settings/{name}")
    def load_settings(name: str):
        try:
            return hub.settings.load(name)
        except FileNotFoundError as e:
            raise HTTPException(404, "no such settings file") from e

    @app.put("/api/settings/{name}")
    def save_settings(name: str, body: dict = Body(...)):
        return {"saved": str(hub.settings.save(name, body))}

    # ------------------------------------------------------------ live data

    @app.websocket("/ws")
    async def ws(socket: WebSocket):
        await socket.accept()
        q: asyncio.Queue = asyncio.Queue()
        hub.clients.add(q)
        await socket.send_text(json.dumps({"type": "hello", **hub.state()}))

        async def sender():
            while True:
                item = await q.get()
                if isinstance(item, bytes):
                    await socket.send_bytes(item)
                else:
                    await socket.send_text(item)

        task = asyncio.create_task(sender())
        try:
            while True:
                msg = json.loads(await socket.receive_text())
                if msg.get("type") == "derived":
                    hub.network.derived(msg.get("kind", ""), msg.get("data"))
        except (WebSocketDisconnect, RuntimeError):
            pass
        finally:
            task.cancel()
            hub.clients.discard(q)

    @app.get("/")
    def index():
        return FileResponse(STATIC / "index.html")

    app.mount("/", StaticFiles(directory=STATIC), name="static")

    @app.exception_handler(Exception)
    async def _unexpected(_request, exc: Exception):  # pragma: no cover
        log.exception("unexpected error")
        return JSONResponse({"detail": str(exc)}, status_code=500)

    return app


async def _status_loop(hub: Hub) -> None:
    """Once a second: packet loss, recording time, network health."""
    while True:
        await asyncio.sleep(1)
        if hub.session and hub.session.streaming:
            hub.broadcast({
                "type": "status", "packets": hub.session.packets.to_json(),
                "recording": hub.recorder.status(), "network": hub.network.status(),
            })
