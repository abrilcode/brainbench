// FFT plot: amplitude spectrum of the selected channels, overlaid.
// Hamming window, |X|/N amplitudes and log-power smoothing, as in the OpenBCI GUI.

import { axes, channelColor, fit, polyline } from "../charts.js";
import { ChannelPicker } from "./channels.js";

export const SMOOTHING = [0, 0.5, 0.75, 0.9, 0.95, 0.98, 0.99, 0.999].map((v) => [v, String(v)]);

export class FftPlot {
  static id = "fft";
  static title = "FFT plot";
  static options = () => [
    { key: "maxFreq", label: "Max", default: 60, values: [20, 40, 60, 100, 120, 250, 500, 800].map((v) => [v, `${v} Hz`]) },
    { key: "maxUv", label: "Max", default: 100, values: [10, 50, 100, 1000].map((v) => [v, `${v} µV`]) },
    { key: "logY", label: "Axis", default: true, values: [[true, "Log"], [false, "Linear"]] },
    { key: "smoothing", label: "Smooth", default: 0.75, values: SMOOTHING },
    { key: "raw", label: "Signal", default: false, values: [[false, "Filtered"], [true, "Unfiltered"]] },
  ];

  constructor(body, app, options, head) {
    this.body = body; this.app = app; this.o = options;
    this.canvas = document.createElement("canvas");
    body.append(this.canvas);
    this.picker = new ChannelPicker(app, head, options);
    this.optionChanged();
  }

  optionChanged() {
    // Smoothing and filtered/unfiltered are shared with the band power widget.
    Object.assign(this.app.stream.fft, { smoothing: this.o.smoothing, raw: this.o.raw });
    this.app.stream.smoothed = [];
  }

  draw() {
    const { stream } = this.app;
    const { ctx, w, h } = fit(this.canvas);
    const a = stream.analyse();
    const maxF = Math.min(this.o.maxFreq, stream.fs / 2);
    const { X, Y, box } = axes(ctx, w, h, { x: [0, maxF], y: [this.o.logY ? 0.1 : 0, this.o.maxUv], logY: this.o.logY, xlabel: "Frequency (Hz)", ylabel: "Amplitude (µV)" });
    if (!a) return;
    a.spectra.forEach((sp, ch) => {
      if (!sp || !this.picker.on(ch)) return;
      const pts = [];
      for (let k = 1; k < sp.freqs.length && sp.freqs[k] <= maxF; k++) pts.push([X(sp.freqs[k]), Y(sp.amp[k])]);
      polyline(ctx, pts, channelColor(ch), 1.2, box);
    });
  }
}
