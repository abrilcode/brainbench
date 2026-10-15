// Hardware settings: ADS1299 channel settings on the Cyton (gain, input,
// bias, SRB2, SRB1, power), channel switches on the Ganglion, and a field
// for raw board commands.

import { dialog, h, toast, put } from "../ui.js";

const GAINS = [1, 2, 4, 6, 8, 12, 24];
const INPUTS = [["normal", "Normal"], ["shorted", "Shorted"], ["bias_meas", "Bias meas."], ["mvdd", "MVDD"], ["temp", "Temperature"], ["test", "Test signal"], ["bias_drp", "Bias DRP"], ["bias_drn", "Bias DRN"]];

export async function openHardware(app) {
  const s = app.session;
  const cyton = s.family === "cyton";
  const draft = s.channels.map((c) => ({ ...c }));
  const changed = new Set();
  const streaming = s.streaming;

  const rowFor = (c, i) => {
    const mark = () => { changed.add(i); tr.classList.add("changed"); };
    const sel = (key, values, conv = (v) => v) => h("select", { onchange: (e) => { c[key] = conv(e.target.value); mark(); } },
      values.map(([v, l]) => h("option", { value: String(v), selected: String(v) === String(c[key]) || undefined }, l)));
    const tr = h("tr", {},
      h("td", {}, `${i + 1}`), h("td", {}, s.layout.names[i] || ""),
      h("td", {}, sel("active", [[true, "Active"], [false, "Inactive"]], (v) => v === "true")),
      cyton ? [
        h("td", {}, sel("gain", GAINS.map((g) => [g, `×${g}`]), Number)),
        h("td", {}, sel("input_type", INPUTS)),
        h("td", {}, sel("bias", [[true, "Yes"], [false, "No"]], (v) => v === "true")),
        h("td", {}, sel("srb2", [[true, "On"], [false, "Off"]], (v) => v === "true")),
        h("td", {}, sel("srb1", [[true, "On"], [false, "Off"]], (v) => v === "true")),
      ] : null);
    return tr;
  };

  await dialog({
    title: cyton ? "Cyton channel settings" : "Ganglion channels",
    intro: cyton
      ? "ADS1299 settings per channel. Only the channels that changed are sent. A channel switched to Inactive is also taken out of the bias and SRB2 and shorted, and gets its settings back when switched on."
      : "Switch Ganglion channels on or off.",
    build: (body) => {
      const tbody = h("tbody", {}, draft.map(rowFor));
      const all = cyton ? h("tr", {}, h("td", { colspan: 2 }, h("b", {}, "All channels")), h("td", {}),
        ...[["gain", GAINS.map((g) => [g, `×${g}`]), Number], ["input_type", INPUTS], ["bias", [[true, "Yes"], [false, "No"]], (v) => v === "true"], ["srb2", [[true, "On"], [false, "Off"]], (v) => v === "true"], ["srb1", [[true, "On"], [false, "Off"]], (v) => v === "true"]]
          .map(([key, values, conv = (v) => v]) => h("td", {}, h("select", {
            onchange: (e) => { draft.forEach((c, i) => { c[key] = conv(e.target.value); changed.add(i); }); tbody.replaceChildren(...draft.map(rowFor)); tbody.querySelectorAll("tr").forEach((tr) => tr.classList.add("changed")); },
          }, h("option", { value: "" }, "—"), values.map(([v, l]) => h("option", { value: String(v) }, l)))))) : null;
      put(body,
        streaming ? h("p.error", { style: { marginTop: 0 } }, "Stop the data stream to send channel settings, as the board expects.") : null,
        h("table.hw-table", {},
          h("thead", {}, h("tr", {}, ["#", "Electrode", "Power", ...(cyton ? ["Gain", "Input", "Bias", "SRB2", "SRB1"] : [])].map((t) => h("th", {}, t)))),
          h("tbody", {}, all), tbody),
        ["cyton", "cyton_daisy"].includes(app.session.source) && app.api.kind !== "demo" ? h("label.check", { style: { marginTop: "14px" } },
          h("input", { type: "checkbox", checked: app.session.smoothing || undefined, onchange: async (e) => {
            try { const d = await app.api.call("POST", "/api/smoothing", { on: e.target.checked }); app.session.smoothing = d.smoothing; toast(d.smoothing ? "Smoothing on" : "Smoothing off"); } catch (err) { toast(err.message, true); }
          } }),
          "Smooth the data flow from the dongle (on by default; the dongle delivers samples in bursts)") : null,
        cyton ? h("div.inline", { style: { marginTop: "12px", gap: "8px" } },
          h("button.small", { type: "button", onclick: () => download(draft) }, "Save to file"),
          h("label.btn-file", {}, h("span.small-btn", {}, "Load from file"), h("input", { type: "file", accept: ".json", hidden: true, onchange: async (e) => {
            try { const data = JSON.parse(await e.target.files[0].text()); data.slice(0, draft.length).forEach((d, i) => { Object.assign(draft[i], d); changed.add(i); }); tbody.replaceChildren(...draft.map(rowFor)); } catch { toast("Not a channel settings file", true); }
          } }))) : null,
        h("div.field-row", { style: { marginTop: "16px" } },
          h("label.field", {}, "Send a raw command to the board (advanced)", h("input", { id: "raw-cmd", placeholder: cyton ? "e.g. ? to print the registers, d for defaults" : "e.g. z, Z, n, N" })),
          h("div.field", { style: { flex: "none", justifyContent: "flex-end" } }, h("button", {
            type: "button", onclick: async () => {
              const v = document.getElementById("raw-cmd").value.trim();
              if (!v) return;
              try { const r = await app.api.command(v); toast(r.reply ? r.reply.slice(0, 200) : `Sent ${v}`); } catch (e) { toast(e.message, true); }
            },
          }, "Send"))),
      );
    },
    actions: [
      { label: "Close" },
      {
        label: "Send changes", primary: true,
        run: async (close) => {
          if (app.session.streaming) return toast("Stop the data stream first.", true);
          try {
            for (const i of [...changed].sort((a, b) => a - b)) {
              const d = await app.api.setChannel(i, draft[i]);
              app.session.channels = d.channels;
            }
            toast(changed.size ? `Sent settings for ${changed.size} channel${changed.size > 1 ? "s" : ""}` : "No changes to send");
            close(true);
          } catch (e) { toast(e.message, true); }
        },
      },
    ],
  });
}

function download(settings) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([JSON.stringify(settings, null, 2)], { type: "application/json" }));
  a.download = `BrainBench-channels-${settings.length}ch.json`;
  a.click();
}
