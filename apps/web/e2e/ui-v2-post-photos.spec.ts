import { deflateSync } from "node:zlib";

import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { openFeedCard, signIn, state } from "./helpers";
import { seedCoreDraft } from "./ui-v2-seed";

/**
 * Photos on a text post and the slideshow page (owner, 2026-11-13; `docs/plans/cmo/2026-11-13-post-photos-plan.md`).
 * The founder adds their own photo on the post's card, approves, and every slot carries it; a slideshow or carousel
 * is made on /app/photos, not on the Calendar. The SQL is `supabase/tests/313_post_photos.test.sql`.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");

const admin = () => {
  const { url, service } = state();
  return createClient(url, service, { auth: { persistSession: false } });
};

/** A real 8×8 PNG, so Storage and the browser both take it as an image. */
function png(): Buffer {
  const crc = (buf: Buffer) => {
    let c = ~0;
    for (const b of buf) {
      c ^= b;
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
    }
    return ~c >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0);
  ihdr.writeUInt32BE(8, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const rows = Buffer.concat(Array.from({ length: 8 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(24, 0x5a)])));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}

test("a photo added on the post card goes out with the post on every platform", async ({ page }, testInfo) => {
  const db = admin();
  const { user, itemId } = await seedCoreDraft();
  await signIn(page, user);
  await page.goto("/app");
  const card = await openFeedCard(page, "Post for 3 platforms");
  const photos = card.getByTestId("post-photos");
  await expect(photos).toContainText("Add photos");
  await photos.locator('input[type="file"]').setInputFiles({ name: "desk.png", mimeType: "image/png", buffer: png() });
  await expect(card.getByRole("img", { name: "Photo 1" })).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => ((await db.from("content_items").select("photos").eq("id", itemId).single()).data?.photos as string[] | undefined)?.length)
    .toBe(1);
  await card.screenshot({ path: testInfo.outputPath("post-card-photo.png") });

  await card.getByRole("button", { name: "Approve", exact: true }).click();
  await expect.poll(async () => (await db.from("content_items").select("status").eq("id", itemId).single()).data?.status).toBe("approved");
  const deliverable = (await db.from("deliverables").select("id").eq("ref_kind", "content_item").eq("ref_id", itemId).single()).data!.id;
  const saved = (await db.from("content_items").select("photos").eq("id", itemId).single()).data!.photos as string[];
  for (const platform of ["x", "threads", "linkedin"]) {
    const { data } = await db.rpc("schedule_content", { p_deliverable: deliverable, p_platform: platform });
    expect((data as { photos?: string[] }).photos, `${platform} posts the photo`).toEqual(saved);
  }

  // A schedule card still to decide shows the photo too.
  await page.reload();
  const waiting = await openFeedCard(page, /Threads @/);
  await expect(waiting.getByTestId("card-photos").getByRole("img", { name: "Photo 1" })).toBeVisible({ timeout: 30_000 });
  await waiting.screenshot({ path: testInfo.outputPath("schedule-card-photo.png") });
});

test("a slideshow or carousel has its own page; the Calendar points to it", async ({ page }, testInfo) => {
  const { user } = await seedCoreDraft();
  await signIn(page, user);
  await page.goto("/app/schedule");
  await expect(page.getByTestId("v2-schedule")).toBeVisible();
  await expect(page.getByTestId("photo-post")).toHaveCount(0);
  await page.getByTestId("calendar-photos-link").getByRole("link", { name: "Photos" }).click();
  await expect(page).toHaveURL(/\/app\/photos$/);
  await expect(page.getByRole("heading", { name: "Slideshows and carousels" })).toBeVisible();
  await expect(page.getByTestId("photo-post")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("photos-page.png") });
  await expect(page.getByRole("link", { name: "Photos" }).first()).toBeVisible();
});
