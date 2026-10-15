// The app shell: start screen, toolbar, workspace of panels, console.

import { DemoTransport, LocalTransport } from "./api.js";
import { DEFAULT_FILTERS, Stream } from "./stream.js";
import { $, clock, dialog, h, toast } from "./ui.js";
import { Workspace, LAYOUTS } from "./workspace.js";
import { openFilters } from "./dialogs/filters.js";
import { openHardware } from "./dialogs/hardware.js";

const demo = location.pathname.includes("/demo") || new URLSearchParams(location.search).has("demo") || !!window.BRAINBENCH_DEMO;
const api = demo ? new DemoTransport() : new LocalTransport();
const stream = new Stream();
const app = {
  api, stream, demo, session: null, recording: { active: false }, network: { streams: [] }, focusAvailable: false,
  sources: [], selected: null, ports: [], log: [],
};
window.brainbench = app; // handy for debugging and for the browser tests

const workspace = new Workspace($("workspace"), app);
app.workspace = workspace;

// ------------------------------------------------------------------ transport events

api.onFrame = (data, rows, cols) => stream.push(data, rows, cols);
api.onMessage = (msg) => {
  if (msg.type === "hello") applyState(msg);
  else if (msg.type === "session") setSession(msg.session);
  else if (msg.type === "status") {
    if (app.session) app.session.packets = msg.packets;
    app.recording = msg.recording || app.recording;
    app.network = msg.network || app.network;
    renderPills();
  } else if (msg.type === "log") addLog(msg.text);
  else if (msg.type === "disconnected") addLog("Lost the connection to the BrainBench server; retrying…");
};

function applyState(state) {
  $("version").textContent = state.version === "demo" ? "" : `v${state.version}`;
  app.recording = state.recording || app.recording;
  app.network = state.network || app.network;
  app.focusAvailable = state.focus_available;
  setSession(state.session);
}

function setSession(session) {
  const wasOpen = !!app.session;
  app.session = session;
  if (session) {
    if (!wasOpen || !stream.layout || stream.layout.num_rows !== session.layout.num_rows) {
      stream.setLayout(session.layout);
      workspace.boardChanged();
    }
    $("start").hidden = true;
    $("workspace").hidden = false;
    $("toolbar").hidden = false;
    $("session-info").hidden = false;
    $("btn-hardware").hidden = !["cyton", "ganglion"].includes(session.family);
  } else {
    $("start").hidden = false;
    $("workspace").hidden = true;
    $("toolbar").hidden = true;
    $("session-info").hidden = true;
    stream.layout = null;
    if (!app.sources.length) loadSources();
  }
  renderStreamButton();
  renderPills();
}

// ------------------------------------------------------------------ console

function addLog(text) {
  const line = `${new Date().toLocaleTimeString()}  ${text}`;
  app.log.push(line);
  app.log = app.log.slice(-300);
  $("console-last").textContent = text;
  $("console-text").textContent = app.log.join("\n");
  $("console-text").scrollTop = 1e9;
}
app.addLog = addLog;
$("console-toggle").onclick = () => {
  const p = $("console-panel");
  p.hidden = !p.hidden;
  $("console-toggle").setAttribute("aria-expanded", String(!p.hidden));
};

// ------------------------------------------------------------------ start screen

const ICONS = { cyton: "C", ganglion: "G", synthetic: "SY", playback: "▶", streaming: "BF" };
const GROUPS = [
  ["Cyton", (s) => s.family === "cyton"],
  ["Ganglion", (s) => s.family === "ganglion"],
  ["Without hardware", (s) => !["cyton", "ganglion"].includes(s.family)],
];

async function loadSources() {
  try {
    app.sources = await api.sources();
  } catch (e) {
    toast(e.message, true);
    return;
  }
  const saved = localStorage.getItem("brainbench.source");
  app.selected = app.sources.find((s) => s.key === saved) || app.sources.find((s) => s.key === "synthetic") || app.sources[0];
  renderSources();
  renderConnect();
}

function renderSources() {
  const list = $("source-list");
  list.replaceChildren();
  for (const [title, test] of GROUPS) {
    const items = app.sources.filter(test);
    if (!items.length) continue;
    list.append(h("div.source-group", {}, title));
    for (const s of items) {
      list.append(h(`button.source${s === app.selected ? ".selected" : ""}`, {
        type: "button", "data-key": s.key,
        onclick: () => { app.selected = s; localStorage.setItem("brainbench.source", s.key); renderSources(); renderConnect(); },
      },
      h("span.ico", {}, ICONS[s.family] || "•"),
      h("span", {}, h("b", {}, s.label), h("small", {}, s.note)),
      h("span.rate", {}, s.channels ? `${s.channels} ch · ${s.sampling_rate} Hz` : "")));
    }
  }
}

