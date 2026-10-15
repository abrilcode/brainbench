import struct

import numpy as np
from brainflow.board_shim import BoardIds

from brainbench.boards import layout_for
from brainbench.formats import BdfWriter, OdfWriter, column_names, master_board_from_header, read_odf
from brainbench.playback import prepare_playback


def fake_chunk(layout, n=500, seed=0):
    rng = np.random.default_rng(seed)
    data = np.zeros((layout.num_rows, n))
    for row in layout.eeg:
        data[row] = rng.normal(0, 20, n).round(4)
    for row in layout.accel:
        data[row] = rng.normal(0, 0.5, n).round(4)
    data[layout.package] = np.arange(n) % 256
    data[layout.timestamp] = 1.7e9 + np.arange(n) / layout.sampling_rate
    data[layout.marker, 100] = 2
    return data


def test_openbci_csv_round_trip(tmp_path):
    layout = layout_for(int(BoardIds.CYTON_BOARD))
    data = fake_chunk(layout)
    w = OdfWriter(tmp_path / "rec.csv", layout, "cyton", "cyton")
    w.write(data[:, :200]); w.write(data[:, 200:]); w.close()
    header, back = read_odf(tmp_path / "rec.csv")
    assert header["Number of channels"] == "8" and header["Sample Rate"] == "250 Hz"
    assert header["Board"] == "OpenBCI_GUI$BoardCytonSerial"
    assert header["header"][:-1] == column_names(layout, "cyton")
    assert back.shape == data.shape
    np.testing.assert_allclose(back[layout.eeg], data[layout.eeg], atol=1e-6)
    assert master_board_from_header(header) == int(BoardIds.CYTON_BOARD)


def test_column_names_follow_the_openbci_gui():
    names = column_names(layout_for(int(BoardIds.CYTON_BOARD)), "cyton")
    assert names[0] == "Sample Index" and names[1] == "EXG Channel 0" and names[8] == "EXG Channel 7"
    assert "Accel Channel 2" in names and "Analog Channel 0" in names
    assert "Digital Channel 0 (D11)" in names and "Digital Channel 4 (D18)" in names
    assert names[-2:] == ["Timestamp", "Marker Channel"]


def test_playback_keeps_the_recorded_channel_count(tmp_path):
    layout = layout_for(int(BoardIds.SYNTHETIC_BOARD))
    layout.eeg, layout.names = layout.eeg[:4], layout.names[:4]
    w = OdfWriter(tmp_path / "four.csv", layout, "synthetic", "synthetic")
    w.write(fake_chunk(layout_for(int(BoardIds.SYNTHETIC_BOARD)))); w.close()
    path, master, channels = prepare_playback(tmp_path / "four.csv")
    assert master == int(BoardIds.SYNTHETIC_BOARD) and channels == 4 and path.exists()


def read_bdf(path):
    raw = path.read_bytes()
    n_rec, dur, ns = int(raw[236:244]), float(raw[244:252]), int(raw[252:256])
    off = 256
    def col(width):
        nonlocal off
        vals = [raw[off + i * width: off + (i + 1) * width].decode().strip() for i in range(ns)]
        off += ns * width
        return vals
    labels, _, dims, pmin, pmax, dmin, dmax, _, spr, _ = (col(w) for w in (16, 80, 8, 8, 8, 8, 8, 80, 8, 32))
    spr = [int(x) for x in spr]
    body = raw[256 * (ns + 1):]
    rec_bytes = 3 * sum(spr)
    assert len(body) == n_rec * rec_bytes
    signals = [[] for _ in range(ns)]
    for r in range(n_rec):
        rec = body[r * rec_bytes:(r + 1) * rec_bytes]
        pos = 0
        for i, k in enumerate(spr):
            chunk = rec[pos:pos + 3 * k]; pos += 3 * k
            signals[i].append(chunk)
    return dict(n_rec=n_rec, dur=dur, ns=ns, labels=labels, dims=dims, pmin=pmin, pmax=pmax, dmin=dmin, dmax=dmax, spr=spr, version=raw[:8], reserved=raw[192:236].decode().strip(), signals=signals)


def decode24(chunks):
    b = b"".join(chunks)
    out = np.array([struct.unpack("<i", b[i:i + 3] + (b"\xff" if b[i + 2] & 0x80 else b"\x00"))[0] for i in range(0, len(b), 3)])
    return out


def test_bdf_header_data_and_annotations(tmp_path):
    layout = layout_for(int(BoardIds.CYTON_BOARD))
    data = fake_chunk(layout, n=625)  # 2.5 s at 250 Hz -> 3 records, the last padded
    w = BdfWriter(tmp_path / "rec.bdf", layout, "cyton", "cyton")
    w.write(data); w.close()
    f = read_bdf(tmp_path / "rec.bdf")
    assert f["version"] == b"\xffBIOSEMI" and f["reserved"] == "BDF+C"
    assert f["n_rec"] == 3 and f["dur"] == 1 and f["ns"] == 8 + 3 + 1
    assert f["labels"][:2] == ["Fp1", "Fp2"] and f["labels"][-1] == "BDF Annotations"
    assert f["dims"][0] == "uV" and f["dims"][8] == "g" and f["spr"][0] == 250
    # Values come back within one quantisation step of the ±4.5 V / 24 range.
    lo, hi = float(f["pmin"][0]), float(f["pmax"][0])
    digital = decode24(f["signals"][0])[:625]
    phys = lo + (digital + 8388608) * (hi - lo) / 16777215
    np.testing.assert_allclose(phys, data[layout.eeg[0]], atol=(hi - lo) / 16777215 * 1.5)
    annot = f["signals"][-1][0].decode("latin-1")  # first record's annotations
    assert "+0\x14\x14" in annot and "+0.4000\x142\x14" in annot  # marker 2 at sample 100
