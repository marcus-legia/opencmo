import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { signIn, state } from "./helpers";
import { ensureOnboarded } from "./ui-v2-seed";

/**
 * Decisions from the CMO chat (docs/plans/cmo/2026-11-02-cmo-chat-decisions-plan.md): the founder asks, the chat shows a
 * confirmation card, and only Approve changes anything. Fake model (`OPENCMO_AGENT_FAKE=1`). Runs with
 * `npm run test:e2e:v2`.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");
test.beforeAll(ensureOnboarded);

const OUT = join(__dirname, "..", "..", "..", "docs", "plans", "cmo", "2026-11-02-cmo-chat-decisions-shots");

async function pausedAt(userId: string): Promise<string | null> {
  const { url, service } = state();
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { data, error } = await admin.from("profiles").select("cmo_paused_at").eq("id", userId).single();
  if (error) throw new Error(error.message);
  return (data as { cmo_paused_at: string | null }).cmo_paused_at;
}

async function resetPause(userId: string): Promise<void> {
  const { url, service } = state();
  const admin = createClient(url, service, { auth: { persistSession: false } });
  const { error } = await admin.from("profiles").update({ cmo_paused_at: null }).eq("id", userId);
  if (error) throw new Error(error.message);
}

test("a decision waits on its card: Cancel changes nothing, the card survives a reload, Approve pauses", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const user = state().users.a;
  await resetPause(user.id);
  await signIn(page, user);

  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/app");
    const chat = page.locator("#v2-chat");
    if (width === 390) await page.getByRole("button", { name: "Chat" }).click();
    await chat.getByLabel("Ask your CMO").fill("Pause my CMO for now, I'm travelling.");
    await chat.getByLabel("Ask your CMO").press("Enter");

    const card = chat.getByRole("group", { name: "Confirm" });
    await expect(card).toBeVisible();
    await expect(card).toContainText(/pause/i);
    expect(await pausedAt(user.id), "nothing changes before Approve").toBeNull();
    await page.screenshot({ path: join(OUT, `confirm-card-${width}.png`) });

    if (width === 1440) {
      await page.reload();
      await expect(chat.getByRole("group", { name: "Confirm" })).toBeVisible();
      await chat.getByRole("group", { name: "Confirm" }).getByRole("button", { name: "Cancel" }).click();
      await expect(chat.getByRole("group", { name: "Confirm" })).toHaveCount(0);
      expect(await pausedAt(user.id), "Cancel changes nothing").toBeNull();
    } else {
      await card.getByTestId("cmo-confirm-approve").click();
      await expect(card).toHaveCount(0);
      await expect.poll(() => pausedAt(user.id)).not.toBeNull();
    }
  }
  await resetPause(user.id);
});
