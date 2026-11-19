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
import type { JobContext } from "../../runner";
import { dmProblems, draftMessages, emailInPage, linkedSite, librarySummary, nudgeProblems, quoteIn, reachFor, REPLY_MAX_WORDS, sameAsTitle, scoreThread, themeName, type RuleRead } from "../../sales-scan";
import { think } from "../../think";
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
    // The business site the post links, never a platform or a short link.
    result("linked-site", linkedSite("see https://www.reddit.com/r/x and https://bit.ly/a, our site https://studio-dana.com/about.")?.href === "https://studio-dana.com/"
      && linkedSite("only https://www.linkedin.com/in/dana") === null),
    result("site-email", emailInPage('<a href="mailto:hello@studio-dana.com?subject=hi">Mail</a>') === "hello@studio-dana.com"
      && emailInPage("<p>Write to <b>dana@studio-dana.com</b></p>") === "dana@studio-dana.com" && emailInPage("<p>noreply@x.com</p>") === null),
    result("site-email-counts", check(base, {}, safe).level === "dm_ready"
      && reachFor(base, scored(base), scoreThread(base, scored(base), now.getTime())!.parts, safe, now, "dana@studio-dana.com").level === "email_ready"),
  ];
}

/**
 * Wave 3 B2: a DM for a DM-ready person and a nudge for a reply with no answer. Code tier: no link, short, the product
 * named once and as the founder's, no public reply claimed that never happened, a nudge that is not a bare bump.
 * Judge tier: the DM refers to what the person wrote; the nudge adds something new.
 */
async function runMessages(fixture: RedditFixture, env: EvalEnv): Promise<CaseResult[]> {
  const id = (output: string) => `w4:messages:${output}`;
  const product = String(fixture.docs.product?.name ?? "");
  const products = [product];
  const result = (name: string, pass: boolean, notes: string[] = []): CaseResult => ({ id: id(name), epoch: env.epoch, pass, decided_by: "code", notes });
  // The graders catch what they exist to catch.
  const graders = [
    result("grader:link", dmProblems(`I make ${product}. See https://duely.example`, products, true).includes("has a link")),
    result("grader:claimed-reply", dmProblems(`I replied in the thread. I make ${product}, want the link?`, products, false).includes("says you replied, and you did not")),
    result("grader:undisclosed", dmProblems(`${product} would fix this for you. Want the link?`, products, false).includes("names the product without saying it is yours")),
    result("grader:bump", nudgeProblems("Just checking in on this!", products).includes("only bumps the thread")),
    result("grader:nudge-product", nudgeProblems(`Have you tried ${product}?`, products).includes("names the product")),
  ];

  const ctx = { now: new Date(), think: (call: Parameters<JobContext["think"]>[0]) => think(call) } as unknown as JobContext;
  const fit = fixture.threads.filter((t) => t.expect === "fit").slice(0, 2).map((t) => ({ ...toThread(t), platform: "reddit" as const }));
  const reply = "Put the due date and the late fee on the invoice itself, then send the same short reminder on day 3, 7 and 14.";
  const targets = [{ thread: fit[0]!, reply }, { thread: fit[1]!, reply: null }];
  const dms = await draftMessages(ctx, "dm", { docs: fixture.docs, voice: "", targets });
  const nudges = await draftMessages(ctx, "nudge", { docs: fixture.docs, voice: "", targets: [{ thread: fit[0]!, reply }] });
  const out: CaseResult[] = [...graders, result("dm:drafted", dms.textFor.size === 2, [`${dms.textFor.size} of 2 passed the checks`]), result("nudge:drafted", nudges.textFor.size === 1)];
  for (const [index, text] of dms.textFor) {
    if (env.provider !== "fake") env.log(`dm ${index}: ${text}`);
    out.push(await cascade(id(`dm:${index}`), env.epoch, [], env.judge, {
      job: "w4",
      docs: fixture.docs,
      output: text,
      criteria: ["The message refers to what the person wrote, says the product is the founder's own, and asks before sending a link."],
    }));
  }
  for (const text of nudges.textFor.values()) {
    if (env.provider !== "fake") env.log(`nudge: ${text}`);
    out.push(await cascade(id("nudge"), env.epoch, [], env.judge, {
      job: "w4",
      docs: fixture.docs,
      output: text,
      criteria: ["The follow-up adds one useful thing the first reply did not say, and does not only ask for an answer."],
    }));
  }
  // Wave 3 B4: the founder's writing samples and intro line reach the DM and nudge prompts as <founder_writing>.
  const seen: string[] = [];
  const capture = { now: new Date(), think: async (call: Parameters<JobContext["think"]>[0]) => (seen.push(`${call.system}\n${call.prompt}`), call.fake!()) } as unknown as JobContext;
  const branded = { ...fixture.docs, brand: { ...(fixture.docs.brand ?? {}), voice_samples: ["Chasing invoices is the worst part of my week, so I wrote it down."], intro_line: "I make Duely so freelancers stop chasing." } };
  await draftMessages(capture, "dm", { docs: branded, voice: "", targets: [targets[0]!] });
  await draftMessages(capture, "nudge", { docs: branded, voice: "", targets: [targets[0]!] });
  const carried = seen.length === 2 && seen.every((p) => p.includes("<founder_writing>") && p.includes("so I wrote it down") && p.includes("<intro_line>I make Duely"));
  out.push(result("founder-writing", carried, [`${seen.length} prompts`]));
  return out;
}

