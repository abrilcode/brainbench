// Spectrogram: the averaged spectrum of a channel group, scrolling right to
// left. Two halves, top and bottom, each with its own channels.

import { fit, heat, line, text, THEME } from "../charts.js";
import { ChannelPicker } from "./channels.js";

const COLS = 900;

export class Spectrogram {
  static id = "spectrogram";
  static title = "Spectrogram";
  static options = () => [
    { key: "maxFreq", label: "Max", default: 40, values: [20, 40, 60, 100, 120, 250].map((v) => [v, `${v} Hz`]) },
    { key: "minutes", label: "Window", default: 3, values: [[30, "30 min"], [6, "6 min"], [3, "3 min"], [1.5, "1.5 min"], [1, "1 min"], [0.5, "30 s"]] },
    { key: "log", label: "Scale", default: true, values: [[true, "Log"], [false, "Linear"]] },
  ];

  constructor(body, app, options, head) {
    this.body = body; this.app = app; this.o = options;
    this.canvas = document.createElement("canvas");
    body.append(this.canvas);
    const n = app.stream.layout.eeg.length;
    if (!options.top) options.top = Array.from({ length: n }, (_, i) => i).filter((i) => i % 2 === 1);
    if (!options.bottom) options.bottom = Array.from({ length: n }, (_, i) => i).filter((i) => i % 2 === 0);
    // Pickers prepend themselves: create the bottom one first so "Top" comes first.
    this.botPick = new ChannelPicker(app, head, options, "bottom", "Bottom");
    this.topPick = new ChannelPicker(app, head, options, "top", "Top");
    this.reset();
  }

  optionChanged() { this.reset(); }

  reset() {
    this.rows = Math.max(2, Math.round(this.o.maxFreq));
    this.img = [new OffscreenCanvas(COLS, this.rows), new OffscreenCanvas(COLS, this.rows)];
    for (const c of this.img) { const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, COLS, this.rows); }
    this.last = 0;
  }

  column(picker, canvas) {
    const a = this.app.stream.analyse();
    const g = canvas.getContext("2d");
    g.drawImage(canvas, -1, 0);
    const col = g.createImageData(1, this.rows);
    const chans = a?.spectra.map((sp, ch) => (sp && picker.on(ch) ? sp : null)).filter(Boolean) || [];
    for (let r = 0; r < this.rows; r++) {
      const f = this.o.maxFreq * (1 - r / (this.rows - 1));
      let v = 0;
      for (const sp of chans) {
        const k = Math.min(sp.amp.length - 1, Math.round(f * (sp.freqs.length - 1) / (sp.freqs.at(-1) || 1)));
        v += sp.amp[k];
      }
      v = chans.length ? v / chans.length : 0;
      // Log: 0.1 µV .. 100 µV over the colour scale; linear: 0 .. 8 µV.
      const level = this.o.log ? (Math.log10(Math.max(v, 0.1)) + 1) / 3 : v / 8;
      col.data.set([...heat(level), 255], r * 4);
    }
    g.putImageData(col, COLS - 1, 0);
  }

  draw(now) {
    const period = (this.o.minutes * 60 * 1000) / COLS;
    if (this.app.session?.streaming && now - this.last >= period) {
      this.last = now;
      this.column(this.topPick, this.img[0]);
      this.column(this.botPick, this.img[1]);
    }
    const { ctx, w, h } = fit(this.canvas);
    const L = 44, B = 26, gap = 10, ih = (h - B - gap - 6) / 2, iw = w - L - 10;
    this.img.forEach((img, i) => {
      const y0 = 4 + i * (ih + gap);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, L, y0, iw, ih);
      line(ctx, L, y0, L, y0 + ih, THEME.axis);
      for (const f of [0, this.o.maxFreq / 2, this.o.maxFreq]) {
        const y = y0 + ih - (f / this.o.maxFreq) * ih;
        line(ctx, L - 4, y, L, y, THEME.axis);
        text(ctx, `${Math.round(f)}`, L - 7, y + 3.5, { align: "right", font: THEME.mono });
      }
      text(ctx, i ? "Bottom" : "Top", L + 6, y0 + 13, { color: THEME.strong, weight: "600" });
    });
    text(ctx, "Hz", 6, 14, { font: THEME.mono });
    for (let k = 0; k <= 4; k++) {
      const x = L + (k / 4) * iw;
      const sec = -this.o.minutes * 60 * (1 - k / 4);
      const label = k === 4 ? "now" : this.o.minutes <= 2 ? `${Math.round(sec)} s` : `${+(sec / 60).toFixed(2)} min`;
      text(ctx, label, Math.max(L + 18, Math.min(w - 16, x)), h - 8, { align: "center", font: THEME.mono });
    }
  }
}
