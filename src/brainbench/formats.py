"""File formats: the OpenBCI GUI's CSV ("ODF"), BDF+, and BrainFlow's CSV.

OpenBCI CSV files written here open in the OpenBCI GUI's playback and the
other way round: same header lines, column names and ", " separator.
"""

from __future__ import annotations

import datetime as dt
import struct
from pathlib import Path

import numpy as np
from brainflow.board_shim import BoardIds

from .boards import Layout

ODF_FIRST_LINE = "%OpenBCI Raw EXG Data"

#: The OpenBCI GUI's board class names, used on the "%Board =" header line.
GUI_BOARD_CLASS = {
    "cyton": "OpenBCI_GUI$BoardCytonSerial",
    "cyton_daisy": "OpenBCI_GUI$BoardCytonSerialDaisy",
    "cyton_wifi": "OpenBCI_GUI$BoardCytonWifi",
    "cyton_daisy_wifi": "OpenBCI_GUI$BoardCytonWifiDaisy",
    "ganglion": "OpenBCI_GUI$BoardGanglionBLE",
    "ganglion_native": "OpenBCI_GUI$BoardGanglionNative",
    "ganglion_wifi": "OpenBCI_GUI$BoardGanglionWifi",
    "synthetic": "OpenBCI_GUI$BoardBrainFlowSynthetic",
}


def column_names(layout: Layout, family: str) -> list[str]:
    """Names of every BrainFlow row, as the OpenBCI GUI labels them."""
    names = ["Other"] * layout.num_rows
    if layout.timestamp is not None:
        names[layout.timestamp] = "Timestamp"
    if layout.package is not None:
        names[layout.package] = "Sample Index"
    for i, row in enumerate(layout.eeg):
        names[row] = f"EXG Channel {i}"
    for i, row in enumerate(layout.accel):
        names[row] = f"Accel Channel {i}"
    if family == "cyton":
        for i, row in enumerate(layout.analog):
            names[row] = f"Analog Channel {i}"
        if len(layout.other) >= 7:
            for k, pin in zip((1, 2, 3, 4, 6), ("D11", "D12", "D13", "D17", "D18")):
                names[layout.other[k]] = f"Digital Channel {(1, 2, 3, 4, 6).index(k)} ({pin})"
            names[layout.other[0]] = "Not Used"
            names[layout.other[5]] = "Not Used"
    if layout.marker is not None:
        names[layout.marker] = "Marker Channel"
    return names


def _num(v: float) -> str:
    """Compact number text: integers without a decimal point, others to 6 significant decimals."""
    if v == int(v) and abs(v) < 1e15:
        return str(int(v))
    return f"{v:.6f}".rstrip("0").rstrip(".")


class OdfWriter:
    """Writes the OpenBCI GUI's CSV format, chunk by chunk."""

    def __init__(self, path: Path, layout: Layout, source_key: str, family: str):
        self.path = Path(path)
        self.layout = layout
        self.f = self.path.open("w", newline="")
        self.f.write(f"{ODF_FIRST_LINE}\n")
        self.f.write(f"%Number of channels = {len(layout.eeg)}\n")
        self.f.write(f"%Sample Rate = {layout.sampling_rate} Hz\n")
        self.f.write(f"%Board = {GUI_BOARD_CLASS.get(source_key, GUI_BOARD_CLASS['synthetic'])}\n")
        self.f.write(", ".join(column_names(layout, family)) + ", Timestamp (Formatted)\n")
        self.samples = 0

    def write(self, chunk: np.ndarray) -> None:
        ts_row = self.layout.timestamp
        lines = []
        for col in chunk.T:
            stamp = dt.datetime.fromtimestamp(col[ts_row]).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3] if ts_row is not None else ""
            lines.append(", ".join(_num(v) for v in col) + ", " + stamp)
        self.f.write("\n".join(lines) + "\n")
        self.samples += chunk.shape[1]

    def close(self) -> None:
        self.f.close()


class BrainFlowCsvWriter:
    """BrainFlow's own CSV: tab separated, one sample per line, every row."""

    def __init__(self, path: Path, layout: Layout, *_):
        from brainflow.data_filter import DataFilter

        self.path = Path(path)
        self._df = DataFilter
        self.samples = 0
        self.path.write_text("")

    def write(self, chunk: np.ndarray) -> None:
        self._df.write_file(np.ascontiguousarray(chunk), str(self.path), "a")
        self.samples += chunk.shape[1]

    def close(self) -> None:
        pass


