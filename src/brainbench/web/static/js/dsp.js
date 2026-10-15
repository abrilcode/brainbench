// Signal processing for the display: filter design, streaming filters, FFT.
//
// Filters are designed the way SciPy does it: an analog prototype (zeros,
// poles, gain), a frequency transform, the bilinear transform, then second-
// order sections. Tests compare the responses with SciPy's.

// ------------------------------------------------------------------ complex numbers

const C = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1]],
  mul: (a, b) => [a[0] * b[0] - a[1] * b[1], a[0] * b[1] + a[1] * b[0]],
  div: (a, b) => { const d = b[0] * b[0] + b[1] * b[1]; return [(a[0] * b[0] + a[1] * b[1]) / d, (a[1] * b[0] - a[0] * b[1]) / d]; },
  scale: (a, s) => [a[0] * s, a[1] * s],
  sqrt: (a) => { const r = Math.hypot(a[0], a[1]); const re = Math.sqrt((r + a[0]) / 2); const im = Math.sign(a[1] || 1) * Math.sqrt(Math.max(0, (r - a[0]) / 2)); return [re, im]; },
  abs: (a) => Math.hypot(a[0], a[1]),
};
const prod = (list) => list.reduce((acc, z) => C.mul(acc, z), [1, 0]);

// ------------------------------------------------------------------ analog prototypes (cutoff 1 rad/s)

/** Butterworth: poles evenly on the left half of the unit circle. */
export function buttap(n) {
  const p = [];
  for (let k = 0; k < n; k++) {
    const th = Math.PI * (2 * k + n + 1) / (2 * n);
    p.push([Math.cos(th), Math.sin(th)]);
  }
  return { z: [], p, k: 1 };
}

/** Chebyshev type I with `rp` dB of passband ripple. */
export function cheb1ap(n, rp) {
  const eps = Math.sqrt(10 ** (0.1 * rp) - 1);
  const mu = Math.asinh(1 / eps) / n;
  const p = [];
  for (let k = -n + 1; k < n; k += 2) {
    const th = Math.PI * k / (2 * n);
    p.push([-Math.sinh(mu) * Math.cos(th), Math.cosh(mu) * Math.sin(th)]);
  }
  let k = Math.abs(prod(p.map((x) => C.scale(x, -1)))[0]);
  if (n % 2 === 0) k /= Math.sqrt(1 + eps * eps);
  return { z: [], p, k };
}

/**
 * Bessel poles, normalised so the phase delay at 1 rad/s is the same as
 * SciPy's `norm="phase"`. Values from scipy.signal.besselap.
 */
const BESSEL_PHASE = {
  1: [[-1.0000000000, -0.0000000000]],
  2: [[-0.8660254038, 0.5000000000], [-0.8660254038, -0.5000000000]],
  3: [[-0.9416000265, -0.0000000000], [-0.7456403858, 0.7113666250], [-0.7456403858, -0.7113666250]],
  4: [[-0.9047587968, 0.2709187330], [-0.9047587968, -0.2709187330], [-0.6572111717, 0.8301614350], [-0.6572111717, -0.8301614350]],
  5: [[-0.9264420774, -0.0000000000], [-0.8515536194, 0.4427174639], [-0.8515536194, -0.4427174639], [-0.5905759446, 0.9072067565], [-0.5905759446, -0.9072067565]],
  6: [[-0.9093906830, 0.1856964397], [-0.9093906830, -0.1856964397], [-0.7996541858, 0.5621717347], [-0.7996541858, -0.5621717347], [-0.5385526817, 0.9616876882], [-0.5385526817, -0.9616876882]],
  7: [[-0.9194871556, -0.0000000000], [-0.8800029342, 0.3216652762], [-0.8800029342, -0.3216652762], [-0.7527355434, 0.6504696306], [-0.7527355434, -0.6504696306], [-0.4966917257, 1.0025085085], [-0.4966917257, -1.0025085085]],
  8: [[-0.9096831547, 0.1412437977], [-0.9096831547, -0.1412437977], [-0.8473250802, 0.4259017538], [-0.8473250802, -0.4259017538], [-0.7111381808, 0.7186517314], [-0.7111381808, -0.7186517314], [-0.4621740413, 1.0343886811], [-0.4621740413, -1.0343886811]],
};
export function besselap(n) {
  const p = BESSEL_PHASE[n];
  if (!p) throw new Error("Bessel filters are available up to order 8");
  const k = prod(p.map((x) => C.scale(x, -1)))[0];
  return { z: [], p: p.map((x) => [...x]), k };
}

