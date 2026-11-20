import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";
import { expect, test } from "@playwright/test";

import { sidewaysOverflow, signIn, state } from "./helpers";
import { ONBOARDING_DOCUMENT } from "./ui-v2-seed";

/**
 * Reaching out and following up (wave 3, C4): "Ready to reach out" with its five checks, the DM tab open for a DM-ready
 * person and locked (with why) on Hacker News, "I sent it" moving a person to Following up, "I replied" asking for the
 * reply's link (a wrong link refused), and the status select and the nudge in Following up. Seeded as the scan stores
 * them (`cmo_save_reach`). Screenshots: `test-results/sales-*.png`.
 */
test.skip(process.env.NEXT_PUBLIC_OPENCMO_UI !== "v2", "v2 UI only: run with npm run test:e2e:v2");

const admin = () => {
  const { url, service } = state();
  return createClient(url, service, { auth: { persistSession: false } });
};

const reach = (over: Record<string, unknown>) => ({
  buyer: true,
  wantsNow: true,
  warm: false,
  fresh: true,
  dmAllowed: true,
  asksForTools: true,
  emailFound: null,
  reasons: ["Says who they are: “I run a two-person studio”", "Wants a fix now", "Asks for tools, but has not answered you yet", "Posted today", "Reddit allows DMs"],
  ...over,
});

async function seed() {
  const db = admin();
  const email = `e2e-people-${randomUUID()}@test.local`;
  const password = `pw-${randomUUID()}`;
  const created = await db.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw new Error(created.error.message);
  const userId = created.data.user!.id;
  const must = (r: { error: { message: string } | null }, what: string) => {
    if (r.error) throw new Error(`could not seed ${what}: ${r.error.message}`);
  };
  must(await db.from("marketing_documents").insert({ user_id: userId, ...ONBOARDING_DOCUMENT }), "a document");
  // Paid: credits on the ledger, so the reply and DM drafts are read (an unpaid account never sees them).
  must(await db.from("credit_ledger").insert({ user_id: userId, delta: 50, reason: "E2E top-up" }), "credits");
  const now = new Date().toISOString();
  const rows = [
    { url: "https://www.reddit.com/r/SaaS/comments/e2edm/invoices_on_time/", platform: "reddit", community: "SaaS", title: "How do you get clients to pay invoices on time?", score: 86,
      reply: "Put the due date and the late fee on the invoice itself.", reach_level: "dm_ready", reach: reach({}), dm_draft: "Hi, saw your post about late invoices. I answered there too. Want the link to the tool I built?" },
    { url: "https://news.ycombinator.com/item?id=424242", platform: "hn", community: "Ask HN", title: "Ask HN: invoicing for solo consultants?", score: 79,
      reply: "I bill monthly and send reminders on day 3, 7 and 14.", reach_level: "reply_first", reach: reach({ dmAllowed: false, reasons: ["Says who they are", "Wants a fix now", "Has not answered you yet", "Posted today", "Hacker News has no DMs"] }) },
    { url: "https://www.reddit.com/r/freelance/comments/e2ert/forty_five_days/", platform: "reddit", community: "freelance", title: "Is it normal to wait 45 days for payment?", score: 74,
      reply: "It is common, and it can change.", reach_level: "reply_first", reach: reach({ buyer: false, asksForTools: false, reasons: ["Not clear they are a buyer like your customers", "Wants a fix now", "Has not answered you yet", "Posted today", "Reddit allows DMs"] }) },
    { url: "https://www.reddit.com/r/consulting/comments/e2eemail/net30/", platform: "reddit", community: "consulting", title: "Net 30 keeps turning into net 60", score: 60,
      reply: "Send the reminder before the due date, not after.", reach_level: "email_ready",
      reach: reach({ warm: true, emailFound: "sam@example.com", reasons: ["Says who they are", "Wants a fix now", "Answered your reply", "Posted today", "Reddit allows DMs", "Published sam@example.com in the post"] }),
      dm_draft: "Hi Sam, I saw your post about net 30 turning into net 60. I built a small tool for it." },
  ];
  const { data: opps, error } = await db
    .from("opportunities")
    .insert(rows.map((r) => ({ ...r, user_id: userId, posted_at: now, rule: "mention_ok", rule_why: "r/SaaS allows it if you say it is yours" })))
    .select("id, url");
  if (error || !opps) throw new Error(`could not seed the threads: ${error?.message}`);
  // Someone replied to four days ago, with a nudge drafted.
  const nudged = await db
    .from("opportunities")
    .insert({ user_id: userId, url: "https://www.reddit.com/r/smallbusiness/comments/e2enudge/chasing/", platform: "reddit", community: "smallbusiness", title: "What is your system for chasing invoices?", score: 70, posted_at: now, status: "replied", person_status: "replied", replied_at: now, decided_at: now, nudge_draft: "Did the reminder schedule help? Happy to share the template." })
    .select("id")
    .single();
  must(nudged, "a person to nudge");
  const id = (url: string) => opps.find((o) => o.url === url)!.id;
  return { user: { email, password, id: userId }, emailPerson: id(rows[3]!.url), dm: id(rows[0]!.url), hn: id(rows[1]!.url), plain: id(rows[2]!.url), plainUrl: rows[2]!.url, nudged: nudged.data!.id };
}

