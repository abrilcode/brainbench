// EMG activation per channel, with the OpenBCI GUI's adaptive envelope:
// a running mean of |x| (clipped at the µV limit) between an upper bound that
// creeps down and a lower bound that creeps up, mapped to 0..1.

export const EMG_CHOICES = {
  window: [0.01, 0.1, 0.15, 0.25, 0.5, 1.0, 2.0],
  limit: [50, 100, 200, 400],
  creepUp: [0.9, 0.95, 0.98, 0.99, 0.999, 0.9999, 0.99999],
  creepDown: [0.9, 0.95, 0.98, 0.99, 0.999, 0.9999, 0.99999],
  minDelta: [2, 4, 6, 8, 10, 20, 40, 80],
  lowLimit: [0, 2, 4, 6, 8, 10, 15, 20, 30, 40],
};
export const EMG_DEFAULTS = { window: 1.0, limit: 200, creepUp: 0.9, creepDown: 0.99999, minDelta: 10, lowLimit: 6 };

export class EmgChannel {
  constructor(settings = {}) {
    this.s = { ...EMG_DEFAULTS, ...settings };
    this.upper = 25; this.lower = 0; this.avg = 0; this.out = 0;
  }

  /** One update from the latest filtered samples (µV); returns the 0..1 activation. */
  update(x) {
    const s = this.s;
    let sum = 0;
    for (let i = 0; i < x.length; i++) sum += Math.min(Math.abs(x[i]), s.limit);
    const avg = x.length ? sum / x.length : 0;
    if (avg >= this.upper && avg <= s.limit) this.upper = avg;
    if (avg <= this.lower) this.lower = avg;
    if (this.upper >= avg + s.minDelta) this.upper *= s.creepUp;
    if (this.lower <= 1) this.lower = 1;
    if (this.lower <= avg) this.lower *= 1 / s.creepDown;
    this.lower = Math.max(this.lower, s.lowLimit);
    if (this.upper <= this.lower + s.minDelta) this.upper = this.lower + s.minDelta;
    this.avg = avg;
    this.out = Math.max(0, Math.min(1, (avg - this.lower) / (this.upper - this.lower)));
    return this.out;
  }
}

/** Per-channel EMG for the whole board, updated once per frame and shared by the widgets. */
export class EmgProcessor {
  constructor(stream, settings = []) {
    this.stream = stream;
    this.channels = stream.layout.eeg.map((_, ch) => new EmgChannel(settings[ch]));
    this.lastSample = -1;
  }
  update() {
    if (this.stream.samples === this.lastSample) return this.channels;
    this.lastSample = this.stream.samples;
    this.channels.forEach((c, ch) => c.update(this.stream.exg(ch, c.s.window)));
    return this.channels;
  }
  settings() { return this.channels.map((c) => c.s); }
}

/** The EMG joystick: X = X+ − X−, Y = Y+ − Y−, mapped from the square to the disc. */
export function joystick(out, inputs) {
  const u = (out[inputs.xPlus] ?? 0) - (out[inputs.xMinus] ?? 0);
  const v = (out[inputs.yPlus] ?? 0) - (out[inputs.yMinus] ?? 0);
  // Elliptical grid mapping. The OpenBCI GUI feeds the already-mapped x into
  // the y line, which lets corners reach a radius of 1.12; both use the inputs here.
  return [u * Math.sqrt(1 - (v * v) / 2), v * Math.sqrt(1 - (u * u) / 2)];
}
