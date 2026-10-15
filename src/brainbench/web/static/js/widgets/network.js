// Networking: send data to other programs over UDP, LSL, OSC or serial,
// with the OpenBCI GUI's data types and payload formats. The server owns the
// sockets; this widget chooses what to send and feeds the derived values
// (FFT, band power, EMG, focus...) that the browser computes.

import { BANDS } from "../stream.js";
import { h, put } from "../ui.js";
import { averageBands } from "./bandpower.js";
import { emgFor } from "./emg.js";
import { joystick } from "../emg.js";

export const PROTOCOLS = {
  udp: { label: "UDP", streams: 3, defaults: (i) => ({ ip: "127.0.0.1", port: 12345 + i }) },
  lsl: { label: "LSL", streams: 3, defaults: (i) => ({ name: `obci_eeg${i + 1}`, type: "EEG" }) },
  osc: { label: "OSC", streams: 4, defaults: (i) => ({ ip: "127.0.0.1", port: 12345 + i, address: "/openbci" }) },
  serial: { label: "Serial", streams: 1, defaults: () => ({ port: "", baud: 57600 }) },
};
export const DATA_TYPES = [
  ["none", "None"], ["timeSeriesRaw", "Time series (raw)"], ["timeSeriesFilt", "Time series (filtered)"],
  ["fft", "FFT"], ["bandPower", "Band power"], ["averageBandPower", "Average band power"],
  ["focus", "Focus"], ["emg", "EMG"], ["emgJoystick", "EMG joystick"], ["accelerometer", "Accelerometer / aux"],
  ["pulse", "Pulse"], ["marker", "Marker"],
];
// Computed in the browser and sent to the server for each running stream.
const DERIVED = new Set(["timeSeriesFilt", "fft", "bandPower", "averageBandPower", "focus", "emg", "emgJoystick", "pulse"]);

export class Networking {
  static id = "networking";
  static title = "Networking";
  static unavailable = (app) => (app.api.kind === "demo" ? "Networking needs the local app: browsers cannot send LSL, OSC, UDP or serial data. Install BrainBench to stream to MATLAB, Python, Unity or OpenViBE." : null);

  constructor(body, app, options) {
    this.app = app; this.o = options;
    this.o.protocol ||= "udp";
    this.o.streams ||= {};
    this.running = !!app.network?.streams?.length;
    this.wrap = h("div.scroll");
    body.append(this.wrap);
    this.render();
    this.lastFilt = 0;
  }

  streams() {
    const P = PROTOCOLS[this.o.protocol];
    const saved = this.o.streams[this.o.protocol] ||= [];
    for (let i = 0; i < P.streams; i++) saved[i] = { type: "none", ...P.defaults(i), ...saved[i] };
    return saved;
  }