async function renderConnect() {
  const s = app.selected;
  $("connect-title").textContent = s.label;
  $("connect-error").hidden = true;
  const box = $("connect-fields");
  box.replaceChildren();
  const remembered = JSON.parse(localStorage.getItem(`brainbench.opts.${s.key}`) || "{}");
  const input = (name, label, placeholder, value = "") =>
    h("label.field", {}, label, h("input", { name, placeholder, value: remembered[name] ?? value, autocomplete: "off" }));

  if (s.fields.includes("serial_port")) {
    const sel = h("select", { name: "serial_port" });
    const refresh = async () => {
      app.ports = await api.ports().catch(() => []);
      sel.replaceChildren(...(app.ports.length
        ? app.ports.map((p) => h("option", { value: p.device, selected: p.device === remembered.serial_port || undefined }, `${p.device}${p.likely ? "  · OpenBCI dongle?" : ""}`))
        : [h("option", { value: "" }, "No serial ports found")]));
    };
    box.append(h("label.field", {}, s.family === "ganglion" ? "BLED112 dongle port" : "Dongle port",
      h("div.inline", {}, sel, h("button.small", { type: "button", onclick: refresh }, "Refresh"))));
    await refresh();
  }
  if (s.fields.includes("mac_address")) box.append(input("mac_address", "Ganglion MAC address (optional)", "found automatically if empty"));
  if (s.fields.includes("ip_address")) {
    box.append(h("div.field-row", {},
      input("ip_address", s.key === "streaming" ? "Multicast address" : "WiFi Shield IP address", s.key === "streaming" ? "225.1.1.1" : "192.168.4.1", s.key === "streaming" ? "225.1.1.1" : "192.168.4.1"),
      input("ip_port", "Port", "6677", s.key === "streaming" ? "6677" : "6677")));
  }
  if (s.connection === "wifi") {
    box.append(h("label.field", {}, "Sample rate",
      h("select", { name: "sample_rate" }, (s.family === "ganglion" ? [200, 400, 800, 1600] : [250, 500, 1000])
        .map((r) => h("option", { value: r, selected: r === (s.family === "ganglion" ? 1600 : 1000) || undefined }, `${r} Hz`)))));
  }
  if (s.fields.includes("master_board")) {
    box.append(h("label.field", {}, "Board that produced the stream",
      h("select", { name: "master_board" }, [["0", "Cyton"], ["2", "Cyton + Daisy"], ["1", "Ganglion"], ["-1", "Synthetic"]].map(([v, l]) => h("option", { value: v }, l)))));
  }
  if (s.fields.includes("file")) {
    const recent = await api.recordings().catch(() => []);
    const field = input("file", "Recording file", "/path/to/OpenBCI-RAW-....txt or .csv");
    box.append(field);
    if (recent.length) {
      box.append(h("div.field", {}, "Recent recordings"),
        h("div.recent", {}, recent.slice(0, 12).map((r) => h("button", { type: "button", onclick: () => { field.querySelector("input").value = r.path; } },
          h("span", {}, r.name), h("small", {}, `${r.channels ?? "?"} ch · ${r.duration ?? "?"}`)))));
    }
  }
  if (s.key === "synthetic") {
    box.append(h("label.field", {}, "Channels", h("select", { name: "channels" }, [4, 8, 16].map((n) => h("option", { value: n, selected: n === Number(remembered.channels || 8) || undefined }, `${n} channels`)))));
  }
  if (s.key === "cyton" || s.key === "cyton_daisy") {
    box.append(h("label.field", {}, "Also write to the board's SD card",
      h("select", { name: "sd_mode" }, [["", "No"], ["A", "5 minutes"], ["S", "15 minutes"], ["F", "30 minutes"], ["G", "1 hour"], ["H", "2 hours"], ["J", "4 hours"], ["K", "12 hours"], ["L", "24 hours"]]
        .map(([v, l]) => h("option", { value: v, selected: v === (remembered.sd_mode || "") || undefined }, l)))));
    if (!demo) box.append(h("details.radio", {}, h("summary", {}, "Radio tools (board not found?)"), radioTools(box)));
  }
  if (["cyton", "ganglion", "synthetic"].includes(s.family) && !demo) {
    box.append(h("label.check", { style: { marginBottom: "10px" } }, h("input", { type: "checkbox", name: "brainflow_streamer", checked: remembered.brainflow_streamer || undefined }), "Also stream to other BrainFlow programs (multicast 225.1.1.1:6677)"));
  }
  if (s.connection === "none" && !s.fields.length) {
    box.append(h("p.hint", { style: { marginTop: 0 } }, demo
      ? "Simulated in this page: background EEG with an occipital alpha rhythm, 60 Hz mains pick-up, eye blinks, muscle bursts, an accelerometer, a pulse sensor in analog mode and lead-off currents for impedance checks."
      : "BrainFlow's synthetic board: 16 channels of sine waves and noise, with accelerometer data. Useful to try the interface without hardware."));
  }
  const fmt = $("record-format"), auto = $("auto-record");
  fmt.value = localStorage.getItem("brainbench.recformat") || "openbci_csv";
  auto.checked = localStorage.getItem("brainbench.autorec") !== "false";
  $("record-hint").textContent = demo
    ? "In the demo, recordings download as a file when they stop."
    : "Files are saved in Documents/BrainBench/Recordings, one folder per session.";
  if (demo) [...fmt.options].forEach((o) => { o.disabled = !["openbci_csv", "off"].includes(o.value); });
}

