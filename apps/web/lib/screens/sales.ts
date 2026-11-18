/**
 * S10 Sales (`Sales.dc.html`).
 */

import { z } from "zod";

import type { SalesScanOutput } from "../cmo/jobs/types";
import { SALES_PLATFORMS } from "../cmo/social/conversations";
import { QuoteSchema, SalesRuleSchema, ScorePartSchema, iso } from "./common";

export const ThreadSchema = z.object({
  id: z.string(),
  score: z.number().int().min(0).max(100),
  /** Sales finder: where the conversation is. */
  platform: z.enum(SALES_PLATFORMS),
  community: z.string().max(80),
  postedAt: iso.nullable(),
  comments: z.number().int().min(0).nullable(),
  title: z.string().max(300),
  url: z.url(),
  /** The subreddit's rule for this thread. `skipped` threads get no draft. */
  rule: SalesRuleSchema,
  parts: z.array(ScorePartSchema),
  quotes: z.array(QuoteSchema),
  /** Null when there is no draft to show: not written yet, skipped, or held back from an unpaid account. */
  draft: z.string().max(10000).nullable(),
  /** A reply was written, or the community's rules leave no room for one. False: the reply comes after a plan (free scan). */
  drafted: z.boolean(),
  /** "No links · product named once, at the end · r/SaaS allows it". */
  draftChecks: z.string().max(200).nullable(),
  status: z.enum(["open", "replied", "dismissed"]),
  approvalId: z.string().nullable(),
});

/**
 * The newest finished scan as the screen reads it (`SalesScanOutput` in `lib/cmo/jobs/types.ts`, free-scan plan). Scans
 * from before that contract have no `queries`, `scanned`, `free` or `verdict`: the loader fills them in.
 */
export const SalesScanSchema = z.object({
  cards: z.number().int().min(0),
  platforms: z.array(z.enum(SALES_PLATFORMS)).max(4),
  /** Places that did not answer during the scan. */
  failed: z.array(z.enum(SALES_PLATFORMS)).max(4),
  /** It ran as the account's free scan: no replies were written. */
  free: z.boolean(),
  /** What it searched for, shown when nothing was found. */
  queries: z.array(z.string().max(200)).max(20),
  /** Threads read after the filters. */
  scanned: z.number().int().min(0),
  verdict: z.enum(["found", "none"]),
  at: iso,
});
export type SalesScan = z.infer<typeof SalesScanSchema>;
// The job's output and the screen's copy of it keep the same fields: a rename in one fails the typecheck here.
type ScanFields = Exclude<keyof SalesScan, "at">;
const sameScanFields: Pick<SalesScanOutput, ScanFields> extends Omit<SalesScan, "at"> ? true : never = true;
void sameScanFields;

export const SalesScreenSchema = z.object({
  /** The account has no plan and no credits (SQL `cmo_paid` is false): replies are not written or sent to it. */
  free: z.boolean(),
  /** The newest finished scan, or null before the first one. */
  lastScan: SalesScanSchema.nullable(),
  /** Product mentions in the last ten replies: at most one in ten may name the product. */
  mentions: z.object({ used: z.number().int().min(0), window: z.number().int().positive() }),
  /**
   * Set when the last two scans found nothing worth joining; the banner points at the Sales settings. A scan holds its
   * credits before it starts and runs in one go, so `creditsToFinish` and `found` are no longer shown (cmo-review-2 S3.6).
   */
  stuck: z.object({ text: z.string().max(200), creditsToFinish: z.number().int().positive(), found: z.number().int().min(0) }).nullable(),
  threads: z.array(ThreadSchema),
  /** The founder's Sales settings (`sales_settings`): subreddits never scanned; pairs of terms that must both appear. */
  settings: z.object({
    excludedSubreddits: z.array(z.string().max(21)).max(50),
    pairs: z.array(z.tuple([z.string().max(60), z.string().max(60)])).max(20),
    /** The places Sales looks (`sales_settings.platforms`), at least one. */
    platforms: z.array(z.enum(SALES_PLATFORMS)).min(1).max(4),
  }),
  week: z.object({ replied: z.number().int().min(0), dismissed: z.number().int().min(0) }),
});
export type SalesScreen = z.infer<typeof SalesScreenSchema>;