/**
 * Wave 3 B1/B2 through the real scan: a buyer who asks for a tool and says "DM me" is DM ready with a drafted DM; the
 * same post on Hacker News stays Reply first with no DM, since HN has no DMs.
 */
async function runReachScan(fixture: RedditFixture, env: EvalEnv): Promise<CaseResult[]> {
  const id = (output: string) => `w4:reach-scan:${output}`;
  const postedAt = new Date(Date.now() - 6 * 3_600_000).toISOString();
  const text = "I'm a freelance designer with about ten clients. Three of them are over 60 days late and I hate writing the follow-up emails. Is there a tool people actually use for this? Happy to try one, DM me.";
  const reddit: RedditThread = { url: "https://www.reddit.com/r/freelance/comments/dm1/late/", community: "freelance", title: "How do you chase clients who pay 60 days late?", author: "pixelpusher", text, comments: 6, postedAt };
  const hn = { url: "https://news.ycombinator.com/item?id=4242", objectId: "4242", community: "Hacker News" as const, title: "Ask HN: How do you chase clients who pay 60 days late?", author: "pg2", text, points: 12, comments: 9, postedAt };
  const mem = memoryStore(fixture.docs, []);
  const run = mem.enqueue("sales_scan", {});
  await env.drain(mem.store, { runId: run.id, budgetMs: 240_000, searchReddit: async () => [reddit], searchHn: async () => [hn], searchConversations: async () => [] });
  const state = mem.runs.find((r) => r.id === run.id);
  if (state?.status !== "done") return [{ id: id("run"), epoch: env.epoch, pass: false, decided_by: "error", notes: [state?.error ?? "the scan did not finish"] }];
  const r = mem.people.get(reddit.url);
  const h = mem.people.get(hn.url);
  const products = [String(fixture.docs.product?.name ?? "")];
  const dmIssues = r?.dm ? dmProblems(r.dm, products, true) : ["no DM drafted"];
  if (env.provider !== "fake" && r?.dm) env.log(`dm: ${r.dm}`);
  return [
    { id: id("run"), epoch: env.epoch, pass: true, decided_by: "code" },
    { id: id("reddit-dm-ready"), epoch: env.epoch, pass: r?.level === "dm_ready" && !dmIssues.length, decided_by: "code", notes: [String(r?.level), ...dmIssues, ...(r?.reach.reasons ?? [])] },
    { id: id("hn-reply-first"), epoch: env.epoch, pass: !!h && h.level === "reply_first" && !h.dm, decided_by: "code", notes: [String(h?.level), ...(h?.reach.reasons ?? [])] },
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
    results.push(...(await runMessages(REDDIT_FIXTURES[0]!, env)));
    results.push(...(await runReachScan(REDDIT_FIXTURES[0]!, env)));
    return results;
  },
};

registerCases([salesCase]);
