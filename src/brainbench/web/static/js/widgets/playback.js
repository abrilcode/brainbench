// Playback: the recent recordings, and the position in the file being played.

import { h, put } from "../ui.js";

const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** A seek bar for the file being played; the time series shows one under the traces. */
export class PlaybackBar {
  constructor(app) {
    this.app = app;
    this.offset = 0;
    this.slider = h("input", { type: "range", min: 0, max: 1000, value: 0, "aria-label": "Position in the recording", onchange: (e) => this.seek(e.target.value / 1000) });
    this.pos = h("span.pb-time");
    this.el = h("div.pb-bar", {}, this.slider, this.pos);
  }
  async seek(fraction) {
    try {
      await this.app.api.seek(fraction);
      this.app.stream.clear();
      this.offset = fraction;
    } catch (e) { this.app.addLog(e.message); }
  }
  update() {
    const pb = this.app.session?.playback;
    if (!pb?.total_samples) return;
    const fs = this.app.stream.fs;
    const at = (this.offset * pb.total_samples + this.app.stream.samples) % pb.total_samples;
    if (document.activeElement !== this.slider) this.slider.value = Math.round((at / pb.total_samples) * 1000);
    this.pos.textContent = `${clock(at / fs)} / ${clock(pb.total_samples / fs)}`;
  }
}

export class Playback {
  static id = "playback";
  static title = "Playback";
  constructor(body, app) {
    this.app = app;
    this.wrap = h("div.scroll");
    body.append(this.wrap);
    this.load();
  }
  async load() {
    const list = await this.app.api.recordings().catch(() => []);
    const s = this.app.session;
    const playing = s?.source === "playback";
    const total = s?.playback?.total_samples;
    this.bar = playing && total ? new PlaybackBar(this.app) : null;
    put(this.wrap,
      playing ? h("div.card", { style: { marginBottom: "12px" } },
        h("div.card-title", {}, "Now playing", h("button.small", { type: "button", onclick: () => this.bar?.seek(0) }, "Back to start")),
        h("div", { style: { fontFamily: "var(--mono)", fontSize: "12px", wordBreak: "break-all", marginBottom: "8px" } }, s.playback_file),
        this.bar?.el) : null,
      h("div.card-title", {}, "Recent recordings"),
      list.length
        ? h("div.recent", { style: { maxHeight: "none" } }, list.map((r) => h("button", { type: "button", title: r.path, onclick: () => this.open(r.path) }, h("span", {}, r.name), h("small", {}, `${r.channels ?? "?"} ch · ${r.duration ?? ""}`))))
        : h("p.hint", {}, this.app.api.kind === "demo" ? "The demo keeps no files; recordings download to the computer instead." : "Recordings made with BrainBench show up here. Files from the OpenBCI GUI can be played from the start screen."),
    );
  }
  async open(path) {
    if (!confirm("End this session and play the recording?")) return;
    const { api } = this.app;
    try {
      await api.endSession();
      const state = await api.startSession({ source: "playback", options: { file: path }, recording: { format: "off", auto: false } });
      this.app.addLog(`Playing ${path}`);
      window.dispatchEvent(new CustomEvent("brainbench:state", { detail: state }));
    } catch (e) { this.app.addLog(e.message); }
  }
  draw() { this.bar?.update(); }
}
