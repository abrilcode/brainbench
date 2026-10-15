// Auxiliary data: accelerometer (all boards), analog and digital read (Cyton).

import { axes, channelColor, fit, line, polyline, text, THEME } from "../charts.js";
import { h } from "../ui.js";

const WINDOW = [["sync", "Sync"], [1, "1 s"], [3, "3 s"], [5, "5 s"], [10, "10 s"], [20, "20 s"]];

/** "Sync" follows the first time series panel's window. */
function windowSeconds(app, v) {
  if (v !== "sync") return v;
  const ts = app.workspace.panels.find((p) => p.widgetId === "timeseries");
  return ts?.options.window || 5;
}

function lanes(ctx, w, hh, series, { scale, unit, win, fs, names, colors, decimals = 0 }) {
  const n = series.length, laneH = (hh - 22) / n, N = Math.round(win * fs);
  series.forEach((x, i) => {
    const y0 = laneH * i, mid = y0 + laneH / 2;
    line(ctx, 0, y0 + laneH, w, y0 + laneH, THEME.grid);
    let lo = Infinity, hi = -Infinity;
    for (const v of x) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const half = scale === "auto" ? Math.max((hi - lo) / 2 * 1.2, unit === "g" ? 0.05 : 1) : scale;
    const centre = scale === "auto" ? (hi + lo) / 2 : unit === "g" ? 0 : (hi + lo) / 2;
    const pts = [];
    const step = Math.max(1, Math.floor(x.length / (w * 2)));
    for (let k = 0; k < x.length; k += step) pts.push([((k + N - x.length) / (N - 1)) * (w - 70) + 70, mid - ((x[k] - centre) / half) * (laneH / 2) * 0.92]);
    polyline(ctx, pts, colors[i], 1.3, { x: 70, y: y0, w: w - 70, h: laneH });
    text(ctx, names[i], 8, mid - 3, { color: THEME.strong, weight: "600" });
    text(ctx, x.length ? `${x.at(-1).toFixed(decimals)} ${unit}` : "–", 8, mid + 11, { font: THEME.mono });
  });
  for (let s = 0; s <= win; s += win <= 5 ? 1 : 5) {
    const x = 70 + (s / win) * (w - 70);
    text(ctx, `${s - win} s`, Math.min(w - 14, x), hh - 6, { align: "center", font: THEME.mono });
  }
}

export class Accelerometer {
  static id = "accelerometer";
  static title = "Accelerometer";
  static unavailable = (app) => (app.stream.layout?.accel?.length ? null : "This data source has no accelerometer.");
  static options = () => [
    { key: "scale", label: "Scale", default: "auto", values: [["auto", "Auto"], [1, "±1 g"], [2, "±2 g"], [4, "±4 g"]] },
    { key: "window", label: "Window", default: 5, values: WINDOW },
  ];

  constructor(body, app, options, head) {
    this.body = body; this.app = app; this.o = options;
    this.canvas = document.createElement("canvas");
    body.append(this.canvas);
    if (app.session?.family === "ganglion") {
      this.on = true;
      const btn = h("button.small.on", { type: "button", onclick: async () => {
        this.on = !this.on;
        await app.api.command(this.on ? "n" : "N").catch((e) => app.addLog(e.message));
        btn.classList.toggle("on", this.on);
        btn.textContent = this.on ? "Accelerometer on" : "Accelerometer off";
      } }, "Accelerometer on");
      (head.querySelector(".opts") || head).prepend(btn);
    }
  }

  draw() {
    const { stream, session } = this.app;
    const { ctx, w, h: hh } = fit(this.canvas);
    if (session?.family === "cyton" && session.board_mode !== "default") {
      text(ctx, `The board is in ${session.board_mode} mode; the accelerometer is off. Switch back from the Analog or Digital read widget.`, w / 2, hh / 2, { align: "center" });
      return;
    }
    const win = windowSeconds(this.app, this.o.window);
    const series = stream.layout.accel.map((r) => stream.row(r, win));
    const gauge = Math.min(150, w * 0.28);
    lanes(ctx, w - gauge - 10, hh, series, { scale: this.o.scale, unit: "g", win, fs: stream.fs, names: ["X", "Y", "Z"], colors: [THEME.navy, THEME.sky, THEME.ok], decimals: 3 });
    // Orientation: the X/Y components as a point in a circle, Z as a bar.
    const cx = w - gauge / 2 - 6, cy = hh / 2 - 6, r = gauge * 0.36;
    ctx.strokeStyle = THEME.axis; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, 2 * Math.PI); ctx.stroke();
    line(ctx, cx - r, cy, cx + r, cy, THEME.grid); line(ctx, cx, cy - r, cx, cy + r, THEME.grid);
    const last = series.map((s) => (s.length ? s.at(-1) : 0));
    const px = cx + Math.max(-1, Math.min(1, last[0])) * r, py = cy - Math.max(-1, Math.min(1, last[1])) * r;
    ctx.fillStyle = THEME.navy; ctx.beginPath(); ctx.arc(px, py, 5, 0, 2 * Math.PI); ctx.fill();
    text(ctx, "X / Y tilt", cx, cy + r + 16, { align: "center", font: THEME.mono });
    text(ctx, `|a| = ${Math.hypot(...last).toFixed(3)} g`, cx, cy + r + 30, { align: "center", font: THEME.mono, color: THEME.strong });
  }
}