$("connect-form").onsubmit = async (e) => {
  e.preventDefault();
  const s = app.selected;
  const form = new FormData($("connect-form"));
  const options = {};
  for (const name of ["serial_port", "mac_address", "ip_address", "ip_port", "sample_rate", "file", "master_board", "channels", "sd_mode"]) {
    const v = form.get(name);
    if (v !== null && v !== "") options[name] = v;
  }
  if (form.get("brainflow_streamer")) options.brainflow_streamer = true;
  localStorage.setItem(`brainbench.opts.${s.key}`, JSON.stringify(options));
  localStorage.setItem("brainbench.recformat", $("record-format").value);
  localStorage.setItem("brainbench.autorec", String($("auto-record").checked));
  const btn = $("btn-connect");
  btn.disabled = true;
  btn.textContent = s.connection === "none" ? "Starting…" : "Connecting…";
  try {
    const state = await api.startSession({
      source: s.key, options,
      recording: { format: $("record-format").value, auto: $("auto-record").checked && $("record-format").value !== "off", name: $("session-name").value.trim(), max_minutes: Number($("max-minutes").value) },
    });
    applyState(state);
  } catch (err) {
    $("connect-error").textContent = err.message;
    $("connect-error").hidden = false;
  } finally {
    btn.disabled = false;
    btn.textContent = "Start session";
  }
};

/** The Cyton dongle's radio: status, channel, auto-scan (before a session is open). */
function radioTools(box) {
  const out = h("p.hint", {}, "If the board is on but not found, the dongle and board may be on different radio channels.");
  const ch = h("select", {}, Array.from({ length: 25 }, (_, i) => h("option", { value: i + 1 }, `Channel ${i + 1}`)));
  const run = async (action, extra = {}) => {
    const port = box.querySelector('select[name="serial_port"]')?.value;
    out.textContent = "Working…";
    try {
      const r = await api.call("POST", "/api/radio", { action, port, ...extra });
      out.textContent = r.reply + (r.channel ? ` (channel ${r.channel})` : "");
    } catch (e) { out.textContent = e.message; }
  };
  return h("div", { style: { padding: "8px 0 4px" } },
    h("div.inline", { style: { flexWrap: "wrap" } },
      h("button.small", { type: "button", onclick: () => run("status") }, "System status"),
      h("button.small", { type: "button", onclick: () => run("get") }, "Get channel"),
      h("button.small", { type: "button", onclick: () => run("scan") }, "Auto-scan"),
      ch,
      h("button.small", { type: "button", onclick: () => run("set", { channel: +ch.value }) }, "Change channel"),
      h("button.small", { type: "button", title: "Changes only the dongle's channel", onclick: () => run("override", { channel: +ch.value }) }, "Override dongle")),
    out);
}

// ------------------------------------------------------------------ toolbar

function renderStreamButton() {
  const on = !!app.session?.streaming;
  const b = $("btn-stream");
  b.classList.toggle("running", on);
  b.querySelector("span").textContent = on ? "Stop stream" : "Start stream";
  $("btn-record").classList.toggle("on", !!app.recording?.active);
  $("btn-record").textContent = app.recording?.active ? "Stop recording" : "Record";
  $("filter-summary").textContent = stream.describeFilters();
}

