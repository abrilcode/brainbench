// EMG: muscle activation per channel, with the bounds that adapt to it.

import { channelColor, fit, text, THEME } from "../charts.js";
import { EMG_CHOICES, EMG_DEFAULTS, EmgProcessor, joystick } from "../emg.js";
import { dialog, h } from "../ui.js";
import { ChannelPicker } from "./channels.js";

/** One processor per board, kept on the app so all widgets see the same values. */
export function emgFor(app) {
  if (!app.emg || app.emg.stream.layout !== app.stream.layout || app.emg.channels.length !== app.stream.layout.eeg.length) {
    app.emg = new EmgProcessor(app.stream, JSON.parse(localStorage.getItem(`brainbench.emg.${app.stream.layout.eeg.length}`) || "[]"));
  }
  return app.emg.update();
}

export class Emg {
  static id = "emg";
  static title = "EMG";

  constructor(body, app, options, head) {
    this.app = app; this.o = options;
    this.canvas = document.createElement("canvas");
    body.append(this.canvas);
    this.picker = new ChannelPicker(app, head, options);
    head.querySelector(".opts").append(h("button.small", { type: "button", onclick: () => this.settings() }, "EMG settings"));
  }

  async settings() {
    const chans = emgFor(this.app);
    const L = this.app.stream.layout;
    await dialog({
      title: "EMG settings",
      intro: "Per channel: the averaging window, the clip limit, how fast the upper and lower bounds creep, the smallest range between them and the floor of the lower bound.",
      build: (body) => {
        const cols = [["window", "Window (s)"], ["limit", "µV limit"], ["creepUp", "Creep +"], ["creepDown", "Creep −"], ["minDelta", "Min Δ µV"], ["lowLimit", "Low limit µV"]];
        body.append(h("table.hw-table", {},
          h("thead", {}, h("tr", {}, h("th", {}, "Channel"), cols.map(([, l]) => h("th", {}, l)))),
          h("tbody", {}, chans.map((c, ch) => h("tr", {}, h("td", {}, `${ch + 1} ${L.names[ch]}`), cols.map(([k]) => h("td", {},
            h("select", { onchange: (e) => { c.s[k] = Number(e.target.value); } }, EMG_CHOICES[k].map((v) => h("option", { value: v, selected: v === c.s[k] || undefined }, v))))))))));
      },
      actions: [
        { label: "Reset", run: (close) => { chans.forEach((c) => { c.s = { ...EMG_DEFAULTS }; }); this.store(); close(); } },
        { label: "Done", primary: true, run: (close) => { this.store(); close(); } },
      ],
    });
  }

  store() { localStorage.setItem(`brainbench.emg.${this.app.stream.layout.eeg.length}`, JSON.stringify(this.app.emg.settings())); }

  draw() {
    const chans = emgFor(this.app);
    const L = this.app.stream.layout;
    const { ctx, w, h: hh } = fit(this.canvas);
    const shown = chans.map((c, ch) => ({ c, ch })).filter(({ ch }) => this.picker.on(ch));
    if (!shown.length) return;
    const cols = Math.min(shown.length, Math.max(2, Math.round(Math.sqrt(shown.length * w / hh))));
    const rows = Math.ceil(shown.length / cols);
    const cw = w / cols, ch_ = hh / rows;
    shown.forEach(({ c, ch }, i) => {
      const x0 = (i % cols) * cw, y0 = Math.floor(i / cols) * ch_;
      const cx = x0 + cw * 0.4, cy = y0 + ch_ * 0.5;
      const R = Math.min(cw * 0.32, ch_ * 0.36);
      const scale = R / c.s.limit;
      // Circle of the current mean, rings at the bounds.
      ctx.fillStyle = channelColor(ch) + "33";
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(2, c.avg * scale), 0, 2 * Math.PI); ctx.fill();
      ctx.strokeStyle = THEME.axis; ctx.lineWidth = 1;
      for (const b of [c.upper, c.lower]) { ctx.beginPath(); ctx.arc(cx, cy, Math.max(1, b * scale), 0, 2 * Math.PI); ctx.stroke(); }
      ctx.strokeStyle = channelColor(ch); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(cx, cy, Math.max(2, c.avg * scale), 0, 2 * Math.PI); ctx.stroke();
      // Activation bar.
      const bx = x0 + cw * 0.78, bw = Math.max(8, cw * 0.08), bh = R * 2;
      ctx.fillStyle = "#EEF3F9"; ctx.fillRect(bx, cy - R, bw, bh);
      ctx.fillStyle = channelColor(ch); ctx.fillRect(bx, cy + R - bh * c.out, bw, bh * c.out);
      text(ctx, `${ch + 1} ${L.names[ch]}`, x0 + 8, y0 + 14, { color: THEME.strong, weight: "600" });
      text(ctx, `${c.avg.toFixed(1)} µV`, x0 + 8, y0 + ch_ - 8, { font: THEME.mono });
      text(ctx, `${(c.out * 100).toFixed(0)}%`, bx + bw / 2, cy - R - 4, { font: THEME.mono, align: "center" });
    });
  }
}

export class EmgJoystick {
  static id = "emgjoystick";
  static title = "EMG joystick";
  static options = (app) => {
    const n = app.stream.layout?.eeg.length || 8;
    const chans = Array.from({ length: n }, (_, i) => [i, `Ch ${i + 1}`]);
    return [
      { key: "smoothing", label: "Smooth", default: 0.9, values: [[0, "Off"], ...[0.9, 0.95, 0.98, 0.99, 0.999, 0.9999].map((v) => [v, String(v)])] },
      { key: "xMinus", label: "X−", default: 0, values: chans },
      { key: "xPlus", label: "X+", default: Math.min(1, n - 1), values: chans },
      { key: "yPlus", label: "Y+", default: Math.min(2, n - 1), values: chans },
      { key: "yMinus", label: "Y−", default: Math.min(3, n - 1), values: chans },
    ];
  };

  constructor(body, app, options) {
    this.app = app; this.o = options;
    this.canvas = document.createElement("canvas");
    body.append(this.canvas);
    this.pos = [0, 0];
  }

  value() {
    const out = emgFor(this.app).map((c) => c.out);
    const [x, y] = joystick(out, this.o);
    const k = 1 - this.o.smoothing;
    this.pos = [this.pos[0] + (x - this.pos[0]) * k, this.pos[1] + (y - this.pos[1]) * k];
    return this.pos;
  }

  draw() {
    const [x, y] = this.value();
    const { ctx, w, h: hh } = fit(this.canvas);
    const R = Math.min(w, hh) * 0.38, cx = w / 2, cy = hh / 2;
    ctx.strokeStyle = THEME.axis; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 2 * Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    ctx.fillStyle = THEME.navy;
    ctx.beginPath(); ctx.arc(cx + x * R, cy - y * R, 9, 0, 2 * Math.PI); ctx.fill();
    text(ctx, `X+ ch ${this.o.xPlus + 1}`, cx + R + 6, cy + 4, { font: THEME.mono });
    text(ctx, `X− ch ${this.o.xMinus + 1}`, cx - R - 6, cy + 4, { font: THEME.mono, align: "right" });
    text(ctx, `Y+ ch ${this.o.yPlus + 1}`, cx, cy - R - 8, { font: THEME.mono, align: "center" });
    text(ctx, `Y− ch ${this.o.yMinus + 1}`, cx, cy + R + 16, { font: THEME.mono, align: "center" });
    text(ctx, `x ${x.toFixed(2)}   y ${y.toFixed(2)}`, 10, hh - 10, { font: THEME.mono, color: THEME.strong });
  }
}
