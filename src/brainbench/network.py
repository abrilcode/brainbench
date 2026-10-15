"""Sending data to other programs: UDP, LSL, OSC and serial.

Data types and payloads follow the OpenBCI GUI's Networking widget, so
scripts written for it keep working:

    UDP     one JSON object per line: {"type": "timeSeriesRaw", "data": [[...], ...]}\r\n
    LSL     one outlet per stream, float32
    OSC     /openbci/time-series-raw/ch0 ... under the chosen address
    Serial  "[v,v,...]" with 3 decimals, one line per update

Raw time series, accelerometer/aux and markers are sent from the
acquisition thread. The other types are computed in the browser and arrive
through ``derived``.
"""

from __future__ import annotations

import json
import logging
import socket
import struct
import threading

import numpy as np

log = logging.getLogger("brainbench")

TYPES = ("timeSeriesRaw", "timeSeriesFilt", "fft", "bandPower", "averageBandPower", "focus", "emg",
         "emgJoystick", "accelerometer", "pulse", "marker")
OSC_PATH = {
    "timeSeriesRaw": "time-series-raw", "timeSeriesFilt": "time-series-filtered", "fft": "fft",
    "bandPower": "band-power", "averageBandPower": "average-band-power", "focus": "focus", "emg": "emg",
    "emgJoystick": "emg-joystick", "accelerometer": "accelerometer", "pulse": "pulse", "marker": "marker",
}


class Output:
    """One configured stream: a protocol, a data type and where to send it."""

    def __init__(self, cfg: dict, layout):
        self.cfg = cfg
        self.protocol = cfg["protocol"]
        self.type = cfg["type"]
        if self.type not in TYPES:
            raise ValueError(f"unknown data type {self.type!r}")
        self.layout = layout
        self.sent = 0
        self.error = ""
        self._open()

    @property
    def label(self) -> str:
        where = {"udp": f"{self.cfg.get('ip')}:{self.cfg.get('port')}", "osc": f"{self.cfg.get('ip')}:{self.cfg.get('port')}",
                 "lsl": self.cfg.get("name", ""), "serial": self.cfg.get("port", "")}[self.protocol]
        return f"{self.protocol.upper()} {self.type} → {where}"

    def _open(self) -> None:
        p = self.protocol
        if p == "udp":
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self.addr = (self.cfg.get("ip", "127.0.0.1"), int(self.cfg.get("port", 12345)))
        elif p == "osc":
            try:
                from pythonosc.udp_client import SimpleUDPClient
            except ImportError as e:
                raise RuntimeError("OSC needs python-osc: pip install python-osc") from e
            self.osc = SimpleUDPClient(self.cfg.get("ip", "127.0.0.1"), int(self.cfg.get("port", 12345)))
            self.base = "/" + self.cfg.get("address", "/openbci").strip("/")
        elif p == "lsl":
            try:
                import pylsl
            except ImportError as e:
                raise RuntimeError("LSL needs pylsl: pip install pylsl") from e
            n, rate = self._lsl_shape()
            info = pylsl.StreamInfo(self.cfg.get("name", "obci_eeg1"), self.cfg.get("type", "EEG"), n, rate, "float32", f"brainbench-{self.type}")
            self.outlet = pylsl.StreamOutlet(info)
        elif p == "serial":
            try:
                import serial
            except ImportError as e:  # pragma: no cover
                raise RuntimeError("Serial output needs pyserial") from e
            self.port = serial.Serial(self.cfg["port"], int(self.cfg.get("baud", 57600)), timeout=0)
        else:
            raise ValueError(f"unknown protocol {p!r}")

    def _lsl_shape(self) -> tuple[int, float]:
        n = len(self.layout.eeg) if self.layout else 8
        fs = float(self.layout.sampling_rate) if self.layout else 250.0
        return {
            "timeSeriesRaw": (n, fs), "timeSeriesFilt": (n, fs), "fft": (125, 0.0), "bandPower": (6, 0.0),
            "averageBandPower": (5, 0.0), "emg": (n, 0.0), "focus": (1, 0.0), "pulse": (2, 0.0),
            "emgJoystick": (2, 0.0), "accelerometer": (3, fs), "marker": (1, fs),
        }[self.type]

    # ---------------------------------------------------------------- sending

    def send(self, data) -> None:
        try:
            getattr(self, f"_send_{self.protocol}")(data)
            self.sent += 1
            self.error = ""
        except Exception as e:  # keep streaming; show the error in the widget
            self.error = str(e)

    def _send_udp(self, data) -> None:
        msg = json.dumps({"type": self.type, "data": _plain(data)}) + "\r\n"
        self.sock.sendto(msg.encode(), self.addr)

    def _send_osc(self, data) -> None:
        b, t = self.base, OSC_PATH[self.type]
        d = _plain(data)
        if self.type in ("timeSeriesRaw", "timeSeriesFilt", "emg") and isinstance(d, list):
            for i, ch in enumerate(d):
                self.osc.send_message(f"{b}/{t}/{'ch' if self.type != 'emg' else ''}{i}", ch)
        elif self.type == "fft":
            for i, ch in enumerate(d):
                for j, v in enumerate(ch):
                    self.osc.send_message(f"{b}/fft/ch{i}/bin{j}", v)
        elif self.type == "bandPower":
            for i, ch in enumerate(d):
                self.osc.send_message(f"{b}/band-power/{i}", ch)
        elif self.type == "averageBandPower":
            for i, v in enumerate(d):
                self.osc.send_message(f"{b}/average-band-power/{i}", v)
        elif self.type == "accelerometer":
            for axis, row in zip("xyz", d):
                self.osc.send_message(f"{b}/accelerometer/{axis}", row)
        elif self.type == "pulse":
            self.osc.send_message(f"{b}/pulse/bpm", d[0])
            self.osc.send_message(f"{b}/pulse/ibi", d[1])
        elif self.type == "emgJoystick":
            self.osc.send_message(f"{b}/emg-joystick/x", d[0])
            self.osc.send_message(f"{b}/emg-joystick/y", d[1])
        else:  # focus, marker
            self.osc.send_message(f"{b}/{t}", d)

    def _send_lsl(self, data) -> None:
        a = np.asarray(data, dtype=float)
        if self.type in ("timeSeriesRaw", "timeSeriesFilt", "accelerometer"):
            self.outlet.push_chunk(a.T.tolist())  # samples x channels
        elif self.type == "marker":
            self.outlet.push_chunk([[v] for v in a.ravel()])
        elif self.type == "fft":
            self.outlet.push_chunk([list(ch[:125]) + [0.0] * (125 - len(ch[:125])) for ch in a])
        elif self.type == "bandPower":
            self.outlet.push_chunk([[float(i)] + list(ch) for i, ch in enumerate(a)])
        else:
            self.outlet.push_sample(np.atleast_1d(a).tolist())

    def _send_serial(self, data) -> None:
        a = np.atleast_1d(np.asarray(data, dtype=float))
        if a.ndim == 2:
            a = a[:, -1]  # newest sample of each channel
        self.port.write(("[" + ",".join(f"{v:.3f}" for v in a.ravel()) + "]\n").encode())

    def close(self) -> None:
        for attr in ("sock", "port"):
            obj = getattr(self, attr, None)
            if obj:
                try:
                    obj.close()
                except Exception:
                    pass

    def status(self) -> dict:
        return {"label": self.label, "type": self.type, "protocol": self.protocol, "sent": self.sent, "ok": not self.error, "error": self.error}


