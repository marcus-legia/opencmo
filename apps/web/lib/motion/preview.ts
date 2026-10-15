/**
 * Explainer previews (docs/explainer-build.md, Track B): a few stills and a layout report for a
 * `MotionJob`, so the Assistant can look at its scene and fix it before anything is paid for.
 *
 * - `OPENCMO_MOTION=local`: spawn the `clip-motion` CLI on this machine in a temp folder.
 * - Otherwise: POST to the Modal endpoint `motion_preview` (`MOTION_PREVIEW_URL`) with the
 *   worker token; the scene code runs there, never inside this server.
 *
 * A broken job or broken scene code comes back as `{ ok: false }` for the Assistant to fix; an
 * outage or a timeout throws, because no change to the code would help.
 */
import "server-only";

import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type { MotionJob, PreviewResult } from "@opencmo/clip-motion/job";

export type MotionPreview = PreviewResult & { images?: string[] };

/** The Assistant waits on this inside a turn: past a minute it should simplify, not wait. */
export const PREVIEW_TIMEOUT_MS = 60_000;

const TIMEOUT = "The explainer preview took too long. Try a simpler scene.";
const FAILED = "The explainer preview failed. Try again in a minute.";
const NOT_SET_UP = "Explainer previews are not set up on the server yet.";

function cliPath(): string {
  // Next runs from apps/web; the CLI lives in the workspace package.
  return process.env.OPENCMO_CLIP_MOTION ?? path.resolve(process.cwd(), "..", "..", "packages", "clip-motion", "src", "cli.ts");
}

function lastLine(text: string): string {
  return text.trim().split("\n").at(-1)?.trim() ?? "";
}

function parseResult(stdout: string): PreviewResult | null {
  try {
    const value = JSON.parse(lastLine(stdout)) as PreviewResult;
    return value && typeof value === "object" && typeof value.ok === "boolean" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Only what the CLI reads. The server's keys stay out of a process that runs the Assistant's
 * code, and its NODE_OPTIONS (react-server conditions) would break Remotion.
 */
function cliEnv(): NodeJS.ProcessEnv {
  const env = {} as NodeJS.ProcessEnv;
  for (const [key, value] of Object.entries(process.env)) {
    if (["PATH", "HOME", "TMPDIR", "LANG"].includes(key) || key.startsWith("OPENCMO_MOTION_") || key === "OPENCMO_EDITOR_FONTS") {
      env[key] = value;
    }
  }
  return env;
}

function run(args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string; timedOut: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"], env: cliEnv() });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    // Remotion logs progress to stderr; keep the tail only.
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr = (stderr + chunk).slice(-8_000)));
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
  });
}

async function previewLocal(job: MotionJob, timeoutMs: number): Promise<MotionPreview> {
  const dir = await mkdtemp(path.join(tmpdir(), "opencmo-motion-preview-"));
  try {
    const jobFile = path.join(dir, "job.json");
    const outdir = path.join(dir, "stills");
    await writeFile(jobFile, JSON.stringify(job));
    const { code, stdout, stderr, timedOut } = await run([cliPath(), "preview", jobFile, outdir], timeoutMs);
    if (timedOut) throw new Error(TIMEOUT);
    const result = parseResult(stdout);
    if (!result) {
      // Exit 3/4 without a JSON line still carries the reason on the last stderr line.
      if (code === 3 || code === 4) {
        return { ok: false, phase: code === 3 ? "job" : "render", message: lastLine(stderr).slice(0, 500) || "The scene failed." };
      }
      console.error("[motion] clip-motion preview failed", code, stderr.slice(-1_500));
      throw new Error(FAILED);
    }
    if (!result.ok) return result;
    const images: string[] = [];
    const stills = [];
    for (const still of result.stills) {
      const file = path.resolve(outdir, still.file);
      // Only files the CLI wrote into this preview's folder.
      if (!file.startsWith(`${outdir}${path.sep}`)) throw new Error(FAILED);
      images.push((await readFile(file)).toString("base64"));
      stills.push({ t: still.t, file: path.basename(file) });
    }
    return { ...result, stills, images };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function previewModal(job: MotionJob, timeoutMs: number): Promise<MotionPreview> {
  const url = process.env.MOTION_PREVIEW_URL;
  const token = process.env.OPENCMO_WORKER_TOKEN;
  if (!url || !token) throw new Error(NOT_SET_UP);
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, job }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw new Error(TIMEOUT);
    console.error("[motion] motion_preview unreachable", error);
    throw new Error(FAILED);
  }
  if (!res.ok) {
    console.error("[motion] motion_preview", res.status, (await res.text()).slice(0, 500));
    throw new Error(FAILED);
  }
  const body = (await res.json()) as MotionPreview;
  if (!body || typeof body.ok !== "boolean") throw new Error(FAILED);
  if (body.ok && (!Array.isArray(body.images) || body.images.length !== body.stills.length)) throw new Error(FAILED);
  return body;
}

/** Stills (base64 JPEGs in `images`, same order as `stills`) and layout issues for `job`. */
export async function previewMotion(job: MotionJob, options: { timeoutMs?: number } = {}): Promise<MotionPreview> {
  const timeoutMs = options.timeoutMs ?? PREVIEW_TIMEOUT_MS;
  return process.env.OPENCMO_MOTION === "local" ? previewLocal(job, timeoutMs) : previewModal(job, timeoutMs);
}
