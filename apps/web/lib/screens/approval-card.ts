/**
 * One approval card (S3, `Cards.dc.html`): ten kinds, one anatomy.
 *
 * Head: department and kind. Body: the thing itself (`body`, one shape per kind). Foot: price, account, time.
 * The Dashboard queue shows `title` collapsed and `summary` + `meta` open; `/app/inbox/[id]` shows the full body.
 * A0 (`approvals` table) is the source of the common fields; the body comes from the row the card points at.
 */

import { z } from "zod";

import { DepartmentSchema, PlatformSchema, QuoteSchema, ScorePartSchema, WhereSchema, day, iso } from "./common";

export const CARD_KINDS = [
  "post",
  "reply",
  "goal",
  "script",
  "price",
  "finished_video",
  "shorts_batch",
  "slideshow",
  "schedule",
  "correction",
] as const;
export const CardKindSchema = z.enum(CARD_KINDS);
export type CardKind = z.infer<typeof CardKindSchema>;

/** Same values as `approvals.status` (brain plan W1-2). */
export const CARD_STATUSES = ["waiting", "approved", "edited", "skipped", "expired", "cancelled"] as const;
export const CardStatusSchema = z.enum(CARD_STATUSES);

/**
 * Why a card cannot simply be approved right now; the card shows the text in its state strip.
 * `decided_elsewhere`: approved or skipped on another device (`decidedVia`).
 */
export const CardProblemSchema = z.object({
  kind: z.enum(["expired", "decided_elsewhere", "needs_credits", "failed"]),
  text: z.string().max(200),
});

const PostBody = z.object({
  kind: z.literal("post"),
  /** Platform tabs; each has its own versions. */
  platforms: z
    .array(
      z.object({
        platform: PlatformSchema,
        versions: z.array(z.string().max(3000)).min(1).max(3),
        limit: z.number().int().positive(),
      }),
    )
    .min(1),
  checks: z.array(z.string().max(60)),
  /** "Why": the insight or plan line the draft came from. */
  why: z.string().max(200).nullable(),
});

const ReplyBody = z.object({
  kind: z.literal("reply"),
  community: z.string().max(80),
  threadTitle: z.string().max(300),
  threadUrl: z.url(),
  score: z.number().int().min(0).max(100),
  parts: z.array(ScorePartSchema),
  quotes: z.array(QuoteSchema),
  draft: z.string().max(10000),
  /** The subreddit rule line: "product mention allowed · you post it yourself". */
  rules: z.string().max(200),
});

const GoalBody = z.object({
  kind: z.literal("goal"),
  goalId: z.string(),
  week: day,
  goal: z.string().max(200),
  metric: z.enum(["posts", "replies", "views"]),
  target: z.number().int().positive(),
  /** The week plan the goal comes with: one line per department. */
  plan: z.array(z.object({ what: z.string().max(120), department: DepartmentSchema })),
  budgetCredits: z.number().int().min(0).nullable(),
});

const ScriptBody = z.object({
  kind: z.literal("script"),
  beats: z.array(z.object({ words: z.string().max(300), picture: z.string().max(300) })).min(1),
  /** Price of the next stage (keyframes), shown before anything is spent. */
  nextPriceCredits: z.number().int().min(0).nullable(),
});

const PriceBody = z.object({
  kind: z.literal("price"),
  what: z.string().max(200),
  shots: z.number().int().min(0),
  seconds: z.number().positive(),
  readyInMinutes: z.number().int().positive().nullable(),
});

const FinishedVideoBody = z.object({
  kind: z.literal("finished_video"),
  clipId: z.string(),
  seconds: z.number().positive(),
  /** Signed URL of the preview file; null until the render is done. */
  previewUrl: z.url().nullable(),
});

const ShortsBatchBody = z.object({
  kind: z.literal("shorts_batch"),
  source: z.string().max(200),
  shorts: z
    .array(z.object({ start: z.number().min(0), end: z.number().positive(), hook: z.string().max(120), previewUrl: z.url().nullable() }))
    .min(1),
});

const SlideshowBody = z.object({
  kind: z.literal("slideshow"),
  slides: z.array(z.string().max(300)).min(1),
  formats: z.array(z.enum(["mp4", "png"])).min(1),
});

const ScheduleBody = z.object({
  kind: z.literal("schedule"),
  what: z.string().max(200),
  where: WhereSchema,
  at: iso,
  why: z.string().max(200).nullable(),
});

const CorrectionBody = z.object({
  kind: z.literal("correction"),
  correctionId: z.string(),
  rule: z.string().max(200),
  /** The edits the rule was learned from: draft line → what the founder wrote. */
  examples: z.array(z.object({ before: z.string().max(300), after: z.string().max(300) })),
});

export const CardBodySchema = z.discriminatedUnion("kind", [
  PostBody,
  ReplyBody,
  GoalBody,
  ScriptBody,
  PriceBody,
  FinishedVideoBody,
  ShortsBatchBody,
  SlideshowBody,
  ScheduleBody,
  CorrectionBody,
]);
export type CardBody = z.infer<typeof CardBodySchema>;

export const ApprovalCardSchema = z
  .object({
    id: z.string(),
    kind: CardKindSchema,
    department: DepartmentSchema,
    status: CardStatusSchema,
    /** Collapsed line: the post's first line, the thread title, the video name. */
    title: z.string().max(300),
    /** Open line in the queue: one or two sentences on what approving does. */
    summary: z.string().max(400),
    /** Foot line: checks, price note, account, time. */
    meta: z.string().max(200),
    priceCredits: z.number().int().min(0).nullable(),
    postAt: iso.nullable(),
    account: WhereSchema.nullable(),
    raisedAt: iso,
    expiresAt: iso.nullable(),
    decidedAt: iso.nullable(),
    decidedVia: z.enum(["app", "email", "push", "mcp"]).nullable(),
    problem: CardProblemSchema.nullable(),
    /** What the founder sees, hashed (JCS + sha256). Sent back with the decision; a changed card refuses it. */
    contentHash: z.string().regex(/^[0-9a-f]{64}$/),
    body: CardBodySchema,
  })
  .refine((card) => card.body.kind === card.kind, { message: "The body kind must match the card kind.", path: ["body"] });
export type ApprovalCard = z.infer<typeof ApprovalCardSchema>;

/** The one filled button of each kind; it always does what the head names. */
export const PRIMARY_ACTION: Record<CardKind, string> = {
  post: "Approve",
  reply: "Copy and open thread",
  goal: "Approve week",
  script: "Approve script",
  price: "Approve price",
  finished_video: "Approve: finished",
  shorts_batch: "Approve batch",
  slideshow: "Approve",
  schedule: "Approve time",
  correction: "Keep as a rule",
};

/** Kinds whose decision works in wave 1 (A0); the others show their button disabled with the reason. */
export const DECIDABLE_IN_WAVE_1: ReadonlySet<CardKind> = new Set(["post", "reply", "goal", "correction"]);
