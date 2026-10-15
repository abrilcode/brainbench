// Beat detection on a PulseSensor wave (analog pin A5 / D11), following the
// classic PulseSensor algorithm the OpenBCI GUI uses. Time advances by the
// real sample period (the GUI assumes 4 ms, i.e. 250 Hz).

export class PulseDetector {
  constructor(fs) {
    this.dt = 1000 / fs;
    this.reset();
  }
  reset() {
    this.t = 0; this.lastBeat = 0; this.thresh = 530; this.peak = 512; this.trough = 512; this.amp = 100;
    this.ibi = 600; this.rate = Array(10).fill(600); this.first = true; this.second = false; this.pulse = false; this.bpm = 0;
    this.beats = []; // sample times of detected beats
  }
  /** Feeds one sample; returns true on a beat. */
  push(signal) {
    this.t += this.dt;
    const n = this.t - this.lastBeat;
    let beat = false;
    if (signal < this.thresh && n > (this.ibi / 5) * 3 && signal < this.trough) this.trough = signal;
    if (signal > this.thresh && signal > this.peak) this.peak = signal;
    if (n > 250 && signal > this.thresh && !this.pulse && n > (this.ibi / 5) * 3) {
      this.pulse = true;
      this.ibi = this.t - this.lastBeat;
      this.lastBeat = this.t;
      if (this.second) { this.second = false; this.rate.fill(this.ibi); }
      if (this.first) { this.first = false; this.second = true; return false; }
      this.rate.shift(); this.rate.push(this.ibi);
      this.bpm = Math.round(60000 / (this.rate.reduce((a, b) => a + b, 0) / this.rate.length));
      this.beats.push(this.t);
      beat = true;
    }
    if (signal < this.thresh && this.pulse) {
      this.pulse = false;
      this.amp = this.peak - this.trough;
      this.thresh = this.amp / 2 + this.trough;
      this.peak = this.thresh; this.trough = this.thresh;
    }
    if (n > 2500) {
      this.thresh = 530; this.peak = 512; this.trough = 512; this.lastBeat = this.t;
      this.first = true; this.second = false; this.bpm = 0;
    }
    return beat;
  }
}
