/**
 * Screenshot the probe's scenes.
 *
 * A layout measurement that passes proves nothing on its own: a scene that
 * threw and rendered an empty document also "fits every window". This renders
 * the same scenes and saves PNGs, which is the only way to see that the page
 * drew at all — and the only way to judge whether it looks like anything.
 */
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIST = path.join(ROOT, ".probe-dist");
const OUT = path.join(ROOT, ".probe-shots");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

/** scene, lang, width, height. */
const SHOTS = [
  // The wordmark split: the toolbar sits inside one Beat and must read
  // "Beat"; the dashboard spans all of them and must read "Beats". Nothing
  // else in the suite renders both words, and the difference is one letter.
  ["toolbar", "en", 1280, 200],
  ["dashboard", "en", 1280, 400],
  ["bell", "en", 700, 620],
  ["team", "en", 1000, 1000],
  ["login", "en", 1440, 900],
  ["login", "en", 768, 1000],
  ["login", "en", 390, 1200],
  ["login", "es", 1440, 900],
  ["login", "de", 1440, 900],
  ["login", "fr", 1440, 900],
  ["login", "pt", 1440, 900],
  ["login", "it", 1440, 900],
];

execFileSync("npx", ["vite", "build", "-c", path.join(import.meta.dirname, "vite.probe.config.ts")], { stdio: "inherit", cwd: ROOT });
await mkdir(OUT, { recursive: true });

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
  "--force-device-scale-factor=2", // legible text in the PNG
  "--remote-debugging-port=0", `--user-data-dir=${path.join(ROOT, ".probe-chrome")}`, url,
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
  } catch { /* not up */ }
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

await send("DOM.enable", {});
await send("CSS.enable", {});

for (let i = 0; i < 80; i++) {
  if (await evaluate("!!window.__probe && window.__probe.ready")) break;
  await new Promise((r) => setTimeout(r, 250));
}

for (const [scene, lang, width, height] of SHOTS) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 2, mobile: false });
  await evaluate(`window.__probe.show(${JSON.stringify(scene)}, ${JSON.stringify(lang)}, "Q3 Platform Roadmap")`);
  // The Team panel's interesting state is a row with its settings open, which
  // no static render reaches. Click the first one.
  if (scene === "bell") {
    await evaluate(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    await evaluate(`document.querySelector('[data-bell] button')?.click()`);
    await evaluate(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    // Force :hover rather than moving a mouse — a dispatched pointer event does
    // not set the pseudo-class, so the hover styling would simply not be in the
    // screenshot and the run would look clean.
    const { root } = await send("DOM.getDocument", { depth: -1 });
    const { nodeIds } = await send("DOM.querySelectorAll", { nodeId: root.nodeId, selector: "[data-bell] button" });
    // The message row: the widest text button in the panel.
    for (const nodeId of nodeIds.slice(-2)) {
      await send("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ["hover"] }).catch(() => {});
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  if (scene === "team") {
    await evaluate(`new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))`);
    await evaluate(`(() => {
      // By its own label, not "the first collapsed thing" — that picked the
      // resource-types button, which is a different disclosure entirely.
      const b = document.querySelector('[data-team-panel] [aria-label="Type, limit and rate"]');
      if (b) b.click();
      return !!b;
    })()`);
  }
  // Let the staggered reveal finish, or the illustration is caught mid-fade.
  await new Promise((r) => setTimeout(r, 1400));
  // Proof it actually rendered, not just that the screenshot succeeded.
  const chars = await evaluate("document.body.innerText.replace(/\\\\s+/g,' ').trim().length");
  // How far the page runs past the fold. A marketing page may scroll, but a
  // footer clipped by a few pixels reads as a mistake rather than as more page.
  const over = await evaluate(`document.documentElement.scrollHeight - window.innerHeight`);
  // Lines, measured. A character count predicts wrapping badly — glyph widths
  // differ per language and the headline is set at 2.6rem, where a couple of
  // characters change the answer.
  const lines = await evaluate(`(() => {
    const linesOf = (el) => {
      if (!el) return 0;
      const cs = getComputedStyle(el);
      const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.2;
      return Math.round(el.getBoundingClientRect().height / lh);
    };
    const h = document.querySelector("h2");
    // The punchline is the only element with a left border in the hero.
    const p = [...document.querySelectorAll("p")].find((e) => getComputedStyle(e).borderLeftWidth !== "0px");
    return linesOf(h) + "/" + linesOf(p);
  })()`);
  const { data } = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  const file = path.join(OUT, `${scene}-${lang}-${width}.png`);
  await writeFile(file, Buffer.from(data, "base64"));
  console.log(`${path.basename(file)}  ${chars} chars  ${over > 0 ? `+${over}px below fold` : "fits fold"}  headline/punchline lines: ${lines}`);
}
ws.close(); chrome.kill(); server.close();
process.exit(0);
