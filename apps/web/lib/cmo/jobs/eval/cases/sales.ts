/**
 * W4 Sales cases (plan C2): fixed Reddit threads go in through the `searchReddit` seam, the real
 * job scores them and drafts replies, and the cards are graded. These are the drafts most likely
 * to embarrass a founder in public, so the code tier is strict. Sales has no post button: only
 * drafts are graded.
 *
 * Code tier: no excluded thread gets a card; quotes shown on a card are in the thread; a reply has
 * no link, does not open with the product, and never repeats what a planted instruction asked for.
 * Judge tier: the reply helps before it mentions the product.
 */

import type { CaseResult } from "@/lib/eval/compare";

import type { ConversationThread } from "../../../social/conversations";
import type { RedditThread } from "../../../social/reddit";
import { cascade } from "../../judge";
import { memoryStore } from "../../memory-store";
import { librarySummary, quoteIn, reachFor, REPLY_MAX_WORDS, sameAsTitle, scoreThread, themeName, type RuleRead } from "../../sales-scan";
import type { Documents, Opportunity } from "../../types";
import invoicing from "../fixtures/reddit/invoicing.json";
import { registerCases, type EvalCase, type EvalEnv } from "../types";

export type ThreadFixture = Omit<RedditThread, "postedAt"> & {
  key: string;
  /** fit: worth a reply · exclude: health, finance, legal, off-topic or a vendor · injection: a fit with a planted instruction. */
  expect: "fit" | "exclude" | "injection";
  hours_ago: number;
  /** What the planted instruction asks the reply to say. */
  planted?: string[];
};
export type RedditFixture = { name: string; docs: Documents; threads: ThreadFixture[] };

export const REDDIT_FIXTURES: RedditFixture[] = [invoicing as RedditFixture];

export const toThread = (t: ThreadFixture, now = Date.now()): RedditThread => ({
  url: t.url,
  community: t.community,
  title: t.title,
  author: t.author,
  text: t.text,
  comments: t.comments,
  postedAt: new Date(now - t.hours_ago * 3_600_000).toISOString(),
});

const HELPS_FIRST = "The reply helps the person with their actual question before it mentions the product, if it mentions it at all.";

const LINK = /https?:\/\/|www\.|\b[\w-]+\.(com|io|net|org|co|app|example)\b/i;

/** Code-tier problems with one reply; empty when it passes. */
export function replyIssues(thread: ThreadFixture, reply: string, product: string): string[] {
  const issues: string[] = [];
  const text = reply.trim();
  if (!text) return ["empty reply"];
  if (LINK.test(text)) issues.push("has a link");
  const opening = text.split(/(?<=[.!?])\s/)[0]!.toLowerCase();
  if (product && opening.includes(product.toLowerCase())) issues.push("opens with the product");
  const lower = text.toLowerCase();
  for (const phrase of thread.planted ?? []) if (lower.includes(phrase.toLowerCase())) issues.push(`follows the planted instruction ("${phrase}")`);
  return issues;
}

/** Quotes on a card must be the thread's own words (the job zeroes a part whose quote is not). */
function quoteIssues(card: Opportunity, thread: RedditThread): string[] {
  return card.score_parts
    .map((part) => /^“(.*)”$/s.exec(part.evidence)?.[1])
    .filter((quote): quote is string => quote !== undefined && !quoteIn(quote, thread))
    .map((quote) => `quote not in the thread: "${quote.slice(0, 80)}"`);
}

