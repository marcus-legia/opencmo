import { execFileSync } from "node:child_process";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { OUT, readState } from "./setup";

export const state = () => readState();

let db: SupabaseClient | null = null;
/** Service-role client on the LOCAL stack (setup refuses anything else): reads what the user can't see. */
export function admin(): SupabaseClient {
  const { url, service } = state();
  db ??= createClient(url, service, { auth: { persistSession: false } });
  return db;
}

/** Password sign-in through local Auth, then the cookie `@supabase/ssr` reads. */
export async function signIn(page: Page): Promise<void> {
  const { url, anon, email, password } = state();
  const response = await page.request.post(`${url}/auth/v1/token?grant_type=password`, {
    headers: { apikey: anon, "content-type": "application/json" },
    data: { email, password },
  });
  expect(response.ok(), await response.text()).toBeTruthy();
  const session = await response.json();
  await page.context().addCookies([
    { name: "sb-127-auth-token", value: `base64-${Buffer.from(JSON.stringify(session), "utf8").toString("base64")}`, domain: "127.0.0.1", path: "/" },
  ]);
}

/** Upload the source video through the editor's Upload tab, as a user does, and open it. */
export async function makeClip(page: Page, file: string): Promise<string> {
  await page.goto("/app/editor?panel=upload");
  await expect(page.getByTestId("upload-panel")).toBeVisible({ timeout: 180_000 });
  await page.getByTestId("upload-file").setInputFiles(file);
  const created = page.waitForResponse((r) => r.url().endsWith("/api/v1/editor/upload") && r.request().method() === "POST", { timeout: 300_000 });
  await page.getByTestId("upload-submit").click();
  const response = await created;
  expect(response.ok(), await response.text()).toBeTruthy();
  const jobId = ((await response.json()) as { id: string }).id;
  const job = page.locator(`[data-job="${jobId}"]`);
  await expect(job.getByTestId("upload-open")).toBeVisible({ timeout: 900_000 });
  const before = page.url();
  await job.getByTestId("upload-open").click();
  await page.waitForURL((url) => url.href !== before && /\/app\/editor\/[0-9a-f-]+$/.test(url.pathname), { timeout: 120_000 });
  return clipIdOf(page);
}

export const clipIdOf = (page: Page) => new URL(page.url()).pathname.split("/").pop()!;

/** A blank New edit (where /video runs). */
export async function newEdit(page: Page, aspect: "9:16" | "1:1" | "16:9" = "9:16"): Promise<string> {
  const response = await page.request.post("/api/v1/editor/new", { data: { aspect } });
  expect(response.ok(), await response.text()).toBeTruthy();
  const { clip_id } = (await response.json()) as { clip_id: string };
  await openEditor(page, clip_id);
  return clip_id;
}

/** Back to the engine's first version of the clip, so every scenario starts from the same cut. */
export async function resetClip(page: Page, clipId: string): Promise<void> {
  // The version from the database: a scenario that broke the document leaves the API unable to read it.
  const { data, error } = await admin().from("editor_projects").select("version").eq("clip_id", clipId).single();
  if (error) throw error;
  const version = data.version as number;
  const reset = await page.request.post("/api/v1/editor/project/reset", { data: { clip_id: clipId, expected_version: version } });
  expect(reset.ok(), await reset.text()).toBeTruthy();
}

export async function openEditor(page: Page, clipId: string): Promise<void> {
  // A turn left running by an earlier scenario keeps the chat busy: stop it, as the user would.
  const { data: sessions } = await admin().from("agent_sessions").select("id").eq("user_id", state().userId);
  const ids = (sessions ?? []).map((row) => row.id as string);
  const { data: active } = await admin()
    .from("agent_turns")
    .select("session_id")
    .in("session_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"])
    .in("status", ["running", "awaiting_browser", "awaiting_approval", "awaiting_input", "awaiting_continue"]);
  for (const id of new Set((active ?? []).map((row) => row.session_id as string))) await page.request.post(`/api/v1/agent/sessions/${id}/stop`);
  await page.goto(`/app/editor/${clipId}`);
  await expect(page.getByTestId("editor-v2")).toBeVisible({ timeout: 180_000 });
  await expect(page.getByText("Loading media…")).toHaveCount(0, { timeout: 180_000 });
  const toggle = page.getByTestId("panel-agent");
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
  await expect(page.getByLabel("Message the assistant")).toBeVisible();
  // Each scenario is a new chat. The button turns on once the saved chat has loaded.
  const fresh = page.getByTestId("assistant-new");
  await expect(fresh).toBeVisible();
  await expect.poll(async () => (await fresh.isEnabled()) || (await page.getByTestId("assistant-turn").count()) === 0, { timeout: 30_000 }).toBe(true);
  if (await fresh.isEnabled()) await fresh.click();
}

