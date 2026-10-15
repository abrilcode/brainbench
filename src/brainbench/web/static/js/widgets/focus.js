// Focus: BrainFlow's concentration (MINDFULNESS) or relaxation (RESTFULNESS)
// score from the average band powers, with a threshold, a history and
// optional audio feedback. In the local app the score comes from BrainFlow
// itself; the online demo uses the same logistic-regression weights.

import { axes, fit, line, polyline, text, THEME } from "../charts.js";
import { amplitudeSpectrum, design, SosFilter } from "../dsp.js";
import { h } from "../ui.js";
import { ChannelPicker } from "./channels.js";

/** BrainFlow 5 MINDFULNESS default classifier: sigmoid(w · bands), restfulness = 1 − that. */
const W = [-1.40609, 2.597694, -30.964705, 12.04594, 45.773018];
export const FOCUS_BANDS = [["Delta", 1.5, 4], ["Theta", 4, 8], ["Alpha", 7.5, 13], ["Beta", 13, 30], ["Gamma", 30, 45]];

/** Relative band powers averaged over channels, then the classifier (demo only). */
export function focusLocally(stream, channels, seconds, metric) {
  const fs = stream.fs;
  const rel = [];
  for (const ch of channels) {
    let x = Float64Array.from(stream.exg(ch, seconds, true));
    if (x.length < fs * 2) return null;
    for (const f of [new SosFilter(design({ type: "bandpass", order: 4, freqs: [1, Math.min(45, fs / 2 - 1)], fs })), new SosFilter(design({ type: "bandstop", order: 4, freqs: [48, 52], fs }))]) x = f.process(x);
    const nfft = 2 ** Math.floor(Math.log2(x.length));
    const { freqs, amp } = amplitudeSpectrum(x, fs, nfft, "hann");
    const p = FOCUS_BANDS.map(([, lo, hi]) => { let s = 0; for (let k = 0; k < freqs.length; k++) if (freqs[k] >= lo && freqs[k] < hi) s += amp[k] ** 2; return s; });
    const tot = p.reduce((a, b) => a + b, 0) || 1;
    rel.push(p.map((v) => v / tot));
  }
  if (!rel.length) return null;
  const bands = FOCUS_BANDS.map((_, i) => rel.reduce((s, r) => s + r[i], 0) / rel.length);
  const z = bands.reduce((s, b, i) => s + W[i] * b, 0);
  const mind = 1 / (1 + Math.exp(-z));
  return { value: metric === "concentration" ? mind : 1 - mind, bands };
}

export class Focus {
  static id = "focus";
  static title = "Focus";
  static options = () => [
    { key: "metric", label: "Metric", default: "relaxation", values: [["relaxation", "Relaxation"], ["concentration", "Concentration"]] },
    { key: "threshold", label: "Threshold", default: 0.8, values: [0.5, 0.6, 0.7, 0.8, 0.9].map((v) => [v, String(v)]) },
    { key: "window", label: "Window", default: 10, values: [[5, "5 s"], [10, "10 s"], [20, "20 s"]] },
  ];

  constructor(body, app, options, head) {
    this.app = app; this.o = options;
    this.picker = new ChannelPicker(app, head, options);
    this.history = [];
    this.result = null;
    this.sound = new Feedback();
    const soundBtn = h("button.small", { type: "button", onclick: () => { this.sound.toggle(); soundBtn.classList.toggle("on", this.sound.on); soundBtn.textContent = this.sound.on ? "Sound on" : "Sound"; } }, "Sound");
    const modeBtn = h("button.small", { type: "button", title: "Audio follows the metric, or each band", onclick: () => { this.sound.useBands = !this.sound.useBands; modeBtn.textContent = this.sound.useBands ? "Audio: bands" : "Audio: metric"; } }, "Audio: metric");
    head.querySelector(".opts").append(soundBtn, modeBtn);
    this.state = h("div.big-number", { style: { fontSize: "26px", marginTop: "4px" } }, "–");
    this.label = h("div.big-label", {}, "");
    this.table = h("tbody");
    this.canvas = h("canvas");
    body.append(h("div", { style: { position: "absolute", inset: "0", display: "grid", gridTemplateColumns: "minmax(250px, 1fr) minmax(0, 1.4fr)" } },
      h("div", { style: { padding: "14px 16px", borderRight: "1px solid var(--line2)", overflow: "auto" } },
        this.label, this.state,
        h("table.data", { style: { marginTop: "12px" } }, h("thead", {}, h("tr", {}, h("th", {}, "Measure"), h("th", { style: { textAlign: "right" } }, "Value"))), this.table)),
      h("div", { style: { position: "relative" } }, this.canvas)));
    this.timer = setInterval(() => this.update(), 1000);
  }

