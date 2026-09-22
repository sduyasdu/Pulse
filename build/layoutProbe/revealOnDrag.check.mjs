/**
 * Does the canvas follow a task to wherever a repack put it?
 *
 * `revealScrollDelta` is unit-tested, but the thing that broke was never the
 * arithmetic — it was that nothing called it after a drag, and that a rect read
 * mid-transition is a position the box is only passing through. Neither is
 * visible without a layout engine and a real settle animation (its duration
 * is `--canvas-settle-ms`).
 *
 * So this performs an actual drag in a real headless Chrome and asks, when
 * everything has stopped, whether the task is still on screen.
 */
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIST = path.join(ROOT, ".probe-dist");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };


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
  "--remote-debugging-port=0", `--user-data-dir=${path.join(ROOT, ".probe-chrome-reveal")}`, url,
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
const HEIGHT = 420;
await send("Input.enable", {}).catch(() => {});
await send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
for (let i = 0; i < 80; i++) {
  if (await evaluate("!!window.__probe && window.__probe.ready")) break;
  await new Promise((r) => setTimeout(r, 250));
}
await evaluate(`window.__probe.show("reveal", "en", "Q3")`);
await evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
const settle = () => evaluate("new Promise(r => setTimeout(r, 700))");
await settle();

let failed = 0;
const assert = (cond, msg) => (cond ? console.log("  ✓", msg) : (failed++, console.error("  ✗", msg)));

/** Where a task box and its scroller are, in viewport coordinates. */
const geom = (id) => evaluate(`(() => {
  const el = document.querySelector('[data-feature-id="${id}"]');
  if (!el) return { missing: true };
  const cont = el.closest('[class*="overflow"]') ?? el.parentElement.closest('div');
  const scroller = (() => { let n = el.parentElement; while (n) { if (n.scrollHeight > n.clientHeight + 4) return n; n = n.parentElement; } return cont; })();
  const b = el.getBoundingClientRect(), c = scroller.getBoundingClientRect();
  return { top: Math.round(b.top), bottom: Math.round(b.bottom),
           left: Math.round(b.left), right: Math.round(b.right),
           viewTop: Math.round(c.top), viewBottom: Math.round(c.bottom),
           scrollTop: Math.round(scroller.scrollTop) };
})()`);

const drag = async (from, to) => {
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: from.x, y: from.y, button: "left", clickCount: 1, buttons: 1 });
  for (let i = 1; i <= 8; i++) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", button: "left", buttons: 1,
      x: Math.round(from.x + ((to.x - from.x) * i) / 8), y: Math.round(from.y + ((to.y - from.y) * i) / 8) });
    await evaluate("new Promise(r => requestAnimationFrame(r))");
  }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: to.x, y: to.y, button: "left", buttons: 0 });
};

console.log(`\nA drag that repacks the layout, in a ${WIDTH}x${HEIGHT} window\n`);

// A task in the LAST epic band, which sits far down the canvas.
const TARGET = "t4-0";
await evaluate(`(() => { const s = document.querySelector('[data-feature-id="${TARGET}"]'); s && s.scrollIntoView({ block: "center" }); })()`);
await settle();

// Does the settle transition actually resolve? `var()` inside the `transition`
// shorthand is legal but easy to get wrong, and a transition that fails to
// parse is simply absent — the box jumps, and nothing reports anything.
const css = await evaluate(`(() => {
  const el = document.querySelector('[data-feature-id="${TARGET}"]');
  const cs = getComputedStyle(el);
  return { cls: el.className, dur: cs.transitionDuration, prop: cs.transitionProperty,
           varValue: getComputedStyle(document.documentElement).getPropertyValue("--canvas-settle-ms").trim() };
})()`);
console.log(`  --canvas-settle-ms = "${css.varValue}"; box class "${css.cls}" -> ${css.prop} ${css.dur}`);

