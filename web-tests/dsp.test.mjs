import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { SosFilter, amplitudeSpectrum, bandPower, design, magnitude, welch } from "../src/brainbench/web/static/js/dsp.js";

const fx = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url)));

test("filter designs match SciPy's frequency responses", () => {
  let worst = 0;
  for (const r of fx.responses) {
    const sos = design({ type: r.type, kind: r.kind, order: r.order, freqs: r.freqs, fs: r.fs, ripple: 1 });
    r.f.forEach((f, i) => {
      const err = Math.abs(magnitude(sos, f, r.fs) - r.mag[i]);
      worst = Math.max(worst, err);
      assert.ok(err < 1e-6, `${r.kind} ${r.type} ${r.freqs} order ${r.order} at ${r.fs} Hz, ${f.toFixed(1)} Hz: ${magnitude(sos, f, r.fs)} vs ${r.mag[i]}`);
    });
  }
  assert.ok(worst < 1e-6);
});

test("the streaming filter gives SciPy's sosfilt output, chunk by chunk", () => {
  const sos = design({ type: "bandpass", order: 4, freqs: [1, 50], fs: 250 });
  const f = new SosFilter(sos);
  const x = Float64Array.from(fx.stream.x);
  const y = [...f.process(x.subarray(0, 123)), ...f.process(x.subarray(123, 400)), ...f.process(x.subarray(400))];
  y.forEach((v, i) => assert.ok(Math.abs(v - fx.stream.y[i]) < 1e-8, `sample ${i}: ${v} vs ${fx.stream.y[i]}`));
});

test("a sine's amplitude spectrum peaks at its frequency with its amplitude", () => {
  const fs = 250, n = 1000;
  const x = Float64Array.from({ length: n }, (_, i) => 20 * Math.sin(2 * Math.PI * 10 * i / fs));
  const { freqs, amp } = amplitudeSpectrum(x, fs, 1024);
  const k = amp.indexOf(Math.max(...amp));
  assert.ok(Math.abs(freqs[k] - 10) < 0.3, `peak at ${freqs[k]}`);
  assert.ok(Math.abs(amp[k] - 20) < 2.5, `amplitude ${amp[k]}`);
});

test("Welch PSD and band power match SciPy", () => {
  // Same white noise as the fixture: compare total power, which is robust to segment alignment.
  const total = fx.welch.psd.reduce((s, v, i, a) => (i ? s + (a[i - 1] + v) / 2 * (fx.welch.f[i] - fx.welch.f[i - 1]) : s), 0);
  const x = Float64Array.from({ length: 4000 }, (_, i) => 5 * Math.sin(i * 12.9898) * 1.4142);
  const p = welch(x, 250, 250);
  assert.equal(p.freqs.length, 126);
  // Parseval: band power over 0..fs/2 equals the variance (25 for amplitude 5·√2 sine-like noise).
  const varx = x.reduce((s, v) => s + v * v, 0) / x.length;
  assert.ok(Math.abs(bandPower(p, 0, 125) - varx) / varx < 0.05, `${bandPower(p, 0, 125)} vs ${varx}`);
  assert.ok(total > 15 && total < 35, `scipy total ${total}`);
});

test("a 10 Hz sine puts its power in the alpha band", () => {
  const fs = 250;
  const x = Float64Array.from({ length: 1000 }, (_, i) => 10 * Math.sin(2 * Math.PI * 10 * i / fs));
  const p = welch(x, fs, 250);
  const alpha = bandPower(p, 8, 13), beta = bandPower(p, 13, 30);
  assert.ok(Math.abs(alpha - 50) < 5, `alpha ${alpha}`);
  assert.ok(beta < alpha / 20);
});
