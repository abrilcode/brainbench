// Head plot: amplitude (standard deviation of the last second, filtered) at
// each electrode, interpolated over a top view of the head. Polarity follows
// the strongest channel, as in the OpenBCI GUI.

import { diverging, fit, heat, text, THEME } from "../charts.js";
import { std } from "../dsp.js";
import { ChannelPicker } from "./channels.js";

/** Electrode positions (x right, y towards the nose), unit circle = head outline at the ears. */
export const POSITIONS = {
  Fp1: [-0.31, 0.95], Fp2: [0.31, 0.95], F7: [-0.81, 0.59], F3: [-0.4, 0.52], Fz: [0, 0.48], F4: [0.4, 0.52], F8: [0.81, 0.59],
  F5: [-0.6, 0.55], F1: [-0.2, 0.5], F2: [0.2, 0.5], F6: [0.6, 0.55],
  T7: [-1, 0], C3: [-0.5, 0], Cz: [0, 0], C4: [0.5, 0], T8: [1, 0],
  P7: [-0.81, -0.59], P3: [-0.4, -0.52], Pz: [0, -0.48], P4: [0.4, -0.52], P8: [0.81, -0.59],
  PO7: [-0.6, -0.8], PO8: [0.6, -0.8], O1: [-0.31, -0.95], Oz: [0, -1], O2: [0.31, -0.95],
};

/** Electrodes sit a little inside the outline, which is drawn at the ears. */
const INSET = 0.9;

export class HeadPlot {
  static id = "headplot";
  static title = "Head plot";
  static options = () => [
    { key: "intensity", label: "Intensity", default: 1, values: [[4, "4×"], [2, "2×"], [1, "1×"], [0.5, "0.5×"], [0.2, "0.2×"], [0.02, "0.02×"]] },
    { key: "polarity", label: "Polarity", default: "both", values: [["both", "+/−"], ["pos", "+"]] },
    { key: "contours", label: "Contours", default: true, values: [[true, "On"], [false, "Off"]] },
    { key: "smoothing", label: "Smooth", default: 0.75, values: [0, 0.5, 0.75, 0.9, 0.95, 0.98].map((v) => [v, String(v)]) },
  ];

  constructor(body, app, options, head) {
    this.body = body; this.app = app; this.o = options;
    this.canvas = document.createElement("canvas");
    body.append(this.canvas);
    this.picker = new ChannelPicker(app, head, options, "channels", "Electrodes");
    this.grid = null;
  }

  draw() {
    const { stream } = this.app;
    const L = stream.layout;
    const { ctx, w, h } = fit(this.canvas);
    const R = Math.min(w, h) * 0.4, cx = w / 2, cy = h / 2 + R * 0.04;
    const elec = [];
    let strongest = -1, maxStd = 0;
    L.eeg.forEach((_, ch) => {
      const p = POSITIONS[L.names[ch]];
      if (!p || !this.picker.on(ch)) return;
      const x = stream.exg(ch, 1);
      const s = x.length ? std(x) : 0;
      elec.push({ ch, p, s, x });
      if (s > maxStd) { maxStd = s; strongest = elec.length - 1; }
    });
    // Polarity: sign of the correlation with the strongest channel.
    const ref = elec[strongest]?.x;
    for (const e of elec) {
      let dot = 0;
      if (ref && e.x.length === ref.length) for (let i = 0; i < ref.length; i++) dot += e.x[i] * ref[i];
      e.v = this.o.polarity === "both" && dot < 0 ? -e.s : e.s;
    }
    // Intensity: 1× maps 200 µV to full colour, on a log scale from max/40.
    const maxI = 200 / this.o.intensity, minI = maxI / 40;
    const level = (v) => Math.sign(v) * Math.min(1, Math.max(0, Math.log(Math.max(Math.abs(v), minI) / minI) / Math.log(maxI / minI)));

    // Interpolate on a coarse grid by inverse-distance weighting, smooth over time, draw scaled up.
    const G = 48;
    const grid = new Float32Array(G * G);
    for (let gy = 0; gy < G; gy++) for (let gx = 0; gx < G; gx++) {
      const x = (gx / (G - 1)) * 2 - 1, y = 1 - (gy / (G - 1)) * 2;
      if (x * x + y * y > 1.02) { grid[gy * G + gx] = NaN; continue; }
      let num = 0, den = 0;
      for (const e of elec) {
        const d2 = (x - e.p[0] * INSET) ** 2 + (y - e.p[1] * INSET) ** 2 + 1e-4;
        const wgt = 1 / (d2 * Math.sqrt(d2));
        num += wgt * e.v; den += wgt;
      }
      grid[gy * G + gx] = den ? num / den : 0;
    }
    if (this.grid && this.o.smoothing) for (let i = 0; i < grid.length; i++) grid[i] = this.o.smoothing * this.grid[i] + (1 - this.o.smoothing) * grid[i];
    this.grid = grid;
    const img = ctx.createImageData(G, G);
    const levels = 12;
    for (let i = 0; i < G * G; i++) {
      const v = grid[i];
      if (Number.isNaN(v)) { img.data[i * 4 + 3] = 0; continue; }
      let l = level(v);
      if (this.o.contours) l = Math.round(l * levels) / levels;
      const c = this.o.polarity === "both" ? diverging(l) : heat(Math.abs(l));
      img.data.set([...c, 255], i * 4);
    }
    const off = new OffscreenCanvas(G, G);
    off.getContext("2d").putImageData(img, 0, 0);
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.clip();
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(off, cx - R, cy - R, 2 * R, 2 * R);
    ctx.restore();
    // Head outline, nose and ears.
    ctx.strokeStyle = THEME.strong; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - R * 0.1, cy - R * 0.99); ctx.lineTo(cx, cy - R * 1.12); ctx.lineTo(cx + R * 0.1, cy - R * 0.99); ctx.stroke();
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(cx + s * R * 1.03, cy, R * 0.06, R * 0.17, 0, 0, 2 * Math.PI); ctx.stroke(); }
    for (const e of elec) {
      const x = cx + e.p[0] * R * INSET, y = cy - e.p[1] * R * INSET;
      ctx.fillStyle = "#fff"; ctx.strokeStyle = THEME.strong; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x, y, 9, 0, 2 * Math.PI); ctx.fill(); ctx.stroke();
      text(ctx, L.names[e.ch], x, y + 3.5, { align: "center", font: '9px -apple-system, sans-serif', color: THEME.strong, weight: "600" });
    }
    text(ctx, `Colour: ${this.o.polarity === "both" ? "±" : ""}${(maxI).toFixed(0)} µV at full scale (std of the last 1 s)`, 8, h - 8, { font: THEME.mono });
  }
}
