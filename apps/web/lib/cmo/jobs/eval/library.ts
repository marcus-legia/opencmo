/**
 * A Library for the eval stores (wave 3 B3): the week plan and post drafts write only from it, so every plan and
 * draft case starts with a few conversations Sales "found" about the fixture's own pains. The summaries are plain
 * sentences of ours, with no numbers, so a number in a draft can only come from the documents or be invented.
 */

import type { memoryStore } from "../memory-store";
import type { Documents, PostSource } from "../types";

/** Up to three themes from the strategy's pains, two conversations each. */
export function seedLibrary(mem: ReturnType<typeof memoryStore>, docs: Documents): void {
  const pains = (Array.isArray(docs.strategy?.pains) ? (docs.strategy.pains as unknown[]) : [])
    .filter((p): p is string => typeof p === "string" && p.trim().length > 0)
    .slice(0, 3);
  const themes = pains.length ? pains : ["finding the first customers"];
  const now = Date.now();
  themes.forEach((pain, t) => {
    for (let k = 0; k < 2; k++) {
      const url = `https://www.reddit.com/r/smallbusiness/comments/lib${t}${k}/eval/`;
      const posted = new Date(now - (t * 2 + k + 1) * 86_400_000).toISOString();
      mem.opps.push({ url, community: "smallbusiness", title: `Question about ${pain}`, author: `member${t}${k}`, snippet: "", posted_at: posted, comments: 4, score: 75, score_parts: [], reply: "A helpful reply." });
      mem.library.set(url, {
        url,
        theme: pain.charAt(0).toUpperCase() + pain.slice(1),
        summary: k === 0 ? `Someone running a small business is stuck on ${pain} and asks how others handle it.` : `A founder says ${pain} keeps eating their week and wants a simpler way.`,
        quotes: [{ kind: "pain", text: `I keep struggling with ${pain}` }],
      });
    }
  });
}

/** The sources a planned item or a draft carries (`body.sources`; the memory store may keep them on the row). */
export function sourcesOf(row: { body?: Record<string, unknown> } & Record<string, unknown>): PostSource[] {
  const raw = Array.isArray(row.body?.sources) ? row.body.sources : Array.isArray(row.sources) ? row.sources : [];
  return raw as PostSource[];
}