// ------------------------------------------------------------------ transforms

function lp2bp({ z, p, k }, wo, bw) {
  const half = (r) => C.scale(r, bw / 2);
  const split = (r) => {
    const h = half(r);
    const d = C.sqrt(C.sub(C.mul(h, h), [wo * wo, 0]));
    return [C.add(h, d), C.sub(h, d)];
  };
  const zb = z.flatMap(split), pb = p.flatMap(split);
  const degree = p.length - z.length;
  for (let i = 0; i < degree; i++) zb.push([0, 0]);
  return { z: zb, p: pb, k: k * bw ** degree };
}

function lp2bs({ z, p, k }, wo, bw) {
  const split = (r) => {
    const h = C.div([bw / 2, 0], r);
    const d = C.sqrt(C.sub(C.mul(h, h), [wo * wo, 0]));
    return [C.add(h, d), C.sub(h, d)];
  };
  const zb = z.flatMap(split), pb = p.flatMap(split);
  const degree = p.length - z.length;
  for (let i = 0; i < degree; i++) { zb.push([0, wo]); zb.push([0, -wo]); }
  const num = prod(z.map((x) => C.scale(x, -1))), den = prod(p.map((x) => C.scale(x, -1)));
  return { z: zb, p: pb, k: k * C.div(num, den)[0] };
}

function lp2lp({ z, p, k }, wo) {
  const degree = p.length - z.length;
  return { z: z.map((x) => C.scale(x, wo)), p: p.map((x) => C.scale(x, wo)), k: k * wo ** degree };
}

function lp2hp({ z, p, k }, wo) {
  const degree = p.length - z.length;
  const zh = z.map((x) => C.div([wo, 0], x)), ph = p.map((x) => C.div([wo, 0], x));
  for (let i = 0; i < degree; i++) zh.push([0, 0]);
  const num = prod(z.map((x) => C.scale(x, -1))), den = prod(p.map((x) => C.scale(x, -1)));
  return { z: zh, p: ph, k: k * C.div(num, den)[0] };
}

function bilinear({ z, p, k }, fs) {
  const fs2 = [2 * fs, 0];
  const map = (r) => C.div(C.add(fs2, r), C.sub(fs2, r));
  const zd = z.map(map), pd = p.map(map);
  for (let i = 0; i < p.length - z.length; i++) zd.push([-1, 0]);
  const num = prod(z.map((x) => C.sub(fs2, x))), den = prod(p.map((x) => C.sub(fs2, x)));
  return { z: zd, p: pd, k: k * C.div(num, den)[0] };
}

// ------------------------------------------------------------------ zeros/poles to second-order sections

/** Groups roots into conjugate pairs and real pairs, most-real last. */
function pairRoots(roots) {
  const tol = 1e-9;
  const cplx = roots.filter((r) => r[1] > tol).sort((a, b) => C.abs(C.sub(a, [1, 0])) - C.abs(C.sub(b, [1, 0])));
  const reals = roots.filter((r) => Math.abs(r[1]) <= tol).map((r) => r[0]).sort((a, b) => a - b);
  const pairs = cplx.map((r) => ({ b1: -2 * r[0], b2: r[0] * r[0] + r[1] * r[1] }));
  for (let i = 0; i < reals.length; i += 2) {
    if (i + 1 < reals.length) pairs.push({ b1: -(reals[i] + reals[i + 1]), b2: reals[i] * reals[i + 1] });
    else pairs.push({ b1: -reals[i], b2: 0, single: true });
  }
  return pairs;
}

