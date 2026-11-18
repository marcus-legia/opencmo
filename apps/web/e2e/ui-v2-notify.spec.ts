import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import type { E2EUser } from "./global-setup";
import { sidewaysOverflow, signIn, state } from "./helpers";
import { ONBOARDING_DOCUMENT } from "./ui-v2-seed";

/**
 * Settings › Notifications (wave 2 C3): the morning email's days and hour, and the log of what was sent or skipped in
 * the last 14 days (`my_email_log`). The email's footer links to `#notifications`.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");

const OUT = join(__dirname, "..", "..", "..", "docs", "plans", "cmo", "2026-11-19-wave2-shots");

function admin() {
  const { url, service } = state();
  return createClient(url, service, { auth: { persistSession: false } });
}

async function founderWithLog(): Promise<E2EUser> {
  const db = admin();
  const user: E2EUser = { email: `notify-${randomUUID()}@test.local`, password: `pw-${randomUUID()}`, id: "" };
  const created = await db.auth.admin.createUser({ email: user.email, password: user.password, email_confirm: true });
  if (created.error) throw new Error(`Could not create a founder: ${created.error.message}`);
  user.id = created.data.user!.id;
  const must = (r: { error: { message: string } | null }, what: string) => {
    if (r.error) throw new Error(`Could not seed ${what}: ${r.error.message}`);
  };
  must(await db.from("marketing_documents").insert({ user_id: user.id, ...ONBOARDING_DOCUMENT }), "a document");
  must(await db.from("profiles").update({ timezone: "UTC", digest_hour: 8, digest_days: "weekdays" }).eq("id", user.id), "the schedule");
  const day = (n: number) => new Date(Date.now() - n * 86_400_000);
  must(
    await db.from("email_log").insert([
      {
        user_id: user.id,
        kind: "digest",
        day: day(1).toISOString().slice(0, 10),
        approval_ids: [],
        status: "sent",
        sent_at: day(1).toISOString(),
        created_at: day(1).toISOString(),
        subject: "3 people asked about late invoices",
        summary: { people: 3, followUps: 1, posts: 2 },
      },
      {
        user_id: user.id,
        kind: "digest",
        day: day(2).toISOString().slice(0, 10),
        approval_ids: [],
        status: "skipped",
        created_at: day(2).toISOString(),
        summary: { people: 0, followUps: 0, posts: 0, note: "Nothing new: no person, follow-up or post due" },
      },
    ]),
    "the log",
  );
  return user;
}

test("Notifications shows the morning email's schedule and the log, and saves a new schedule", async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const user = await founderWithLog();
  await signIn(page, user);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/app/settings#notifications");

  const log = page.getByTestId("email-log");
  await expect(log.locator('li[data-status="sent"]')).toContainText("3 people asked about late invoices");
  await expect(log.locator('li[data-status="sent"]')).toContainText("3 people asking · 1 follow-up · 2 posts");
  await expect(log.locator('li[data-status="skipped"]')).toContainText("Nothing new: no person, follow-up or post due");
  await expect(log.locator('li[data-status="skipped"]')).toContainText("Skipped");

  const schedule = page.getByTestId("digest-schedule");
  await expect(schedule.getByLabel("When", { exact: true })).toHaveValue("weekdays");
  await expect(schedule.getByLabel("at", { exact: true })).toHaveValue("8");
  await log.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(OUT, "notifications-1440.png") });

  await schedule.getByLabel("When", { exact: true }).selectOption("monday");
  await schedule.getByLabel("at", { exact: true }).selectOption("9");
  await schedule.getByRole("button", { name: "Save" }).click();
  await expect(schedule.getByRole("status")).toContainText("every Monday at 09:00");
  const { data } = await admin().from("profiles").select("digest_days, digest_hour").eq("id", user.id).single();
  expect(data).toEqual({ digest_days: "monday", digest_hour: 9 });

  // Off hides the hour and saves only the days.
  await schedule.getByLabel("When", { exact: true }).selectOption("off");
  await expect(schedule.getByLabel("at", { exact: true })).toHaveCount(0);
  await schedule.getByRole("button", { name: "Save" }).click();
  await expect(schedule.getByRole("status")).toContainText("No morning email");
  const after = await admin().from("profiles").select("digest_days, digest_hour").eq("id", user.id).single();
  expect(after.data).toEqual({ digest_days: "off", digest_hour: 9 });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(log).toBeVisible();
  const overflow = await sidewaysOverflow(page);
  expect(overflow.width, `settings @ 390: ${overflow.culprits.join("; ")}`).toBeLessThanOrEqual(390);
  await log.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(OUT, "notifications-390.png") });
});
