/**
 * What a priced CMO job says before it runs (cmo-review-2 S3.5, S3.6): the same lines on the chat's approval card and
 * on the Sales screen's Scan now card, with the price from `JOB_PRICES`. Pure, so the browser and the server share it.
 */
import { PLATFORM_LABEL, SALES_PLATFORMS, type SalesPlatform } from "../social/conversations";
import { JOB_PRICES } from "./progress";

export type PriceCard = { changes: string[]; credits: number };

const clip = (text: string, n: number) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** "Reddit", "Reddit and Threads", "Reddit, Hacker News and Threads". */
function joinLabels(labels: string[]): string {
  return labels.length <= 1 ? (labels[0] ?? "") : `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/** Missing or empty `platforms` means every place Sales looks. */
export function salesScanCard(brief?: string, platforms?: SalesPlatform[]): PriceCard {
  const where = joinLabels((platforms?.length ? platforms : [...SALES_PLATFORMS]).map((p) => PLATFORM_LABEL[p]));
  return {
    changes: [
      brief ? `Scan ${where}: ${clip(brief, 200)}` : `Scan ${where} for people who describe the problem you solve`,
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

/** A script the CMO chat orders (cmo-review-3 I0): the founder records the video; nothing builds it for them. */
export function scriptCard(brief: string): PriceCard {
  return {
    changes: [
      `Write a script and storyboard: ${clip(brief, 200)}`,
      "3 to 8 beats with what to say and what to show, on a script card in Approvals for your OK",
      "You record the video yourself; read the script on your phone while you film",
    ],
    credits: JOB_PRICES.write_video_brief ?? 0,
  };
}