class BdfWriter:
    """BDF+ (24-bit EDF variant), continuous, one-second records.

    EXG channels are stored in µV with the physical range of the converter at
    each channel's gain, the accelerometer in g, and markers as annotations.
    """

    RECORD_S = 1
    ANNOT_BYTES = 120  # per record

    def __init__(self, path: Path, layout: Layout, source_key: str, family: str, gains: list[int] | None = None):
        self.path = Path(path)
        self.layout = layout
        self.fs = int(layout.sampling_rate)
        self.start = dt.datetime.now()
        gains = gains or [24] * len(layout.eeg)
        self.signals = []  # (row, label, dimension, physical min, physical max, transducer)
        for i, row in enumerate(layout.eeg):
            full = 1.2e6 / 1.5 / 51 if family == "ganglion" else 4.5e6 / gains[i]
            self.signals.append((row, layout.names[i] if i < len(layout.names) else f"EXG {i + 1}", "uV", -full, full, "AgAgCl electrode"))
        for row, axis in zip(layout.accel, "XYZ"):
            self.signals.append((row, f"Accel {axis}", "g", -4.0, 4.0, "MEMS accelerometer"))
        self.buf = np.zeros((len(self.signals), 0))
        self.records = 0
        self.annotations: list[tuple[float, str]] = []
        self.samples = 0
        self.f = self.path.open("wb")
        self._write_header()

    # -- header

    def _write_header(self, records: int = -1) -> None:
        ns = len(self.signals) + 1
        def field(text, width):
            return str(text)[:width].ljust(width).encode("ascii", "replace")
        h = bytearray(b"\xffBIOSEMI")
        h += field("X X X X", 80)
        h += field(f"Startdate {self.start.strftime('%d-%b-%Y').upper()} X BrainBench X", 80)
        h += field(self.start.strftime("%d.%m.%y"), 8) + field(self.start.strftime("%H.%M.%S"), 8)
        h += field(256 * (ns + 1), 8) + field("BDF+C", 44) + field(records, 8) + field(self.RECORD_S, 8) + field(ns, 4)
        labels = [s[1] for s in self.signals] + ["BDF Annotations"]
        trans = [s[5] for s in self.signals] + [""]
        dims = [s[2] for s in self.signals] + [""]
        pmin = [_g(s[3]) for s in self.signals] + ["-1"]
        pmax = [_g(s[4]) for s in self.signals] + ["1"]
        dmin = ["-8388608"] * len(self.signals) + ["-8388608"]
        dmax = ["8388607"] * len(self.signals) + ["8388607"]
        spr = [str(self.fs * self.RECORD_S)] * len(self.signals) + [str(self.ANNOT_BYTES // 3)]
        for values, width in ((labels, 16), (trans, 80), (dims, 8), (pmin, 8), (pmax, 8), (dmin, 8), (dmax, 8), ([""] * ns, 80), (spr, 8), ([""] * ns, 32)):
            for v in values:
                h += field(v, width)
        self.f.seek(0)
        self.f.write(bytes(h))

    # -- data

    def write(self, chunk: np.ndarray) -> None:
        rows = np.array([chunk[s[0]] for s in self.signals])
        self.buf = np.concatenate([self.buf, rows], axis=1)
        if self.layout.marker is not None:
            for i in np.nonzero(chunk[self.layout.marker])[0]:
                self.annotations.append(((self.samples + i) / self.fs, _g(chunk[self.layout.marker, i])))
        self.samples += chunk.shape[1]
        n = self.fs * self.RECORD_S
        while self.buf.shape[1] >= n:
            self._record(self.buf[:, :n])
            self.buf = self.buf[:, n:]

    def _record(self, block: np.ndarray) -> None:
        out = bytearray()
        for (_, _, _, lo, hi, _), x in zip(self.signals, block):
            digital = np.clip(np.round((x - lo) / (hi - lo) * 16777215 - 8388608), -8388608, 8388607).astype("<i4")
            out += _pack24(digital)
        onset = self.records * self.RECORD_S
        tal = f"+{onset}\x14\x14\x00".encode()
        due = [a for a in self.annotations if onset <= a[0] < onset + self.RECORD_S]
        for t, text in due:
            tal += f"+{t:.4f}\x14{text}\x14\x00".encode()
        out += tal[: self.ANNOT_BYTES].ljust(self.ANNOT_BYTES, b"\x00")
        self.f.seek(0, 2)
        self.f.write(bytes(out))
        self.records += 1

    def close(self) -> None:
        if self.buf.shape[1]:
            # Pad the last record with its final sample so no data is dropped.
            n = self.fs * self.RECORD_S
            pad = np.repeat(self.buf[:, -1:], n - self.buf.shape[1], axis=1)
            self._record(np.concatenate([self.buf, pad], axis=1))
            self.buf = self.buf[:, :0]
        self._write_header(self.records)
        self.f.close()


def _g(v: float) -> str:
    s = f"{v:.6g}"
    return s if len(s) <= 8 else f"{v:.0f}"


def _pack24(values: np.ndarray) -> bytes:
    b = values.astype("<i4").tobytes()
    return b"".join(b[i:i + 3] for i in range(0, len(b), 4))


# ------------------------------------------------------------------ reading


def read_odf(path: Path) -> tuple[dict, np.ndarray]:
    """Header fields and data (BrainFlow rows x samples) of an OpenBCI GUI CSV."""
    header: dict = {}
    rows = []
    with Path(path).open() as f:
        first = f.readline().strip()
        if not first.startswith("%OpenBCI Raw"):
            raise ValueError("not an OpenBCI GUI recording")
        for line in f:
            if line.startswith("%"):
                key, _, value = line[1:].partition("=")
                header[key.strip()] = value.strip()
                continue
            if "header" not in header:  # the column-name line
                header["header"] = [c.strip() for c in line.split(",")]
                continue
            parts = line.rstrip("\n").split(",")
            if len(parts) < 2:
                continue
            rows.append([float(p) for p in parts[:-1]])  # drop the formatted timestamp
    data = np.array(rows, dtype=float).T if rows else np.zeros((len(header.get("header", [])) - 1, 0))
    return header, data


def master_board_from_header(header: dict) -> int:
    board = header.get("Board", "")
    n = int(header.get("Number of channels", "8"))
    if "Ganglion" in board:
        return int(BoardIds.GANGLION_BOARD)
    if "Synthetic" in board:
        return int(BoardIds.SYNTHETIC_BOARD)
    return int(BoardIds.CYTON_DAISY_BOARD if n > 8 or "Daisy" in board else BoardIds.CYTON_BOARD)