  render() {
    const P = PROTOCOLS[this.o.protocol];
    const list = this.streams();
    const field = (s, key, label, attrs = {}) => h("label.field", {}, label, h("input", { value: s[key] ?? "", ...attrs, disabled: this.running || undefined, oninput: (e) => { s[key] = attrs.type === "number" ? +e.target.value : e.target.value; this.app.workspace.save(); } }));
    const rows = list.map((s, i) => h("div.card", { style: { padding: "10px 12px", marginBottom: "8px" } },
      h("div.field-row", {},
        h("label.field", { style: { flex: "1.3" } }, `Stream ${i + 1}`, h("select", { disabled: this.running || undefined, onchange: (e) => { s.type = e.target.value; this.app.workspace.save(); } },
          DATA_TYPES.filter(([t]) => this.o.protocol !== "serial" || t !== "fft").map(([v, l]) => h("option", { value: v, selected: v === s.type || undefined }, l)))),
        this.o.protocol === "lsl" ? [field(s, "name", "Name"), field(s, "type", "Type")] : null,
        this.o.protocol === "udp" || this.o.protocol === "osc" ? [field(s, "ip", "IP address"), field(s, "port", "Port", { type: "number" })] : null,
        this.o.protocol === "osc" ? field(s, "address", "Address") : null,
        this.o.protocol === "serial" ? [field(s, "port", "Serial port", { placeholder: "/dev/tty..." }),
          h("label.field", {}, "Baud", h("select", { disabled: this.running || undefined, onchange: (e) => { s.baud = +e.target.value; } }, [57600, 115200, 250000, 500000].map((b) => h("option", { value: b, selected: b === s.baud || undefined }, b))))] : null)));
    const status = (this.app.network?.streams || []).map((s) => h("li", {}, `${s.label}: ${s.ok ? `sent ${s.sent}` : `error: ${s.error}`}`));
    put(this.wrap,
      h("div.inline", { style: { marginBottom: "10px", gap: "10px" } },
        h("div.seg", {}, Object.entries(PROTOCOLS).map(([k, p]) => h(`button${k === this.o.protocol ? ".sel" : ""}`, { type: "button", disabled: this.running || undefined, onclick: () => { this.o.protocol = k; this.render(); this.app.workspace.save(); } }, p.label))),
        h(`button${this.running ? "" : ".primary"}`, { type: "button", onclick: () => this.toggle() }, this.running ? "Stop" : "Start")),
      ...rows,
      h("p.hint", {}, `${P.label}: ${{ udp: "one JSON object per line, as the OpenBCI GUI sends it.", lsl: "one LSL outlet per stream, float32 at the board's rate for time series.", osc: "messages under the address, e.g. /openbci/time-series-raw/ch0.", serial: "[v, v, ...] lines with 3 decimals." }[this.o.protocol]} Data types and formats follow the OpenBCI GUI, so existing scripts keep working.`),
      status.length ? h("ul.hint", {}, status) : null,
    );
  }

  async toggle() {
    try {
      if (this.running) {
        await this.app.api.network([]);
        this.running = false;
      } else {
        const streams = this.streams().filter((s) => s.type !== "none").map((s) => ({ protocol: this.o.protocol, ...s }));
        if (!streams.length) throw new Error("Choose a data type for at least one stream.");
        this.app.network = await this.app.api.network(streams);
        this.running = true;
      }
    } catch (e) { this.app.addLog(e.message); }
    this.render();
  }

  /** Each frame: send the derived values the running streams need. */
  draw() {
    if (!this.running || !this.app.session?.streaming) return;
    const { app } = this;
    const wanted = new Set(this.streams().filter((s) => s.type !== "none").map((s) => s.type));
    const send = (kind, data) => { if (wanted.has(kind) && DERIVED.has(kind) && data != null) app.api.derived(kind, data); };
    const a = app.stream.analyse();
    if (wanted.has("timeSeriesFilt")) {
      const fresh = app.stream.samples - this.lastFilt;
      if (fresh > 0) {
        const n = Math.min(fresh, app.stream.fs);
        send("timeSeriesFilt", app.stream.layout.eeg.map((_, ch) => Array.from(app.stream.exg(ch, n / app.stream.fs).slice(-n))));
        this.lastFilt = app.stream.samples;
      }
    }
    if (a) {
      send("fft", a.spectra.map((sp) => (sp ? Array.from(sp.amp.slice(0, 125)) : [])));
      send("bandPower", a.bands.map((b) => b || BANDS.map(() => 0)));
      const avg = averageBands(app);
      if (avg) { const t = avg.reduce((s, v) => s + v, 0) || 1; send("averageBandPower", avg.map((v) => v / t)); }
    }
    if (wanted.has("emg") || wanted.has("emgJoystick")) {
      const out = emgFor(app).map((c) => c.out);
      send("emg", out);
      const js = app.workspace.panels.find((p) => p.widgetId === "emgjoystick");
      send("emgJoystick", js?.widget ? js.widget.pos : joystick(out, { xMinus: 0, xPlus: 1, yPlus: 2, yMinus: 3 }));
    }
    if (app.focusValue) send("focus", app.focusValue.over ? 1 : 0);
    const pulse = app.workspace.panels.find((p) => p.widgetId === "pulse")?.widget;
    if (pulse?.det?.bpm) send("pulse", [pulse.det.bpm, Math.round(pulse.det.ibi)]);
  }
}
