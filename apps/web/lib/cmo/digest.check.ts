/**
 * The morning email leads with people (wave 2, B1): people asking (at most 3, strongest first, a quote, a link to the
 * card), up to 2 follow-ups, one line for posts. Empty when there is no new person, follow-up or post due today. No
 * "Went out", no "Stuck"; the footer says replies are never posted for you. Links only open things.
 *
 *     cd apps/web && npx tsx lib/cmo/digest.check.ts
 */
import assert from "node:assert/strict";

import { buildDigest, digestScheduleLabel, personQuote, type DigestInput, type DigestPerson } from "./digest";

const failures: string[] = [];
function check(name: string, run: () => void): void {
  try {
    run();
  } catch (err) {
    failures.push(`${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

const NOW = new Date("2026-11-10T07:00:00Z");
const base: DigestInput = {
  appUrl: "https://ferreto.io/",
  dateLabel: "Tuesday 10 Nov",
  timezone: "UTC",
  now: NOW,
  people: [],
  followUps: [],
  posts: { waiting: 0, firstId: null, nextAt: null, autopilot: false, platform: null },
  schedule: digestScheduleLabel("weekdays", 8),
  unsubscribeUrl: "https://ferreto.io/unsubscribe?token=t",
  waiting: [],
  wentOut: [{ title: "Old post", where: "X" }],
  stuck: [{ title: "A failed job", department: "sales", reason: "Over budget." }],
};
const person = (i: number, extra: Partial<DigestPerson> = {}): DigestPerson => ({
  approvalId: `c${i}`,
  title: `Thread ${i}`,
  source: i % 2 ? "Hacker News" : "r/SaaS",
  score: 60 + i * 5,
  quote: `I lose two hours a week on invoices (${i})`,
  isNew: true,
  ...extra,
});

check("people first: at most three, strongest first, match, quote, card link", () => {
  const d = buildDigest({ ...base, people: [0, 1, 2, 3, 4].map((i) => person(i)) });
  assert.equal(d.subject, "5 people are asking on r/SaaS and Hacker News");
  const lines = d.text.split("\n");
  const start = lines.indexOf("PEOPLE ASKING");
  assert.ok(start > 0, d.text);
  assert.equal(lines[start + 1], "- r/SaaS · Strong match · new");
  assert.equal(lines[start + 2], "  Thread 4");
  assert.equal(lines[start + 3], "  “I lose two hours a week on invoices (4)”");
  assert.equal(lines[start + 4], "  https://ferreto.io/app/inbox/c4");
  assert.ok(d.text.includes("- Hacker News · Good match · new\n  Thread 1") === false, "the weakest two are not listed");
  assert.ok(d.text.includes("2 more in Sales: https://ferreto.io/app/sales"));
  assert.equal(d.preview, "“I lose two hours a week on invoices (4)”", "the preview is the strongest quote");
  assert.equal(d.empty, false);
  assert.deepEqual(d.summary, { people: 3, followUps: 0, posts: 0 });
});

check("no Went out, no Stuck, the new footer", () => {
  const d = buildDigest({ ...base, people: [person(1)] });
  assert.ok(!/Went out|Stuck|Nothing goes out until you approve it/.test(d.text + d.html));
  assert.ok(d.text.includes("Replies are never posted for you."));
  assert.ok(d.text.includes("You get this email every weekday at 08:00."));
  assert.ok(d.text.includes("Change when it comes: https://ferreto.io/app/settings#notifications"));
  assert.ok(d.text.includes("Stop these emails: https://ferreto.io/unsubscribe?token=t"));
  assert.ok(d.text.includes("support@ferreto.io"));
  assert.ok(!/—/.test(d.text + d.html), "no em dashes (no-ai-slop)");
});

check("follow-ups: at most two, with the thread link", () => {
  const f = (i: number) => ({ title: `Reply thread ${i}`, source: "r/SaaS", replies: i, url: `https://reddit.com/r/SaaS/${i}` });
  const d = buildDigest({ ...base, followUps: [f(1), f(2), f(3)] });
  assert.equal(d.subject, "Someone answered your reply on r/SaaS");
  assert.ok(d.text.includes("FOLLOW UP\n- 1 reply to your answer on r/SaaS\n  Reply thread 1\n  https://reddit.com/r/SaaS/1"));
  assert.ok(d.text.includes("2 replies to your answer"));
  assert.ok(!d.text.includes("Reply thread 3"));
  assert.equal(d.empty, false);
});

check("posts: one line with the next deadline; a post due today is not empty", () => {
  const d = buildDigest({ ...base, posts: { waiting: 2, firstId: "p1", nextAt: "2026-11-10T14:00:00Z", autopilot: false, platform: null } });
  assert.equal(d.subject, "2 posts wait for you");
  assert.ok(d.text.includes("POSTS\n2 posts wait for you. The next one needs your OK by 14:00. https://ferreto.io/app/inbox/p1"), d.text);
  assert.equal(d.empty, false);
  const later = buildDigest({ ...base, posts: { waiting: 1, firstId: "p1", nextAt: "2026-11-12T14:00:00Z", autopilot: false, platform: null } });
  assert.ok(later.text.includes("needs your OK by Thu 14:00"));
  assert.equal(later.empty, true, "nothing due today, no person, no follow-up: not sent");
});

check("autopilot: the line says when it goes out on its own", () => {
  const d = buildDigest({ ...base, timezone: "Asia/Ho_Chi_Minh", posts: { waiting: 1, firstId: "p1", nextAt: "2026-11-10T07:00:00Z", autopilot: true, platform: "X" } });
  assert.ok(d.text.includes("1 post waits for you. The X post goes out at 14:00 unless you edit or skip it."), d.text);
  assert.equal(d.empty, false);
});

check("people already sent before are listed but do not make an email", () => {
  const d = buildDigest({ ...base, people: [person(1, { isNew: false })] });
  assert.equal(d.empty, true);
  assert.ok(!d.text.includes("· new"));
  assert.equal(buildDigest(base).empty, true);
});

check("titles and quotes are escaped; no link decides anything", () => {
  const d = buildDigest({ ...base, people: [person(1, { title: "<script>x</script>", quote: "a <b> & c" })] });
  assert.ok(!d.html.includes("<script>") && d.html.includes("&lt;script&gt;"));
  assert.ok(d.html.includes("a &lt;b&gt; &amp; c"));
  assert.ok(d.html.includes('href="https://ferreto.io/app/inbox/c1"'));
  assert.ok(![...d.html.matchAll(/href="([^"]*)"/g)].some(([, href]) => /approve|decide/i.test(href!)));
});

check("the quote is the thread's own words, never the scan's 'no pain' note", () => {
  assert.equal(personQuote([{ label: "Pain", score: 20, evidence: "“invoices eat my week”" }]), "invoices eat my week");
  assert.equal(personQuote([{ label: "Pain", score: 0, evidence: "No clear pain in their words" }, { label: "Evidence", score: 5, evidence: "“I tried three tools”" }]), "I tried three tools");
  assert.equal(personQuote([{ label: "Pain", score: 0, evidence: "No clear pain in their words" }]), null);
  assert.equal(personQuote(null), null);
});

check("schedule labels", () => {
  assert.equal(digestScheduleLabel("weekdays", 8), "every weekday at 08:00");
  assert.equal(digestScheduleLabel("monday", 9), "every Monday at 09:00");
  assert.equal(digestScheduleLabel("daily", 7), "every morning at 07:00");
});

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("digest.check: every check passed");
