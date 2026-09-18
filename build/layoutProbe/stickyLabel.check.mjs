/**
 * Does the task name actually stay on screen when its box starts off the left?
 *
 * The unit tests in `src/domain/stickyLabel.test.ts` pin the arithmetic. They
 * cannot see whether the answer reaches the screen: the label is translated
 * inside a box that sets `overflow: hidden`, inside a `scale()` wrapper, in a
 * flex row whose layout box does NOT move when its paint does. Every one of
 * those could clip or misplace it with the maths perfectly correct, and jsdom
 * has no layout engine to notice.
 *
 * So this walks a long task across a real headless Chrome and, at each
 * position, asks where the name was actually painted.
 */
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIST = path.join(ROOT, ".probe-dist");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

/** Must match `STICKY_LABEL_RESERVE_PX` in CanvasView. Below this much box
 * still on screen there is nowhere to put a name, and the label deliberately
 * leaves with the box rather than being crushed. */
const RESERVE = 120;

execFileSync("npx", ["vite", "build", "-c", path.join(import.meta.dirname, "vite.probe.config.ts")], { stdio: "inherit", cwd: ROOT });

const server = createServer(async (req, res) => {
  const rel = (req.url ?? "/").split("?")[0].replace(/^\//, "") || "probe.html";
  try {
    const body = await readFile(path.join(DIST, rel));
    res.writeHead(200, { "content-type": TYPES[path.extname(rel)] ?? "application/octet-stream", "cache-control": "no-store" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/build/layoutProbe/probe.html?t=${Date.now()}`;

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-sandbox", "--hide-scrollbars",
  "--remote-debugging-port=0", `--user-data-dir=${path.join(ROOT, ".probe-chrome-sticky")}`, url,
]);
process.on("exit", () => chrome.kill());
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(1));

const PORT = await new Promise((resolve, reject) => {
  let buf = "";
  const timer = setTimeout(() => reject(new Error("no debugging port")), 30000);
  chrome.stderr.on("data", (d) => {
    buf += d;
    const m = buf.match(/ws:\/\/127\.0\.0\.1:(\d+)\//);
    if (m) { clearTimeout(timer); resolve(Number(m[1])); }
  });
});

let page;
for (let i = 0; i < 60 && !page; i++) {
  try {
    const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
    page = list.find((t) => t.type === "page" && t.url === url);
  } catch { /* not up yet */ }
  if (!page) await new Promise((r) => setTimeout(r, 250));
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 1;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  const p = pending.get(m.id);
  if (!p) return;
  pending.delete(m.id);
  if (m.error) p.reject(new Error(JSON.stringify(m.error))); else p.resolve(m.result);
};
const send = (method, params) => new Promise((resolve, reject) => {
  const id = nextId++; pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async (e) => (await send("Runtime.evaluate", { expression: e, returnByValue: true, awaitPromise: true })).result.value;

const WIDTH = 1200;
await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: 800, deviceScaleFactor: 1, mobile: false });
for (let i = 0; i < 80; i++) {
  if (await evaluate("!!window.__probe && window.__probe.ready")) break;
  await new Promise((r) => setTimeout(r, 250));
}
await evaluate(`window.__probe.show("stickyLabel", "en", "Q3")`);
await evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");

/** The painted geometry of the box and of its name, in viewport coordinates. */
const READ = `(() => {
  const label = [...document.querySelectorAll("span")].find((n) => n.textContent === "PROBE-LABEL");
  if (!label) return { missing: true };
  const box = label.closest("[data-task-box]") ?? label.parentElement.parentElement.parentElement;
  const l = label.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  return { labelLeft: Math.round(l.left), labelRight: Math.round(l.right), labelWidth: Math.round(l.width),
           boxLeft: Math.round(b.left), boxRight: Math.round(b.right) };
})()`;

let failed = 0;
const assert = (cond, msg) => (cond ? console.log("  ✓", msg) : (failed++, console.error("  ✗", msg)));

console.log(`\nA long task panned across a ${WIDTH}px viewport\n`);
console.log("  offset   box left   label left   label width");
console.log("  " + "-".repeat(46));

// Derived from the box the scene actually drew, not hardcoded: the width
// depends on density and zoom, and a fixed offset list silently stops covering
// the interesting positions the moment either changes. The first run of this
// check asserted a name should be visible at an offset where the whole box had
// long since left the screen.
await evaluate("window.__pan(0)");
await evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
const first = await evaluate(READ);
const BOX_W = first.boxRight - first.boxLeft;
console.log(`  (the probe task is ${BOX_W}px wide at this density)\n`);

const OFFSETS = [
  0,                    // at rest
  -50,                  // just crossed
  -Math.round(BOX_W / 2),
  -(BOX_W - 600),       // most of the way out, plenty of room left
  -(BOX_W - RESERVE),   // the exact point the label stops travelling
  -(BOX_W - 40),        // past it: a sliver too narrow to hold a name
  -(BOX_W + 200),       // gone entirely
];

const rows = [];
for (const offset of OFFSETS) {
  await evaluate(`window.__pan(${offset})`);
  await evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
  const m = await evaluate(READ);
  if (m.missing) { console.error(`  offset ${offset}: the label is not in the document at all`); failed++; continue; }
  rows.push({ offset, ...m });
  console.log(`  ${String(offset).padStart(6)}   ${String(m.boxLeft).padStart(8)}   ${String(m.labelLeft).padStart(10)}   ${String(m.labelWidth).padStart(11)}`);
}

console.log("");
// The point of the feature, stated as the condition it actually claims: while
// there is room on screen for a name, the name is on screen. Once the box is
// down to a sliver it leaves with the box, which is the documented trade — so
// asserting visibility there would be asserting something untrue and would have
// to be "fixed" by squeezing the name into 40px of box.
const readable = rows.filter((r) => r.boxRight >= RESERVE);
assert(readable.length >= 4, `the run covers enough positions with room for a name (${readable.length})`);
for (const r of readable) {
  assert(r.labelLeft >= -1, `offset ${r.offset}: the name is on screen (left ${r.labelLeft})`);
  assert(r.labelWidth > 40, `offset ${r.offset}: the name has real width (${r.labelWidth}px)`);
}

// And the far side: a box that has left entirely takes its name with it. If
// this ever passes something on screen, the label has escaped its box.
for (const r of rows.filter((x) => x.boxRight < 0)) {
  assert(r.labelRight <= 0, `offset ${r.offset}: a box that is gone leaves nothing behind`);
}
// It must stay inside its own box, or it is floating over the neighbouring one.
for (const r of rows) {
  assert(r.labelLeft >= r.boxLeft - 1 && r.labelRight <= r.boxRight + 1,
    `offset ${r.offset}: the name is inside its box`);
}
// And the control: with the box on screen, nothing has moved. If this fails the
// effect is firing when it should not, and every ordinary task is affected.
const rest = rows.find((r) => r.offset === 0);
assert(rest && rest.labelLeft > rest.boxLeft && rest.labelLeft - rest.boxLeft < 60,
  "offset 0: an unscrolled box draws its name at its own left edge, as before");

ws.close();
chrome.kill();
server.close();
console.log(failed ? `\n${failed} check(s) FAILED\n` : "\nThe name stays on screen and inside its box at every offset.\n");
process.exit(failed ? 1 : 0);