test("reach out: five checks, DM open or locked with why, I sent it, I replied with its link, Following up", async ({ page }) => {
  test.setTimeout(120_000);
  const s = await seed();
  const db = admin();
  await signIn(page, s.user);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/app/sales");

  const thread = (title: string) => page.getByRole("listitem").filter({ hasText: title });
  // The best open thread starts open; another one opens on a click.
  const openThread = async (title: string) => {
    const row = thread(title);
    const toggle = row.getByRole("button", { name: new RegExp(title.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }).first();
    if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
    return row;
  };
  // The DM-ready person: the level, the five checks with the scan's reasons, the DM draft with Copy and open.
  const dm = await openThread("How do you get clients to pay invoices on time?");
  const panel = dm.getByTestId("sales-reach");
  await expect(panel.getByTestId("sales-reach-level")).toHaveText("DM ready");
  await expect(panel.getByTestId("sales-reach-check")).toHaveCount(5);
  await expect(panel).toContainText("Reddit allows DMs");
  await panel.getByRole("tab", { name: "DM" }).click();
  await expect(panel.getByTestId("sales-dm").getByRole("textbox")).toHaveValue(/saw your post about late invoices/);
  await expect(panel.getByRole("button", { name: "Copy and open Reddit chat" })).toBeVisible();
  await panel.getByRole("tab", { name: /Email/ }).click();
  await expect(panel.getByTestId("sales-email-locked")).toContainText("Reply in public first");
  await page.screenshot({ path: "test-results/sales-reach-1440.png" });

  // "I sent it" marks the person replied; no link is asked for a DM.
  await panel.getByRole("tab", { name: "DM" }).click();
  await panel.getByRole("button", { name: "I sent it" }).click();
  await expect.poll(async () => (await db.from("opportunities").select("status, person_status").eq("id", s.dm).single()).data).toEqual({ status: "replied", person_status: "replied" });
  await expect(page.getByTestId("sales-reply-link")).toHaveCount(0);

  // Hacker News has no DMs: the tab says so.
  const hn = await openThread("Ask HN: invoicing for solo consultants?");
  await hn.getByTestId("sales-reach").getByRole("tab", { name: /DM/ }).click();
  await expect(hn.getByTestId("sales-dm-locked")).toContainText("Hacker News has no private messages.");

  // "I replied" asks for the link; one from another thread is refused, the right one is kept.
  const plain = await openThread("Is it normal to wait 45 days for payment?");
  await plain.getByRole("button", { name: "I replied" }).click();
  const ask = page.getByTestId("sales-reply-link");
  await expect(ask).toContainText("Nice. Where did you post it?");
  await ask.getByLabel("Link to your reply").fill("https://www.reddit.com/r/SaaS/comments/other/thread/");
  await ask.getByRole("button", { name: "Save and follow up" }).click();
  await expect(ask.getByRole("alert")).toContainText("Paste the link to your reply in this thread.");
  const link = `${s.plainUrl}comment/abc123/`;
  await ask.getByLabel("Link to your reply").fill(link);
  await ask.getByRole("button", { name: "Save and follow up" }).click();
  await expect(ask).toHaveCount(0);
  expect((await db.from("opportunities").select("reply_url").eq("id", s.plain).single()).data!.reply_url).toBe(link.replace(/\/$/, "")); // stored without the trailing slash (#239)

  // Following up: everyone replied to, the nudge, and the status select.
  await page.getByRole("tab", { name: /Following up/ }).click();
  const following = page.getByTestId("sales-following");
  await expect(following.getByTestId("sales-person")).toHaveCount(3);
  const nudged = following.getByTestId("sales-person").filter({ hasText: "What is your system for chasing invoices?" });
  await nudged.getByRole("button", { name: "Read the nudge" }).click();
  await expect(nudged.getByTestId("sales-nudge")).toContainText("Did the reminder schedule help?");
  const person = following.getByTestId("sales-person").filter({ hasText: "Is it normal to wait 45 days" });
  await person.getByLabel("Mark").selectOption("talking");
  await expect.poll(async () => (await db.from("opportunities").select("person_status").eq("id", s.plain).single()).data!.person_status).toBe("talking");
  await expect(person.getByTestId("sales-person-status")).toHaveText("Talking");
  await page.screenshot({ path: "test-results/sales-following-1440.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await sidewaysOverflow(page);
  expect(overflow.width, `sideways scroll from: ${overflow.culprits.join("; ")}`).toBeLessThanOrEqual(390);
  await page.screenshot({ path: "test-results/sales-following-390.png", fullPage: true });
});

test("email ready: the Email tab opens Gmail or the mail app with the subject, the draft and the opt-out line (wave 4b)", async ({ page }) => {
  const s = await seed();
  await signIn(page, s.user);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/app/sales");
  const row = page.getByRole("listitem").filter({ hasText: "Net 30 keeps turning into net 60" });
  const toggle = row.getByRole("button", { name: /Net 30 keeps turning/ }).first();
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
  const panel = row.getByTestId("sales-reach");
  await expect(panel.getByTestId("sales-reach-level")).toHaveText("Email ready");
  await panel.getByRole("tab", { name: /Email/ }).click();
  const email = panel.getByTestId("sales-email");
  await expect(email).toContainText("sam@example.com");
  await expect(email).toContainText("About your post: Net 30 keeps turning into net 60");
  const gmail = new URL((await email.getByTestId("sales-email-gmail").getAttribute("href"))!);
  expect(gmail.origin).toBe("https://mail.google.com");
  expect(gmail.searchParams.get("to")).toBe("sam@example.com");
  expect(gmail.searchParams.get("su")).toBe("About your post: Net 30 keeps turning into net 60");
  expect(gmail.searchParams.get("body")).toMatch(/net 30 turning into net 60[\s\S]*tell me and I will not write again\.$/);
  expect(await email.getByTestId("sales-email-mailto").getAttribute("href")).toMatch(/^mailto:sam@example\.com\?subject=/);
  // A body too long for a link offers Copy only.
  await email.getByRole("textbox", { name: "Email" }).fill("word ".repeat(600));
  await expect(email.getByTestId("sales-email-long")).toBeVisible();
  await expect(email.getByTestId("sales-email-gmail")).toHaveCount(0);
  expect((await sidewaysOverflow(page)).culprits).toEqual([]);
  await page.screenshot({ path: "test-results/sales-email-1440.png" });
});
