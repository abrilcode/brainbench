"""Radio tools for the Cyton's USB dongle: status, channel, auto-scan.

The dongle and the board talk on one of 25 radio channels. When they drift
apart (after re-flashing, or a board from another kit), the board appears
"not found". These are the OpenBCI SDK's radio commands, sent straight to
the dongle before a session is opened.
"""

from __future__ import annotations

import time

STATUS = bytes([0xF0, 0x07])
GET_CHANNEL = bytes([0xF0, 0x00])
SET_CHANNEL = 0x01      # board and dongle
OVERRIDE_DONGLE = 0x02  # dongle only
CHANNELS = range(1, 26)


def _ask(port: str, payload: bytes, wait: float = 1.0) -> str:
    import serial

    with serial.Serial(port, 115200, timeout=0.1) as s:
        s.reset_input_buffer()
        s.write(payload)
        out = b""
        end = time.time() + wait
        while time.time() < end and b"$$$" not in out:
            out += s.read(256)
    return out.replace(b"$$$", b"").decode(errors="replace").strip()


def status(port: str) -> dict:
    reply = _ask(port, STATUS)
    return {"ok": "success" in reply.lower(), "reply": reply or "No reply from the dongle."}


def get_channel(port: str) -> dict:
    reply = _ask(port, GET_CHANNEL)
    digits = "".join(c for c in reply.split(":")[-1] if c.isdigit())
    return {"ok": "success" in reply.lower(), "reply": reply, "channel": int(digits) if digits else None}


def set_channel(port: str, channel: int, dongle_only: bool = False) -> dict:
    if channel not in CHANNELS:
        raise ValueError("radio channel must be 1 to 25")
    reply = _ask(port, bytes([0xF0, OVERRIDE_DONGLE if dongle_only else SET_CHANNEL, channel]), wait=1.5)
    return {"ok": "success" in reply.lower(), "reply": reply, "channel": channel}


def auto_scan(port: str) -> dict:
    """Moves the dongle through every channel until the board answers."""
    for ch in CHANNELS:
        set_channel(port, ch, dongle_only=True)
        st = status(port)
        if st["ok"]:
            return {"ok": True, "channel": ch, "reply": f"Found the board on channel {ch}."}
    return {"ok": False, "channel": None, "reply": "The board did not answer on any channel. Is it switched on (PC position)?"}
