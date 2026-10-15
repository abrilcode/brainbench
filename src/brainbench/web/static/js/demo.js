// Simulated OpenBCI boards for the online demo.
//
// The signals are built to exercise every widget: background EEG with a
// waxing and waning occipital alpha rhythm, 60 Hz mains pick-up for the notch,
// eye blinks on the frontal channels, bursts of muscle activity, a pulse wave
// on an analog pin, the accelerometer, lead-off currents for impedance checks
// and an occasional lost packet. Rows follow BrainFlow's board layouts.

import { toOpenBciCsv } from "./formats.js";

export const LAYOUTS = {
  cyton: {
    board_id: 0, sampling_rate: 250, eeg: [1, 2, 3, 4, 5, 6, 7, 8], names: ["Fp1", "Fp2", "C3", "C4", "P7", "P8", "O1", "O2"],
    accel: [9, 10, 11], analog: [19, 20, 21], other: [12, 13, 14, 15, 16, 17, 18], resistance: [], package: 0, timestamp: 22, marker: 23, num_rows: 24,
  },
  cyton_daisy: {
    board_id: 2, sampling_rate: 125, eeg: Array.from({ length: 16 }, (_, i) => i + 1),
    names: ["Fp1", "Fp2", "C3", "C4", "P7", "P8", "O1", "O2", "F7", "F8", "F3", "F4", "T7", "T8", "P3", "P4"],
    accel: [17, 18, 19], analog: [27, 28, 29], other: [20, 21, 22, 23, 24, 25, 26], resistance: [], package: 0, timestamp: 30, marker: 31, num_rows: 32,
  },
  ganglion: {
    board_id: 1, sampling_rate: 200, eeg: [1, 2, 3, 4], names: ["Fp1", "Fp2", "O1", "O2"],
    accel: [5, 6, 7], analog: [], other: [], resistance: [8, 9, 10, 11, 12], package: 0, timestamp: 13, marker: 14, num_rows: 15,
  },
};

export const DEMO_SOURCES = [
  { key: "demo_cyton", label: "Cyton (simulated)", family: "cyton", connection: "none", note: "8 channels at 250 Hz", fields: [], channels: 8, sampling_rate: 250, layout: "cyton" },
  { key: "demo_cyton_daisy", label: "Cyton + Daisy (simulated)", family: "cyton", connection: "none", note: "16 channels at 125 Hz", fields: [], channels: 16, sampling_rate: 125, layout: "cyton_daisy" },
  { key: "demo_ganglion", label: "Ganglion (simulated)", family: "ganglion", connection: "none", note: "4 channels at 200 Hz", fields: [], channels: 4, sampling_rate: 200, layout: "ganglion" },
];

// Where on the head each montage position is, for the alpha and artefact patterns.
const OCCIPITAL = new Set(["O1", "O2", "P7", "P8", "P3", "P4"]);
const FRONTAL = new Set(["Fp1", "Fp2"]);
const TEMPORAL = new Set(["T7", "T8", "F7", "F8", "P7", "P8", "C3", "C4"]);

/** Small deterministic random generator, so the demo looks the same each time. */
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
function gauss(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }

export class DemoBoard {
  constructor(sourceKey, recording = {}) {
    const src = DEMO_SOURCES.find((s) => s.key === sourceKey) || DEMO_SOURCES[0];
    this.source = src;
    this.label = src.label;
    this.layout = structuredClone(LAYOUTS[src.layout]);
    this.fs = this.layout.sampling_rate;
    const n = this.layout.eeg.length;
    this.channels = Array.from({ length: n }, () => ({ active: true, gain: 24, input_type: "normal", bias: true, srb2: true, srb1: false }));
    this.boardMode = "default";
    this.leadOff = new Set();
    this.ganglionImpedance = false;
    this.impedanceKohm = Array.from({ length: n }, (_, i) => [8, 14, 6, 22, 11, 48, 9, 17, 12, 7, 19, 10, 25, 13, 8, 30][i]);
    this.t = 0; // samples generated
    this.pkg = 0;
    this.random = rng(42);
    this.state = this.layout.eeg.map(() => ({ pink: [0, 0, 0, 0, 0, 0, 0], drift: 0 }));
    this.streaming = false;
    this.pendingMarkers = [];
    this.recordFormat = recording.format || "openbci_csv";
    this.autoRecord = recording.auto ?? false;
    this.recordRows = null;
    this.received = 0;
    this.lost = 0;
    this.startedAt = null;
    this.onChunk = () => {}; this.onLog = () => {}; this.onStatus = () => {};
  }

