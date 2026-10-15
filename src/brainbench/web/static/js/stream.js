// The live data in the browser: ring buffers for every row, the filter chain
// for the EXG channels, and the per-frame analysis shared by the widgets.

import { SosFilter, amplitudeSpectrum, design } from "./dsp.js";

/** The bands the OpenBCI GUI computes, lower edge included and upper excluded. */
export const BANDS = [
  { key: "delta", label: "Delta", lo: 1, hi: 4 },
  { key: "theta", label: "Theta", lo: 4, hi: 8 },
  { key: "alpha", label: "Alpha", lo: 8, hi: 13 },
  { key: "beta", label: "Beta", lo: 13, hi: 30 },
  { key: "gamma", label: "Gamma", lo: 30, hi: 55 },
];

/** OpenBCI GUI defaults: band-pass 5-50 Hz on, band-stop off, notch at 50 and 60 Hz. */
export const DEFAULT_FILTERS = {
  perChannel: false,
  notch: "50+60", // "50" | "60" | "50+60" | "none", as BrainFlow's remove_environmental_noise
  bandpass: { on: true, lo: 5, hi: 50, kind: "butterworth", order: 4 },
  bandstop: { on: false, lo: 58, hi: 62, kind: "butterworth", order: 4 },
  channels: [], // per-channel band-pass and band-stop when perChannel is true: [{bandpass, bandstop}]
};

/** FFT length by sampling rate, as in the OpenBCI GUI. */
export function nfftFor(fs) {
  return { 500: 512, 1000: 1024, 1600: 2048 }[fs] || 256;
}

class Ring {
  constructor(n) { this.buf = new Float32Array(n); this.n = n; this.len = 0; }
  push(values) {
    const k = values.length;
    if (k >= this.n) { this.buf.set(values.subarray(k - this.n)); }
    else { this.buf.copyWithin(0, k); this.buf.set(values, this.n - k); }
    this.len = Math.min(this.n, this.len + k);
  }
  /** The last `count` samples (fewer if not yet received), oldest first. */
  last(count) { const c = Math.min(count, this.len); return this.buf.subarray(this.n - c); }
  clear() { this.buf.fill(0); this.len = 0; }
}

export class Stream {
  constructor() {
    this.layout = null;
    this.filters = structuredClone(DEFAULT_FILTERS);
    this.listeners = new Set();
    this.samples = 0;
    this.fft = { smoothing: 0.75, raw: false }; // shared by the FFT and band power widgets
  }

  /** Sets up buffers for a board (layout from the server or the demo). */
  setLayout(layout, seconds = 30) {
    this.layout = layout;
    this.fs = layout.sampling_rate;
    const n = Math.round(this.fs * seconds);
    this.rows = Array.from({ length: layout.num_rows }, () => new Ring(n));
    this.filtered = layout.eeg.map(() => new Ring(n));
    this.samples = 0;
    this.analysis = null;
    this.markers = []; // {t: sample count, value}
    this.rebuildFilters();
  }

  setFilters(filters) {
    this.filters = structuredClone(filters);
    this.rebuildFilters();
  }

  filterFor(ch) {
    if (this.filters.perChannel && this.filters.channels[ch]) return this.filters.channels[ch];
    return this.filters;
  }

  rebuildFilters() {
    if (!this.layout) return;
    const nyq = this.fs / 2;
    const notch = { "50": [50], "60": [60], "50+60": [50, 60], none: [] }[this.filters.notch ?? "50+60"] || [];
    this.chains = this.layout.eeg.map((_, ch) => {
      const f = this.filterFor(ch);
      const chain = [];
      // Same order as the OpenBCI GUI: band-stop, band-pass, then the mains notch.
      if (f.bandstop?.on && f.bandstop.hi < nyq) {
        chain.push(new SosFilter(design({ type: "bandstop", kind: f.bandstop.kind, order: f.bandstop.order, freqs: [f.bandstop.lo, f.bandstop.hi], fs: this.fs })));
      }
      if (f.bandpass?.on && f.bandpass.lo < Math.min(f.bandpass.hi, nyq * 0.98)) {
        const hi = Math.min(f.bandpass.hi, nyq * 0.98);
        chain.push(new SosFilter(design({ type: "bandpass", kind: f.bandpass.kind, order: f.bandpass.order, freqs: [f.bandpass.lo, hi], fs: this.fs })));
      }
      for (const hz of notch) {
        if (hz + 2 < nyq) chain.push(new SosFilter(design({ type: "bandstop", kind: "butterworth", order: 4, freqs: [hz - 2, hz + 2], fs: this.fs })));
      }
      return chain;
    });
  }

