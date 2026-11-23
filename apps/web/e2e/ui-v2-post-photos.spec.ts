import { deflateSync } from "node:zlib";

import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { openFeedCard, signIn, state } from "./helpers";
import { seedCoreDraft } from "./ui-v2-seed";

/**
 * Photos on a text post (owner, 2026-11-13; `docs/plans/cmo/2026-11-13-post-photos-plan.md`). The founder adds their
 * own photo on the post's card, approves, and every slot carries it. The SQL is `supabase/tests/313_post_photos.test.sql`.
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
  let card = await openFeedCard(page, "Post for 3 platforms");
  const photos = card.getByTestId("post-photos");
  await expect(photos).toContainText("Add photos");
  await photos.locator('input[type="file"]').setInputFiles({ name: "desk.png", mimeType: "image/png", buffer: png() });
  await expect(card.getByRole("img", { name: "Photo 1" })).toBeVisible({ timeout: 30_000 });
  await expect
    .poll(async () => ((await db.from("content_items").select("photos").eq("id", itemId).single()).data?.photos as string[] | undefined)?.length)
    .toBe(1);
  // Saving the photos raises the post's card again (they are part of what is approved): find it afresh.
  // The queue can draw the raised card once more while it settles: the screenshot (a record, not a check) tries again.
  await expect(async () => {
    card = await openFeedCard(page, "Post for 3 platforms");
    await expect(card.getByRole("img", { name: "Photo 1" })).toBeVisible({ timeout: 30_000 });
    await card.screenshot({ path: testInfo.outputPath("post-card-photo.png"), timeout: 10_000 });
  }).toPass({ timeout: 90_000 });

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

test("the old photo-post and prompter addresses land on the app (deleted in wave 4b)", async ({ page }) => {
  const { user } = await seedCoreDraft();
  await signIn(page, user);
  for (const path of ["/app/photos", "/app/script/00000000-0000-4000-8000-000000000000/prompter"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/app$/);
  }
  await expect(page.locator(".td-views").getByRole("link", { name: "Photos" })).toHaveCount(0);

  // Four views in the bar: on a phone the row fits, never the page scrolling sideways.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const path of ["/app", "/app/schedule"]) {
    await page.goto(path);
    await expect(page.locator(".td-views")).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `no sideways scroll on ${path}`).toBeLessThanOrEqual(390);
  }
});

test("a quote card from the post's Library source is made, previewed, added as a photo and removed (wave 4b)", async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const db = admin();
  const { user, itemId } = await seedCoreDraft();
  // One conversation in the Library, with a quote, as a source of the post.
  const opp = await db.from("opportunities").insert({ user_id: user.id, platform: "reddit", url: `https://www.reddit.com/r/SaaS/comments/${itemId.slice(0, 6)}/quote/`,
    community: "SaaS", title: "Forms", score: 70, reply: "" }).select("id").single();
  expect(opp.error).toBeNull();
  const quote = "I pay $50 a month for forms nobody fills in.";
  expect((await db.from("library_entries").insert({ opportunity_id: opp.data!.id, user_id: user.id, summary: "Forms cost too much for what they do",
    quotes: [{ kind: "pain", text: quote }], platform: "reddit", community: "r/SaaS" })).error).toBeNull();
  const { data: item } = await db.from("content_items").select("body").eq("id", itemId).single();
  expect((await db.from("content_items").update({ body: { ...(item!.body as object), sources: [{ opportunityId: opp.data!.id, summary: "Forms cost too much", platform: "reddit", community: "SaaS" }] } }).eq("id", itemId)).error).toBeNull();

  await signIn(page, user);
  await page.goto("/app");
  const card = await openFeedCard(page, "Post for 3 platforms");
  await card.getByTestId("quote-card-make").click();
  const maker = card.getByTestId("quote-card");
  await expect(maker.getByRole("radio", { name: new RegExp(quote.slice(0, 20).replace(/\$/g, "\\$")) })).toBeChecked();
  const preview = maker.getByRole("img", { name: "The quote card" });
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((img: HTMLImageElement) => img.naturalWidth), { timeout: 30_000 }).toBe(1080);
  await maker.screenshot({ path: testInfo.outputPath("quote-card-maker.png") });
  await maker.getByTestId("quote-card-add").click();
  await expect
    .poll(async () => ((await db.from("content_items").select("body").eq("id", itemId).single()).data?.body as { quote_card?: { quote?: string } }).quote_card?.quote, { timeout: 30_000 })
    .toBe(quote);
  // The photo raises the post's card again: find it afresh before looking at it.
  const raised = await openFeedCard(page, "Post for 3 platforms");
  await expect(raised.getByRole("img", { name: "Photo 1" })).toBeVisible({ timeout: 30_000 });

  // Removing the photo takes the quote card off the post.
  await raised.getByRole("button", { name: "Remove photo 1" }).click();
  await expect
    .poll(async () => "quote_card" in ((await db.from("content_items").select("body").eq("id", itemId).single()).data?.body as object))
    .toBe(false);
});
