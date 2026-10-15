"""Recording to disk, on the acquisition thread, in one of three formats."""

from __future__ import annotations

import logging
import threading
import time
from pathlib import Path

from .formats import BdfWriter, BrainFlowCsvWriter, OdfWriter, read_odf

log = logging.getLogger("brainbench")

FORMATS = {
    "openbci_csv": (OdfWriter, ".csv", "OpenBCI CSV"),
    "bdf": (BdfWriter, ".bdf", "BDF+"),
    "brainflow_csv": (BrainFlowCsvWriter, ".csv", "BrainFlow CSV"),
}


class Recorder:
    def __init__(self, root: Path):
        self.root = Path(root)
        self.session = None
        self.format = "openbci_csv"
        self.auto = False
        self.name = ""
        self.max_minutes: float | None = 60
        self.writer = None
        self.started_at: float | None = None
        self.folder: Path | None = None
        self._lock = threading.Lock()

    def configure(self, session, cfg: dict) -> None:
        self.session = session
        fmt = cfg.get("format", self.format)
        self.format = fmt if fmt in FORMATS else "off"
        self.auto = bool(cfg.get("auto", False)) and self.format != "off" and session.source.key != "playback"
        self.name = cfg.get("name") or self.name or ""
        mm = cfg.get("max_minutes", 60)
        self.max_minutes = None if mm in (None, -1, "none") else float(mm)
        stamp = time.strftime("%Y-%m-%d_%H-%M-%S")
        self.folder = self.root / f"BrainBench-{self.name or stamp}"

    def start(self) -> str:
        with self._lock:
            if self.writer:
                return str(self.writer.path)
            if self.session is None or self.session.layout is None:
                raise RuntimeError("no session")
            if self.format == "off":
                self.format = "openbci_csv"
            cls, ext, _ = FORMATS[self.format]
            self.folder.mkdir(parents=True, exist_ok=True)
            path = self.folder / f"BrainBench-{'BDF' if self.format == 'bdf' else 'RAW'}-{time.strftime('%Y-%m-%d_%H-%M-%S')}{ext}"
            s = self.session
            args = (path, s.layout, s.source.key, s.source.family)
            self.writer = cls(*args, gains=[c.gain for c in s.channels]) if cls is BdfWriter else cls(*args)
            self.started_at = time.time()
            log.info("recording to %s", path)
            return str(path)

    def stop(self) -> str | None:
        with self._lock:
            if not self.writer:
                return None
            path = str(self.writer.path)
            self.writer.close()
            self.writer = None
            self.started_at = None
            return path

    def write(self, chunk) -> None:
        with self._lock:
            if not self.writer:
                return
            self.writer.write(chunk)
            rollover = self.max_minutes and self.format == "openbci_csv" and time.time() - self.started_at > self.max_minutes * 60
        if rollover:  # a new file, as the OpenBCI GUI does at the maximum duration
            self.stop()
            self.start()

    def status(self) -> dict:
        w = self.writer
        return {
            "active": w is not None, "format": self.format, "auto": self.auto,
            "path": str(w.path) if w else None, "started_at": self.started_at,
            "samples": w.samples if w else 0, "folder": str(self.folder) if self.folder else None,
        }


def list_recordings(root: Path, limit: int = 40) -> list[dict]:
    """Recent recordings under the root, newest first, with channel count and duration when known."""
    root = Path(root)
    if not root.exists():
        return []
    files = [p for p in root.rglob("*") if p.suffix.lower() in (".csv", ".txt", ".bdf") and p.is_file()]
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    out = []
    for p in files[:limit]:
        entry = {"name": p.name, "path": str(p), "modified": p.stat().st_mtime, "size": p.stat().st_size}
        try:
            with p.open(errors="ignore") as f:
                first = f.readline()
                if first.startswith("%OpenBCI Raw"):
                    chans = f.readline().split("=")[-1].strip()
                    rate = f.readline().split("=")[-1].replace("Hz", "").strip()
                    lines = sum(1 for _ in f) - 2
                    entry["channels"] = int(chans)
                    secs = max(0, lines) / max(1, int(rate))
                    entry["duration"] = f"{int(secs // 60)}:{int(secs % 60):02d}"
        except (OSError, ValueError):
            pass
        out.append(entry)
    return out


__all__ = ["Recorder", "list_recordings", "FORMATS", "read_odf"]
