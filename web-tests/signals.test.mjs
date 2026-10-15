import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { LAYOUTS } from "../src/brainbench/web/static/js/demo.js";
import { EmgChannel, joystick } from "../src/brainbench/web/static/js/emg.js";
import { columnNames, toOpenBciCsv } from "../src/brainbench/web/static/js/formats.js";
import { PulseDetector } from "../src/brainbench/web/static/js/pulse.js";
import { BANDS, nfftFor } from "../src/brainbench/web/static/js/stream.js";

const fx = JSON.parse(readFileSync(new URL("./fixtures.json", import.meta.url)));

test("the demo boards use BrainFlow's row layouts", () => {
  for (const [key, { layout }] of Object.entries(fx.layouts)) {
    for (const field of ["sampling_rate", "eeg", "accel", "analog", "other", "package", "timestamp", "marker", "num_rows"]) {
      assert.deepEqual(LAYOUTS[key][field], layout[field], `${key}.${field}`);
    }
  }
});

test("CSV columns from the demo match the app's OpenBCI CSV", () => {
  for (const [key, { layout, columns, family }] of Object.entries(fx.layouts)) {
    assert.deepEqual(columnNames(layout, family), columns, key);
  }
});

test("a demo recording is a valid OpenBCI CSV", () => {
  const L = fx.layouts.cyton.layout;
  const chunk = new Float32Array(L.num_rows * 3);
  L.eeg.forEach((r, i) => chunk.fill(i + 0.5, r * 3, r * 3 + 3));
  for (let c = 0; c < 3; c++) chunk[L.timestamp * 3 + c] = 1.7e9 + c / 250;
  const csv = toOpenBciCsv([chunk], L, "cyton").trim().split("\n");
  assert.equal(csv[0], "%OpenBCI Raw EXG Data");
  assert.equal(csv[1], "%Number of channels = 8");
  assert.equal(csv[3], "%Board = OpenBCI_GUI$BoardCytonSerial");
  assert.equal(csv.length, 5 + 3);
  const cells = csv[5].split(", ");
  assert.equal(cells.length, L.num_rows + 1);
  assert.equal(cells[1], "0.5");
  assert.match(cells.at(-1), /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3}$/);
});

test("FFT sizes and bands follow the OpenBCI GUI", () => {
  assert.deepEqual([125, 200, 250, 500, 1000, 1600].map(nfftFor), [256, 256, 256, 512, 1024, 2048]);
  assert.deepEqual(BANDS.map((b) => [b.lo ?? b[1], b.hi ?? b[2]]), [[1, 4], [4, 8], [8, 13], [13, 30], [30, 55]]);
});

test("EMG activation is 0 at rest and near 1 during a contraction", () => {
  const ch = new EmgChannel({ window: 0.25 });
  const fs = 250, n = fs * 0.25;
  let seed = 1;
  const noise = (a) => Float64Array.from({ length: n }, () => { seed = (seed * 16807) % 2147483647; return a * (seed / 2147483647 - 0.5) * 2; });
  let rest = 0, active = 0;
  for (let i = 0; i < 40; i++) rest = ch.update(noise(5));
  for (let i = 0; i < 8; i++) active = ch.update(noise(150));
  assert.ok(rest < 0.1, `rest ${rest}`);
  assert.ok(active > 0.8, `active ${active}`);
  for (let i = 0; i < 40; i++) rest = ch.update(noise(5));
  assert.ok(rest < 0.1, `back to rest ${rest}`);
});

test("the joystick maps the square onto the disc", () => {
  const inputs = { xPlus: 0, xMinus: 1, yPlus: 2, yMinus: 3 };
  assert.deepEqual(joystick([0, 0, 0, 0], inputs), [0, 0]);
  const [x, y] = joystick([1, 0, 1, 0], inputs);
  assert.ok(Math.hypot(x, y) <= 1.0001, `corner at radius ${Math.hypot(x, y)}`);
  const [xl] = joystick([0, 1, 0, 0], inputs);
  assert.equal(xl, -1);
});

test("the pulse detector reads 72 BPM from a 72 BPM wave", () => {
  const fs = 250, bpm = 72;
  const p = new PulseDetector(fs);
  for (let i = 0; i < fs * 20; i++) {
    const phase = ((i / fs) * bpm / 60) % 1;
    p.push(512 + 300 * Math.exp(-((phase - 0.15) ** 2) / 0.002) - 60 * Math.exp(-((phase - 0.35) ** 2) / 0.01));
  }
  assert.ok(Math.abs(p.bpm - bpm) <= 1, `bpm ${p.bpm}`);
  assert.ok(Math.abs(p.ibi - 60000 / bpm) < 10, `ibi ${p.ibi}`);
});
