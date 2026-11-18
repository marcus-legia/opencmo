/**
 * Free scan A5 (docs/plans/cmo/2026-11-18-free-scan-plan.md): after the founder pays, one click writes the replies of
 * the cards their free scan saved without one (`reply = ''`). Same drafting step, prompt and checks as a paid scan
 * (`draftReplies` in `sales-scan.ts`); there is still no posting step.
 *
 * The rules a card was saved under can be old: a Reddit community's rules are read again when the cache is older
 * than a week (`readCommunityRules` keeps fresh ones), and the one product mention per ten replies is counted again
 * now. Either can only tighten a card to help only; a card whose community now says stay out is left undrafted.
 */

import { voiceBlock } from "../writer/context";
import { safeForSales } from "../sales/ban-risk";
import { recall } from "./context";
import type { JobContext, JobOutput } from "./runner";
import { draftReplies, readCommunityRules, subredditOf, type DraftTarget, type RuleRead } from "./sales-scan";
import { mayMention, type SubredditVerdict, type UndraftedOpportunity } from "./types";

/** The newest cards a run drafts: as many as two scans' worth, inside one model call. */
export const REPLY_DRAFTS_MAX = 10;

export type SalesReplyDraftsOutput = { drafted: number; cards: number; refund: boolean };

type Planned = { card: UndraftedOpportunity; rule: SubredditVerdict; why: string };

export async function salesReplyDrafts(ctx: JobContext): Promise<SalesReplyDraftsOutput & JobOutput> {
  const { store, run } = ctx;
  const { cards, docs, memories, voice, mentionsUsed, mentionsWaiting } = await ctx.step(
    "read_doc",
    "Read your product and the cards waiting for a reply",
    async () => ({
      cards: await store.undraftedOpportunities(run.user_id, REPLY_DRAFTS_MAX),
      docs: await store.documents(run.user_id),
      // As the scan: a founder rule that would get the account banned never reaches the reply prompt.
      memories: await recall(store, run.user_id, 15, "sales", (text) => safeForSales(text, true)),
      voice: voiceBlock(
        (await store.voiceNotes(run.user_id, 5))
          .filter((n) => safeForSales(n.body))
          .map((n) => ({ body: n.body, platform: n.platform, weight: n.weight, createdAt: n.created_at })),
      ),
      mentionsUsed: await store.recentMentions(run.user_id),
      mentionsWaiting: await store.waitingMentions(run.user_id),
    }),
    (r) => `${r.cards.length} ${r.cards.length === 1 ? "card waits" : "cards wait"} for a reply`,
  );

  if (!cards.length) {
    await ctx.step("create_card", "No cards waiting for a reply", async () => 0);
    return { drafted: 0, cards: 0, refund: true };
  }

  const names = [...new Set(cards.filter((c) => c.platform === "reddit").map((c) => subredditOf(c.community)))];
  const verdicts: Record<string, RuleRead> = !names.length ? {} : await ctx.step(
    "check_rules",
    "Checking each community's rules",
    async () => readCommunityRules(ctx, names),
    (v) => `${Object.keys(v).length} ${Object.keys(v).length === 1 ? "community" : "communities"} checked`,
  );

  // The waiting count includes these cards themselves (they are in review and may name the product): only the other
  // waiting drafts count against the one mention, as they did when the scan planned these cards.
  const ownWaiting = cards.filter((c) => mayMention(c.rule)).length;
  let allowance = mentionsUsed + Math.max(0, mentionsWaiting - ownWaiting) >= 1 ? 0 : 1;
  const planned: Planned[] = [];
  for (const card of cards) {
    let rule = card.rule;
    let why = card.rule_why ?? "";
    const read = card.platform === "reddit" ? verdicts[subredditOf(card.community)] : undefined;
    if (read) {
      // The community now says stay out: no reply is written, the card stays as the founder saw it.
      if (read.verdict === "skip") continue;
      if (!mayMention(read.verdict) || read.megathread) {
        if (mayMention(rule)) why = read.megathread ? `${read.summary.replace(/\.$/, "")} · self-promotion only in the megathread` : read.summary;
        rule = mayMention(rule) ? "no_product_mention" : rule;
      }
    }
    if (mayMention(rule)) {
      if (allowance > 0) allowance -= 1;
      else {
        rule = "no_product_mention";
        why = mentionsUsed >= 1 ? "Help only this time: you named the product in one of your last 10 replies" : "Help only: one product mention per scan";
      }
    }
    planned.push({ card, rule, why: why.slice(0, 200) });
  }

  const targets: DraftTarget[] = planned.map((p) => ({
    rule: p.rule,
    thread: {
      platform: p.card.platform,
      url: p.card.url,
      community: p.card.community,
      title: p.card.title,
      author: p.card.author,
      text: p.card.snippet,
      comments: p.card.comments,
      postedAt: p.card.posted_at,
    },
  }));
  const { replyFor, gen } = await draftReplies(ctx, { docs, memories, voice, threads: targets });

  const drafted = await ctx.step(
    "save_reply",
    "Adding the replies to your cards",
    async () => {
      let n = 0;
      for (const [i, p] of planned.entries()) {
        const reply = replyFor.get(i);
        if (!reply) continue;
        const tightened = p.rule !== p.card.rule ? { rule: "no_product_mention" as const, why: p.why } : undefined;
        if (await store.saveOpportunityReply(run.user_id, run.id, p.card.id, reply.slice(0, 3000), gen, tightened)) n += 1;
      }
      return n;
    },
    (n) => `${n} ${n === 1 ? "reply" : "replies"} written`,
  );
  return { drafted, cards: cards.length, refund: drafted === 0 };
}