function zpk2sos({ z, p, k }) {
  const pp = pairRoots(p);
  const zz = pairRoots(z);
  while (zz.length < pp.length) zz.push({ b1: 0, b2: 0 });
  const sos = pp.map((den, i) => {
    const num = zz[i];
    return [1, num.b1, num.b2, 1, den.b1, den.b2];
  });
  // Put the whole gain in the first section.
  sos[0][0] *= k; sos[0][1] *= k; sos[0][2] *= k;
  return sos;
}

/**
 * Designs a digital filter as second-order sections.
 *   type: "bandpass" | "bandstop" | "lowpass" | "highpass"
 *   kind: "butterworth" | "chebyshev" | "bessel"
 *   freqs: [low, high] for band filters, cutoff for the others (Hz)
 */
export function design({ type, kind = "butterworth", order = 4, freqs, fs, ripple = 1 }) {
  const proto = kind === "chebyshev" ? cheb1ap(order, ripple) : kind === "bessel" ? besselap(order) : buttap(order);
  const warp = (f) => 2 * fs * Math.tan(Math.PI * f / fs);
  let analog;
  if (type === "bandpass" || type === "bandstop") {
    const [lo, hi] = freqs.map(warp);
    const bw = hi - lo, wo = Math.sqrt(lo * hi);
    analog = type === "bandpass" ? lp2bp(proto, wo, bw) : lp2bs(proto, wo, bw);
  } else {
    const wo = warp(Array.isArray(freqs) ? freqs[0] : freqs);
    analog = type === "highpass" ? lp2hp(proto, wo) : lp2lp(proto, wo);
  }
  return zpk2sos(bilinear(analog, fs));
}

/** Magnitude response of second-order sections at frequency f (Hz). */
export function magnitude(sos, f, fs) {
  const w = 2 * Math.PI * f / fs;
  const z1 = [Math.cos(-w), Math.sin(-w)], z2 = [Math.cos(-2 * w), Math.sin(-2 * w)];
  let h = [1, 0];
  for (const [b0, b1, b2, a0, a1, a2] of sos) {
    const num = C.add(C.add([b0, 0], C.scale(z1, b1)), C.scale(z2, b2));
    const den = C.add(C.add([a0, 0], C.scale(z1, a1)), C.scale(z2, a2));
    h = C.mul(h, C.div(num, den));
  }
  return C.abs(h);
}

/** A streaming filter for one channel: keeps its state between chunks (direct form II transposed). */
export class SosFilter {
  constructor(sos) {
    this.sos = sos;
    this.state = sos.map(() => [0, 0]);
  }
  reset() { this.state = this.sos.map(() => [0, 0]); }
  process(x) {
    const out = new Float64Array(x.length);
    for (let n = 0; n < x.length; n++) {
      let v = x[n];
      for (let s = 0; s < this.sos.length; s++) {
        const [b0, b1, b2, , a1, a2] = this.sos[s];
        const st = this.state[s];
        const y = b0 * v + st[0];
        st[0] = b1 * v - a1 * y + st[1];
        st[1] = b2 * v - a2 * y;
        v = y;
      }
      out[n] = v;
    }
    return out;
  }
}

// ------------------------------------------------------------------ spectra

/** In-place radix-2 FFT of real and imaginary arrays (length a power of two). */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const ar = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
        const ai = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
        re[i + k + len / 2] = re[i + k] - ar; im[i + k + len / 2] = im[i + k] - ai;
        re[i + k] += ar; im[i + k] += ai;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

export const nextPow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(2, n)));

export const WINDOWS = {
  hann: (n, N) => 0.5 - 0.5 * Math.cos(2 * Math.PI * n / (N - 1)),
  hamming: (n, N) => 0.54 - 0.46 * Math.cos(2 * Math.PI * n / (N - 1)),
  blackman: (n, N) => 0.42 - 0.5 * Math.cos(2 * Math.PI * n / (N - 1)) + 0.08 * Math.cos(4 * Math.PI * n / (N - 1)),
  none: () => 1,
};

/**
 * Amplitude spectrum of the last `nfft` samples, single-sided, in the units
 * of the input (µV for EEG). Returns { freqs, amp }.
 *   norm "window": divided by the window's sum, so a sine reads its amplitude
 *   norm "N":      divided by N, as the OpenBCI GUI does (Hamming reads 0.54×)
 */