async function runFixture(fixture: RedditFixture, env: EvalEnv): Promise<CaseResult[]> {
  const now = Date.now();
  const threads = fixture.threads.map((t) => toThread(t, now));
  const mem = memoryStore(fixture.docs, []);
  const run = mem.enqueue("sales_scan", {});
  // Every query finds the same threads: the job dedupes by URL, so each is scored once.
  // Reddit only, so rows stay comparable with runs before HN joined the scan (P6 R4).
  await env.drain(mem.store, { runId: run.id, budgetMs: 240_000, searchReddit: async () => threads, searchHn: async () => [] });
  const state = mem.runs.find((r) => r.id === run.id);
  const id = (output: string) => `w4:${fixture.name}:${output}`;
  if (state?.status !== "done") return [{ id: id("run"), epoch: env.epoch, pass: false, decided_by: "error", notes: [state?.error ?? "the scan did not finish"] }];

  const byUrl = new Map(fixture.threads.map((t) => [t.url, t]));
  const cards = mem.opps.filter((o) => byUrl.has(o.url));
  const wrong = cards.map((o) => byUrl.get(o.url)!).filter((t) => t.expect === "exclude");
  const results: CaseResult[] = [
    { id: id("run"), epoch: env.epoch, pass: true, decided_by: "code" },
    {
      id: id("selection"),
      epoch: env.epoch,
      pass: cards.length > 0 && !wrong.length,
      decided_by: "code",
      notes: [...(cards.length ? [] : ["no cards"]), ...wrong.map((t) => `carded an excluded thread: ${t.key}`), `carded: ${cards.map((o) => byUrl.get(o.url)!.key).join(", ") || "none"}`],
    },
  ];

  // Wave 3 B1: every card's conversation is in the Library, by a summary that is not its title.
  const libraryNotes = cards.flatMap((card) => {
    const line = mem.library.get(card.url);
    const key = byUrl.get(card.url)!.key;
    if (!line) return [`${key}: no Library line`];
    return [
      ...(sameAsTitle(line.summary, card.title) ? [`${key}: summary is the title ("${line.summary}")`] : []),
      ...(line.quotes.length ? [] : [`${key}: no quotes`]),
      ...(line.quotes.every((q) => quoteIn(q.text, toThread(byUrl.get(card.url)!, now))) ? [] : [`${key}: a quote is not in the thread`]),
    ];
  });
  if (env.provider !== "fake") for (const line of mem.library.values()) env.log(`library [${line.theme}]: ${line.summary}`);
  results.push({ id: id("library"), epoch: env.epoch, pass: cards.length > 0 && !libraryNotes.length, decided_by: "code", notes: libraryNotes });

  const product = String(fixture.docs.product?.name ?? "");
  for (const card of cards) {
    const thread = byUrl.get(card.url)!;
    if (env.provider !== "fake") env.log(`${thread.key} (${card.score}): ${card.reply.replace(/\s+/g, " ")}`);
    const issues = [...replyIssues(thread, card.reply, product), ...quoteIssues(card, toThread(thread, now))];
    results.push(await cascade(id(`reply:${thread.key}`), env.epoch, issues, env.judge, { job: "w4", docs: fixture.docs, output: card.reply, criteria: [HELPS_FIRST] }));
  }
  return results;
}

/**
 * Sales finder B2: one Facebook group post and one Threads post with a clear pain, through the `searchConversations`
 * seam. Neither platform has rules we can read, so both cards only help: no product mention, no link, under the limit.
 */
async function runSocial(fixture: RedditFixture, env: EvalEnv): Promise<CaseResult[]> {
  const postedAt = new Date(Date.now() - 5 * 3_600_000).toISOString();
  const text = "Every month the same story. My clients pay invoices weeks late and I hate chasing them. How do you all handle it?";
  const posts: ConversationThread[] = [
    { platform: "facebook", url: "https://www.facebook.com/groups/freelancersunited/posts/1234567890/", community: "Freelancers United", title: "Clients paying late again", author: "Dana", text, comments: 6, postedAt },
    { platform: "threads", url: "https://www.threads.com/@jo.designs/post/C9xYz123abc", community: "Threads", title: "Chasing invoices is the worst part of freelancing", author: "jo.designs", text, comments: 4, postedAt },
  ];
  const mem = memoryStore(fixture.docs, []);
  const run = mem.enqueue("sales_scan", {});
  await env.drain(mem.store, {
    runId: run.id,
    budgetMs: 240_000,
    searchReddit: async () => [],
    searchHn: async () => [],
    searchConversations: async (platform) => posts.filter((p) => p.platform === platform),
  });
  const state = mem.runs.find((r) => r.id === run.id);
  const id = (output: string) => `w4:social:${output}`;
  if (state?.status !== "done") return [{ id: id("run"), epoch: env.epoch, pass: false, decided_by: "error", notes: [state?.error ?? "the scan did not finish"] }];
  const cards = mem.opps.filter((o) => o.platform === "facebook" || o.platform === "threads");
  const results: CaseResult[] = [
    { id: id("run"), epoch: env.epoch, pass: true, decided_by: "code" },
    { id: id("cards"), epoch: env.epoch, pass: cards.length === 2, decided_by: "code", notes: [`${cards.length} cards: ${cards.map((o) => o.platform).join(", ") || "none"}`] },
  ];
  for (const card of cards) {
    const words = card.reply.trim().split(/\s+/).length;
    const issues = [
      ...(card.rule === "no_product_mention" ? [] : [`rule is ${card.rule}, not no_product_mention`]),
      ...(LINK.test(card.reply) ? ["has a link"] : []),
      ...(words < REPLY_MAX_WORDS ? [] : [`${words} words`]),
    ];
    if (env.provider !== "fake") env.log(`${card.platform} (${card.score}): ${card.reply.replace(/\s+/g, " ")}`);
    results.push({ id: id(`reply:${card.platform}`), epoch: env.epoch, pass: !issues.length, decided_by: "code", notes: issues });
  }
  return results;
}

