/**
 * Run the layout probe in headless Chrome and report what does not fit.
 *
 * Usage: npm run test:layout
 *
 * Chrome is the only thing in this project that can lay out a page — the unit
 * tests run on jsdom, where every `clientWidth` is 0 and "it fits" passes
 * against anything. See probe.tsx.
 *
 * Exits non-zero when any scene makes the document wider than the window, so
 * this can gate a change.
 */
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const DIST = path.join(ROOT, ".probe-dist");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

/** The desktop range. Below 768 the app swaps to its mobile views, so those
 * widths never render these scenes. */
const WIDTHS = [768, 900, 1024, 1152, 1280, 1440, 1512, 1680, 1920, 2560];
const LANGS = ["en", "de"]; // English, plus the longest labels
const NAMES = ["short", "typical", "long", "unbroken"];
const NAME_VALUES = {
  short: "Roadmap",
  typical: "Q3 Platform Roadmap",
  long: "Q3 Platform Roadmap — Payments, Billing and Identity",
  unbroken: "Q3-Platform-Roadmap-Payments-Billing-Identity-Migration",
};
const SCENES = ["dashboard", "toolbar"];

execFileSync("npx", ["vite", "build", "-c", path.join(import.meta.dirname, "vite.probe.config.ts")], { stdio: "inherit", cwd: ROOT });

const server = createServer(async (req, res) => {
  const rel = (req.url ?? "/").split("?")[0].replace(/^\//, "") || "probe.html";
  try {
    const body = await readFile(path.join(DIST, rel));
    // `no-store`, or Chrome reuses probe.html and its stylesheet across runs.
    // That is not a slow refresh, it is a wrong answer: the cached HTML points
    // at a content-hashed CSS from an EARLIER build, so the probe measured a
    // stylesheet that no longer exists on disk and reported the current one
    // broken. Cost hours.
    res.writeHead(200, {
      "content-type": TYPES[path.extname(rel)] ?? "application/octet-stream",
      "cache-control": "no-store, must-revalidate",
    });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((r) => server.listen(0, r));
// Vite is rooted at the repo, so the entry keeps its path inside the output.
// Cache-buster as well as the no-store header: belt and braces, because a
// stale page here fails as a confident wrong measurement rather than an error.
const url = `http://127.0.0.1:${server.address().port}/build/layoutProbe/probe.html?t=${Date.now()}`;

// CDP, not --dump-dom: that snapshots the document before the module script has
// run and returns the bare shell every time, which reads exactly like a probe
// that measured nothing rather than one that never started.
const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--hide-scrollbars", // a scrollbar would eat width and skew every number
  // Port 0 = let the OS pick, and read it back from Chrome's own banner.
  //
  // This was a FIXED port, and every `process.exit()` on a failed self-check
  // left its Chrome running. The next run then found the stray on that port and
  // measured ITS page — a document from an earlier build, with an earlier
  // stylesheet. So the harness reported a rule missing that was present on
  // disk, in the bundle and on the live site, and went on reporting it after
  // the caches were cleared and the profile deleted, because the page being
  // measured was never rebuilt. Hours.
  "--remote-debugging-port=0",
  `--user-data-dir=${path.join(ROOT, ".probe-chrome")}`,
  url,
]);
// Every exit path, not just the happy one — see above.
process.on("exit", () => chrome.kill());
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(1));

/** Chrome prints `DevTools listening on ws://127.0.0.1:<port>/...` once up. */
const PORT = await new Promise((resolve, reject) => {
  let buf = "";
  const timer = setTimeout(() => reject(new Error("Chrome never announced a debugging port")), 30000);
  chrome.stderr.on("data", (d) => {
    buf += d;
    const m = buf.match(/ws:\/\/127\.0\.0\.1:(\d+)\//);
    if (m) {
      clearTimeout(timer);
      resolve(Number(m[1]));
    }
  });
});

async function findPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`).then((r) => r.json());
      // Match the EXACT url we launched, cache-buster and all. Matching on
      // "probe.html" alone is what let a stray instance's page be measured.
      const page = list.find((t) => t.type === "page" && t.url === url);
      if (page?.webSocketDebuggerUrl) return page;
    } catch {
      // port not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("Chrome's debugging port never answered");
}

const ws = new WebSocket((await findPage()).webSocketDebuggerUrl);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
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

const evaluate = async (expression) => {
  const { result } = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  return result.value;
};

for (let i = 0; i < 80; i++) {
  if (await evaluate("!!window.__probe && window.__probe.ready")) break;
  await new Promise((r) => setTimeout(r, 250));
}
if (!(await evaluate("!!window.__probe"))) {
  console.error("probe never mounted");
  process.exit(2);
}

async function at(width, fn) {
  await send("Emulation.setDeviceMetricsOverride", { width, height: 900, deviceScaleFactor: 1, mobile: false });
  return fn();
}

/**
 * Self-check 1: are the styles the components rely on actually present?
 *
 * This is not paranoia — it is the failure that already happened. With Vite
 * rooted at the probe directory, Tailwind scanned only that folder and emitted
 * none of the utilities used inside `src/`. `flex-col` was missing, so the
 * toolbar's two rows laid out side by side, and the probe reported ~1900px of
 * overflow that scaled with the viewport and varied by language — indis-
 * tinguishable from a real bug, and I nearly fixed the app because of it.
 *
 * A stylesheet that fails to cover the components under test invalidates every
 * number, so it is checked before any of them are taken.
 */
const flexDirection = await evaluate(`(() => {
  const d = document.createElement('div');
  d.className = 'flex flex-col';
  document.body.appendChild(d);
  const v = getComputedStyle(d).flexDirection;
  d.remove();
  return v;
})()`);
if (flexDirection !== "column") {
  console.error(`self-check FAILED: .flex.flex-col computes flex-direction: ${flexDirection}, expected column.`);
  console.error("Tailwind did not generate the utilities the components use — every measurement would be of an unstyled page.");
  process.exit(2);
}
console.log(`\nSelf-check: Tailwind utilities present (.flex-col → ${flexDirection}).`);

/**
 * Self-check 1b: the app's own CSS, not just Tailwind's.
 *
 * `.canvas-settle` is what makes a repacked canvas glide instead of jump. It is
 * hand-written CSS in index.css, so it fails differently from a Tailwind
 * utility — and it fails SILENTLY, because a missing transition looks exactly
 * like the instant rearrangement it replaced. Nothing else in the suite would
 * notice.
 */
const settleUnder = async (motion) => {
  // Emulated, not inherited. Chrome reports the HOST's accessibility setting by
  // default, so with "Reduce motion" on in macOS the probe read `transition:
  // none` and declared the stylesheet broken — a true reading of the wrong
  // question. Emulating both values also turns one assertion into two: the
  // animation exists, AND it is actually suppressed when asked.
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: motion }] });
  return evaluate(`(() => {
    const d = document.createElement('div');
    d.className = 'canvas-settle';
    document.body.appendChild(d);
    const s = getComputedStyle(d);
    const v = s.transitionProperty + ' / ' + s.transitionDuration;
    d.remove();
    return v;
  })()`);
};