  destroy() { clearInterval(this.timer); this.sound.stop(); this.picker.destroy?.(); }

  async update() {
    const { app } = this;
    if (!app.session?.streaming) return;
    const chans = app.stream.layout.eeg.map((_, i) => i).filter((i) => this.picker.on(i));
    let r = null;
    if (app.api.kind === "local" && app.focusAvailable) {
      try { r = await app.api.call("GET", `/api/focus?metric=${this.o.metric}&seconds=${this.o.window}&channels=${chans.join(",")}`); } catch { r = null; }
    } else {
      r = focusLocally(app.stream, chans, this.o.window, this.o.metric);
    }
    if (!r || r.value == null) return;
    this.result = r;
    this.history.push({ t: Date.now(), v: r.value });
    this.history = this.history.filter((p) => p.t > Date.now() - 120000);
    this.sound.update(r.value, r.bands);
    app.focusValue = { value: r.value, over: r.value >= this.o.threshold };
  }

  draw() {
    const r = this.result, word = this.o.metric === "relaxation" ? "Relaxing" : "Concentrating";
    this.label.textContent = this.o.metric === "relaxation" ? "Relaxation" : "Concentration";
    if (r) {
      const over = r.value >= this.o.threshold;
      this.state.textContent = over ? word : `Not ${word.toLowerCase()}`;
      this.state.style.color = over ? "var(--ok)" : "var(--muted)";
      this.table.replaceChildren(
        h("tr", {}, h("td", {}, "Metric value"), h("td.num", {}, r.value.toFixed(3))),
        ...FOCUS_BANDS.map(([name, lo, hi], i) => h("tr", {}, h("td", { style: { whiteSpace: "nowrap" } }, name, h("span.hint", { style: { marginLeft: "6px" } }, `${lo}–${hi} Hz`)), h("td.num", {}, r.bands?.[i] != null ? r.bands[i].toFixed(3) : "–"))));
    } else {
      this.state.textContent = "Waiting";
      this.table.replaceChildren(h("tr", {}, h("td", { colspan: 2 }, `Needs ${this.o.window} s of data`)));
    }
    const { ctx, w, h: hh } = fit(this.canvas);
    const { X, Y, box } = axes(ctx, w, hh, { x: [-120, 0], y: [0, 1], xlabel: "Time (s)", ylabel: "Score" });
    line(ctx, box.x, Y(this.o.threshold), box.x + box.w, Y(this.o.threshold), THEME.amber, 1, [4, 4]);
    text(ctx, `threshold ${this.o.threshold}`, box.x + box.w - 4, Y(this.o.threshold) - 5, { align: "right", font: THEME.mono, color: THEME.amber });
    polyline(ctx, this.history.map((p) => [X((p.t - Date.now()) / 1000), Y(p.v)]), THEME.navy, 2, box);
  }
}

/** Five soft tones; their loudness follows the metric, or each band power (as the GUI's audio feedback). */
class Feedback {
  constructor() { this.on = false; this.useBands = false; }
  toggle() {
    this.on = !this.on;
    if (this.on && !this.ctx) {
      this.ctx = new AudioContext();
      this.gains = [220, 277.2, 329.6, 392, 466.2].map((f) => {
        const o = this.ctx.createOscillator(), g = this.ctx.createGain();
        o.frequency.value = f; o.type = "sine"; g.gain.value = 0;
        o.connect(g).connect(this.ctx.destination); o.start();
        return g;
      });
    }
    if (!this.on) this.gains?.forEach((g) => g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.1));
  }
  update(value, bands) {
    if (!this.on || !this.gains) return;
    const db = (v, a, b, lo, hi) => lo + (Math.min(Math.max(v, a), b) - a) / (b - a) * (hi - lo);
    this.gains.forEach((g, i) => {
      const level = this.useBands && bands ? db(bands[i] ?? 0, 0.1, 0.7, -22, -7) : db(value, 0, 1, -42, -7);
      g.gain.setTargetAtTime(10 ** (level / 20) * 0.2, this.ctx.currentTime, 0.3);
    });
  }
  stop() { this.ctx?.close(); this.ctx = null; this.gains = null; this.on = false; }
}
