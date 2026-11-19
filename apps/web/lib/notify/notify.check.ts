/**
 * Email (P6 C0) without network: which sender runs (the key alone never sends), what Resend is sent (only to its own
 * host, the one-click unsubscribe headers), when the morning email is due, and what the morning run logs.
 *
 *     cd apps/web && npx tsx lib/notify/notify.check.ts
 */
import assert from "node:assert/strict";

import { emailSender, SUPPORT_EMAIL, unsubscribeUrl, type EmailSender } from "./email";
import { cardTitle } from "@/lib/cmo/digest";

import { digestDue, sendDigestEmail } from "./send";

async function main() {
  // Selection.
  assert.equal(emailSender({ RESEND_API_KEY: "re_x" }), null, "the key alone (production's .env.local) never sends");
  assert.equal(emailSender({ RESEND_API_KEY: "re_x", OPENCMO_EMAIL_LIVE: "1" })?.name, "resend");
  assert.equal(emailSender({ OPENCMO_DIGEST_LOCAL_MAIL: "1" })?.name, "local");
  assert.equal(emailSender({}), null);

  // Resend: the key goes to Resend's host only; the unsubscribe headers ride along.
  const seen: { url: string; init: RequestInit }[] = [];
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    seen.push({ url: String(url), init: init! });
    return new Response(JSON.stringify({ id: "email_123" }), { status: 200 });
  }) as typeof fetch;
  const resend = emailSender({ RESEND_API_KEY: "re_secret", OPENCMO_EMAIL_LIVE: "1" }, fake)!;
  const url = unsubscribeUrl("https://ferreto.io/", "6f1c2c4e-3b0a-4c8e-9d7e-0a1b2c3d4e5f");
  assert.equal(url, "https://ferreto.io/unsubscribe?token=6f1c2c4e-3b0a-4c8e-9d7e-0a1b2c3d4e5f"); // gitleaks:allow (made-up unsubscribe token)
  assert.deepEqual(await resend.send({ to: "f@example.com", subject: "S", text: "T", html: "<p>H</p>", unsubscribeUrl: url }), { id: "email_123" });
  assert.equal(seen[0]!.url, "https://api.resend.com/emails");
  assert.equal((seen[0]!.init.headers as Record<string, string>).Authorization, "Bearer re_secret");
  const sent = JSON.parse(String(seen[0]!.init.body)) as { headers: Record<string, string>; reply_to: string; from: string };
  assert.equal(sent.headers["List-Unsubscribe"], `<${url}>`);
  assert.equal(sent.headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click");
  assert.equal(sent.reply_to, SUPPORT_EMAIL);
  assert.ok(!JSON.stringify(sent).includes("re_secret"), "the key is never in the body");
  const refusing = emailSender({ RESEND_API_KEY: "re_x", OPENCMO_EMAIL_LIVE: "1" }, (async () => new Response("{}", { status: 422 })) as typeof fetch)!;
  await assert.rejects(refusing.send({ to: "f@example.com", subject: "S", text: "T", html: "H", unsubscribeUrl: url }), /refused it \(422\)/);

  // The digest goes out at its hour, or up to two hours later when today's has not (a failed send is retried then).
  const due = (hour: number, digest_hour: number | null, digest_days: "weekdays" | "daily" | "monday" | "off" = "daily", weekday = 3) =>
    digestDue({ hour, weekday }, { digest_hour, digest_days });
  assert.ok(due(8, 8) && due(9, 8) && due(10, 8) && !due(11, 8) && !due(7, 8));
  assert.ok(due(23, 23) && !due(0, 23) && !due(1, 23), "the catch-up stops at midnight (the claim is per local date)");
  assert.ok(due(22, 22) && due(23, 22) && !due(0, 22));
  assert.ok(!due(8, null), "no digest hour, no digest");
  // Wave 2 B2: the days the founder picked, by local weekday (0 Sunday).
  assert.ok(due(8, 8, "weekdays", 1) && due(8, 8, "weekdays", 5) && !due(8, 8, "weekdays", 6) && !due(8, 8, "weekdays", 0), "weekdays: Monday to Friday");
  assert.ok(due(8, 8, "monday", 1) && !due(8, 8, "monday", 2), "Mondays only");
  assert.ok(due(8, 8, "daily", 0) && !due(8, 8, "off", 1), "every day, or never");

  // Wave 2 B2: a morning with nothing new is logged as skipped and not sent; a send that fails after the claim is
  // recorded as failed, so the claim never stays `claimed` and blocks the day.
  const run = async (cards: unknown[], sender: EmailSender) => {
    const calls: [string, Record<string, unknown>][] = [];
    const table = (rows: unknown[]) => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq", "gte", "gt", "lte", "neq", "order", "limit", "in"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: rows[0] ?? null, error: null });
      q.then = (resolve: (v: unknown) => void) => resolve({ data: rows, error: null });
      return q;
    };
    const admin = {
      from: (name: string) => table(name === "approvals" ? cards : []),
      rpc: async (name: string, args: Record<string, unknown>) => {
        calls.push([name, args]);
        if (name === "notify_settings_for") return { data: { unsubscribe_token: "tok", email_digest: true }, error: null };
        if (name === "email_log_claim") return { data: [{ log_id: "log-1", approval_ids: ["c-1"] }], error: null };
        if (name === "email_log_skip") return { data: "log-skip", error: null };
        return { data: null, error: null };
      },
    };
    const founder = { id: "u-1", email: "f@example.com", timezone: "UTC", digest_hour: 8, digest_days: "weekdays" as const };
    const outcome = await sendDigestEmail(admin as never, sender, founder, { appUrl: "https://ferreto.io", now: new Date("2026-11-02T08:00:00Z") });
    return { outcome, calls };
  };
  let sends = 0;
  const counting: EmailSender = { name: "local", send: async () => ((sends += 1), { id: "x" }) };
  const quiet = await run([], counting);
  assert.equal(quiet.outcome, "skipped");
  const skip = quiet.calls.find(([n]) => n === "email_log_skip");
  assert.ok(skip && (skip[1].p_summary as { note: string }).note.startsWith("Nothing new"), "the skipped row says why");
  assert.ok(!quiet.calls.some(([n]) => n === "email_log_claim") && sends === 0, "nothing claimed, nothing sent");

  const dueToday = [{ id: "c-1", kind: "post", department: "writer", ref_kind: "content_item", ref_id: "i-1", snapshot: { kind: "post", text: "A post" }, expires_at: null, auto_at: null, post_at: "2026-11-02T15:00:00Z" }];
  const ok = await run(dueToday, counting);
  assert.equal(ok.outcome, "sent");
  const claimArgs = ok.calls.find(([n]) => n === "email_log_claim")![1];
  assert.equal(claimArgs.p_subject, "1 post waits for you");
  assert.deepEqual(claimArgs.p_summary, { people: 0, followUps: 0, posts: 1 }, "the log keeps subject and summary");

  const failing: EmailSender = { name: "local", send: async () => { throw new Error("mail down"); } };
  const failed = await run(dueToday, failing);
  assert.equal(failed.outcome, "none");
  const done = failed.calls.find(([n]) => n === "email_log_done");
  assert.ok(done && done[1].p_log === "log-1" && done[1].p_error === "mail down", "the claim is recorded as failed");

  // One card title for the digest and Today (review follow-up S3): one line, where it goes.
  assert.equal(cardTitle({ kind: "schedule", text: "Launch day\nthread", platform: "x" }), "Launch day thread · X");
  assert.equal(cardTitle({}), "A card waits for you");

  console.log("notify: sender selection, Resend request, the digest days and hour, skipped mornings and failed claims");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
