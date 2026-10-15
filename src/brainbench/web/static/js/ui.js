// Small DOM helpers: element builder, dialogs, toasts, dropdowns.

/** h("div.card#id", {attrs}, ...children) */
export function h(tag, attrs = {}, ...children) {
  const [name, ...rest] = tag.split(/(?=[.#])/);
  const el = document.createElement(name || "div");
  for (const part of rest) {
    if (part[0] === ".") el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children.flat()) if (c !== null && c !== undefined && c !== false) el.append(c instanceof Node ? c : String(c));
  return el;
}

export const $ = (id) => document.getElementById(id);

/** A labelled <select> for a widget option. values: [[value, label], ...] */
export function optionSelect(label, values, current, onChange) {
  const sel = h("select", { "aria-label": label, onchange: (e) => onChange(parse(e.target.value)) },
    values.map(([v, l]) => h("option", { value: String(v), selected: String(v) === String(current) || undefined }, l)));
  return h("label.opt", {}, label, sel);
}
const parse = (v) => (v === "true" ? true : v === "false" ? false : v !== "" && !isNaN(v) ? Number(v) : v);

let toastTimer = 0;
export function toast(text, err = false) {
  const el = $("toast");
  el.textContent = text;
  el.classList.toggle("err", err);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), err ? 6000 : 3200);
}

/** Replaces an element's children, skipping null/false like h() does. */
export function put(el, ...children) {
  el.replaceChildren(...children.flat().filter((c) => c !== null && c !== undefined && c !== false));
  return el;
}

/** Opens a dialog. build(body, close) fills it; resolves when closed. */
export function dialog({ title, intro = "", build, actions = [] }) {
  return new Promise((resolve) => {
    const overlay = $("overlay"), box = $("dialog");
    const close = (value) => { overlay.hidden = true; box.replaceChildren(); document.removeEventListener("keydown", esc); resolve(value); };
    const esc = (e) => { if (e.key === "Escape") close(null); };
    const body = h("div.body");
    box.replaceChildren(
      h("header", {}, h("h2", {}, title), intro ? h("p", {}, intro) : null),
      body,
      h("footer", {}, ...actions.map((a) => h(`button${a.primary ? ".primary" : ""}`, { type: "button", onclick: () => (a.run ? a.run(close) : close(a.value)) }, a.label))),
    );
    build?.(body, close);
    overlay.hidden = false;
    overlay.onclick = (e) => { if (e.target === overlay) close(null); };
    document.addEventListener("keydown", esc);
    box.querySelector("select, input, button")?.focus({ preventScroll: true });
  });
}

/** Seconds as h:mm:ss or m:ss. */
export function clock(s) {
  s = Math.max(0, Math.floor(s));
  const hh = Math.floor(s / 3600), mm = Math.floor(s / 60) % 60, ss = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${mm}:${p(ss)}`;
}