const before = await geom(TARGET);
if (before.missing) { console.error("  ✗ the probe task never rendered"); process.exit(1); }
console.log(`  before: top ${before.top}, view ${before.viewTop}–${before.viewBottom}, scrollTop ${before.scrollTop}`);
assert(before.top >= before.viewTop - 2 && before.bottom <= before.viewBottom + 2,
  "the task starts fully on screen, so the check begins from a fair state");

// Grab its middle and drag it far to the right: in compact mode the drag is
// x-only, so this changes which tasks it overlaps and therefore its lane.
// Grab the box's own middle. A hardcoded x silently missed it entirely on the
// first run, and the check still "passed" — nothing had moved, so nothing had
// gone off screen.
const midY = Math.round((before.top + before.bottom) / 2);
const midX = Math.round((before.left + before.right) / 2);
console.log(`  grabbing at ${midX},${midY} (box spans ${before.left}-${before.right})`);
await drag({ x: midX, y: midY }, { x: midX + 420, y: midY });
// Sample every frame through the release, so we can see whether the box GLIDES
// to its new lane or jumps there. A jump is the other half of "the task
// disappears": it is gone from where you were looking with nothing to follow.
const trace = await evaluate(`(() => new Promise((done) => {
  const el = document.querySelector('[data-feature-id="${TARGET}"]');
  // CONTENT coordinates, not viewport: the canvas is scrolling at the same
  // time, and a viewport-relative trace credits that movement to the box. It
  // did exactly that — the box was jumping and the trace showed a glide.
  const scroller = (() => { let n = el.parentElement; while (n) { if (n.scrollHeight > n.clientHeight + 4) return n; n = n.parentElement; } return null; })();
  const tops = []; let n = 0;
  const tick = () => {
    tops.push(Math.round(el.getBoundingClientRect().top + (scroller ? scroller.scrollTop : 0)));
    if (n++ < 40) requestAnimationFrame(tick); else done(tops);
  };
  requestAnimationFrame(tick);
}))()`);
const distinct = [...new Set(trace)];
console.log(`  trace: ${distinct.slice(0, 12).join(" -> ")}${distinct.length > 12 ? " ..." : ""}`);
console.log(`  (${distinct.length} distinct positions over ${trace.length} frames)`);

await settle();
await settle();

const after = await geom(TARGET);
console.log(`  after:  top ${after.top}, view ${after.viewTop}–${after.viewBottom}, scrollTop ${after.scrollTop}`);

assert(!after.missing, "the task still exists after the drag");
// The guard on the guard. Without this the check passes whenever the drag
// misses the box, because a task that never moved never goes off screen.
assert(Math.abs(after.left - before.left) > 40,
  `the drag actually moved the task (${before.left} -> ${after.left})`);
assert(after.top >= after.viewTop - 2 && after.bottom <= after.viewBottom + 2,
  "the task is still fully on screen once everything has settled");

// The scroll has to have been NECESSARY, or "still on screen" says nothing:
// a repack that happened to leave the box where it was would pass that on its
// own. This reconstructs where the box would be had the canvas not followed it.
const scrolled = after.scrollTop - before.scrollTop;
const wouldBeTop = after.top + scrolled;
const wouldBeBottom = after.bottom + scrolled;
console.log(`  without the follow it would sit at ${wouldBeTop}–${wouldBeBottom}`);
assert(scrolled !== 0, `the canvas followed the task (scrollTop ${before.scrollTop} -> ${after.scrollTop})`);

// The box has to GLIDE to its new row, not jump there. Measured in content
// coordinates, so the scroll cannot stand in for it. Two positions would mean
// one frame at the start and one at the end — a jump.
assert(distinct.length >= 4, `the task glides to its new row (${distinct.length} distinct positions)`);
assert(wouldBeBottom > after.viewBottom || wouldBeTop < after.viewTop,
  "and it had to: the task would otherwise have been off screen");

ws.close();
chrome.kill();
server.close();
console.log(failed ? `\n${failed} check(s) FAILED\n` : "\nThe canvas keeps the dragged task in view.\n");
process.exit(failed ? 1 : 0);