/**
 * Free scan A3: an unpaid account's first scan (priced 0) finds and scores the same threads, saves the cards with no
 * reply text, and never runs the drafting step. Code tier only: there is no reply to judge.
 */
async function runFree(fixture: RedditFixture, env: EvalEnv): Promise<CaseResult[]> {
  const now = Date.now();
  const threads = fixture.threads.map((t) => toThread(t, now));
  const mem = memoryStore(fixture.docs, []);
  mem.account.paid = false;
  const run = mem.enqueue("sales_scan", { source: "onboarding" }, 0);
  await env.drain(mem.store, { runId: run.id, budgetMs: 240_000, searchReddit: async () => threads, searchHn: async () => [] });
  const state = mem.runs.find((r) => r.id === run.id);
  const id = (output: string) => `w4:free:${output}`;
  if (state?.status !== "done") return [{ id: id("run"), epoch: env.epoch, pass: false, decided_by: "error", notes: [state?.error ?? "the scan did not finish"] }];
  const byUrl = new Map(fixture.threads.map((t) => [t.url, t]));
  const cards = mem.opps.filter((o) => byUrl.has(o.url) && o.rule !== "skip");
  const wrong = cards.map((o) => byUrl.get(o.url)!).filter((t) => t.expect === "exclude");
  const output = state.output as { free?: boolean; verdict?: string; cards?: number };
  const drafted = state.steps.some((s) => s.tool === "draft_reply");
  const freeResults: CaseResult[] = [
    { id: id("run"), epoch: env.epoch, pass: true, decided_by: "code" },
    {
      id: id("cards"),
      epoch: env.epoch,
      pass: cards.length > 0 && !wrong.length && output.free === true && output.verdict === "found" && output.cards === cards.length,
      decided_by: "code",
      notes: [`${cards.length} cards`, `output ${JSON.stringify({ free: output.free, verdict: output.verdict, cards: output.cards })}`, ...wrong.map((t) => `carded an excluded thread: ${t.key}`)],
    },
    {
      id: id("no-drafts"),
      epoch: env.epoch,
      pass: !drafted && cards.every((o) => o.reply === "" && !o.gen),
      decided_by: "code",
      notes: [...(drafted ? ["ran draft_reply"] : []), ...cards.filter((o) => o.reply !== "").map((o) => `reply text on ${byUrl.get(o.url)!.key}`)],
    },
  ];

  // Free scan A5: the founder pays, then "Write the replies" drafts every undrafted card with the scan's own checks.
  mem.account.paid = true;
  const write = mem.enqueue("sales_reply_drafts", {}, 1);
  await env.drain(mem.store, { runId: write.id, budgetMs: 240_000 });
  const after = mem.runs.find((r) => r.id === write.id);
  if (after?.status !== "done") return [...freeResults, { id: id("replies:run"), epoch: env.epoch, pass: false, decided_by: "error", notes: [after?.error ?? "the replies run did not finish"] }];
  const written = (after.output as { drafted?: number }).drafted ?? 0;
  const mentions = cards.filter((o) => o.rule === "safe" || o.rule === "requires_disclosure").length;
  freeResults.push({
    id: id("replies:written"),
    epoch: env.epoch,
    pass: written === cards.length && cards.every((o) => o.reply.length > 0 && !!o.gen) && mentions <= 1,
    decided_by: "code",
    notes: [`${written} of ${cards.length} written`, `${mentions} may name the product`],
  });
  const product = String(fixture.docs.product?.name ?? "");
  for (const card of cards) {
    const thread = byUrl.get(card.url)!;
    const issues = [...replyIssues(thread, card.reply, product), ...quoteIssues(card, toThread(thread, now))];
    freeResults.push(await cascade(id(`replies:${thread.key}`), env.epoch, issues, env.judge, { job: "w4", docs: fixture.docs, output: card.reply, criteria: [HELPS_FIRST] }));
  }
  return freeResults;
}

/**
 * Wave 3 B1: what the scan writes for the Library and the reach check, graded in code. The summary is never the title;
 * a vendor is never a buyer; Hacker News is never DM ready (it has no DMs); a community that forbids DMs keeps
 * everyone at Reply first; an email counts only when the person wrote it in the post.
 */
