/**
 * What a priced CMO job says before it runs (cmo-review-2 S3.5, S3.6): the same lines on the chat's approval card and
 * on the Sales screen's Scan now card, with the price from `JOB_PRICES`. Pure, so the browser and the server share it.
 */
import { JOB_PRICES } from "./progress";

export type PriceCard = { changes: string[]; credits: number };

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

export function salesScanCard(brief?: string): PriceCard {
  return {
    changes: [
      brief ? `Scan Reddit and Hacker News: ${clip(brief, 200)}` : "Scan Reddit and Hacker News for people who describe the problem you solve",
      "Up to 8 searches written from your customers' pains, skipping the subreddits and term pairs in your Sales settings",
      "Draft replies for the 5 best threads into Approvals. You post them yourself.",
    ],
    credits: JOB_PRICES.sales_scan ?? 0,
  };
}

export function researchCard(brief: string, handles: string[] = []): PriceCard {
  return {
    changes: [
      `Research competitors: ${clip(brief, 200)}`,
      handles.length ? `X accounts: ${handles.map((h) => `@${h.replace(/^@/, "")}`).join(", ")}` : "X accounts: the ones in your Competitor Analysis",
      "Save the hooks that beat their usual posts, for your planner and X writer",
    ],
    credits: JOB_PRICES.competitor_research ?? 0,
  };
}