  describe() {
    return {
      source: this.source.key, label: this.label, family: this.source.family, streaming: this.streaming,
      board_mode: this.boardMode, channels: this.channels, layout: this.layout, started_at: this.startedAt,
      packets: this.packetStats(), simulated: true,
    };
  }

  packetStats() {
    const total = this.received + this.lost;
    return { received: this.received, lost: this.lost, percent: total ? 100 * this.lost / total : 0 };
  }

  start() {
    if (this.streaming) return;
    this.streaming = true;
    this.startedAt = Date.now() / 1000;
    this.wall = performance.now();
    this.due = 0;
    this.timer = setInterval(() => this.tick(), 1000 / 30);
    this.statusTimer = setInterval(() => this.onStatus({ packets: this.packetStats(), recording: this.recording() }), 1000);
    if (this.autoRecord) this.startRecording(this.recordFormat);
  }

  stop() {
    clearInterval(this.timer); clearInterval(this.statusTimer);
    if (this.streaming && this.autoRecord) this.stopRecording();
    this.streaming = false;
  }

  setChannel(i, s) { this.channels[i] = { ...this.channels[i], ...s }; }
  impedance(index, on) {
    if (this.source.family === "ganglion") { this.ganglionImpedance = on; return; }
    if (on) this.leadOff.add(index); else this.leadOff.delete(index);
  }
  marker(value) { this.pendingMarkers.push(value); }

  tick() {
    const elapsed = (performance.now() - this.wall) / 1000;
    const want = Math.floor(elapsed * this.fs) - this.due;
    if (want <= 0) return;
    this.due += want;
    const chunk = this.generate(want);
    this.onChunk(chunk, this.layout.num_rows, want);
    if (this.recordRows) this.recordRows.push(chunk.slice());
  }

