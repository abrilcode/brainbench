// Markers, pulse sensor and packet loss.

import { axes, fit, line, polyline, text, THEME } from "../charts.js";
import { PulseDetector } from "../pulse.js";
import { h } from "../ui.js";

export const MARKER_KEYS = { z: 1, x: 2, c: 3, v: 4, Z: 5, X: 6, C: 7, V: 8 };

export class Marker {
  static id = "marker";
  static title = "Marker";
  static options = () => [
    { key: "scale", label: "Scale", default: 8, values: [["auto", "Auto"], [2, "2"], [4, "4"], [8, "8"], [10, "10"], [20, "20"]] },
    { key: "window", label: "Window", default: 5, values: [[5, "5 s"], [10, "10 s"], [20, "20 s"]] },
  ];
  constructor(body, app, options) {
    this.app = app; this.o = options;
    this.canvas = h("canvas");
    const keys = Object.entries(MARKER_KEYS);
    body.append(h("div", { style: { position: "absolute", inset: "0", display: "grid", gridTemplateRows: "auto minmax(0, 1fr)" } },
      h("div", { style: { padding: "10px 12px 6px" } },
        h("div.marker-buttons", {}, keys.map(([k, v]) => h("button", { type: "button", onclick: () => this.insert(v) }, `Insert ${v}`, h("kbd", {}, k)))),
        h("p.hint", { style: { margin: "8px 0 0" } }, app.api.kind === "local"
          ? "Markers go into the board's marker channel and the recording. Other programs can send one as a 4-byte big-endian float to UDP 127.0.0.1:12350."
          : "Markers go into the marker channel and the recording.")),
      h("div", { style: { position: "relative" } }, this.canvas)));
  }
  insert(v) {
    if (!this.app.session?.streaming) return this.app.addLog("Start the stream to insert markers.");
    this.app.api.marker(v).catch((e) => this.app.addLog(e.message));
  }
  draw() {
    const { stream } = this.app;
    const { ctx, w, h: hh } = fit(this.canvas);
    const x = stream.row(stream.layout.marker, this.o.window);
    const top = this.o.scale === "auto" ? Math.max(2, ...x) * 1.2 : this.o.scale;
    const { X, Y, box } = axes(ctx, w, hh, { x: [-this.o.window, 0], y: [0, top], xlabel: "Time (s)", ylabel: "Marker" });
    const N = this.o.window * stream.fs, off = N - x.length;
    for (let i = 0; i < x.length; i++) if (x[i]) {
      const px = X(-this.o.window + ((i + off) / N) * this.o.window);
      line(ctx, px, Y(0), px, Y(Math.min(x[i], top)), THEME.sky, 2);
      text(ctx, String(x[i]), px + 3, Y(Math.min(x[i], top)) - 3, { font: THEME.mono, color: THEME.sky });
    }
    void box;
  }
}

