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

/**
 * Studio snapshots: what `approval_snapshot` (SQL, 20261228090000) stores for the four Studio kinds, field for
 * field, so the hash the founder approves covers exactly this. Paths and ids only, never signed URLs (a URL changes
 * on every read). The bodies below are what the card renders, built from a snapshot plus signed URLs.
 */
const sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/** One beat of the storyboard: the voice line, the keyframe (picture) and what moves during the beat. */
export const StoryBeatSchema = z.object({ words: z.string().max(300), picture: z.string().max(300), motion: z.string().max(300).nullable() });

/** One keyframe on the contact sheet (card 2) or the one being redone. */
const SheetKeyframeSnapshot = z.object({
  index: z.number().int().min(0),
  words: z.string().max(300),
  /** `media` bucket path of the keyframe image; null while it is not made yet. */
  path: z.string().max(500).nullable(),
  /** The text checker's badge: the keyframe may show garbled text. */
  garbled: z.boolean(),
  credits: z.number().int().min(0),
});

/** Card 1: storyboard + keyframe price (`studio_steps.kind = 'script'`). */
export const ScriptSnapshotSchema = z.object({
  kind: z.literal("script"),
  step_id: z.string(),
  clip_id: z.string(),
  tool: z.string(),
  title: z.string().max(200),
  seconds: z.number().positive().nullable(),
  aspect: z.enum(["9:16", "16:9", "1:1"]).nullable(),
  beats: z.array(StoryBeatSchema).max(40),
  /** Price of the keyframes, held when the founder approves. */
  price_credits: z.number().int().min(0),
});

/** Card 2 (contact sheet + video price) and a redone keyframe (`studio_steps.kind = 'price'`). */
export const PriceSnapshotSchema = z.object({
  kind: z.literal("price"),
  step_id: z.string(),
  clip_id: z.string(),
  tool: z.string(),
  title: z.string().max(200),
  what: z.string().max(200),
  seconds: z.number().positive().nullable(),
  wait_minutes: z.number().int().positive().nullable(),
  /** The contact sheet (card 2) or the one keyframe redone; empty when the price is for shots only. */
  keyframes: z.array(SheetKeyframeSnapshot).max(40),
  shots: z.number().int().min(0),
  price_credits: z.number().int().min(0),
});

/** Card 3: the render of the edit as it is now (`ref_kind = 'editor_project'`, `ref_id` = clip id). */
export const FinishedVideoSnapshotSchema = z.object({
  kind: z.literal("finished_video"),
  clip_id: z.string(),
  title: z.string().max(200),
  /** The document hash approving marks finished; any edit after it changes the hash and supersedes the card. */
  document_hash: sha256,
  /** The `render_document` task of this exact document; null while none is done. */
  render_task_id: z.string().nullable(),
  render_path: z.string().max(500).nullable(),
  seconds: z.number().positive().nullable(),
});

/** Card 4: the shorts cut from one finished edit, approved together (`ref_kind = 'short_batch'`). */
export const ShortsBatchSnapshotSchema = z.object({
  kind: z.literal("shorts_batch"),
  batch_id: z.string(),
  parent_clip_id: z.string(),
  title: z.string().max(200),
  parent_hash: sha256,
  shorts: z
    .array(
      z.object({
        short_id: z.string(),
        /** The short's own edit (`clips.kind = 'short'`); null until the Builder made it. */
        short_clip_id: z.string().nullable(),
        start: z.number().min(0),
        end: z.number().positive(),
        hook: z.string().max(120),
        reason: z.string().max(300),
      }),
    )
    .max(3),
});

export const StudioSnapshotSchema = z.discriminatedUnion("kind", [
  ScriptSnapshotSchema,
  PriceSnapshotSchema,
  FinishedVideoSnapshotSchema,
  ShortsBatchSnapshotSchema,
]);
export type StudioSnapshot = z.infer<typeof StudioSnapshotSchema>;

/** `approvals.ref_kind` per Studio card kind. */
export const STUDIO_REF_KIND = { script: "studio_step", price: "studio_step", finished_video: "editor_project", shorts_batch: "short_batch" } as const;

const ScriptBody = z.object({
  kind: z.literal("script"),
  stepId: z.string(),
  seconds: z.number().positive().nullable(),
  aspect: z.enum(["9:16", "16:9", "1:1"]).nullable(),
  beats: z.array(StoryBeatSchema).min(1),
  /** Price of the next stage (keyframes), shown before anything is spent. */
  nextPriceCredits: z.number().int().min(0).nullable(),
});

const PriceBody = z.object({
  kind: z.literal("price"),
  stepId: z.string(),
  what: z.string().max(200),
  /** Contact sheet tiles; each has its own Redo (a new `price` card for that keyframe). Empty for shots only. */
  keyframes: z.array(
    z.object({ index: z.number().int().min(0), label: z.string().max(300), thumbUrl: z.url().nullable(), garbled: z.boolean(), credits: z.number().int().min(0) }),
  ),
  shots: z.number().int().min(0),
  seconds: z.number().positive(),
  readyInMinutes: z.number().int().positive().nullable(),
});

const FinishedVideoBody = z.object({
  kind: z.literal("finished_video"),
  clipId: z.string(),
  /** Sent back with "Mark finished": a later edit refuses it. */
  documentHash: sha256,
  seconds: z.number().positive(),
  /** Signed URL of the render; null until the render is done. */
  previewUrl: z.url().nullable(),
  /** Seconds into the render shown as the still before it plays. */
  frameAt: z.number().min(0),
});

const ShortsBatchBody = z.object({
  kind: z.literal("shorts_batch"),
  batchId: z.string(),
  parentClipId: z.string(),
  source: z.string().max(200),
  /** The squad cuts 3; fewer only when the reviewer found fewer good ranges. */
  shorts: z
    .array(
      z.object({
        shortClipId: z.string().nullable(),
        start: z.number().min(0),
        end: z.number().positive(),
        hook: z.string().max(120),
        reason: z.string().max(300),
        previewUrl: z.url().nullable(),
      }),
    )
    .min(1)
    .max(3),
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

/**
 * Studio actions (`approval_decide`, A1), named as `components/cards/decide.ts` sends them: redo one keyframe on a
 * contact sheet, cancel a script or a price (releases any hold), send back a finished video or a shorts batch.
 * Editing a beat (`edit {beat, text}`) re-plans the script and raises a new card.
 */
export const STUDIO_ACTIONS: Record<"script" | "price" | "finished_video" | "shorts_batch", readonly string[]> = {
  script: ["approve", "edit", "cancel"],
  price: ["approve", "redo", "cancel"],
  finished_video: ["approve", "send_back"],
  shorts_batch: ["approve", "send_back"],
};

/**
 * Kinds whose decision works now (wave 1 A0, P2 A1 for Studio steps and the finished video); the others show their
 * button disabled with the reason. The name stays so `components/cards/decide.ts` keeps reading it.
 */
export const DECIDABLE_IN_WAVE_1: ReadonlySet<CardKind> = new Set(["post", "reply", "goal", "correction", "script", "price", "finished_video"]);