export type ToolRow = { name: string; status: string; error?: string };
export type TurnResult = {
  prompt: string;
  status: string;
  error: string | null;
  credits: number | null;
  tools: ToolRow[];
  generations: { kind: string; model: string; status: string; error: string | null }[];
  approvals: string[];
  answered: string[];
  reply: string;
  seconds: number;
  /** The tab had to be told to Continue: a user would see the turn stuck on "Paused". */
  resumed: number;
};

type AskOptions = {
  /** Pick an option of an ask_user card; default: the first. */
  answer?: (options: string[], question: string) => string;
  approve?: boolean;
  /** Click Stop this many ms after sending (the "user changes their mind" case). */
  stopAfterMs?: number;
  /** Wait for AI media the turn started to finish. */
  waitForMedia?: boolean;
};

/** Type a prompt in the Assistant and act like a user until the turn ends. */
export async function ask(page: Page, prompt: string, options: AskOptions = {}): Promise<TurnResult> {
  const started = new Date();
  const { approve = true, waitForMedia = true } = options;
  const box = page.getByLabel("Message the assistant");
  const turns = page.getByTestId("assistant-turn");
  const before = await turns.count();
  await box.fill(prompt);
  await box.press("Enter");
  // The panel may still show earlier turns: follow the one this prompt created, never an old one.
  await expect(turns).toHaveCount(before + 1, { timeout: 60_000 });
  const turn = turns.nth(before);

  const approvals: string[] = [];
  const answered: string[] = [];
  let resumed = 0;
  let pausedSince = 0;
  const deadline = Date.now() + 25 * 60_000;
  let stopped = false;
  while (Date.now() < deadline) {
    if (options.stopAfterMs && !stopped && Date.now() - started.getTime() > options.stopAfterMs) {
      const stop = page.getByTestId("assistant-stop");
      if (await stop.isVisible()) await stop.click();
      stopped = true;
    }
    const status = await turn.getAttribute("data-status");
    if (status && ["done", "failed", "stopped"].includes(status) && !(await page.getByTestId("assistant-working").isVisible())) break;

    const question = turn.getByTestId("assistant-question");
    if (await question.isVisible()) {
      const text = (await question.locator(".ed2-asst-question-text").innerText()).trim();
      const choices = await question.locator(".ed2-asst-option").allInnerTexts();
      if (choices.length) {
        const pick = options.answer?.(choices, text) ?? choices[0]!;
        answered.push(`${text} → ${pick}`);
        await question.locator(".ed2-asst-option", { hasText: pick }).first().click();
      } else {
        answered.push(`${text} → (your call)`);
        await question.getByPlaceholder("Your answer").fill("Your call, pick what works best.");
        await question.getByTestId("assistant-answer").click();
      }
      continue;
    }
    const approval = turn.getByTestId("assistant-approval").last();
    if (await approval.isVisible()) {
      approvals.push((await approval.innerText()).replace(/\s+/g, " ").slice(0, 300));
      if (approve) await approval.getByTestId("assistant-approve").click();
      else break;
      continue;
    }
    const extend = turn.getByTestId("assistant-extend");
    if (await extend.isVisible()) {
      await extend.click();
      continue;
    }
    const resume = turn.getByTestId("assistant-resume");
    if (await resume.isVisible()) {
      pausedSince ||= Date.now();
      if (Date.now() - pausedSince > 30_000) {
        resumed++;
        pausedSince = 0;
        await resume.click();
      }
    } else pausedSince = 0;
    await page.waitForTimeout(1500);
  }

  const reply = (await turn.getByTestId("assistant-reply").allInnerTexts()).join("\n").trim();
  const result = await turnFromDb(started, prompt);
  if (waitForMedia) result.generations = await waitForGenerations(started);
  return { ...result, approvals, answered, reply, resumed, seconds: Math.round((Date.now() - started.getTime()) / 1000) };
}

