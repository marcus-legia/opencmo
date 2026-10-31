/**
 * Email (P6 C0) without network: which sender runs (the key alone never sends), what Resend is sent (only to its own
 * host, the one-click unsubscribe headers), and the two emails: links open the card, nothing approves, the footer
 * names support and the unsubscribe page.
 *
 *     cd apps/web && npx tsx lib/notify/notify.check.ts
 */
import assert from "node:assert/strict";

import { emailFooter, emailSender, expiringEmail, SUPPORT_EMAIL, unsubscribeUrl } from "./email";

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
  const url = unsubscribeUrl("https://opencmo.io/", "6f1c2c4e-3b0a-4c8e-9d7e-0a1b2c3d4e5f");
  assert.equal(url, "https://opencmo.io/unsubscribe?token=6f1c2c4e-3b0a-4c8e-9d7e-0a1b2c3d4e5f");
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

  // The expiring email: opens the card, never approves; times in the founder's zone; the footer.
  const m = expiringEmail({
    appUrl: "https://opencmo.io",
    cardId: "c-1",
    title: "Most AI video tools stop at the first draft <script> on X",
    expiresAt: "2026-11-02T02:00:00Z",
    timezone: "Asia/Ho_Chi_Minh",
    unsubscribeUrl: url,
  });
  assert.match(m.subject, /^Approve by Mon 09:00: /);
  assert.ok(m.html.includes('href="https://opencmo.io/app/inbox/c-1"'), "the link opens the card");
  assert.ok(!/approve\?|action=approve|decide/i.test(m.html + m.text), "no link decides anything");
  assert.ok(!m.html.includes("<script>"), "outside text is escaped");
  assert.ok(m.text.includes(SUPPORT_EMAIL) && m.html.includes(url.replace(/&/g, "&amp;")), "support and unsubscribe in the footer");
  const footer = emailFooter(url);
  assert.ok(footer.text.includes(url) && footer.html.includes("Stop these emails"));

  console.log("notify: sender selection, Resend request, the expiring email and the footer");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