class Network:
    def __init__(self):
        self.outputs: list[Output] = []
        self._lock = threading.Lock()

    def configure(self, streams: list[dict], layout) -> None:
        self.close()
        outs = []
        try:
            for cfg in streams:
                if cfg.get("type", "none") != "none":
                    outs.append(Output(cfg, layout))
        except Exception:
            for o in outs:
                o.close()
            raise
        with self._lock:
            self.outputs = outs

    def raw(self, chunk: np.ndarray, layout) -> None:
        """From the acquisition thread: time series, aux and marker data."""
        if not self.outputs or layout is None:
            return
        for o in list(self.outputs):
            if o.type == "timeSeriesRaw":
                o.send(chunk[layout.eeg])
            elif o.type == "accelerometer" and layout.accel:
                o.send(chunk[layout.accel])
            elif o.type == "marker" and layout.marker is not None:
                o.send(chunk[layout.marker])

    def derived(self, kind: str, data) -> None:
        for o in list(self.outputs):
            if o.type == kind:
                o.send(data)

    def marker(self, value: float) -> None:
        pass  # markers reach the marker stream through the marker row of the data

    def close(self) -> None:
        with self._lock:
            for o in self.outputs:
                o.close()
            self.outputs = []

    def status(self) -> dict:
        return {"streams": [o.status() for o in self.outputs], "available": True}


def _plain(d):
    if isinstance(d, np.ndarray):
        return np.round(d, 6).tolist()
    return d


class MarkerListener:
    """Receives markers from other programs: a 4-byte big-endian float on UDP 127.0.0.1:12350."""

    def __init__(self, on_marker, host: str = "127.0.0.1", port: int = 12350):
        self.on_marker = on_marker
        self.addr = (host, port)
        self.sock = None
        self.thread = None

    def start(self) -> bool:
        if self.thread:
            return True
        try:
            self.sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            self.sock.bind(self.addr)
            self.sock.settimeout(0.5)
        except OSError as e:
            log.warning("marker port %s busy: %s", self.addr, e)
            self.sock = None
            return False
        self._run = True
        self.thread = threading.Thread(target=self._loop, name="brainbench-markers", daemon=True)
        self.thread.start()
        return True

    def _loop(self) -> None:
        while self._run:
            try:
                data, _ = self.sock.recvfrom(64)
            except (socket.timeout, OSError):
                continue
            if len(data) >= 4:
                self.on_marker(struct.unpack(">f", data[:4])[0])

    def stop(self) -> None:
        self._run = False
        if self.thread:
            self.thread.join(timeout=1)
        if self.sock:
            self.sock.close()
        self.thread = self.sock = None