export function amplitudeSpectrum(x, fs, nfft, window = "hann", norm = "window") {
  const re = new Float64Array(nfft), im = new Float64Array(nfft);
  const start = Math.max(0, x.length - nfft);
  const n = Math.min(nfft, x.length);
  let mean = 0;
  for (let i = 0; i < n; i++) mean += x[start + i];
  mean /= n || 1;
  let gain = 0;
  for (let i = 0; i < n; i++) {
    const w = WINDOWS[window](i, n);
    gain += w;
    re[i] = (x[start + i] - mean) * w;
  }
  fft(re, im);
  const half = nfft / 2 + 1;
  const freqs = new Float64Array(half), amp = new Float64Array(half);
  for (let k = 0; k < half; k++) {
    freqs[k] = k * fs / nfft;
    amp[k] = (Math.hypot(re[k], im[k]) / ((norm === "N" ? nfft : gain) || 1)) * (k === 0 || k === nfft / 2 ? 1 : 2);
  }
  return { freqs, amp };
}

/** Power spectral density by Welch's method (Hann, 50 % overlap), in units²/Hz. */
export function welch(x, fs, nperseg) {
  nperseg = Math.min(nperseg, x.length);
  const step = Math.max(1, Math.floor(nperseg / 2));
  const half = Math.floor(nperseg / 2) + 1;
  const psd = new Float64Array(half);
  let s2 = 0;
  for (let i = 0; i < nperseg; i++) s2 += WINDOWS.hann(i, nperseg) ** 2;
  let count = 0;
  const N = nextPow2(nperseg);
  for (let start = 0; start + nperseg <= x.length; start += step) {
    const re = new Float64Array(N), im = new Float64Array(N);
    let mean = 0;
    for (let i = 0; i < nperseg; i++) mean += x[start + i];
    mean /= nperseg;
    for (let i = 0; i < nperseg; i++) re[i] = (x[start + i] - mean) * WINDOWS.hann(i, nperseg);
    fft(re, im);
    for (let k = 0; k < half; k++) {
      const kk = Math.round(k * N / nperseg) % N;
      psd[k] += (re[kk] ** 2 + im[kk] ** 2) / (fs * s2) * (k === 0 || (nperseg % 2 === 0 && k === half - 1) ? 1 : 2);
    }
    count++;
  }
  for (let k = 0; k < half; k++) psd[k] /= count || 1;
  const freqs = Float64Array.from({ length: half }, (_, k) => k * fs / nperseg);
  return { freqs, psd };
}

/** Integral of a PSD between two frequencies (trapezoids), i.e. band power in units². */
export function bandPower({ freqs, psd }, lo, hi) {
  let total = 0;
  for (let k = 1; k < freqs.length; k++) {
    const f0 = freqs[k - 1], f1 = freqs[k];
    if (f1 <= lo || f0 >= hi) continue;
    total += (psd[k - 1] + psd[k]) / 2 * (Math.min(f1, hi) - Math.max(f0, lo));
  }
  return total;
}

// ------------------------------------------------------------------ small helpers

export function rms(x, from = 0, to = x.length) {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
}

export function std(x, from = 0, to = x.length) {
  const n = Math.max(1, to - from);
  let m = 0;
  for (let i = from; i < to; i++) m += x[i];
  m /= n;
  let s = 0;
  for (let i = from; i < to; i++) s += (x[i] - m) ** 2;
  return Math.sqrt(s / n);
}

export function peakAbs(x, from = 0, to = x.length) {
  let p = 0;
  for (let i = from; i < to; i++) p = Math.max(p, Math.abs(x[i]));
  return p;
}

/** Exponential smoothing between successive frames: k = 0 is none, close to 1 is heavy. */
export function smooth(prev, next, k) {
  if (!prev || prev.length !== next.length || !k) return Float64Array.from(next);
  const out = new Float64Array(next.length);
  for (let i = 0; i < next.length; i++) out[i] = k * prev[i] + (1 - k) * next[i];
  return out;
}