function renderPills() {
  const s = app.session;
  if (!s) return;
  $("pill-board").textContent = s.label;
  $("pill-rate").textContent = `${s.layout.eeg.length} ch · ${s.layout.sampling_rate} Hz${s.board_mode && s.board_mode !== "default" ? ` · ${s.board_mode} mode` : ""}`;
  const pk = s.packets || { percent: 0, lost: 0 };
  const pkPill = $("pill-packets");
  pkPill.textContent = `Packet loss ${pk.percent.toFixed(pk.percent < 1 ? 2 : 1)} %`;
  pkPill.className = `pill ${pk.percent > 5 ? "bad" : pk.percent > 1 ? "warn" : ""}`;
  const rec = app.recording;
  $("pill-rec").hidden = !rec?.active;
  if (rec?.active) $("pill-rec").textContent = `REC ${clock(Date.now() / 1000 - (rec.started_at || Date.now() / 1000))}`;
  renderStreamButton();
}
setInterval(renderPills, 1000);

async function toggleStream() {
  if (!app.session) return;
  try {
    const on = !app.session.streaming;
    if (on) stream.clear();
    applyState(await api.stream(on));
  } catch (e) { toast(e.message, true); }
}
$("btn-stream").onclick = toggleStream;

$("btn-record").onclick = async () => {
  try {
    const on = !app.recording?.active;
    const fmt = localStorage.getItem("brainbench.recformat") || "openbci_csv";
    applyState(await api.record(on, fmt === "off" ? "openbci_csv" : fmt));
  } catch (e) { toast(e.message, true); }
};

$("btn-end").onclick = async () => {
  if (app.recording?.active && !confirm("A recording is running. End the session and save it?")) return;
  try { applyState(await api.endSession()); } catch (e) { toast(e.message, true); }
};

$("btn-filters").onclick = () => openFilters(app, () => { renderStreamButton(); workspace.save(); });
$("btn-hardware").onclick = () => openHardware(app);
$("btn-layout").onclick = () => workspace.chooseLayout();
$("btn-settings").onclick = () => openSettings();

// ------------------------------------------------------------------ settings files

const currentSettings = () => ({ layout: workspace.layoutKey, panels: workspace.panelState(), filters: stream.filters });
function applySettings(data) {
  if (data.filters) { stream.setFilters({ ...DEFAULT_FILTERS, ...data.filters }); localStorage.setItem("brainbench.filters", JSON.stringify(stream.filters)); renderStreamButton(); }
  if (data.layout) workspace.restore(data.layout, data.panels);
}

async function openSettings() {
  const current = currentSettings;
  let list = [];
  try { list = await api.listSettings(); } catch { /* none yet */ }
  await dialog({
    title: "Interface settings",
    intro: "Saves the layout, each panel's widget and options, and the filters. Channel and board settings are part of the hardware, not of this file.",
    build: (body, close) => {
      const name = h("input", { placeholder: "settings name", value: "default" });
      body.append(
        h("div.field-row", {}, h("label.field", {}, "Save as", name),
          h("div.field", { style: { justifyContent: "flex-end", flex: "none" } }, h("button.primary", {
            type: "button",
            onclick: async () => {
              try { const r = await api.saveSettings(name.value || "default", current()); toast(`Saved ${r.saved}`); close(); }
              catch (e) { toast(e.message, true); }
            },
          }, "Save"))),
        h("label.check", { style: { margin: "4px 0 14px" } }, h("input", { type: "checkbox", checked: app.expert || undefined, onchange: (e) => { app.expert = e.target.checked; localStorage.setItem("brainbench.expert", String(app.expert)); } }),
          "Expert mode: keys 1–8 and ! @ # $ … switch channels off and on, n and N save and load the User settings, ? prints the Cyton's registers, [ and ] the board's square-wave test signal"),
        h("div.field", {}, "Load"),
        list.length ? h("div.recent", {}, list.map((s) => h("button", {
          type: "button",
          onclick: async () => {
            try {
              applySettings(await api.loadSettings(s.name));
              toast(`Loaded ${s.name}`);
              close();
            } catch (e) { toast(e.message, true); }
          },
        }, h("span", {}, s.name), h("small", {}, s.modified ? new Date(s.modified * 1000).toLocaleString() : "")))) : h("p.hint", {}, "No saved settings yet."),
      );
    },
    actions: [{ label: "Close" }],
  });
}

// ------------------------------------------------------------------ keyboard
//   Space        start or stop the stream
//   z x c v      markers 1-4, Z X C V markers 5-8
//   f, l         filters, layout
//   Expert mode (Settings), as in the OpenBCI GUI: 1-8 / ! @ # $ % ^ & * switch
//   channels 1-8 off / on, q-i / Q-I channels 9-16, n / N save and load the
//   "User" settings, ? prints the Cyton's registers, [ and ] the square wave.

