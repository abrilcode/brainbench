// Time series: every EXG channel stacked, filtered, with a time axis,
// per-channel on/off, amplitude and how close each channel is to railing.

import { channelColor, fit, line, text, THEME, ticks } from "../charts.js";
import { peakAbs, std } from "../dsp.js";
import { railedState } from "../signal-check.js";
import { h } from "../ui.js";
import { PlaybackBar } from "./playback.js";

export class TimeSeries {
  static id = "timeseries";
  static title = "Time series";
  static options = () => [
    { key: "scale", label: "Scale", default: 200, values: [["auto", "Auto"], [50, "50 µV"], [100, "100 µV"], [200, "200 µV"], [400, "400 µV"], [1000, "1000 µV"], [10000, "10000 µV"]] },
    { key: "window", label: "Window", default: 5, values: [[1, "1 s"], [3, "3 s"], [5, "5 s"], [10, "10 s"], [20, "20 s"]] },
    { key: "raw", label: "Signal", default: false, values: [[false, "Filtered"], [true, "Raw"]] },
  ];

  constructor(body, app, options) {
    this.body = body; this.app = app; this.o = options;
    this.autoScale = 100;
  }

  mount() {
    const L = this.app.stream.layout;
    this.side = h("div.ts-side");
    this.canvas = h("canvas");
    this.rows = L.eeg.map((_, ch) => {
      const num = h("button.num", { type: "button", title: "Switch the channel on or off", style: { background: channelColor(ch) }, onclick: () => this.toggle(ch) }, ch + 1);
      const amp = h("span", {}, "–");
      const rail = h("span", {}, "");
      const row = h("div.ts-ch", {}, num, h("div.meta", {}, h("b", {}, L.names[ch]), amp, rail));
      this.side.append(row);
      return { num, amp, rail };
    });
    this.body.append(h("div.ts", {}, this.side, h("div.ts-plot", {}, this.canvas)));
    if (this.app.session?.source === "playback" && this.app.session.playback?.total_samples) {
      this.bar = new PlaybackBar(this.app);
      this.body.append(this.bar.el);
      this.body.classList.add("with-bar");
    }
    this.syncToggles();
  }

  syncToggles() {
    const chs = this.app.session?.channels || [];
    this.rows.forEach((r, ch) => r.num.classList.toggle("off", chs[ch] && !chs[ch].active));
  }

  async toggle(ch) {
    const s = this.app.session;
    const active = !(s.channels[ch]?.active ?? true);
    try {
      const d = await this.app.api.setChannel(ch, { active });
      this.app.session.channels = d.channels;
    } catch (e) { this.app.addLog(e.message); }
    this.syncToggles();
  }

  draw() {
    this.bar?.update();
    const { stream, session } = this.app;
    const L = stream.layout;
    const { ctx, w, h: H } = fit(this.canvas);
    const n = L.eeg.length;
    const win = this.o.window;
    const fs = stream.fs;
    const N = Math.round(win * fs);
    const padB = 22, laneH = (H - padB) / n;
    this.side.classList.toggle("compact", laneH < 34);
    this.side.classList.toggle("tiny", laneH < 18);
    // Time grid: one line a second, labels underneath.
    for (const t of ticks(0, win, Math.min(10, win))) {
      const x = (t / win) * w;
      line(ctx, x, 0, x, H - padB, THEME.grid);
      text(ctx, `${t - win} s`, Math.min(w - 16, Math.max(14, x)), H - 7, { align: "center", font: THEME.mono });
    }
    let maxAmp = 0;
    const scale = this.o.scale === "auto" ? this.autoScale : this.o.scale;
    for (let ch = 0; ch < n; ch++) {
      const x = stream.exg(ch, win, this.o.raw);
      const y0 = laneH * (ch + 0.5);
      line(ctx, 0, laneH * (ch + 1), w, laneH * (ch + 1), THEME.grid);
      const active = session?.channels?.[ch]?.active ?? true;
      if (!x.length || !active) {
        this.rows[ch].amp.textContent = active ? "–" : "off";
        this.rows[ch].rail.textContent = "";
        continue;
      }
      const sd = std(x, Math.max(0, x.length - fs), x.length);
      maxAmp = Math.max(maxAmp, peakAbs(x, Math.max(0, x.length - fs * 2), x.length) - Math.abs(mean(x)));
      this.rows[ch].amp.textContent = `${sd.toFixed(1)} µVrms`;
      const raw = stream.exg(ch, 2, true);
      const rs = railedState(raw, session?.channels?.[ch]?.gain ?? 24, session?.family);
      this.rows[ch].rail.textContent = rs.label;
      this.rows[ch].rail.className = rs.level;
      // Centre the trace on its lane: subtract the mean of what is shown.
      const m = this.o.raw ? mean(x) : 0;
      const k = (laneH / 2) / scale;
      const offset = N - x.length;
      ctx.save();
      ctx.beginPath(); ctx.rect(0, laneH * ch, w, laneH); ctx.clip();
      ctx.strokeStyle = channelColor(ch); ctx.lineWidth = 1.1; ctx.lineJoin = "round";
      ctx.beginPath();
      const step = Math.max(1, Math.floor(x.length / (w * 2)));
      for (let i = 0; i < x.length; i += step) {
        const px = ((i + offset) / (N - 1)) * w;
        const py = y0 - (x[i] - m) * k;
        if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
      }
      ctx.stroke();
      ctx.restore();
    }
    // Markers from the board's marker channel.
    for (const mk of stream.markers) {
      const x = ((mk.t - (stream.samples - N)) / N) * w;
      if (x < 0 || x > w) continue;
      line(ctx, x, 0, x, H - padB, THEME.sky, 1.2, [3, 3]);
      text(ctx, String(mk.value), x + 3, 11, { color: THEME.sky, font: THEME.mono });
    }
    text(ctx, `±${scale >= 1000 ? `${scale / 1000} mV` : `${Math.round(scale)} µV`} per lane`, w - 6, 12, { align: "right", font: THEME.mono, color: THEME.text });
    if (maxAmp > 0) {
      const target = [50, 100, 200, 400, 1000, 10000].find((s) => s >= maxAmp * 1.1) || 10000;
      this.autoScale += (target - this.autoScale) * 0.15;
    }
    if (Date.now() % 1000 < 40) this.syncToggles();
  }
}

function mean(x) {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return x.length ? s / x.length : 0;
}