  generate(cols) {
    const L = this.layout, fs = this.fs, r = this.random;
    const data = new Float32Array(L.num_rows * cols);
    const set = (row, i, v) => { data[row * cols + i] = v; };
    for (let i = 0; i < cols; i++) {
      const t = (this.t + i) / fs;
      // Lose roughly one packet in 400 (BrainFlow fills the gap only with what arrives).
      if (r() < 0.0025) { this.pkg = (this.pkg + 1) % 256; this.lost++; }
      this.received++;
      set(L.package, i, this.pkg);
      this.pkg = (this.pkg + (this.source.layout === "cyton_daisy" ? 2 : 1)) % 256;
      const alphaEnv = 0.55 + 0.45 * Math.sin(2 * Math.PI * t / 7.3) ** 2;
      const blink = blinkAt(t);
      const burst = muscleAt(t);
      L.eeg.forEach((row, ch) => {
        const c = this.channels[ch];
        const name = L.names[ch];
        if (!c.active) { set(row, i, 0); return; }
        let v;
        if (c.input_type === "shorted") v = gauss(r) * 0.6;
        else if (c.input_type === "test") v = (Math.floor(t * 1.95 * 2) % 2 ? 1 : -1) * 1875 + gauss(r) * 0.5;
        else {
          const st = this.state[ch];
          // Pink-ish background (Voss-McCartney), a slow drift and mains pick-up.
          const k = Math.floor(r() * st.pink.length);
          st.pink[k] = gauss(r);
          const pink = st.pink.reduce((a, b) => a + b, 0) * 2.2;
          st.drift = st.drift * 0.999 + gauss(r) * 0.4;
          const alpha = (OCCIPITAL.has(name) ? 16 : 5) * alphaEnv * Math.sin(2 * Math.PI * 10.2 * t + ch * 0.7);
          const theta = 3 * Math.sin(2 * Math.PI * 6.1 * t + ch);
          const beta = 2.2 * Math.sin(2 * Math.PI * 21 * t + ch * 1.3);
          const mains = 9 * Math.sin(2 * Math.PI * 60 * t + ch * 0.3);
          const eog = FRONTAL.has(name) ? blink * (name === "Fp1" ? 110 : 95) : blink * 8;
          const emg = TEMPORAL.has(name) ? burst * gauss(r) * 38 : burst * gauss(r) * 4;
          v = pink + st.drift + alpha + theta + beta + mains + eog + emg;
        }
        if (this.leadOff.has(ch)) {
          // OpenBCI: Z = sqrt(2)·std / 6 nA − 2.2 kΩ, so std = (Z + 2.2 kΩ) · 6 nA / sqrt(2).
          const stdUv = ((this.impedanceKohm[ch] * 1000 + 2200) * 6e-9 / Math.SQRT2) * 1e6;
          v += Math.SQRT2 * stdUv * Math.sin(2 * Math.PI * 31.2 * t);
        }
        set(row, i, v);
      });
      if (this.boardMode === "default" || this.source.family === "ganglion") {
        const sway = 0.03 * Math.sin(2 * Math.PI * 0.21 * t);
        set(L.accel[0], i, sway + gauss(r) * 0.004);
        set(L.accel[1], i, -0.04 + 0.02 * Math.sin(2 * Math.PI * 0.13 * t) + gauss(r) * 0.004);
        set(L.accel[2], i, 0.99 + gauss(r) * 0.004);
      }
      if (this.boardMode === "analog" && L.analog.length) {
        set(L.analog[0], i, ppgAt(t));
        set(L.analog[1], i, 512 + 300 * Math.sin(2 * Math.PI * 0.25 * t));
        set(L.analog[2], i, (Math.floor(t / 2) % 2) * 1023);
      }
      if (this.boardMode === "digital" && L.other.length) {
        // D11, D12, D13, D17, D18 as 0/1, with a push button on D17.
        // Other rows 1, 2, 3, 4 and 6 carry D11, D12, D13, D17 and D18 (row 0 is the end byte).
        [Math.floor(t) % 2, Math.floor(t / 2) % 2, Math.floor(t / 4) % 2, t % 5 < 0.4 ? 1 : 0, 0].forEach((v, k) => set(L.other[[1, 2, 3, 4, 6][k]], i, v));
      }
      if (L.resistance.length && this.ganglionImpedance) {
        L.eeg.forEach((_, ch) => set(L.resistance[ch], i, this.impedanceKohm[ch]));
        set(L.resistance[L.eeg.length], i, 5);
      }
      set(L.timestamp, i, this.startedAt + t);
      if (i === 0 && this.pendingMarkers.length) set(L.marker, i, this.pendingMarkers.shift());
    }
    this.t += cols;
    return data;
  }

  // ------------------------------------------------------------ recording (downloaded as a file)

  recording() {
    return { active: !!this.recordRows, format: this.recordFormat, path: this.recordRows ? "download on stop" : null, started_at: this.recordStarted || null };
  }

  startRecording(format) {
    this.recordFormat = format || this.recordFormat;
    this.recordRows = [];
    this.recordStarted = Date.now() / 1000;
    this.onLog("Recording in the browser; the file downloads when the recording stops.");
  }

  stopRecording() {
    if (!this.recordRows) return;
    const chunks = this.recordRows;
    this.recordRows = null;
    const csv = toOpenBciCsv(chunks, this.layout, this.source.family);
    const name = `BrainBench-RAW-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.csv`;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.onLog(`Saved ${name}`);
  }
}

/** Eye blinks: a smooth 0..1 bump about every 5 s. */
function blinkAt(t) {
  const period = 5.3, at = (t % period) - 2.1;
  return Math.exp(-((at / 0.09) ** 2));
}

/** A clench of about a second every 12 s. */
function muscleAt(t) {
  const at = t % 12;
  return at > 8 && at < 9.1 ? Math.sin(Math.PI * (at - 8) / 1.1) : 0;
}

/** A pulse-sensor wave on the 0-1023 analog range at 72 beats per minute. */
function ppgAt(t) {
  const ph = (t * 72 / 60) % 1;
  const sys = Math.exp(-(((ph - 0.18) / 0.06) ** 2));
  const dic = 0.35 * Math.exp(-(((ph - 0.45) / 0.08) ** 2));
  return 420 + 380 * (sys + dic);
}
