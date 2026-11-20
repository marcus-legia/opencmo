/**
 * Email links (wave 4 B6):
 *
 *     cd apps/web && npx tsx lib/cmo/email-links.check.ts
 */
import assert from "node:assert/strict";

import { MAX_MAIL_URL, OPT_OUT_LINE, emailBody, emailSubject, mailLinks } from "./email-links";

const failures: string[] = [];
function check(label: string, run: () => void): void {
  try {
    run();
  } catch (err) {
    failures.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

check("the body ends with the opt-out line", () => assert.equal(emailBody("Hi Sam,\nSaw your post."), `Hi Sam,\nSaw your post.\n\n${OPT_OUT_LINE}`));
check("the opt-out line is not added twice", () => assert.equal(emailBody(`Hi.\n\n${OPT_OUT_LINE}`), `Hi.\n\n${OPT_OUT_LINE}`));
check("an empty draft has no body", () => assert.equal(emailBody("  \n "), ""));
check("the subject names their post", () => assert.equal(emailSubject("Typeform  is too expensive"), "About your post: Typeform is too expensive"));
check("a long title is cut to 120 characters", () => assert.equal(emailSubject("x".repeat(300)).length, 120));
check("no title still gives a subject", () => assert.equal(emailSubject(""), "About your post"));

check("Gmail compose link carries the address, subject and body", () => {
  const { gmail } = mailLinks("sam@example.com", "About your post: forms", "Hi & thanks?");
  const url = new URL(gmail!);
  assert.equal(url.origin, "https://mail.google.com");
  assert.equal(url.searchParams.get("view"), "cm");
  assert.equal(url.searchParams.get("to"), "sam@example.com");
  assert.equal(url.searchParams.get("su"), "About your post: forms");
  assert.equal(url.searchParams.get("body"), `Hi & thanks?\n\n${OPT_OUT_LINE}`);
});
check("mailto keeps the address readable and encodes the rest", () => {
  const { mailto } = mailLinks("sam@example.com", "A b", "Line 1\nLine 2 & more");
  assert.ok(mailto!.startsWith("mailto:sam@example.com?subject=A%20b&body="));
  assert.ok(mailto!.includes("Line%201%0ALine%202%20%26%20more"));
});
check("a header cannot be injected through the address", () => {
  const { mailto } = mailLinks("sam@example.com?bcc=x@y.z", "s", "b");
  assert.ok(!mailto!.includes("?bcc="));
});
check("a body too long for a URL gives no link (copy instead)", () => {
  const links = mailLinks("sam@example.com", "s", "word ".repeat(600));
  assert.deepEqual(links, { gmail: null, mailto: null });
});
check("a body that fits gives links under the limit", () => {
  const links = mailLinks("sam@example.com", "s", "word ".repeat(100));
  assert.ok(links.gmail && links.gmail.length <= MAX_MAIL_URL);
  assert.ok(links.mailto && links.mailto.length <= MAX_MAIL_URL);
});
check("no address or no body gives no link", () => {
  assert.deepEqual(mailLinks("", "s", "b"), { gmail: null, mailto: null });
  assert.deepEqual(mailLinks("a@b.co", "s", " "), { gmail: null, mailto: null });
});

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("email-links: ok");
