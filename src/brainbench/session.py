"""A live connection to one board: connect, stream, configure, record.

The session reads BrainFlow's buffer about 30 times a second on a background
thread and hands each chunk (rows x samples, BrainFlow's row layout) to its
listeners: the web clients, the recorder and the network outputs.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable

import numpy as np
from brainflow.board_shim import BoardShim, BrainFlowError

from . import hardware
from .boards import BY_KEY, Layout, Source, input_params, layout_for
from .playback import prepare_playback

log = logging.getLogger("brainbench")

Listener = Callable[[np.ndarray], None]


@dataclass
class PacketStats:
    """Packets lost, from gaps in BrainFlow's sample counter.

    The counter runs 0..255 on the Cyton (every second value with the Daisy)
    and over shorter ranges on the Ganglion, where values can come in pairs.
    The range is learnt from what arrives, so a wrap is not counted as a gap.
    """

    received: int = 0
    lost: int = 0
    last: int | None = None
    step: int = 1
    lo: int | None = None
    hi: int | None = None

    def update(self, nums: np.ndarray) -> None:
        for n in nums.astype(int):
            self.lo = n if self.lo is None else min(self.lo, n)
            self.hi = n if self.hi is None else max(self.hi, n)
            if self.last is not None and n != self.last:
                if n > self.last:
                    gap = n - self.last
                else:  # wrapped around
                    gap = (self.hi - self.last) + (n - self.lo) + self.step
                if gap > self.step:
                    self.lost += gap // self.step - 1
            self.last = n
            self.received += 1

    def to_json(self) -> dict:
        total = self.received + self.lost
        return {"received": self.received, "lost": self.lost, "percent": 100.0 * self.lost / total if total else 0.0}


class Session:
    """One board, from connect to disconnect."""

    def __init__(self, source_key: str, options: dict | None = None, buffer_seconds: int = 60):
        if source_key not in BY_KEY:
            raise ValueError(f"unknown data source {source_key!r}")
        self.source: Source = BY_KEY[source_key]
        self.options = dict(options or {})
        self.board: BoardShim | None = None
        self.layout: Layout | None = None
        self.streaming = False
        self.started_at: float | None = None
        self.listeners: list[Listener] = []
        self.packets = PacketStats()
        self.channels: list[hardware.ChannelSettings] = []
        self.board_mode = "default"
        self.playback_file: Path | None = None
        self.buffer_seconds = buffer_seconds
        self._ring: np.ndarray | None = None
        self._ring_len = 0
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self._saved: dict[int, hardware.ChannelSettings] = {}  # settings kept while a channel is off or under test
        self.smoothing = self.source.key in ("cyton", "cyton_daisy")
        self.playback_samples = 0
        self._pending: np.ndarray | None = None

    # ------------------------------------------------------------------ lifecycle

    def connect(self) -> dict:
        """Opens the board (``prepare_session``). Returns its layout."""
        BoardShim.disable_board_logger()
        board_id = self.source.board_id
        options = dict(self.options)
        file_channels = None
        if self.source.key == "playback":
            self.playback_file, master, file_channels = prepare_playback(Path(options["file"]))
            options["file"] = str(self.playback_file)
            options["master_board"] = master
        params = input_params(self.source, options)
        self.board = BoardShim(board_id, params)
        try:
            self.board.prepare_session()
        except BrainFlowError as e:
            self.board = None
            raise ConnectionError(_explain(self.source, e)) from e
        layout_id = params.master_board if self.source.key in ("playback", "streaming") else board_id
        self.layout = layout_for(layout_id)
        n = len(self.layout.eeg)
        self.channels = [hardware.ChannelSettings() for _ in range(n)]
        if self.source.key in ("cyton_daisy", "cyton_daisy_wifi"):
            self.packets.step = 2
        k = None
        if self.source.key == "synthetic" and self.options.get("channels"):
            k = int(self.options["channels"])
        elif self.source.key == "playback" and file_channels and file_channels < n:
            k = file_channels  # e.g. a synthetic-board recording made with 4 of its 16 channels
        if k:
            self.layout.eeg, self.layout.names = self.layout.eeg[:k], self.layout.names[:k]
            self.channels = self.channels[:k]
        if self.source.key == "playback":
            from .playback import count_samples
            self.board.config_board("loopback_true")
            self.playback_samples = count_samples(self.playback_file)
        if self.source.connection == "wifi" and self.options.get("sample_rate"):
            self.configure(hardware.sample_rate_command(self.source.family, int(self.options["sample_rate"])))
            self.layout.sampling_rate = int(self.options["sample_rate"])
        self._ring = np.zeros((self.layout.num_rows, self.layout.sampling_rate * self.buffer_seconds))
        self._ring_len = 0
        log.info("connected: %s", self.source.label)
        return self.describe()

    def start_stream(self) -> None:
        if self.board is None:
            raise RuntimeError("not connected")
        if self.streaming:
            return
        sd = self.options.get("sd_mode")
        if sd and self.source.key in ("cyton", "cyton_daisy"):
            self.configure(sd)  # A, S, F, G, H, J, K or L: write to the SD card for 5 min .. 24 h
        streamer = "streaming_board://225.1.1.1:6677" if self.options.get("brainflow_streamer") else ""
        self.board.start_stream(450000, streamer)
        self.streaming = True
        self.started_at = time.time()
        self._stop.clear()
        self._thread = threading.Thread(target=self._pump, name="brainbench-acquisition", daemon=True)
        self._thread.start()

    def stop_stream(self) -> None:
        if not self.streaming or self.board is None:
            return
        self._stop.set()
        if self._thread:
            self._thread.join(timeout=2)
        try:
            self.board.stop_stream()
        except BrainFlowError:
            pass
        if self.options.get("sd_mode") and self.source.key in ("cyton", "cyton_daisy"):
            try:
                self.configure("j")  # close the SD-card file
            except RuntimeError:
                pass
        self.streaming = False

    def disconnect(self) -> None:
        self.stop_stream()
        if self.board is not None:
            try:
                self.board.release_session()
            except BrainFlowError:
                pass
        self.board = None

    # ------------------------------------------------------------------ data

    def _pump(self) -> None:
        last = time.time()
        while not self._stop.is_set():
            time.sleep(1 / 30)
            try:
                chunk = self.board.get_board_data()
            except BrainFlowError as e:  # board unplugged, BLE dropped...
                log.warning("read failed: %s", e)
                continue
            now = time.time()
            dt, last = now - last, now
            if self.smoothing:
                # The Cyton dongle delivers in bursts; release samples at the sampling rate instead
                # (the OpenBCI GUI's "smoothing"), keeping at most a second in hand.
                if chunk.size:
                    self._pending = chunk if self._pending is None else np.concatenate([self._pending, chunk], axis=1)
                if self._pending is None or self._pending.shape[1] == 0:
                    continue
                fs = self.layout.sampling_rate
                n = int(np.ceil(fs * dt))
                n = max(n, self._pending.shape[1] - fs)
                chunk, self._pending = self._pending[:, :n], self._pending[:, n:]
            if chunk.size == 0:
                continue
            self._ingest(chunk)

    def _ingest(self, chunk: np.ndarray) -> None:
        if self.layout.package is not None:
            self.packets.update(chunk[self.layout.package])
        with self._lock:
            n = chunk.shape[1]
            cap = self._ring.shape[1]
            if n >= cap:
                self._ring[:] = chunk[:, -cap:]
            else:
                self._ring = np.roll(self._ring, -n, axis=1)
                self._ring[:, -n:] = chunk
            self._ring_len = min(cap, self._ring_len + n)
        for fn in list(self.listeners):
            try:
                fn(chunk)
            except Exception:  # one listener must not stop the others
                log.exception("listener failed")

    def recent(self, seconds: float) -> np.ndarray:
        """The last ``seconds`` of data, all rows."""
        n = min(self._ring_len, int(seconds * self.layout.sampling_rate))
        with self._lock:
            return self._ring[:, self._ring.shape[1] - n:].copy()

    # ------------------------------------------------------------------ control

    def configure(self, command: str) -> str:
        if self.board is None:
            raise RuntimeError("not connected")
        if self.source.family not in ("cyton", "ganglion", "playback"):
            return ""
        try:
            return self.board.config_board(command) or ""
        except BrainFlowError as e:
            raise RuntimeError(f"the board did not accept {command!r}: {e}") from e

    def set_channel(self, index: int, settings: hardware.ChannelSettings) -> str:
        """Applies ADS1299 settings on a Cyton, or switches a Ganglion channel on or off.

        As in the OpenBCI GUI, a Cyton channel switched off is also removed
        from the bias and SRB2 and shorted; switching it on restores them.
        """
        if self.source.family == "ganglion":
            self.channels[index] = settings
            return self.configure(hardware.channel_toggle_command(index, settings.active, "ganglion"))
        if self.source.family != "cyton":
            self.channels[index] = settings
            return ""
        was = self.channels[index]
        sent = settings
        if was.active and not settings.active:
            self._saved[index] = hardware.ChannelSettings(**{**settings.to_json(), "active": True})
            sent = hardware.ChannelSettings(active=False, gain=settings.gain, input_type="shorted", bias=False, srb2=False, srb1=settings.srb1)
        elif not was.active and settings.active and index in self._saved:
            sent = self._saved.pop(index)
        self.channels[index] = sent
        return self.configure(sent.command(index))

    def set_board_mode(self, mode: str) -> str:
        if mode not in hardware.BOARD_MODES:
            raise ValueError(f"board mode must be one of {sorted(hardware.BOARD_MODES)}")
        self.board_mode = mode
        return self.configure(hardware.BOARD_MODES[mode])

    def impedance(self, index: int | None, on: bool, pin: str = "p") -> str:
        """Cyton: lead-off current on a channel's P or N pin. Ganglion: impedance mode for all channels.

        On the Cyton the channel is set to gain x1, normal input, in the bias,
        SRB2 and SRB1 off for the test, and gets its settings back afterwards
        (the OpenBCI GUI's procedure).
        """
        if self.source.family == "cyton" and index is not None:
            key = 100 + index
            if on:
                self._saved.setdefault(key, self.channels[index])
                test = hardware.ChannelSettings(active=True, gain=1, input_type="normal", bias=True, srb2=False, srb1=False)
                self.channels[index] = test
                self.configure(test.command(index))
                return self.configure(hardware.impedance_command(index, pin == "p", pin == "n"))
            reply = self.configure(hardware.impedance_command(index, False, False))
            restore = self._saved.pop(key, None)
            if restore is not None:
                self.channels[index] = restore
                self.configure(restore.command(index))
            return reply
        if self.source.family == "ganglion":
            return self.configure("z" if on else "Z")
        return ""

    def insert_marker(self, value: float) -> None:
        if self.board is not None and self.streaming:
            self.board.insert_marker(float(value))

    def seek(self, fraction: float) -> None:
        """Playback only: jump to a point in the file (0 to 1)."""
        if self.source.key == "playback" and self.board is not None:
            self.board.config_board(f"set_index_percentage:{int(round(100 * fraction))}")

    def describe(self) -> dict:
        d = {
            "source": self.source.key, "label": self.source.label, "family": self.source.family,
            "streaming": self.streaming, "board_mode": self.board_mode,
            "channels": [c.to_json() for c in self.channels],
            "packets": self.packets.to_json(),
            "started_at": self.started_at,
        }
        if self.layout:
            d["layout"] = self.layout.to_json()
        if self.playback_file:
            d["playback_file"] = str(self.options.get("file"))
            d["playback"] = {"total_samples": self.playback_samples}
        d["smoothing"] = self.smoothing
        return d


def _explain(source: Source, err: BrainFlowError) -> str:
    """A plain-language reason for a failed connection."""
    hints = {
        "serial": "Check that the dongle is plugged in, the board is switched on (PC position), and the right port is selected.",
        "wifi": "Check that the computer is on the WiFi Shield's network and the IP address is right.",
        "ble": "Check that Bluetooth is on and the Ganglion is switched on and not connected to another program.",
        "file": "Check that the file is an OpenBCI or BrainFlow recording.",
        "multicast": "Check the address and port of the BrainFlow stream.",
    }
    return f"Could not connect to the {source.label}. {hints.get(source.connection, '')} ({err})".strip()

