/**
 * Timeline bench (plan 2026-11-15, B0/B4). Builds `harness.tsx` with esbuild, opens it in
 * Chromium and prints DOM size and frame times for: open + fit, zooming in, scrolling at a
 * close zoom, and dragging a clip. Run from apps/web:
 *
 *   npx tsx components/editor/timeline/bench/run.mts [minutes=30] [cuts=400]
 */

import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { build } from "esbuild";
import { chromium } from "playwright";

const web = resolve(import.meta.dirname, "../../../..");
const minutes = Number(process.argv[2] ?? 30);
const cuts = Number(process.argv[3] ?? 400);
const out = mkdtempSync(join(tmpdir(), "timeline-bench-"));

await build({
  entryPoints: [join(import.meta.dirname, "harness.tsx")],
  bundle: true,
  format: "esm",
  outfile: join(out, "bench.js"),
  jsx: "automatic",
  alias: { "@": web },
  define: { "process.env.NODE_ENV": '"production"' },
  minify: true,
  logLevel: "error",
});
const css = ["styles/design-system.css", "app/globals.css"]
  .map((file) => readFileSync(join(web, file), "utf8").replace(/^@import[^;]*;/gm, ""))
  .join("\n");
writeFileSync(
  join(out, "index.html"),
  `<!doctype html><html data-theme="dark"><head><meta charset="utf-8"><style>${css}</style></head><body><div id="root"></div><script type="module" src="bench.js"></script></body></html>`,
);

// CHROMIUM_PATH: a pre-installed browser when the pinned Playwright has none of its own.
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
// tsx wraps named functions in `__name(...)`, which also lands in code sent to `page.evaluate`.
await page.addInitScript("window.__name = (fn) => fn;");
page.on("pageerror", (error) => console.error("page error:", error.message));
// Module scripts do not load from file://: serve the two files from a made-up origin.
await page.route("http://bench.local/**", (route) => {
  const file = new URL(route.request().url()).pathname.slice(1) || "index.html";
  if (file !== "index.html" && file !== "bench.js") return route.fulfill({ status: 404, body: "" });
  route.fulfill({ body: readFileSync(join(out, file)), contentType: file.endsWith(".js") ? "text/javascript" : "text/html" });
});
await page.goto(`http://bench.local/index.html?minutes=${minutes}&cuts=${cuts}`);
await page.waitForSelector('[data-testid="timeline"]');
await page.waitForTimeout(500);
// BENCH_SHOT=<file.png>: a picture of the timeline as it opens, to look at.
if (process.env.BENCH_SHOT) await page.screenshot({ path: process.env.BENCH_SHOT });

const result = await page.evaluate(async () => {
  const frames = () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
  const nodes = () => {
    const root = document.querySelector('[data-testid="timeline"]')!;
    const count = (selector: string) => root.querySelectorAll(selector).length;
    return { all: count("*"), ticks: count(".ed2-tick"), words: count(".ed2-word"), bars: count(".ed2-bar") };
  };
  const scroller = document.querySelector(".ed2-tl-scroll") as HTMLElement;
  const timed = async (action: () => void) => {
    const start = performance.now();
    action();
    await frames();
    return performance.now() - start;
  };
  /** Frame intervals while `step` runs once per frame, `count` times. */
  const during = async (count: number, step: (index: number) => void) => {
    const gaps: number[] = [];
    let last = performance.now();
    for (let index = 0; index < count; index++) {
      step(index);
      await new Promise<void>((done) => requestAnimationFrame(() => done()));
      const now = performance.now();
      gaps.push(now - last);
      last = now;
    }
    gaps.sort((a, b) => a - b);
    return { median: gaps[Math.floor(gaps.length / 2)]!, p95: gaps[Math.floor(gaps.length * 0.95)]!, worst: gaps.at(-1)! };
  };
  const round = (value: number) => Math.round(value * 10) / 10;
  const report: Record<string, unknown> = {};

  report.fit = { nodes: nodes(), width: scroller.scrollWidth, visible: scroller.clientWidth };
  report.fitClick = round(await timed(() => (document.querySelector('[data-testid="timeline-fit"]') as HTMLElement).click()));

  const zoomIn = document.querySelector('[aria-label="Zoom in timeline"]') as HTMLElement;
  // Zooming with the button keeps the playhead where it is on screen (B1).
  const playheadX = () => document.querySelector('[data-testid="timeline-playhead"]')!.getBoundingClientRect().left;
  const before = playheadX();
  zoomIn.click();
  await frames();
  await frames();
  report.playheadDriftPx = round(playheadX() - before);
  const steps: number[] = [];
  for (let index = 0; index < 12; index++) steps.push(round(await timed(() => zoomIn.click())));
  report.zoomInSteps = steps;
  report.closeZoom = { nodes: nodes(), width: scroller.scrollWidth };

  const scroll = await during(60, (index) => {
    scroller.scrollLeft += 400 + index;
  });
  report.scrollAtCloseZoom = { median: round(scroll.median), p95: round(scroll.p95), worst: round(scroll.worst) };

  (document.querySelector('[data-testid="timeline-fit"]') as HTMLElement).click();
  await frames();
  const bar = document.querySelector('[data-testid="clip-broll3"]') as HTMLElement;
  const box = bar.getBoundingClientRect();
  const at = { clientX: box.left + box.width / 2, clientY: box.top + box.height / 2, bubbles: true, pointerId: 1, button: 0 };
  bar.dispatchEvent(new PointerEvent("pointerdown", at));
  const drag = await during(40, (index) => {
    window.dispatchEvent(new PointerEvent("pointermove", { ...at, clientX: at.clientX + 6 + index * 3 }));
  });
  window.dispatchEvent(new PointerEvent("pointerup", at));
  await frames();
  report.dragAtFit = { median: round(drag.median), p95: round(drag.p95), worst: round(drag.worst) };
  return report;
});

// BENCH_SHOT_CLOSE=<file.png>: zoomed in and scrolled to the middle, to check nothing is left undrawn.
if (process.env.BENCH_SHOT_CLOSE) {
  for (let index = 0; index < 12; index++) await page.click('[aria-label="Zoom in timeline"]');
  await page.evaluate(() => {
    const scroller = document.querySelector(".ed2-tl-scroll") as HTMLElement;
    scroller.scrollLeft = scroller.scrollWidth / 2;
  });
  await page.waitForTimeout(300);
  await page.screenshot({ path: process.env.BENCH_SHOT_CLOSE });
}

console.log(JSON.stringify({ minutes, cuts, ...result }, null, 2));
await browser.close();
