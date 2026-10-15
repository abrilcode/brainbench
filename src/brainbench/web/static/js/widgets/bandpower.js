// Band power: delta, theta, alpha, beta and gamma, averaged over the
// selected channels. Bands and the PSD formula follow the OpenBCI GUI; the
// labels show the bands it actually computes.

import { axes, fit, line, text, THEME } from "../charts.js";
import { BANDS } from "../stream.js";
import { ChannelPicker } from "./channels.js";
import { SMOOTHING } from "./fft.js";

const COLORS = ["#8DB4D9", "#3A7FC1", "#0B3C7A", "#0E7C66", "#B7791F"];

export class BandPower {
  static id = "bandpower";
  static title = "Band power";
  static options = () => [
    { key: "smoothing", label: "Smooth", default: 0.75, values: SMOOTHING },
    { key: "raw", label: "Signal", default: false, values: [[false, "Filtered"], [true, "Unfiltered"]] },
    { key: "show", label: "Show", default: "abs", values: [["abs", "µV²/Hz"], ["rel", "% of total"]] },
  ];

  constructor(body, app, options, head) {
    this.body = body; this.app = app; this.o = options;
    this.canvas = document.createElement("canvas");
    body.append(this.canvas);
    this.picker = new ChannelPicker(app, head, options);
  }

  optionChanged(key) {
    if (key === "smoothing" || key === "raw") {
      Object.assign(this.app.stream.fft, { smoothing: this.o.smoothing, raw: this.o.raw });
      this.app.stream.smoothed = [];
    }
  }

  draw() {
    const { ctx, w, h } = fit(this.canvas);
    const v = averageBands(this.app, (ch) => this.picker.on(ch));
    const rel = this.o.show === "rel";
    const total = v ? v.reduce((s, x) => s + x, 0) || 1 : 1;
    const vals = v ? (rel ? v.map((x) => (100 * x) / total) : v) : null;
    const { Y, box } = axes(ctx, w, h, {
      // 0.1 to 100 µV²/Hz as in the OpenBCI GUI, extended by decades when a band goes over.
      x: [0, BANDS.length], y: rel ? [0, 100] : [0.1, Math.max(100, 10 ** Math.ceil(Math.log10(Math.max(...(vals || [1])) * 1.5)))], logY: !rel, xtickFmt: () => "",
      ylabel: rel ? "Share of power (%)" : "Power (µV²/Hz)", pad: { b: 36 },
    });
    const bw = box.w / BANDS.length;
    BANDS.forEach((b, i) => {
      const x0 = box.x + i * bw + bw * 0.2, x1 = box.x + (i + 1) * bw - bw * 0.2;
      text(ctx, b.label, (x0 + x1) / 2, box.y + box.h + 15, { align: "center", color: THEME.strong, weight: "600" });
      text(ctx, `${b.lo}–${b.hi} Hz`, (x0 + x1) / 2, box.y + box.h + 28, { align: "center", font: THEME.mono });
      if (!vals) return;
      const y = Y(Math.max(vals[i], rel ? 0 : 0.1));
      ctx.fillStyle = COLORS[i];
      ctx.fillRect(x0, y, x1 - x0, box.y + box.h - y);
      text(ctx, rel ? `${vals[i].toFixed(0)} %` : vals[i] >= 100 ? vals[i].toFixed(0) : vals[i].toFixed(2), (x0 + x1) / 2, Math.max(box.y + 10, y - 5), { align: "center", font: THEME.mono, color: THEME.strong });
    });
    line(ctx, box.x, box.y + box.h, box.x + box.w, box.y + box.h, THEME.axis);
    if (!v) text(ctx, "Waiting for a second of data", box.x + box.w / 2, box.y + box.h / 2, { align: "center" });
  }
}

/** Mean band powers over the channels that pass `use` (null until there is data). */
export function averageBands(app, use = () => true) {
  const a = app.stream.analyse();
  if (!a) return null;
  const rows = a.bands.filter((b, ch) => b && use(ch) && (app.session?.channels?.[ch]?.active ?? true));
  if (!rows.length) return null;
  return BANDS.map((_, i) => rows.reduce((s, b) => s + b[i], 0) / rows.length);
}
