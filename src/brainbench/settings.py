"""Saved interface settings: layout, widgets, filters, channel settings, outputs.

Stored as JSON files, one per name, like the OpenBCI GUI's session settings.
"""

from __future__ import annotations

import json
import re
import time
from pathlib import Path


class SettingsStore:
    def __init__(self, root: Path):
        self.root = Path(root)

    def _path(self, name: str) -> Path:
        safe = re.sub(r"[^A-Za-z0-9_. -]", "_", name).strip() or "default"
        return self.root / f"{safe}.json"

    def save(self, name: str, data: dict) -> Path:
        self.root.mkdir(parents=True, exist_ok=True)
        path = self._path(name)
        path.write_text(json.dumps({"saved_at": time.strftime("%Y-%m-%dT%H:%M:%S"), **data}, indent=2))
        return path

    def load(self, name: str) -> dict:
        return json.loads(self._path(name).read_text())

    def list(self) -> list[dict]:
        if not self.root.exists():
            return []
        files = sorted(self.root.glob("*.json"), key=lambda p: p.stat().st_mtime, reverse=True)
        return [{"name": p.stem, "modified": p.stat().st_mtime} for p in files]
