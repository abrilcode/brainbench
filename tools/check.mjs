// Browser check: opens BrainBench in headless Chrome, connects each board,
// streams, shows every widget and opens every dialog. Fails on console errors,
// blank charts and stray "null"/"undefined"/"NaN" text.
//
//   node tools/check.mjs http://127.0.0.1:8800/?demo            the online demo boards
//   node tools/check.mjs http://127.0.0.1:8800/ --local          synthetic board, recording, playback
//   add --shots <dir> to save a screenshot of each step
//
// Needs Node 22+ (built-in WebSocket) and Chrome or Chromium ($CHROME overrides the path).

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const url = args.find((a) => a.startsWith("http"));
const local = args.includes("--local");
const shots = args.includes("--shots") ? args[args.indexOf("--shots") + 1] : null;
if (!url) { console.error("usage: node tools/check.mjs <url> [--local] [--shots dir]"); process.exit(2); }
if (shots) mkdirSync(shots, { recursive: true });

const chrome = process.env.CHROME || [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser",
].find(existsSync);
if (!chrome) { console.error("Chrome not found; set $CHROME"); process.exit(2); }

const W = 1600, H = 1000;
const proc = spawn(chrome, ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${mkdtempSync(join(tmpdir(), "bb-check-"))}`,
  "--no-first-run", "--no-sandbox", "--hide-scrollbars", "about:blank"], { stdio: ["ignore", "ignore", "pipe"] });
const wsUrl = await new Promise((ok) => proc.stderr.on("data", (d) => { const m = String(d).match(/ws:\/\/\S+/); if (m) ok(m[0]); }));
const ws = new WebSocket(wsUrl);
await new Promise((ok) => ws.addEventListener("open", ok));

let id = 0, sid;
const pending = new Map(), errors = [];
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.method === "Runtime.exceptionThrown") errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  if (m.method === "Runtime.consoleAPICalled" && m.params.type === "error") errors.push(m.params.args.map((a) => a.value ?? a.description).join(" "));
  if (m.method === "Log.entryAdded" && m.params.entry.level === "error") errors.push(`${m.params.entry.text} ${m.params.entry.url || ""}`);
  if (m.method === "Page.javascriptDialogOpening") send("Page.handleJavaScriptDialog", { accept: true }, m.sessionId);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.fail(new Error(m.error.message)) : p.ok(m.result); }
});
const send = (method, params = {}, s = sid) => new Promise((ok, fail) => { pending.set(++id, { ok, fail }); ws.send(JSON.stringify({ id, method, params, sessionId: s })); });
const { targetId } = await send("Target.createTarget", { url: "about:blank" }, undefined);
({ sessionId: sid } = await send("Target.attachToTarget", { targetId, flatten: true }, undefined));
await send("Runtime.enable"); await send("Log.enable"); await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });

async function run(js) {
  const r = await send("Runtime.evaluate", { expression: `(async () => { ${js} })()`, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
async function shot(name) {
  if (!shots) return;
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(shots, `${name}.png`), Buffer.from(data, "base64"));
}

// Helpers injected into the page.
const PAGE = `
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const app = window.brainbench;
  const bad = (root) => [...new Set(root.innerText.match(/\\b(null|undefined|NaN)\\b|\\[object Object\\]/g) || [])];
  const blank = (c) => {
    if (!c.width || !c.height) return true;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    for (let i = 4; i < d.length; i += 4 * 97) if (d[i + 3] && (d[i] !== d[0] || d[i + 1] !== d[1] || d[i + 2] !== d[2] || d[i + 3] !== d[3])) return false;
    return true;
  };
`;

const failures = [];
const check = (cond, msg) => { if (!cond) failures.push(msg); console.log(`${cond ? "  ok  " : "  FAIL"} ${msg}`); };

async function open() {
  await send("Page.navigate", { url });
  await new Promise((r) => setTimeout(r, 1500));
  await run(`localStorage.clear(); return true;`);
  await send("Page.reload");
  await new Promise((r) => setTimeout(r, 1500));
}

async function connect(key, extra = "") {
  return run(`${PAGE}
    document.querySelector('[data-key="${key}"]').click(); await wait(300);
    ${extra}
    document.getElementById("btn-connect").click();
    for (let i = 0; i < 60 && !app.session; i++) await wait(100);
    if (!app.session) throw new Error(document.getElementById("connect-error").textContent || "no session");
    document.getElementById("btn-stream").click();
    await wait(2500);
    return { channels: app.session.channels.length, fs: app.stream.fs, samples: app.stream.samples };
  `);
}

async function everyWidget(tag) {
  const ids = await run(`${PAGE} return (await import("./js/widgets/index.js")).WIDGETS.map((w) => w.id);`);
  for (let i = 0; i < ids.length; i += 6) {
    const group = ids.slice(i, i + 6);
    const r = await run(`${PAGE}
      app.workspace.restore("6", ${JSON.stringify(group.map((w) => ({ widget: w })))});
      await wait(2600);
      return [...document.querySelectorAll("#workspace .panel")].map((p) => {
        const note = p.querySelector(".panel-note");
        const canvases = [...p.querySelectorAll("canvas")];
        return { title: p.querySelector(".panel-head select, .panel-head")?.value || "", unavailable: note && !p.querySelector(".panel-body > :not(.panel-note)") ? note.innerText : null,
          bad: bad(p), blank: canvases.filter(blank).length, canvases: canvases.length };
      });
    `);
    r.slice(0, group.length).forEach((p, k) => {
      const name = `${tag}: ${group[k]}`;
      if (p.unavailable) { console.log(`  --   ${name} (unavailable: ${p.unavailable.slice(0, 60)}…)`); return; }
      check(!p.bad.length, `${name} shows no ${p.bad.join("/") || "stray values"}`);
      if (p.canvases) check(p.blank < p.canvases, `${name} draws its chart`);
    });
    await shot(`${tag}-widgets-${i / 6 + 1}`);
  }
}

async function dialogs(tag) {
  for (const btn of ["btn-filters", "btn-layout", "btn-hardware", "btn-settings", "btn-help"]) {
    const r = await run(`${PAGE}
      const b = document.getElementById("${btn}");
      if (!b || b.hidden || b.offsetParent === null) return null;
      b.click(); await wait(500);
      const d = document.getElementById("dialog");
      const out = { open: !document.getElementById("overlay").hidden, bad: bad(d), title: d.querySelector("h2")?.textContent };
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); await wait(200);
      return out;
    `);
    if (!r) continue;
    check(r.open && !r.bad.length, `${tag}: ${r.title} dialog opens cleanly${r.bad.length ? ` (shows ${r.bad.join("/")})` : ""}`);
  }
}

async function end() {
  await run(`${PAGE} await app.api.endSession(); window.dispatchEvent(new CustomEvent("brainbench:state", { detail: await app.api.state() })); await wait(300); return true;`);
}

try {
  await open();
  if (!local) {
    for (const key of ["demo_cyton", "demo_cyton_daisy", "demo_ganglion"]) {
      console.log(key);
      const s = await connect(key, `document.getElementById("auto-record").checked = false;`);
      check(s.samples > 0, `${key}: streams (${s.channels} ch at ${s.fs} Hz)`);
      await everyWidget(key);
      await dialogs(key);
      await end();
    }
  } else {
    console.log("synthetic");
    const s = await connect("synthetic", `document.querySelector('select[name="channels"]').value = "8"; document.getElementById("session-name").value = "browser-check";`);
    check(s.channels === 8 && s.samples > 0, `synthetic: streams 8 channels (${s.samples} samples)`);
    await everyWidget("synthetic");
    await dialogs("synthetic");
    const rec = await run(`${PAGE}
      document.getElementById("btn-stream").click(); await wait(800);
      const list = await app.api.recordings();
      return list.find((r) => r.path.includes("browser-check")) || null;
    `);
    check(rec && rec.channels === 8, `synthetic: recorded ${rec?.name} (${rec?.channels} ch, ${rec?.duration})`);
    await end();
    console.log("playback");
    const p = await run(`${PAGE}
      const state = await app.api.startSession({ source: "playback", options: { file: ${JSON.stringify(rec?.path || "")} }, recording: { format: "off", auto: false } });
      window.dispatchEvent(new CustomEvent("brainbench:state", { detail: state })); await wait(600);
      document.getElementById("btn-stream").click(); await wait(2500);
      return { channels: app.session.channels.length, samples: app.stream.samples, total: app.session.playback?.total_samples, bar: document.querySelector(".pb-time")?.textContent };
    `);
    check(p.channels === 8 && p.samples > 0 && p.total > 0, `playback: plays the recording back (${p.channels} ch, ${p.bar})`);
    await shot("playback");
    await end();
  }
} catch (e) {
  failures.push(String(e.message || e));
  console.log(`  FAIL ${e.message || e}`);
}

for (const e of errors) { failures.push(`console: ${e}`); console.log(`  FAIL console: ${e}`); }
ws.close(); proc.kill();
console.log(failures.length ? `\n${failures.length} problem(s)` : "\nall checks passed");
process.exit(failures.length ? 1 : 0);
