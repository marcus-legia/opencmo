import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

import { FIXTURE_DIR } from "./global-setup";
import { signIn, state } from "./helpers";

/**
 * C1 (owner, 2026-11-09): the week's video is a script the founder records. The plan's video item → Writer's brief
 * with a storyboard → a free script card → "Approve and open in editor" → one blank edit with a marker per beat; the
 * Writer screen opens the same edit again. On the local stack; the brief's run is completed here as Writer would.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");

const admin = () => {
  const { url, service } = state();
  return createClient(url, service, { auth: { persistSession: false } });
};

const STORYBOARD = [
  { say: "Your invoice is late.", show: "You, to camera", shot: "talking_head", seconds: 5 },
  { say: "Paylane sends the reminder for you.", show: "Paylane's reminder screen", shot: "screen", seconds: 15 },
  { say: "Try Paylane.", show: "You, to camera", shot: "talking_head", seconds: 10 },
];

type Beat = (typeof STORYBOARD)[number];

/**
 * A founder with an approved script for `storyboard`, signed in, on the edit "Approve and open in editor" made.
 * The brief's run is completed here as Writer would.
 */
async function scriptEdit(page: Page, storyboard: readonly Beat[] = STORYBOARD) {
  const db = admin();
  const email = `e2e-script-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;
  const { data: created, error } = await db.auth.admin.createUser({ email, password: "e2e-script-password", email_confirm: true });
  if (error || !created.user) throw new Error(`could not create the founder: ${error?.message}`);
  const userId = created.user.id;
  await db.from("credit_ledger").insert({ user_id: userId, delta: 50, reason: "E2E top-up" });
  // Fresh niche research, so the brief starts at once.
  await db.from("cmo_insights").insert({ user_id: userId, kind: "niche_video", body: {} });
  const { data: run } = await db.from("cmo_runs").insert({ user_id: userId, kind: "plan_week", status: "running" }).select("id").single();
  const planned = await db.rpc("cmo_plan_week", {
    p_user: userId,
    p_run: run!.id,
    p_items: [{ department: "video", platform: "Shorts", day: new Date().toISOString().slice(0, 10), idea: "Chase a late invoice", reason: "Launch week" }],
  });
  expect(planned.error).toBeNull();
  const { data: brief } = await db.from("work_orders").select("id").eq("user_id", userId).eq("kind", "write_video_brief").single();
  expect((await db.from("work_orders").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("kind", "build_video")).count).toBe(0);
  await db
    .from("cmo_runs")
    .update({
      status: "done",
      finished_at: new Date().toISOString(),
      output: { reason: "Brief written", brief: { objective: "Chase a late invoice", hooks: ["Your invoice is late.", "b", "c"], cta: "Try Paylane", seconds: 30, aspect: "9:16", storyboard } },
    })
    .eq("input->>order_id", brief!.id);
  const { data: card } = await db.from("approvals").select("id, kind, price_credits").eq("ref_kind", "work_order").eq("ref_id", brief!.id).eq("status", "waiting").single();
  expect([card!.kind, card!.price_credits]).toEqual(["script", 0]);

  await signIn(page, { email, password: "e2e-script-password", id: userId });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`/app/inbox/${card!.id}`);
  const view = page.getByTestId("inbox-card-page").getByTestId("approval-card");
  await expect(view).toContainText("Your invoice is late.");
  await expect(view).toContainText("Free: nothing is generated");
  await view.getByRole("button", { name: "Approve and open in editor" }).click();
  await expect(page).toHaveURL(/\/app\/editor\/[0-9a-f-]{36}/, { timeout: 60_000 });
  const clipId = page.url().split("/app/editor/")[1]!.split(/[?#]/)[0]!;
  return { db, userId, email, card: card!, brief: brief!, clipId };
}

test("a script card opens its edit with a marker per beat; nothing builds a video", async ({ page }) => {
  test.setTimeout(180_000);
  const { db, card, clipId } = await scriptEdit(page);

  const { data: project } = await db.from("editor_projects").select("document").eq("clip_id", clipId).single();
  const markers = JSON.stringify(project!.document).match(/"name":"0[1-3] · [A-Za-z ]+"/g) ?? [];
  expect(markers).toEqual(['"name":"01 · To camera"', '"name":"02 · Screen"', '"name":"03 · To camera"']);
  expect((await db.from("approvals").select("status").eq("id", card!.id).single()).data!.status).toBe("approved");

  // The Writer screen opens the same edit again, and places nothing twice.
  await page.goto("/app/writer");
  await page.getByRole("tab", { name: "Video briefs" }).click();
  await page.getByRole("button", { name: "Open in editor", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/app/editor/${clipId}`), { timeout: 60_000 });
  const { data: again } = await db.from("editor_projects").select("document").eq("clip_id", clipId).single();
  expect((JSON.stringify(again!.document).match(/"name":"0[1-3] · /g) ?? []).length).toBe(3);
});

type Marker = { id: string; name: string; comment?: string };
const markersOf = (document: unknown): Marker[] => {
  const found: Marker[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const markers = (value as { marks?: { markers?: Marker[] } }).marks?.markers;
    if (Array.isArray(markers)) found.push(...markers);
    Object.values(value).forEach(visit);
  };
  visit(document);
  return found;
};

test("I1: the Script tab shows the beats; an edited beat holds in the order and its marker, after a reload too", async ({ page, browser }) => {
  test.setTimeout(240_000);
  const { db, brief, clipId } = await scriptEdit(page);
  await expect(page.getByTestId("editor-v2")).toBeVisible({ timeout: 120_000 });

  await page.getByTestId("tab-script").click();
  const panel = page.getByTestId("script-panel");
  await expect(panel.getByTestId("script-beat")).toHaveCount(3);
  await expect(panel).toContainText("Your invoice is late.");
  await expect(panel.getByRole("link", { name: "Read on your phone" })).toHaveAttribute("href", `/app/script/${brief.id}/prompter`);

  await panel.getByRole("button", { name: "Edit beat 2" }).click();
  await panel.getByLabel("What to say in beat 2").fill("Paylane chases the invoice so you do not have to.");
  await panel.getByRole("button", { name: "Save" }).click();
  await expect(panel.getByTestId("script-beat").nth(1)).toContainText("Paylane chases the invoice so you do not have to.");

  // The order holds the words: the card, the Writer screen and the prompter read them from there.
  await expect
    .poll(async () => ((await db.from("work_orders").select("brief").eq("id", brief.id).single()).data!.brief as { storyboard: Beat[] }).storyboard[1]!.say)
    .toBe("Paylane chases the invoice so you do not have to.");
  // The beat's marker carries them too, once the edit is saved.
  const marker = async () => markersOf((await db.from("editor_projects").select("document").eq("clip_id", clipId).single()).data!.document).find((m) => m.name.startsWith("02 · "));
  await expect.poll(async () => (await marker())?.comment, { timeout: 30_000 }).toBe("Say: Paylane chases the invoice so you do not have to.\nShow: Paylane's reminder screen");

  await page.reload();
  await expect(page.getByTestId("editor-v2")).toBeVisible({ timeout: 120_000 });
  await page.getByTestId("tab-script").click();
  await expect(page.getByTestId("script-panel").getByTestId("script-beat").nth(1)).toContainText("Paylane chases the invoice so you do not have to.");

  // Another founder's clip: no script, no tab.
  const other = await browser.newPage();
  const otherEmail = `e2e-script-other-${Date.now()}@test.local`;
  const { data: created } = await db.auth.admin.createUser({ email: otherEmail, password: "e2e-script-password", email_confirm: true });
  await signIn(other, { email: otherEmail, password: "e2e-script-password", id: created.user!.id });
  expect((await other.request.get(`/api/v1/clips/${clipId}/script`)).status()).toBe(404);
  await other.close();
});

/** Words spread evenly over [start, end), in the upload's own seconds. */
function line(text: string, start: number, end: number) {
  const words = text.split(" ");
  const step = (end - start) / words.length;
  const round = (value: number) => Math.round(value * 100) / 100;
  return { text, words: words.map((word, index) => ({ text: word, start: round(start + index * step), end: round(start + (index + 0.85) * step) })) };
}

const TAKE_SCRIPT: Beat[] = [
  { say: "Your invoice is late.", show: "You, to camera", shot: "talking_head", seconds: 3 },
  { say: "Paylane sends the reminder for you.", show: "Paylane's reminder screen", shot: "screen", seconds: 4 },
  { say: "Start a free trial today.", show: "You, to camera", shot: "talking_head", seconds: 3 },
];
/** A take with a false start of beat 1, an aside, and beat 3 never said. */
const TAKE = [
  line("Your invoice is", 0.2, 1.0),
  line("Your invoice is late", 1.4, 2.6),
  line("Paylane sends the reminder for you", 3.0, 5.6),
  line("okay hold on I lost my place", 6.4, 8.8),
];
const NAME = "script-take.mp4";

test("I3: the take against the script, and Keep only the script cuts after the confirm", async ({ page }, testInfo) => {
  test.setTimeout(600_000);
  const { clipId } = await scriptEdit(page, TAKE_SCRIPT);
  await expect(page.getByTestId("editor-v2")).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText("Loading media…")).toHaveCount(0, { timeout: 60_000 });

  // The founder's take: 10 s with sound; its words come from TAKE (the e2e worker's fake transcriber reads the sidecar).
  writeFileSync(join(FIXTURE_DIR, `${NAME}.transcript.json`), JSON.stringify(TAKE));
  const file = testInfo.outputPath(NAME);
  execFileSync("ffmpeg", [
    "-v", "error", "-y", "-f", "lavfi", "-i", "testsrc=s=360x640:r=15:d=10", "-f", "lavfi", "-i", "sine=f=220:d=10",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", file,
  ]);
  await page.getByRole("tab", { name: /media/i }).click();
  await page.getByTestId("import-input").setInputFiles(file);
  const row = page.getByTestId(`asset-${NAME}`);
  await expect(row).toBeVisible();
  await row.locator(".ed2-lib-icon").dblclick();
  await expect(row.getByTestId("transcript-ready")).toBeVisible({ timeout: 180_000 });

  await page.getByTestId("tab-script").click();
  const panel = page.getByTestId("script-panel");
  const takes = panel.getByTestId("script-take");
  await expect(takes).toHaveCount(3, { timeout: 60_000 });
  await expect(takes.nth(0)).toHaveText(/^Said/);
  await expect(takes.nth(1)).toHaveText(/^Said/);
  await expect(takes.nth(2)).toHaveText(/^Not said/);
  await expect(panel).toContainText("Beat 3 is missing");

  // Proposed, never cut on its own.
  const readDoc = async () => {
    const response = await page.request.get(`/api/v1/editor/document?clip_id=${clipId}`);
    expect(response.ok()).toBeTruthy();
    return ((await response.json()) as { document: unknown }).document;
  };
  type Cut = { start: number; end: number };
  const removed = async (): Promise<Cut[]> => {
    const found: Cut[] = [];
    const visit = (value: unknown) => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== "object") return;
      const mark = (value as { marks?: { "text-cut"?: { removed?: Cut[] } } }).marks?.["text-cut"];
      if (mark?.removed) found.push(...mark.removed);
      Object.values(value).forEach(visit);
    };
    visit(await readDoc());
    return found;
  };
  await panel.getByTestId("script-keep-open").click();
  await expect(panel).toContainText("2 stretches");
  await expect(panel).toContainText("okay hold on I lost my place");
  expect(await removed(), "nothing is cut before the confirm").toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("script-keep.png") });

  await panel.getByTestId("script-keep-confirm").click();
  const inCut = (time: number, cuts: Cut[]) => cuts.some((range) => range.start <= time && time < range.end);
  await expect.poll(async () => inCut(0.5, await removed()) && inCut(7.5, await removed()), { timeout: 30_000 }).toBe(true);
  const cuts = await removed();
  for (const kept of [1.5, 2.2, 3.5, 5.0]) expect(inCut(kept, cuts), `${kept}s is the script and stays`).toBe(false);
  // Nothing left to propose once it is cut.
  await expect(panel.getByTestId("script-keep")).toHaveCount(0, { timeout: 30_000 });
});