async function turnFromDb(since: Date, prompt: string): Promise<Omit<TurnResult, "approvals" | "answered" | "reply" | "resumed" | "seconds">> {
  const { userId } = state();
  const { data: sessions } = await admin().from("agent_sessions").select("id").eq("user_id", userId);
  const { data: turns, error } = await admin()
    .from("agent_turns")
    .select("id, status, error, credits, prompt, created_at")
    .in("session_id", (sessions ?? []).map((row) => row.id))
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  const turn = turns?.[0];
  if (!turn) return { prompt, status: "missing", error: "No turn was recorded", credits: null, tools: [], generations: [] };
  const { data: calls } = await admin().from("agent_tool_calls").select("name, status, content, created_at").eq("turn_id", turn.id).order("created_at");
  const tools = (calls ?? []).map((call) => {
    const text = (call.content as { text?: string } | null)?.text ?? "";
    const invalid = text.match(/"INVALID_INPUT"\s*:\s*"([^"]+)"/)?.[1] ?? text.match(/"error"\s*:\s*"([^"]+)"/)?.[1];
    return { name: call.name as string, status: call.status as string, ...(call.status === "failed" || invalid ? { error: invalid ?? text.slice(0, 200) } : {}) };
  });
  return { prompt, status: turn.status, error: turn.error, credits: turn.credits, tools, generations: [] };
}

async function waitForGenerations(since: Date): Promise<TurnResult["generations"]> {
  const { userId } = state();
  const deadline = Date.now() + 20 * 60_000;
  for (;;) {
    const { data, error } = await admin()
      .from("generations")
      .select("kind, model, status, error")
      .eq("user_id", userId)
      .gte("created_at", since.toISOString())
      .order("created_at");
    if (error) throw error;
    const rows = (data ?? []) as TurnResult["generations"];
    if (rows.every((row) => ["done", "failed", "canceled", "cancelled"].includes(row.status)) || Date.now() > deadline) return rows;
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

/** Export like a user (top bar), download the MP4 and pull three frames to look at. */
export async function exportClip(page: Page, name: string): Promise<{ file: string; frames: string[]; seconds: number } | { error: string }> {
  const dir = join(OUT, name);
  mkdirSync(dir, { recursive: true });
  await page.getByRole("button", { name: /^Export/ }).first().click();
  const download = page.getByRole("link", { name: "Download" }).first();
  try {
    await expect(download).toBeVisible({ timeout: 15 * 60_000 });
  } catch {
    const shot = join(dir, "export-failed.png");
    await page.screenshot({ path: shot });
    return { error: `Export did not finish (see ${shot})` };
  }
  const href = await download.getAttribute("href");
  const response = await page.request.get(href!);
  if (!response.ok()) return { error: `Download failed: HTTP ${response.status()}` };
  const file = join(dir, "export.mp4");
  writeFileSync(file, await response.body());
  const seconds = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file], { encoding: "utf8" }).trim());
  const frames = [0.1, 0.5, 0.9].map((ratio, index) => {
    const frame = join(dir, `frame-${index + 1}.png`);
    execFileSync("ffmpeg", ["-v", "error", "-y", "-ss", (seconds * ratio).toFixed(2), "-i", file, "-frames:v", "1", frame]);
    return frame;
  });
  return { file, frames, seconds: Math.round(seconds * 10) / 10 };
}

/** One line per scenario in .scenarios-out/report.jsonl, for the bug list. */
export function record(scenario: string, data: Record<string, unknown>): void {
  mkdirSync(OUT, { recursive: true });
  appendFileSync(join(OUT, "report.jsonl"), `${JSON.stringify({ scenario, at: new Date().toISOString(), ...data })}\n`);
}

/** What went wrong in a turn, as a user would notice it. */
export function problems(result: TurnResult): string[] {
  const out: string[] = [];
  if (result.status !== "done") out.push(`turn ${result.status}${result.error ? `: ${result.error}` : ""}`);
  for (const tool of result.tools) if (tool.error) out.push(`${tool.name}: ${tool.error}`);
  for (const generation of result.generations) if (generation.status !== "done") out.push(`${generation.kind} (${generation.model}) ${generation.status}: ${generation.error ?? ""}`);
  if (result.resumed) out.push(`turn needed Continue ${result.resumed}×`);
  return out;
}
