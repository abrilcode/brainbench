// Two ways to talk to a board, with the same methods:
//   LocalTransport  the Python server (real boards through BrainFlow)
//   DemoTransport   an in-browser simulation, for the online demo

import { DemoBoard, DEMO_SOURCES } from "./demo.js";

export class LocalTransport {
  constructor(base = "") {
    this.base = base;
    this.kind = "local";
    this.onFrame = () => {};
    this.onMessage = () => {};
  }

  async call(method, path, body) {
    const res = await fetch(this.base + path, {
      method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.detail || `${res.status} ${res.statusText}`);
    return data;
  }

  connect() {
    const url = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/ws";
    this.ws = new WebSocket(url);
    this.ws.binaryType = "arraybuffer";
    this.ws.onmessage = (ev) => {
      if (typeof ev.data === "string") return this.onMessage(JSON.parse(ev.data));
      const head = new Uint32Array(ev.data, 0, 2);
      this.onFrame(new Float32Array(ev.data, 8), head[0], head[1]);
    };
    this.ws.onclose = () => { this.onMessage({ type: "disconnected" }); setTimeout(() => this.connect(), 1500); };
  }

  send(msg) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg)); }

  state() { return this.call("GET", "/api/state"); }
  sources() { return this.call("GET", "/api/sources"); }
  ports() { return this.call("GET", "/api/ports"); }
  recordings() { return this.call("GET", "/api/recordings"); }
  startSession(cfg) { return this.call("POST", "/api/session", cfg); }
  endSession() { return this.call("DELETE", "/api/session"); }
  stream(on) { return this.call("POST", "/api/stream", { on }); }
  setChannel(i, s) { return this.call("POST", `/api/channel/${i}`, s); }
  setChannels(indices, settings) { return this.call("POST", "/api/channels", { indices, settings }); }
  boardMode(mode) { return this.call("POST", "/api/board-mode", { mode }); }
  impedance(index, on, pin = "p") { return this.call("POST", "/api/impedance", { index, on, pin }); }
  command(command) { return this.call("POST", "/api/command", { command }); }
  marker(value) { return this.call("POST", "/api/marker", { value }); }
  seek(fraction) { return this.call("POST", "/api/seek", { fraction }); }
  record(on, format) { return this.call("POST", "/api/record", { on, format }); }
  focus(metric) { return this.call("GET", `/api/focus?metric=${metric}`); }
  network(streams) { return this.call("POST", "/api/network", { streams }); }
  derived(kind, data) { this.send({ type: "derived", kind, data }); }
  listSettings() { return this.call("GET", "/api/settings"); }
  loadSettings(name) { return this.call("GET", `/api/settings/${encodeURIComponent(name)}`); }
  saveSettings(name, data) { return this.call("PUT", `/api/settings/${encodeURIComponent(name)}`, data); }
}

/** Same interface, no server: everything is simulated in the page. */
export class DemoTransport {
  constructor() {
    this.kind = "demo";
    this.onFrame = () => {};
    this.onMessage = () => {};
    this.board = null;
    this.saved = JSON.parse(localStorage.getItem("brainbench.demo.settings") || "{}");
  }

  connect() { setTimeout(() => this.onMessage({ type: "hello", ...this._state() }), 0); }
  send() {}

  _state() {
    return { version: "demo", session: this.board?.describe() || null, recording: this.board?.recording() || { active: false }, network: { streams: [], available: false }, focus_available: true };
  }
  _emit(type, extra = {}) { this.onMessage({ type, ...extra }); }

  async state() { return this._state(); }
  async sources() { return DEMO_SOURCES; }
  async ports() { return []; }
  async recordings() { return []; }

  async startSession(cfg) {
    this.board = new DemoBoard(cfg.source, cfg.recording || {});
    this.board.onChunk = (data, rows, cols) => this.onFrame(data, rows, cols);
    this.board.onLog = (text) => this._emit("log", { text });
    this.board.onStatus = (status) => this._emit("status", status);
    this._emit("log", { text: `Session started: ${this.board.label}, ${this.board.layout.eeg.length} channels at ${this.board.layout.sampling_rate} Hz (simulated)` });
    this._emit("session", { session: this.board.describe() });
    return this._state();
  }
  async endSession() { this.board?.stop(); this.board = null; this._emit("session", { session: null }); return this._state(); }
  async stream(on) { on ? this.board.start() : this.board.stop(); this._emit("session", { session: this.board.describe() }); return this._state(); }
  async setChannel(i, s) { this.board.setChannel(i, s); return this.board.describe(); }
  async setChannels(indices, settings) { for (const i of indices) this.board.setChannel(i, settings); return this.board.describe(); }
  async boardMode(mode) { this.board.boardMode = mode; this._emit("log", { text: `Board mode: ${mode}` }); return this.board.describe(); }
  async impedance(index, on) { this.board.impedance(index, on); return { reply: "" }; }
  async command(command) { this._emit("log", { text: `> ${command}  (the simulator ignores commands)` }); return { reply: "" }; }
  async marker(value) { this.board.marker(value); return { ok: true }; }
  async seek() { return { ok: true }; }
  async record(on, format) { on ? this.board.startRecording(format) : this.board.stopRecording(); return this._state(); }
  async focus() { return { value: null }; }
  async network() { throw new Error("Network outputs need the local app: browsers cannot send LSL, OSC, UDP or serial data."); }
  derived() {}
  async listSettings() { return Object.keys(this.saved).map((name) => ({ name })); }
  async loadSettings(name) { if (!this.saved[name]) throw new Error("no such settings"); return this.saved[name]; }
  async saveSettings(name, data) {
    this.saved[name] = data;
    localStorage.setItem("brainbench.demo.settings", JSON.stringify(this.saved));
    return { saved: `${name} (in this browser)` };
  }
}