/** Shared by the analog and digital widgets: a button that switches the Cyton's board mode. */
function modeButton(app, head, mode, label) {
  const btn = h("button.small", { type: "button" });
  const sync = () => {
    const on = app.session?.board_mode === mode;
    btn.classList.toggle("on", on);
    btn.textContent = on ? `Turn ${label} off` : `Turn ${label} on`;
  };
  btn.onclick = async () => {
    const on = app.session?.board_mode === mode;
    try {
      const d = await app.api.boardMode(on ? "default" : mode);
      app.session.board_mode = d.board_mode;
    } catch (e) { app.addLog(e.message); }
    sync();
  };
  (head.querySelector(".opts") || head.appendChild(h("div.opts"))).prepend(btn);
  sync();
  return sync;
}

export class AnalogRead {
  static id = "analog";
  static title = "Analog read";
  static unavailable = (app) => (app.session?.family === "cyton" && app.stream.layout.analog?.length ? null : "Analog read needs a Cyton.");
  static options = () => [
    { key: "scale", label: "Scale", default: "auto", values: [["auto", "Auto"], [50, "50"], [100, "100"], [200, "200"], [400, "400"], [1000, "1000"], [10000, "10000"]] },
    { key: "window", label: "Window", default: "sync", values: WINDOW },
  ];
  constructor(body, app, options, head) {
    this.app = app; this.o = options;
    this.canvas = document.createElement("canvas");
    body.append(this.canvas);
    this.sync = modeButton(app, head, "analog", "analog read");
  }
  draw() {
    const { stream, session } = this.app;
    if (this.mode !== session.board_mode) { this.mode = session.board_mode; this.sync(); }
    const { ctx, w, h: hh } = fit(this.canvas);
    if (session.board_mode !== "analog") { text(ctx, "Turn analog read on to stream pins A5 (D11), A6 (D12) and A7 (D13).", w / 2, hh / 2, { align: "center" }); return; }
    const win = windowSeconds(this.app, this.o.window);
    const pins = session.source?.includes("wifi") ? 2 : 3;
    const series = stream.layout.analog.slice(0, pins).map((r) => stream.row(r, win));
    lanes(ctx, w, hh, series, { scale: this.o.scale, unit: "", win, fs: stream.fs, names: ["A5 (D11)", "A6 (D12)", "A7 (D13)"], colors: [0, 1, 2].map(channelColor) });
  }
}

export const DIGITAL_PINS = ["D11", "D12", "D13", "D17", "D18"];
/** BrainFlow's "other" rows that hold the digital pins: 1, 2, 3, 4 and 6 (0 is the end byte, 5 is unused). */
export const digitalRows = (layout) => [1, 2, 3, 4, 6].map((i) => layout.other[i]);

export class DigitalRead {
  static id = "digital";
  static title = "Digital read";
  static unavailable = (app) => (app.session?.family === "cyton" && app.stream.layout.other?.length >= 7 ? null : "Digital read needs a Cyton.");
  constructor(body, app, options, head) {
    this.app = app;
    this.canvas = document.createElement("canvas");
    body.append(this.canvas);
    this.sync = modeButton(app, head, "digital", "digital read");
  }
  draw() {
    const { stream, session } = this.app;
    if (this.mode !== session.board_mode) { this.mode = session.board_mode; this.sync(); }
    const { ctx, w, h: hh } = fit(this.canvas);
    if (session.board_mode !== "digital") { text(ctx, "Turn digital read on to stream pins D11, D12, D13, D17 and D18.", w / 2, hh / 2, { align: "center" }); return; }
    const wifi = session.source?.includes("wifi");
    const pins = DIGITAL_PINS.map((name, i) => ({ name, row: digitalRows(stream.layout)[i] })).filter((p) => !wifi || ["D11", "D12", "D17"].includes(p.name));
    const laneH = (hh - 20) / pins.length, win = 5, N = win * stream.fs;
    pins.forEach((p, i) => {
      const x = stream.row(p.row, win);
      const y0 = i * laneH, v = x.length ? x.at(-1) : 0;
      ctx.fillStyle = v ? THEME.navy : "#E3EAF2";
      ctx.beginPath(); ctx.arc(26, y0 + laneH / 2, Math.min(12, laneH / 3), 0, 2 * Math.PI); ctx.fill();
      text(ctx, p.name, 48, y0 + laneH / 2 - 2, { color: THEME.strong, weight: "600" });
      text(ctx, v ? "HIGH" : "LOW", 48, y0 + laneH / 2 + 12, { font: THEME.mono });
      const pts = [];
      for (let k = 0; k < x.length; k++) pts.push([110 + ((k + N - x.length) / N) * (w - 120), y0 + laneH * 0.78 - (x[k] ? laneH * 0.5 : 0)]);
      polyline(ctx, pts, channelColor(i), 1.5);
      line(ctx, 110, y0 + laneH, w, y0 + laneH, THEME.grid);
    });
  }
}
