// The grid of panels. Each panel shows one widget, chosen from its header,
// with that widget's options next to it. Layouts follow the OpenBCI GUI's.

import { WIDGETS, DEFAULT_PANELS } from "./widgets/index.js";
import { dialog, h, optionSelect } from "./ui.js";

/** Layouts: CSS grid areas, one letter per panel. */
export const LAYOUTS = {
  "1": { label: "One", areas: ["a"] },
  "2c": { label: "Two columns", areas: ["a b"] },
  "2r": { label: "Two rows", areas: ["a", "b"] },
  "3l": { label: "One left, two right", areas: ["a b", "a c"] },
  "3t": { label: "One top, two below", areas: ["a a", "b c"] },
  "3c": { label: "Three columns", areas: ["a b c"] },
  "4": { label: "Four", areas: ["a b", "c d"] },
  "4l": { label: "One left, three right", areas: ["a b", "a c", "a d"] },
  "5": { label: "One left, four right", areas: ["a b c", "a d e"] },
  "6": { label: "Six", areas: ["a b c", "d e f"] },
};
const DEFAULT_LAYOUT = "4l";

export class Workspace {
  constructor(root, app) {
    this.root = root;
    this.app = app;
    const saved = JSON.parse(localStorage.getItem("brainbench.workspace") || "null");
    this.layoutKey = saved?.layout in LAYOUTS ? saved.layout : DEFAULT_LAYOUT;
    this.saved = saved?.panels || null;
    this.panels = [];
    requestAnimationFrame(() => this.loop());
  }

  panelCount() { return new Set(LAYOUTS[this.layoutKey].areas.join(" ").split(" ")).size; }

  /** A new board: rebuild every panel (channel counts and capabilities changed). */
  boardChanged() { this.build(); }

  build() {
    for (const p of this.panels) p.widget?.destroy?.();
    const L = LAYOUTS[this.layoutKey];
    this.root.style.gridTemplateAreas = L.areas.map((r) => `"${r}"`).join(" ");
    const cols = L.areas[0].split(" ").length;
    // The first column is wider when it spans several rows (the time series sits there).
    const spans = L.areas.length > 1 && L.areas.every((r) => r.split(" ")[0] === "a") && cols > 1;
    this.root.style.gridTemplateColumns = spans ? `minmax(0, 1.25fr) ${"minmax(0, 1fr) ".repeat(cols - 1)}` : `repeat(${cols}, minmax(0, 1fr))`;
    this.root.style.gridTemplateRows = `repeat(${L.areas.length}, minmax(0, 1fr))`;
    const letters = [...new Set(L.areas.join(" ").split(" "))];
    const prefs = this.saved || DEFAULT_PANELS;
    this.root.replaceChildren();
    this.panels = letters.map((letter, i) => {
      const pref = prefs[i] || DEFAULT_PANELS[i] || DEFAULT_PANELS.at(-1);
      const panel = { letter, widgetId: pref.widget, options: { ...(pref.options || {}) } };
      panel.el = h("section.panel", { style: { gridArea: letter }, "data-panel": letter });
      this.root.append(panel.el);
      this.mount(panel);
      return panel;
    });
    this.save();
  }

  mount(panel) {
    panel.widget?.destroy?.();
    let W = WIDGETS.find((w) => w.id === panel.widgetId) || WIDGETS[0];
    const reason = W.unavailable?.(this.app);
    const head = h("div.panel-head");
    const body = h("div.panel-body");
    const select = h("select.widget-select", {
      "aria-label": "Widget",
      onchange: (e) => { panel.widgetId = e.target.value; panel.options = {}; this.mount(panel); this.save(); },
    }, WIDGETS.map((w) => h("option", { value: w.id, selected: w === W || undefined }, w.title)));
    head.append(select);
    panel.el.replaceChildren(head, body);
    if (reason) {
      body.append(h("div.panel-note", {}, reason));
      panel.widget = null;
      return;
    }
    const opts = W.options?.(this.app) || [];
    for (const o of opts) if (panel.options[o.key] === undefined) panel.options[o.key] = o.default;
    if (opts.length) {
      head.append(h("div.opts", {}, opts.map((o) => optionSelect(o.label, o.values, panel.options[o.key], (v) => {
        panel.options[o.key] = v;
        panel.widget?.optionChanged?.(o.key, v);
        this.save();
      }))));
    }
    panel.widget = new W(body, this.app, panel.options, head);
    panel.widget.mount?.();
  }

  loop() {
    const now = performance.now();
    if (!this.root.hidden && this.app.stream.layout && now - (this.last || 0) > 1000 / 30) {
      this.last = now;
      for (const p of this.panels) {
        try { p.widget?.draw?.(now); } catch (e) { console.error(p.widgetId, e); }
      }
    }
    requestAnimationFrame(() => this.loop());
  }

  panelState() { return this.panels.map((p) => ({ widget: p.widgetId, options: p.options })); }

  save() {
    this.saved = this.panelState();
    localStorage.setItem("brainbench.workspace", JSON.stringify({ layout: this.layoutKey, panels: this.saved }));
  }

  restore(layout, panels) {
    if (layout in LAYOUTS) this.layoutKey = layout;
    if (panels) this.saved = panels;
    this.build();
  }

  async chooseLayout() {
    const key = await dialog({
      title: "Layout",
      intro: "Each panel keeps its widget when the layout changes, in order. Shortcut: L.",
      build: (body, close) => {
        body.append(h("div.layouts", {}, Object.entries(LAYOUTS).map(([k, L]) => {
          const cols = L.areas[0].split(" ").length;
          const mini = h("div.mini", { style: { gridTemplateAreas: L.areas.map((r) => `"${r}"`).join(" "), gridTemplateColumns: `repeat(${cols}, 1fr)`, gridTemplateRows: `repeat(${L.areas.length}, 1fr)` } },
            [...new Set(L.areas.join(" ").split(" "))].map((a) => h("i", { style: { gridArea: a } })));
          return h(`button.layout-opt${k === this.layoutKey ? ".sel" : ""}`, { type: "button", title: L.label, "data-layout": k, onclick: () => close(k) }, mini);
        })));
      },
      actions: [{ label: "Cancel" }],
    });
    if (key && key !== this.layoutKey) {
      this.saved = this.panelState().concat(this.saved?.slice(this.panels.length) || []);
      this.layoutKey = key;
      this.build();
    }
  }
}
