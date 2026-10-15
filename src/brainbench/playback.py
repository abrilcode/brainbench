"""Getting a recording ready for BrainFlow's playback board.

BrainFlow plays its own CSV format. OpenBCI GUI recordings (and BrainBench's
OpenBCI CSV files) are converted to it first, into a temporary file.
"""

from __future__ import annotations

import tempfile
from pathlib import Path

import numpy as np
from brainflow.board_shim import BoardIds, BoardShim

from .formats import master_board_from_header, read_odf


def sniff(path: Path) -> str:
    with Path(path).open() as f:
        first = f.readline()
    if first.startswith("%OpenBCI Raw"):
        return "openbci"
    if first.startswith("%STOP AT"):
        raise ValueError("This is a raw SD-card file. Convert it with the OpenBCI GUI first.")
    return "brainflow"


def guess_master(data: np.ndarray) -> int:
    """Board for a BrainFlow CSV, from its number of rows (and the sample counter for 32 rows)."""
    rows = data.shape[0]
    candidates = {24: BoardIds.CYTON_BOARD, 15: BoardIds.GANGLION_BOARD, 25: BoardIds.GANGLION_WIFI_BOARD}
    if rows in candidates:
        return int(candidates[rows])
    if rows == 32:
        steps = np.diff(data[0, :200]) % 256
        return int(BoardIds.CYTON_DAISY_BOARD if np.median(steps) == 2 else BoardIds.SYNTHETIC_BOARD)
    raise ValueError(f"Cannot tell which board made this file ({rows} columns).")


def prepare_playback(path: Path) -> tuple[Path, int, int | None]:
    """Returns a BrainFlow-format file to play, the board that recorded it,
    and how many EXG channels were in use (None when the file does not say)."""
    path = Path(path).expanduser()
    if not path.exists():
        raise FileNotFoundError(f"No such file: {path}")
    from brainflow.data_filter import DataFilter

    if sniff(path) == "openbci":
        header, data = read_odf(path)
        master = master_board_from_header(header)
        expected = BoardShim.get_num_rows(master)
        if data.shape[0] != expected:
            raise ValueError(f"The file has {data.shape[0]} columns; a {header.get('Board', 'board')} recording should have {expected}.")
        out = Path(tempfile.mkdtemp(prefix="brainbench-")) / (path.stem + ".brainflow.csv")
        DataFilter.write_file(np.ascontiguousarray(data), str(out), "w")
        n = header.get("Number of channels", "")
        return out, master, int(n) if n.isdigit() else None
    data = DataFilter.read_file(str(path))
    return path, guess_master(data), None


def count_samples(path: Path) -> int:
    with Path(path).open() as f:
        return sum(1 for line in f if line.strip() and not line.startswith("%"))
