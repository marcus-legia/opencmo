/**
 * previewMotion: the local path against a fake CLI (stills read as base64, temp folder removed,
 * code errors returned, timeouts thrown) and the Modal path against a local HTTP server.
 *
 *     cd apps/web && NODE_OPTIONS=--conditions=react-server npx tsx lib/motion/preview.check.ts
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";

import type { MotionJob } from "@opencmo/clip-motion/job";

import { previewMotion } from "./preview";

const job: MotionJob = {
  title: "How Shazam hears a song",
  code: "return function Scene() { return null; };",
  beats: [{ say: "One." }, { say: "Two." }, { say: "Three." }],
  format: "16:9",
  duration: 15,
  seed: 0,
};

const scripts = mkdtempSync(path.join(tmpdir(), "motion-preview-check-"));
function fakeCli(name: string, body: string): string {
  const file = path.join(scripts, `${name}.mjs`);
  writeFileSync(file, `import { mkdirSync, writeFileSync, readFileSync } from "node:fs";\nconst [, , command, jobFile, outdir] = process.argv;\n${body}\n`);
  return file;
}

const previewDirs = () => readdirSync(tmpdir()).filter((name) => name.startsWith("opencmo-motion-preview-")).length;

async function main() {
  process.env.OPENCMO_MOTION = "local";
  const before = previewDirs();

  process.env.OPENCMO_CLIP_MOTION = fakeCli("ok", `
    if (command !== "preview") process.exit(2);
    const job = JSON.parse(readFileSync(jobFile, "utf8"));
    mkdirSync(outdir, { recursive: true });
    writeFileSync(outdir + "/s0.jpg", "jpeg-0");
    writeFileSync(outdir + "/s1.jpg", "jpeg-1");
    process.stderr.write("bundling…\\n");
    console.log(JSON.stringify({ ok: true, stills: [{ t: 1, file: "s0.jpg" }, { t: 5, file: outdir + "/s1.jpg" }], issues: ["Text under 36 px: " + job.title], estimated: true }));
  `);
  const ok = await previewMotion(job);
  assert.equal(ok.ok, true);
  assert.ok(ok.ok);
  assert.deepEqual(ok.images, [Buffer.from("jpeg-0").toString("base64"), Buffer.from("jpeg-1").toString("base64")], "stills as base64, same order");
  assert.deepEqual(ok.stills, [{ t: 1, file: "s0.jpg" }, { t: 5, file: "s1.jpg" }], "file names only, no server paths");
  assert.deepEqual(ok.issues, ["Text under 36 px: How Shazam hears a song"], "the job reached the CLI");
  assert.equal(previewDirs(), before, "the temp folder is removed");

  process.env.OPENCMO_CLIP_MOTION = fakeCli("code", `
    console.log(JSON.stringify({ ok: false, phase: "guard", message: "fetch is not allowed (line 2)" }));
    process.stderr.write("fetch is not allowed (line 2)\\n");
    process.exit(4);
  `);
  assert.deepEqual(await previewMotion(job), { ok: false, phase: "guard", message: "fetch is not allowed (line 2)" }, "code errors go back to the Assistant");

  process.env.OPENCMO_CLIP_MOTION = fakeCli("crash", `process.stderr.write("boom\\nTypeError: x is undefined\\n"); process.exit(4);`);
  assert.deepEqual(await previewMotion(job), { ok: false, phase: "render", message: "TypeError: x is undefined" }, "exit 4 without JSON: last stderr line");

  process.env.OPENCMO_CLIP_MOTION = fakeCli("broken", `process.stderr.write("Chromium died\\n"); process.exit(1);`);
  await assert.rejects(previewMotion(job), /The explainer preview failed\./, "an outage throws in English");

  process.env.OPENCMO_CLIP_MOTION = fakeCli("escape", `console.log(JSON.stringify({ ok: true, stills: [{ t: 0, file: "/etc/hostname" }], issues: [], estimated: true }));`);
  await assert.rejects(previewMotion(job), /The explainer preview failed\./, "never reads a file outside the preview folder");

  process.env.OPENCMO_CLIP_MOTION = fakeCli("slow", `setTimeout(() => {}, 60_000);`);
  const started = Date.now();
  await assert.rejects(previewMotion(job, { timeoutMs: 300 }), /took too long/, "timeout throws in English");
  assert.ok(Date.now() - started < 5_000, "the CLI is killed at the timeout");
  assert.equal(previewDirs(), before, "the temp folder is removed after failures too");

  // Modal path.
  process.env.OPENCMO_MOTION = "modal";
  delete process.env.MOTION_PREVIEW_URL;
  await assert.rejects(previewMotion(job), /not set up/, "no endpoint configured");

  let received: unknown = null;
  let reply: unknown = { ok: true, stills: [{ t: 1, file: "s0.jpg" }], issues: [], estimated: true, images: ["aGk="] };
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      received = JSON.parse(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  process.env.MOTION_PREVIEW_URL = `http://127.0.0.1:${port}/`;
  process.env.OPENCMO_WORKER_TOKEN = "worker-token";
  delete process.env.MOTION_PREVIEW_TOKEN;
  try {
    await assert.rejects(previewMotion(job), /not set up/, "the worker token is never sent to the preview container");
    assert.equal(received, null);
    process.env.MOTION_PREVIEW_TOKEN = "preview-token";
    const remote = await previewMotion(job);
    assert.deepEqual(received, { token: "preview-token", job }, "the preview token in the body, like submit");
    assert.ok(remote.ok);
    assert.deepEqual(remote.images, ["aGk="]);
    reply = { ok: true, stills: [{ t: 1, file: "s0.jpg" }], issues: [], estimated: true };
    await assert.rejects(previewMotion(job), /preview failed/, "stills without images are refused");
  } finally {
    server.close();
  }
  assert.equal(existsSync(scripts), true);
  console.log("motion preview: every check passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