const MARKER_KEYS = { z: 1, x: 2, c: 3, v: 4, Z: 5, X: 6, C: 7, V: 8 };
const OFF_KEYS = "12345678qwertyui", ON_KEYS = "!@#$%^&*QWERTYUI";
app.expert = localStorage.getItem("brainbench.expert") === "true";

document.addEventListener("keydown", async (e) => {
  if (e.target.matches?.("input, select, textarea") || !$("overlay").hidden || e.metaKey || e.ctrlKey || e.altKey) return;
  if (!app.session) return;
  if (e.code === "Space") { e.preventDefault(); toggleStream(); return; }
  if (e.key === "f") { $("btn-filters").click(); return; }
  if (e.key === "l") { $("btn-layout").click(); return; }
  if (e.key in MARKER_KEYS && !(app.expert && ON_KEYS.includes(e.key))) {
    if (app.session.streaming) api.marker(MARKER_KEYS[e.key]).catch((err) => addLog(err.message));
    return;
  }
  if (!app.expert) return;
  const off = OFF_KEYS.indexOf(e.key), on = ON_KEYS.indexOf(e.key);
  const ch = off >= 0 ? off : on;
  if (ch >= 0 && ch < app.session.channels.length) {
    try { const d = await api.setChannel(ch, { active: on >= 0 }); app.session.channels = d.channels; addLog(`Channel ${ch + 1} ${on >= 0 ? "on" : "off"}`); } catch (err) { addLog(err.message); }
  } else if (e.key === "[" || e.key === "]") {
    // The boards' synthetic square wave, as in the OpenBCI GUI's expert mode.
    api.command(e.key).then(() => addLog(`Sent ${e.key} to the board`), (err) => addLog(err.message));
  } else if (e.key === "n") {
    api.saveSettings("User", currentSettings()).then(() => toast("Saved the User settings; N loads them"), (err) => toast(err.message, true));
  } else if (e.key === "N") {
    api.loadSettings("User").then((d) => { applySettings(d); toast("Loaded the User settings"); }, () => toast("No User settings yet; n saves them", true));
  } else if (e.key === "?" && app.session.family === "cyton") {
    api.command("?").then((r) => addLog(r.reply || "Registers requested"), (err) => addLog(err.message));
  }
});

$("btn-help").onclick = () => dialog({
  title: "Help",
  intro: "BrainBench works with every OpenBCI board through BrainFlow. The guides cover connecting, impedance and streaming to other programs.",
  build: (body) => {
    const link = (href, label, note) => h("li", {}, h("a", { href, target: "_blank", rel: "noopener" }, label), note ? h("span.hint", {}, `  ${note}`) : null);
    const repo = "https://github.com/abrilcode/brainbench/blob/main/docs";
    body.append(
      h("ul", { style: { margin: "0 0 14px", paddingLeft: "18px", lineHeight: "1.9" } },
        link(`${repo}/getting-started.md`, "Getting started", "install, connect a board, first recording"),
        link(`${repo}/hardware.md`, "Boards and electrodes", "Cyton, Daisy, Ganglion, WiFi Shield, impedance"),
        link(`${repo}/networking.md`, "Streaming to other programs", "UDP, LSL, OSC and serial formats"),
        link(`${repo}/file-formats.md`, "File formats", "OpenBCI CSV, BDF+, BrainFlow CSV"),
        link(`${repo}/parity.md`, "Feature list", "what each OpenBCI GUI feature maps to"),
        link("https://github.com/abrilcode/brainbench/issues", "Report a problem")),
      h("table.data", {}, h("tbody", {},
        [["Space", "Start or stop the stream"], ["z x c v · Z X C V", "Insert markers 1–4 · 5–8"], ["f · l", "Filters · layout"], ["Expert mode: 1–8, ! @ # $ % ^ & *", "Channels 1–8 off, on"],
          ["Expert mode: q–i, Q–I", "Channels 9–16 off, on"], ["Expert mode: n · N", "Save · load the User settings"],
          ["Expert mode: ?", "Print the Cyton's registers to the console"], ["Expert mode: [ ]", "The board's square-wave test signal"]]
          .map(([k, v]) => h("tr", {}, h("td", { style: { fontFamily: "var(--mono)" } }, k), h("td", {}, v))))),
    );
  },
  actions: [{ label: "Close" }],
});

window.addEventListener("brainbench:state", (e) => applyState(e.detail));

// ------------------------------------------------------------------ boot

if (demo) $("pill-demo").hidden = false;
const savedFilters = JSON.parse(localStorage.getItem("brainbench.filters") || "null");
if (savedFilters) stream.filters = { ...DEFAULT_FILTERS, ...savedFilters };
api.connect();
export { LAYOUTS };