export class Pulse {
  static id = "pulse";
  static title = "Pulse sensor";
  static unavailable = (app) => (app.session?.family === "cyton" && app.stream.layout.analog?.length ? null : "The pulse sensor reads analog pin A5 (D11) on a Cyton.");
  constructor(body, app, options, head) {
    this.app = app;
    this.det = new PulseDetector(app.stream.fs);
    this.seen = app.stream.samples;
    this.canvas = h("canvas");
    this.bpm = h("div.big-number", {}, "–");
    this.ibi = h("div", { style: { fontFamily: "var(--mono)", color: "var(--muted)", marginTop: "6px" } }, "IBI – ms");
    body.append(h("div", { style: { position: "absolute", inset: "0", display: "grid", gridTemplateColumns: "150px minmax(0, 1fr)" } },
      h("div", { style: { padding: "16px", borderRight: "1px solid var(--line2)" } }, h("div.big-label", {}, "Heart rate"), this.bpm, h("div.big-label", { style: { marginTop: "2px" } }, "BPM"), this.ibi),
      h("div", { style: { position: "relative" } }, this.canvas)));
    const btn = h("button.small", { type: "button" });
    const sync = () => { const on = app.session?.board_mode === "analog"; btn.textContent = on ? "Turn analog read off" : "Turn analog read on"; btn.classList.toggle("on", on); };
    btn.onclick = async () => {
      try { const d = await app.api.boardMode(app.session.board_mode === "analog" ? "default" : "analog"); app.session.board_mode = d.board_mode; } catch (e) { app.addLog(e.message); }
      sync();
    };
    (head.querySelector(".opts") || head.appendChild(h("div.opts"))).prepend(btn);
    sync();
    this.sync = sync;
  }
  draw() {
    const { stream, session } = this.app;
    if (this.mode !== session.board_mode) { this.mode = session.board_mode; this.sync(); }
    const row = stream.layout.analog[0];
    const fresh = stream.samples - this.seen;
    if (fresh > 0) {
      const x = stream.row(row, Math.min(fresh, stream.fs * 5) / stream.fs);
      for (const v of x) this.det.push(v);
      this.seen = stream.samples;
    }
    this.bpm.textContent = this.det.bpm ? String(this.det.bpm) : "–";
    this.ibi.textContent = `IBI ${this.det.bpm ? Math.round(this.det.ibi) : "–"} ms`;
    const { ctx, w, h: hh } = fit(this.canvas);
    if (session.board_mode !== "analog") { text(ctx, "Turn analog read on and connect the pulse sensor to D11 (A5).", w / 2, hh / 2, { align: "center" }); return; }
    const win = 5, x = stream.row(row, win);
    let lo = Infinity, hi = -Infinity;
    for (const v of x) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    const { X, Y, box } = axes(ctx, w, hh, { x: [-win, 0], y: [Math.floor(lo - 20), Math.ceil(hi + 20)], xlabel: "Time (s)", ylabel: "Pulse (0–1023)" });
    const N = win * stream.fs, off = N - x.length;
    polyline(ctx, Array.from(x, (v, i) => [X(-win + ((i + off) / N) * win), Y(v)]), THEME.red, 1.6, box);
    line(ctx, box.x, Y(this.det.thresh), box.x + box.w, Y(this.det.thresh), THEME.axis, 1, [3, 3]);
  }
}

export class PacketLoss {
  static id = "packetloss";
  static title = "Packet loss";
  constructor(body, app) {
    this.app = app;
    this.wrap = h("div.scroll");
    body.append(this.wrap);
    this.samples = []; // {t, received, lost} snapshots
    this.timer = setInterval(() => this.snap(), 1000);
    this.streamStart = null;
  }
  destroy() { clearInterval(this.timer); }
  snap() {
    const p = this.app.session?.packets;
    if (!p || !this.app.session.streaming) { this.streamStart = null; return; }
    if (!this.streamStart) this.streamStart = { t: Date.now(), received: p.received, lost: p.lost };
    this.samples.push({ t: Date.now(), received: p.received, lost: p.lost });
    this.samples = this.samples.filter((s) => s.t > Date.now() - 61000);
    this.render();
  }
  since(ms) {
    const now = this.samples.at(-1);
    if (!now) return null;
    const then = this.samples.find((s) => s.t >= now.t - ms) || this.samples[0];
    return { received: now.received - then.received, lost: now.lost - then.lost };
  }
  render() {
    const p = this.app.session.packets;
    const cols = [
      ["Entire session", { received: p.received, lost: p.lost }],
      ["Current stream", this.streamStart ? { received: p.received - this.streamStart.received, lost: p.lost - this.streamStart.lost } : null],
      ["Last 1 s", this.since(1000)], ["Last 10 s", this.since(10000)], ["Last 1 min", this.since(60000)],
    ];
    const cell = (c, f) => h("td.num", {}, c ? f(c) : "–");
    const pct = (c) => { const e = c.received + c.lost; return e ? `${((100 * c.lost) / e).toFixed(2)} %` : "0.00 %"; };
    const dur = this.app.session.started_at ? Math.round(Date.now() / 1000 - this.app.session.started_at) : 0;
    this.wrap.replaceChildren(
      h("table.data", {},
        h("thead", {}, h("tr", {}, h("th", {}, ""), cols.map(([n]) => h("th", { style: { textAlign: "right" } }, n)))),
        h("tbody", {},
          h("tr", {}, h("td", {}, "Packets lost"), cols.map(([, c]) => cell(c, (x) => x.lost))),
          h("tr", {}, h("td", {}, "Packets received"), cols.map(([, c]) => cell(c, (x) => x.received))),
          h("tr", {}, h("td", {}, "Packets expected"), cols.map(([, c]) => cell(c, (x) => x.received + x.lost))),
          h("tr", {}, h("td", {}, h("b", {}, "% lost")), cols.map(([, c]) => cell(c, pct))))),
      h("p.hint", {}, `Stream running for ${dur} s. Losses come from gaps in the board's sample counter (0–255 on the Cyton, every second number with the Daisy).`),
    );
  }
  draw() {}
}
