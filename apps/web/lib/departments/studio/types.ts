/**
 * The Studio adapter's contract (P2 B0): the one way into Studio's Video agent team for the brain, the
 * Assistant, MCP and the UI (`docs/architecture/studio.md` §5, `brain.md` §7b).
 *
 * Every entry point runs under the founder's RLS session (`StudioContext.supabase`): a brain order
 * brings a short-lived user JWT as MCP does, and the service role never writes an editor document.
 * A priced step is planned first (price, nothing spent) and runs only on a decision: MCP carries the
 * prepared step in its signed confirm code, the brain and the UI store it as a `studio_steps` row
 * behind an approval card. The team owns how a video is made; callers only say what they want.
 */

import { z } from "zod";

import type { SupabaseClient } from "@/lib/api/handler";
import type { ToolOutcome } from "@/lib/agent/tools";

/** Who calls Studio. `ui` is the founder's own buttons (Mark finished, Cut shorts) over `/api/v1/studio`. */
export const STUDIO_CALLERS = ["brain", "assistant", "mcp", "ui"] as const;
export type StudioCaller = (typeof STUDIO_CALLERS)[number];

export const STUDIO_ENTRIES = ["plan", "decide", "buildVideo", "cutShorts", "markFinished", "renderShort"] as const;
export type StudioEntry = (typeof STUDIO_ENTRIES)[number];

/**
 * Who may call each entry point; the capability registry (`packages/contracts/capabilities.json`)
 * lists the same pairs. `buildVideo` and `renderShort` are the brain's: the founder and MCP make a
 * video with `create_video` through `plan`. Marking an edit finished is the founder's call only (a
 * finished-video card approved in the inbox reaches it through `approval_decide`, i.e. the UI).
 */
export const STUDIO_ACCESS: Record<StudioEntry, readonly StudioCaller[]> = {
  plan: ["brain", "assistant", "mcp"],
  decide: ["brain", "assistant", "mcp", "ui"],
  buildVideo: ["brain"],
  cutShorts: ["brain", "ui"],
  markFinished: ["ui"],
  renderShort: ["brain"],
};

export const mayCall = (caller: StudioCaller, entry: StudioEntry): boolean => STUDIO_ACCESS[entry].includes(caller);

/** Long-video frames, the same list as `editor-core`'s `VIDEO_ASPECTS`. */
export const BRIEF_ASPECTS = ["9:16", "16:9", "1:1"] as const;

/**
 * What the brain asks Studio for (a `build_video` order's input): the week plan's video item, never
 * a shot list. `buildVideo` turns it into `create_video` input; the Director writes the script.
 */
export const VideoBriefSchema = z.object({
  /** What the video should achieve: "show founders how a slash command makes a demo video". */
  objective: z.string().trim().min(3).max(300),
  /** The strategy angle it takes. */
  angle: z.string().trim().max(300).default(""),
  /** Opening lines to choose from; the first is preferred. */
  hooks: z.array(z.string().trim().min(1).max(160)).max(3).default([]),
  /** Facts the script may use; the Director invents none. */
  keyPoints: z.array(z.string().trim().min(1).max(200)).max(6).default([]),
  seconds: z.number().int().min(5).max(90).default(30),
  aspect: z.enum(BRIEF_ASPECTS).default("9:16"),
  /** A premade voice name; absent → the strategy voice, else the model's default. */
  voice: z.string().trim().max(40).optional(),
});
export type VideoBrief = z.infer<typeof VideoBriefSchema>;

/** The Studio tools that are planned and decided (MCP's `PRICED` set). */
export type StudioTool = string;

/** A planned step, ready to run on approval: what MCP signs and `studio_steps.input` stores. */
export type PreparedStep = { clipId: string; tool: StudioTool; input: unknown };

/** `plan`'s answer. `priced` is the card; nothing is spent until `decide` approves it. */
export type StudioPlan =
  | {
      kind: "priced";
      credits: number;
      /** One line per change, as the in-app card lists them. */
      lines: string[];
      /** Card 1 of a long take: the Director's beats. */
      storyboard?: unknown;
      /** Card 2 of a long take: the keyframes to animate. */
      sheet?: unknown;
      prepared: PreparedStep;
    }
  /** The tool could not be planned: the founder (or the client) reads `message` and fixes the input. */
  | { kind: "invalid"; message: string }
  /** The price is more than the account holds: `message` says how to top up. Nothing is stored. */
  | { kind: "short"; message: string; credits: number };

/** A stored step (`studio_steps.id`), or one carried in a signed code (MCP). */
export type StepRef = { stepId: string } | { prepared: PreparedStep };

export type StudioAction =
  | { kind: "approve" }
  | { kind: "cancel" }
  /** Card 2 only: make keyframe `index` again; the step keeps waiting with a new card. */
  | { kind: "redo"; index: number };

export type StudioDecision = {
  outcome: ToolOutcome;
  /** Set when the step queued a generation: poll it (or the order waits on it). */
  generationId?: string;
  /** Set when the step queued an export (`request_export`): one per file. */
  exports?: { taskId: string; [key: string]: unknown }[];
  /** True when the step changed the edit's document. */
  wrote: boolean;
};

/** `buildVideo`'s answer: the blank edit made for the brief and the step that waits on card 1. */
export type BuiltVideo =
  | { kind: "waiting"; clipId: string; stepId: string; credits: number }
  | { kind: "invalid"; message: string };

/** One range the Shorts squad cuts, in the parent edit's timeline seconds. */
export type ShortRange = {
  start: number;
  end: number;
  /** The first spoken line, said in the first 3 s. */
  hook: string;
  title: string;
  /** Why this range: hook, flow, value (shown on the batch card). */
  reason: string;
};

export type CutShorts =
  | { kind: "cut"; batchId: string; shorts: { shortId: string; clipId: string; range: ShortRange }[] }
  /** Not finished, finished at another document, or nothing worth cutting. */
  | { kind: "refused"; message: string };

export type MarkedFinished =
  | { kind: "finished"; finishedAt: string; hash: string }
  /** The founder saw another version than the one saved: nothing is marked. */
  | { kind: "stale"; message: string };

export type RenderedShort = { kind: "queued"; taskId: string } | { kind: "refused"; message: string };

/**
 * Who drives the call. `orderId` ties planned steps, shorts and renders to the brain's work order;
 * absent for the Assistant, MCP and the founder's buttons.
 */
export type StudioContext = {
  supabase: SupabaseClient;
  userId: string;
  caller: StudioCaller;
  orderId?: string;
};

export interface StudioAdapter {
  /** Price a Studio tool on an edit; nothing is spent or stored. */
  plan(clipId: string, tool: StudioTool, input: unknown): Promise<StudioPlan>;
  /** Run, cancel or redo a planned step. A cancelled step releases any hold and changes nothing. */
  decide(step: StepRef, action: StudioAction): Promise<StudioDecision>;
  /** Brain only: a blank edit for the brief, the Director's plan, and card 1 raised as a `studio_steps` row. */
  buildVideo(brief: VideoBrief): Promise<BuiltVideo>;
  /** Three shorts from an edit marked finished at its current document; each its own `short` edit. */
  cutShorts(clipId: string): Promise<CutShorts>;
  /** The founder marks the edit finished at the document hash they saw. */
  markFinished(clipId: string, hash: string): Promise<MarkedFinished>;
  /** Queue `render_document` for a short's own edit, with no editor open and no founder session. */
  renderShort(shortClipId: string): Promise<RenderedShort>;
}