// Poll: `window.__probe.ready` only promises React has mounted and the
// dictionaries have landed, which says nothing about the stylesheet. Reading
// once, immediately, caught the page before the sheet had applied and reported
// the rule missing.
let settle = "";
for (let i = 0; i < 20; i++) {
  settle = await settleUnder("no-preference");
  if (/top/.test(settle)) break;
  await new Promise((r) => setTimeout(r, 250));
}
if (!/top/.test(settle) || /(^|\s)0s/.test(settle.split("/")[1] ?? "")) {
  const why = await evaluate(`(() => {
    const sheets = [...document.styleSheets].map((s) => {
      let n = -1, has = "?";
      try { n = s.cssRules.length; has = [...s.cssRules].some((r) => (r.cssText || "").includes("canvas-settle")); } catch (e) { has = "blocked"; }
      return (s.href || "inline").split("/").pop() + " rules=" + n + " hasRule=" + has;
    });
    const d = document.createElement("div");
    d.className = "canvas-settle";
    document.body.appendChild(d);
    const matched = d.matches(".canvas-settle");
    d.remove();
    return sheets.join(" | ") + " || selectorMatches=" + matched +
      " reduced=" + matchMedia("(prefers-reduced-motion: reduce)").matches;
  })()`);
  console.error(`self-check FAILED: .canvas-settle resolves to "${settle}", expected a transition on top.`);
  console.error(`page state: ${why}`);
  console.error("The canvas repack animation is not in the stylesheet.");
  process.exit(2);
}
const settleReduced = await settleUnder("reduce");
if (/top/.test(settleReduced)) {
  console.error(`self-check FAILED: .canvas-settle is still "${settleReduced}" under prefers-reduced-motion: reduce.`);
  process.exit(2);
}
await send("Emulation.setEmulatedMedia", { features: [] });
console.log(`Self-check: app CSS present (.canvas-settle → ${settle}; reduced → ${settleReduced}).`);

