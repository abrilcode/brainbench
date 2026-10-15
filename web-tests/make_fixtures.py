"""Regenerates fixtures.json: SciPy filter responses, a filtered stream, a Welch PSD,
and BrainFlow's board layouts with the OpenBCI column names, for the browser tests.

    python web-tests/make_fixtures.py
"""

import json
from pathlib import Path

import numpy as np
from brainflow.board_shim import BoardIds
from scipy import signal

from brainbench.boards import layout_for
from brainbench.formats import column_names

DESIGN = {
    "butterworth": lambda n, wn, btype, fs: signal.butter(n, wn, btype, fs=fs, output="sos"),
    "chebyshev": lambda n, wn, btype, fs: signal.cheby1(n, 1, wn, btype, fs=fs, output="sos"),
    "bessel": lambda n, wn, btype, fs: signal.bessel(n, wn, btype, fs=fs, output="sos", norm="phase"),
}
BANDS = {"bandpass": [[1, 50], [5, 50], [7, 13]], "bandstop": [[48, 52], [58, 62]], "lowpass": [[30]], "highpass": [[1]]}


def responses():
    out = []
    for fs in (125, 200, 250, 1000):
        for kind, make in DESIGN.items():
            for btype, bands in BANDS.items():
                for freqs in bands:
                    for order in (2, 4):
                        wn = freqs if len(freqs) == 2 else freqs[0]
                        sos = make(order, wn, btype, fs)
                        f = np.linspace(0.5, fs / 2 * 0.98, 60)
                        _, hz = signal.sosfreqz(sos, worN=f, fs=fs)
                        out.append({"fs": fs, "kind": kind, "order": order, "type": btype, "freqs": freqs,
                                    "f": f.round(6).tolist(), "mag": np.abs(hz).tolist()})
    return out


def main():
    rng = np.random.default_rng(7)
    x = rng.normal(0, 10, 500) + 30 * np.sin(2 * np.pi * 10 * np.arange(500) / 250)
    y = signal.sosfilt(signal.butter(4, [1, 50], "bandpass", fs=250, output="sos"), x)
    noise = rng.normal(0, 5, 4000)
    f, psd = signal.welch(noise, 250, nperseg=250)
    layouts = {}
    for key, board, family in (("cyton", BoardIds.CYTON_BOARD, "cyton"), ("cyton_daisy", BoardIds.CYTON_DAISY_BOARD, "cyton"),
                               ("ganglion", BoardIds.GANGLION_BOARD, "ganglion")):
        lay = layout_for(int(board))
        layouts[key] = {"layout": lay.to_json(), "columns": column_names(lay, family), "family": family}
    data = {"responses": responses(), "stream": {"x": x.tolist(), "y": y.tolist()},
            "welch": {"f": f.tolist(), "psd": psd.tolist()}, "layouts": layouts}
    Path(__file__).with_name("fixtures.json").write_text(json.dumps(data))


if __name__ == "__main__":
    main()
