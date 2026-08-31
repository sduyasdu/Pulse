/**
 * Run the layout probe in headless Chrome and print what fits.
 *
 * Usage: node build/layoutProbe/measure.mjs
 *
 * Chrome is the only thing here that can lay out a page — `npm test` runs on
 * jsdom, where every `clientWidth` is 0 and an overflow assertion passes
 * against a toolbar three times too wide. See probe.tsx.
 *
 * Exits non-zero when any row overflows, so this can gate a change.
 */
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const DIST = path.resolve(import.meta.dirname, "../../.probe-dist");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

execFileSync("npx", ["vite", "build", "-c", path.resolve(import.meta.dirname, "vite.probe.config.ts")], {
  stdio: "inherit",
  cwd: path.resolve(import.meta.dirname, "../.."),
});

const server = createServer(async (req, res) => {
  const rel = (req.url ?? "/").split("?")[0].replace(/^\//, "") || "probe.html";
  try {
    const body = await readFile(path.join(DIST, rel));
    res.writeHead(200, { "content-type": TYPES[path.extname(rel)] ?? "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((r) => server.listen(0, r));
const url = `http://127.0.0.1:${server.address().port}/probe.html`;

// CDP, not --dump-dom. --dump-dom snapshots the document before the module
// script has run — it returns the 330-byte shell every time, which reads
// exactly like a probe that measured nothing rather than one that never
// started. CDP can poll until the layout effect has actually reported.
const PORT = 9333;
const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--hide-scrollbars", // a scrollbar would eat width and skew every number
  `--remote-debugging-port=${PORT}`,
  "--user-data-dir=" + path.resolve(import.meta.dirname, "../../.probe-chrome"),
  url,
]);
chrome.stderr.resume();

/** Chrome needs a moment before the debugging port answers. */
async function targets() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      const page = list.find((t) => t.type === "page" && t.url.includes("probe.html"));
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Chrome's debugging port never answered");
}

const page = await targets();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => {
  ws.onopen = r;
  ws.onerror = j;
});

let nextId = 1;
const pending = new Map();
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  const p = pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
  else p.resolve(msg.result);
};
const send = (method, params) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

/** Poll for the report rather than sleeping a fixed time: fonts and React's
 * mount take an unpredictable moment, and a fixed wait either flakes or is
 * always slower than it needs to be. */
let raw = null;
for (let i = 0; i < 80; i++) {
  const { result } = await send("Runtime.evaluate", {
    expression: `(() => { const el = document.getElementById("report"); return el && el.dataset.done === "1" ? el.textContent : null; })()`,
    returnByValue: true,
  });
  if (result.value) {
    raw = result.value;
    break;
  }
  await new Promise((r) => setTimeout(r, 250));
}
ws.close();
chrome.kill();
server.close();

if (!raw) {
  console.error("probe produced no report — did it fail to mount?");
  process.exit(2);
}
const results = JSON.parse(raw);

// The self-check comes first, and hard. A probe that cannot detect a row it
// KNOWS overflows is not evidence of anything, and its "fits" everywhere reads
// exactly like a clean bill of health.
const control = results.find((r) => r.name === "CONTROL");
if (!control) {
  console.error("probe reported no control row — the self-check did not run");
  process.exit(2);
}
if (control.rows[0].overflow < 1000) {
  console.error(`self-check FAILED: a row overflowing by ~1232px measured as ${control.rows[0].overflow}px.`);
  console.error("The probe is not measuring overflow; ignore any result it prints.");
  process.exit(2);
}
console.log(`\nSelf-check: control row overflows by ${control.rows[0].overflow}px — measurement works.`);

let failures = 0;
console.log("\nPulse toolbar — how far does each row run past its viewport?");
console.log("(· = fits; a number is pixels of content off the right edge)\n");

const langs = [...new Set(results.map((r) => r.lang))].filter((l) => l !== "--");
const names = [...new Set(results.map((r) => r.name))].filter((n) => n !== "CONTROL");
const widths = [...new Set(results.map((r) => r.width))].sort((a, b) => a - b);

console.log("  lang  name      " + widths.map((w) => String(w).padStart(6)).join(""));
console.log("  ----  -------- " + widths.map(() => "------").join(""));
for (const lang of langs) {
  for (const name of names) {
    const cells = widths.map((w) => {
      const r = results.find((x) => x.lang === lang && x.name === name && x.width === w);
      const worst = r ? Math.max(...r.rows.map((row) => row.overflow)) : 0;
      if (worst > 0) failures++;
      return (worst > 0 ? String(worst) : "·").padStart(6);
    });
    console.log(`  ${lang.padEnd(4)}  ${name.padEnd(8)} ${cells.join("")}`);
  }
}

/** The narrowest viewport at which every language and name fits. */
const firstClean = widths.find((w) => results.filter((r) => r.width === w).every((r) => r.rows.every((row) => row.overflow <= 0)));
console.log(
  failures === 0
    ? "\nEverything fits at every probed width.\n"
    : `\n${failures} combination(s) overflow. Narrowest width where all fit: ${firstClean ?? "none probed"}\n`,
);
process.exit(failures === 0 ? 0 : 1);