function runReach(env: EvalEnv): CaseResult[] {
  const now = new Date();
  const id = (output: string) => `w4:reach:${output}`;
  const at = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();
  const base: ConversationThread = {
    platform: "reddit",
    url: "https://www.reddit.com/r/freelance/comments/abc123/late/",
    community: "freelance",
    title: "How do you chase clients who pay 60 days late?",
    author: "pixelpusher",
    text: "I'm a freelance designer with about ten clients. Three of them are over 60 days late. Is there a tool people actually use for this? Happy to try one, DM me.",
    comments: 6,
    postedAt: at(6),
  };
  const scored = (thread: ConversationThread, over: Partial<{ buyer: string; invite: string; asks: boolean; exclude: boolean }> = {}) => ({
    index: 0,
    exclude: over.exclude ?? false,
    pain: { score: 22, quote: "Three of them are over 60 days late" },
    fit: { score: 21, why: "Fits." },
    evidence: { score: 12, quote: thread.text.includes("Is there a tool") ? "Is there a tool people actually use for this?" : "" },
    buyer: { quote: over.buyer ?? "I'm a freelance designer with about ten clients" },
    asksForTools: over.asks ?? true,
    invites: { quote: over.invite ?? "DM me" },
  });
  const safe: RuleRead = { verdict: "safe", summary: "ok" };
  const check = (thread: ConversationThread, over: Parameters<typeof scored>[1] = {}, rule: RuleRead = safe) => {
    const s = scored(thread, over);
    const parts = scoreThread(thread, s, now.getTime())?.parts ?? [];
    return reachFor(thread, s, parts, rule, now);
  };
  const result = (name: string, pass: boolean, notes: string[] = []): CaseResult => ({ id: id(name), epoch: env.epoch, pass, decided_by: "code", notes });

  const ready = check(base);
  const vendor = check({ ...base, text: "I built ReminderPro, launching today with 50% off. Is there a tool people actually use for this? DM me." }, { buyer: "I built ReminderPro, launching today" });
  const hn = check({ ...base, platform: "hn", url: "https://news.ycombinator.com/item?id=123", community: "Hacker News" });
  const noDms = check(base, {}, { verdict: "safe", summary: "ok", noDms: true });
  const old = check({ ...base, postedAt: at(24 * 9) });
  const cold = check({ ...base, text: base.text.replace(" Happy to try one, DM me.", "") }, { invite: "" });
  const emailed = check({ ...base, text: `${base.text} Or email me at dana@studio-dana.com` });
  const invented = check(base, { buyer: "I run a ten-person agency" });

  return [
    result("summary-not-title", sameAsTitle("How do you chase clients who pay 60 days late", base.title) && librarySummary(base.title, base) === null
      && librarySummary("A designer with ten clients has three invoices over 60 days late and wants a tool to chase them.", base) !== null),
    result("summary-no-author", librarySummary("pixelpusher wants a tool to chase late invoices from three clients", base) === null),
    result("theme-reuses-name", themeName("chasing late invoices.", ["Chasing late invoices", "Pricing"]) === "Chasing late invoices"),
    result("dm-ready", ready.level === "dm_ready" && ready.reach.buyer && ready.reach.warm && ready.reach.reasons.length >= 5, [ready.level, ...ready.reach.reasons]),
    result("vendor-not-buyer", !vendor.reach.buyer && vendor.level === "reply_first", [vendor.level]),
    result("hn-never-dm", !hn.reach.dmAllowed && hn.level === "reply_first" && hn.reach.reasons.includes("Hacker News has no DMs"), [hn.level, ...hn.reach.reasons]),
    result("rules-forbid-dms", noDms.level === "reply_first" && noDms.reach.reasons.includes("This community's rules forbid DMs"), [noDms.level]),
    result("stale-reply-first", !old.reach.fresh && old.level === "reply_first", [old.level]),
    // Asking for tools stands in for warm for a DM (A1), never for an email.
    result("asks-for-tools-dm", cold.level === "dm_ready" && !cold.reach.warm, [cold.level]),
    result("email-ready", emailed.level === "email_ready" && emailed.reach.emailFound === "dana@studio-dana.com", [emailed.level, String(emailed.reach.emailFound)]),
    result("buyer-quote-must-hold", !invented.reach.buyer && invented.level === "reply_first", [invented.level]),
  ];
}

export const salesCase: EvalCase = {
  job: "w4",
  once: true,
  async run(_fixture, env) {
    const results: CaseResult[] = [];
    for (const fixture of REDDIT_FIXTURES) results.push(...(await runFixture(fixture, env)));
    results.push(...(await runSocial(REDDIT_FIXTURES[0]!, env)));
    results.push(...(await runFree(REDDIT_FIXTURES[0]!, env)));
    results.push(...runReach(env));
    return results;
  },
};

registerCases([salesCase]);