/**
 * Self-check 2. The first version of this probe reported "fits" for everything
 * while measuring nothing at all, and a green run that cannot go red is not
 * evidence. So plant an element that provably cannot fit, confirm the
 * measurement sees it, and remove it.
 */
const control = await at(768, async () => {
  await evaluate(`(() => { const d = document.createElement('div');
    d.id = '__control'; d.style.cssText = 'width:2000px;height:1px'; document.body.appendChild(d); })()`);
  const m = await evaluate("JSON.stringify(window.__probe.measure())");
  await evaluate(`document.getElementById('__control').remove()`);
  return JSON.parse(m);
});
if (control.documentOverflow < 1000) {
  console.error(`self-check FAILED: a 2000px element in a 768px window measured ${control.documentOverflow}px of overflow.`);
  console.error("The probe is not measuring; ignore anything it prints.");
  process.exit(2);
}
console.log(`\nSelf-check: control overflows by ${control.documentOverflow}px — measurement works.`);

const rows = [];
for (const scene of SCENES) {
  for (const lang of LANGS) {
    for (const name of NAMES) {
      for (const width of WIDTHS) {
        const m = await at(width, async () => {
          await evaluate(`window.__probe.show(${JSON.stringify(scene)}, ${JSON.stringify(lang)}, ${JSON.stringify(NAME_VALUES[name])})`);
          // One frame for React to commit and Chrome to lay out.
          await evaluate("new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))");
          return JSON.parse(await evaluate("JSON.stringify(window.__probe.measure())"));
        });
        // The instrument, checked on every single reading. A viewport override
        // that silently stops applying would leave every number here a
        // measurement of some other window — and the shape of the result (a
        // constant overflow that shrinks 1:1 with the requested width) looks
        // enough like a real finding to act on.
        if (m.clientWidth !== width) {
          console.error(`\nviewport override FAILED: asked for ${width}px, page reports ${m.clientWidth}px.`);
          console.error("Every measurement would be against the wrong window; refusing to report.");
          process.exit(2);
        }
        rows.push({ scene, lang, name, width, ...m });
      }
    }
  }
}
ws.close();
chrome.kill();
server.close();

console.log("\nIs the document wider than the window?");
console.log("(· = fits; a number is pixels of page beyond the right edge)\n");
console.log("  scene      lang  name      " + WIDTHS.map((w) => String(w).padStart(6)).join(""));
console.log("  ---------  ----  --------  " + WIDTHS.map(() => "------").join(""));
let failures = 0;
for (const scene of SCENES) {
  for (const lang of LANGS) {
    for (const name of NAMES) {
      const cells = WIDTHS.map((w) => {
        const r = rows.find((x) => x.scene === scene && x.lang === lang && x.name === name && x.width === w);
        if (r && r.documentOverflow > 0) failures++;
        return (r && r.documentOverflow > 0 ? String(r.documentOverflow) : "·").padStart(6);
      });
      console.log(`  ${scene.padEnd(9)}  ${lang.padEnd(4)}  ${name.padEnd(8)}  ${cells.join("")}`);
    }
  }
}

const worst = rows.filter((r) => r.documentOverflow > 0).sort((a, b) => b.documentOverflow - a.documentOverflow)[0];
if (worst) {
  console.log(`\nWidest case: ${worst.scene} / ${worst.lang} / ${worst.name} at ${worst.width}px — ${worst.documentOverflow}px over.`);
  console.log("What is too wide:");
  for (const o of worst.offenders) {
    console.log(`  right=${o.right}  <${o.tag} ${o.cls ? `"${o.cls}"` : ""}> ${o.text ? `"${o.text}"` : ""}`);
    console.log(`            in  ${o.path}`);
  }
}
console.log(failures === 0 ? "\nEvery scene fits its window.\n" : `\n${failures} case(s) overflow.\n`);
process.exit(failures === 0 ? 0 : 1);