  /** A chunk from the board: Float32Array, `rows` rows of `cols` samples, row-major. */
  push(data, rows, cols) {
    if (!this.layout) return;
    for (let r = 0; r < rows && r < this.rows.length; r++) this.rows[r].push(data.subarray(r * cols, (r + 1) * cols));
    this.layout.eeg.forEach((row, ch) => {
      let x = Float64Array.from(data.subarray(row * cols, (row + 1) * cols));
      for (const f of this.chains[ch]) x = f.process(x);
      this.filtered[ch].push(Float32Array.from(x));
    });
    if (this.layout.marker != null) {
      const m = data.subarray(this.layout.marker * cols, (this.layout.marker + 1) * cols);
      for (let i = 0; i < cols; i++) if (m[i]) this.markers.push({ t: this.samples + i, value: m[i] });
      this.markers = this.markers.filter((x) => x.t > this.samples - this.fs * 60);
    }
    this.samples += cols;
    this.analysis = null;
    for (const fn of this.listeners) fn(data, rows, cols);
  }

  clear() {
    this.rows?.forEach((r) => r.clear());
    this.filtered?.forEach((r) => r.clear());
    this.chains?.forEach((c) => c.forEach((f) => f.reset()));
    this.samples = 0;
    this.markers = [];
    this.analysis = null;
    this.smoothed = [];
  }

  /** Last `seconds` of EXG channel `ch`, filtered (default) or raw. */
  exg(ch, seconds, raw = false) {
    const n = Math.round(seconds * this.fs);
    return raw ? this.rows[this.layout.eeg[ch]].last(n) : this.filtered[ch].last(n);
  }

  row(index, seconds) { return this.rows[index].last(Math.round(seconds * this.fs)); }

  /**
   * Spectra and band powers for every channel, computed once per frame and
   * shared by the FFT, band power, head plot, focus and networking widgets.
   */
  /**
   * Spectra and band powers for every channel, once per frame, shared by the
   * FFT, band power, spectrogram and networking widgets. As in the OpenBCI
   * GUI, the FFT's smoothing and filtered/raw choice apply to band power too.
   * Smoothing is done in log-power space: out = x^(1-a) · prev^a.
   */
  analyse() {
    if (this.analysis || !this.layout) return this.analysis;
    const nfft = nfftFor(this.fs);
    const a = this.fft.smoothing;
    this.smoothed ||= [];
    const spectra = [], bands = [];
    this.layout.eeg.forEach((_, ch) => {
      const x = this.exg(ch, nfft / this.fs, this.fft.raw);
      if (x.length < nfft) { spectra.push(null); bands.push(null); return; }
      const sp = amplitudeSpectrum(x, this.fs, nfft, "hamming", "N");
      const prev = this.smoothed[ch];
      for (let k = 0; k < sp.amp.length; k++) {
        const v = Math.max(sp.amp[k], 0.01);
        sp.amp[k] = prev && a ? v ** (1 - a) * prev[k] ** a : v;
      }
      this.smoothed[ch] = sp.amp;
      spectra.push(sp);
      bands.push(BANDS.map((b) => bandFromSpectrum(sp, nfft, this.fs, b.lo, b.hi)));
    });
    this.analysis = { nfft, spectra, bands };
    return this.analysis;
  }

  describeFilters() {
    const f = this.filters;
    const parts = [];
    if (f.bandpass.on) parts.push(`${f.bandpass.lo}–${f.bandpass.hi} Hz`);
    if (f.bandstop.on) parts.push(`stop ${f.bandstop.lo}–${f.bandstop.hi} Hz`);
    if (f.notch && f.notch !== "none") parts.push(`notch ${f.notch.replace("+", " + ")} Hz`);
    if (f.perChannel) parts.push("per channel");
    return parts.join(" · ") || "No filters";
  }
}

/**
 * Band power from an amplitude spectrum, as the OpenBCI GUI computes it:
 * PSD per bin = amplitude² · N / fs / 4 (no /4 at DC and Nyquist), summed
 * over bins with lo <= f < hi. Units µV²/Hz summed over bins, as in the GUI.
 */
export function bandFromSpectrum({ freqs, amp }, nfft, fs, lo, hi) {
  let total = 0;
  for (let k = 0; k < freqs.length; k++) {
    if (freqs[k] < lo || freqs[k] >= hi) continue;
    const edge = k === 0 || k === freqs.length - 1;
    total += (amp[k] ** 2 * nfft) / fs / (edge ? 1 : 4);
  }
  return total;
}
