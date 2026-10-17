/**
 * Visual blocks inside a blog post: `<!--block {json} -->` between paragraphs.
 *
 * Posts are written by a scheduled Claude run and merged automatically, so a block is
 * DATA, never markup: zod validates it here and React components render it as text.
 * There is no way for a post to inject a class, a style or a script, and every block
 * looks like the rest of the site because the components own the design.
 *
 * Any block that shows numbers must either cite a `source` (an https link the reader
 * can open) or say `"illustrative": true`, which prints "Illustrative example" on it.
 * A made-up number that looks like a finding is the one failure we cannot afford.
 */

import { z } from "zod";

const text = (max: number) => z.string().trim().min(1).max(max);

const Source = z.object({
  label: text(80),
  url: z.string().url().startsWith("https://"),
});

/** Numbers either come from somewhere the reader can check, or say they are an example. */
const Evidence = {
  source: Source.optional(),
  illustrative: z.boolean().optional(),
};

const StatsBlock = z.object({
  type: z.literal("stats"),
  title: text(80).optional(),
  items: z.array(z.object({ value: text(12), label: text(90) })).min(2).max(4),
  ...Evidence,
});

const ChartBlock = z.object({
  type: z.literal("chart"),
  kind: z.enum(["bar", "line"]),
  title: text(80),
  unit: text(16).optional(),
  data: z.array(z.object({ label: text(24), value: z.number().finite().min(0) })).min(2).max(10),
  /** Index of the bar to highlight (the point the paragraph above makes). */
  highlight: z.number().int().min(0).optional(),
  ...Evidence,
});

const LeaderboardBlock = z.object({
  type: z.literal("leaderboard"),
  title: text(80),
  unit: text(16).optional(),
  rows: z.array(z.object({ name: text(48), score: z.number().finite().min(0), note: text(90).optional() })).min(3).max(8),
  ...Evidence,
});

const StoryboardBlock = z.object({
  type: z.literal("storyboard"),
  title: text(80).optional(),
  frames: z.array(z.object({ title: text(40), text: text(160) })).min(3).max(6),
});

const CalloutBlock = z.object({
  type: z.literal("callout"),
  tone: z.enum(["tip", "key", "warning", "exercise"]),
  title: text(60),
  text: text(320),
});

const CompareBlock = z.object({
  type: z.literal("compare"),
  title: text(80).optional(),
  before: z.object({ label: text(32), items: z.array(text(120)).min(2).max(5) }),
  after: z.object({ label: text(32), items: z.array(text(120)).min(2).max(5) }),
});

/** Presets, not free 3D: each one is a scene the component knows how to draw well. */
export const SCENE_PRESETS = ["funnel", "flywheel", "ladder", "orbit"] as const;

const SceneBlock = z.object({
  type: z.literal("scene"),
  preset: z.enum(SCENE_PRESETS),
  title: text(80),
  /** One label per stage/step/channel; the scene builds one shape per label. */
  labels: z.array(text(28)).min(3).max(6),
  caption: text(160).optional(),
});

export const BlockSchema = z
  .discriminatedUnion("type", [StatsBlock, ChartBlock, LeaderboardBlock, StoryboardBlock, CalloutBlock, CompareBlock, SceneBlock])
  .superRefine((block, ctx) => {
    if (block.type === "stats" || block.type === "chart" || block.type === "leaderboard") {
      if (!block.source && !block.illustrative) {
        ctx.addIssue({ code: "custom", message: `"${block.type}" shows numbers: add "source": {"label","url"} or "illustrative": true` });
      }
      if (block.source && block.illustrative) {
        ctx.addIssue({ code: "custom", message: "a block is either sourced or illustrative, not both" });
      }
    }
    if (block.type === "chart" && block.highlight !== undefined && block.highlight >= block.data.length) {
      ctx.addIssue({ code: "custom", message: `highlight ${block.highlight} is past the last data point` });
    }
  });

export type Block = z.infer<typeof BlockSchema>;
export type BlockOf<T extends Block["type"]> = Extract<Block, { type: T }>;

export type Segment = { kind: "html"; html: string } | { kind: "block"; block: Block };

export const BLOCK_MARKER = /<!--block\s*([\s\S]*?)-->/g;

/** Splits a post body into HTML runs and validated blocks; throws with the block's position. */
export function splitBlocks(slug: string, body: string): Segment[] {
  const segments: Segment[] = [];
  let last = 0;
  let n = 0;
  for (const m of body.matchAll(BLOCK_MARKER)) {
    n += 1;
    const before = body.slice(last, m.index).trim();
    if (before) segments.push({ kind: "html", html: before });
    let raw: unknown;
    try {
      raw = JSON.parse(m[1]);
    } catch (error) {
      throw new Error(`${slug}.html: block #${n} is not valid JSON (${(error as Error).message})`);
    }
    const parsed = BlockSchema.safeParse(raw);
    if (!parsed.success) {
      throw new Error(`${slug}.html: block #${n} is invalid — ${parsed.error.issues.map((i) => `${i.path.join(".") || "block"}: ${i.message}`).join("; ")}`);
    }
    segments.push({ kind: "block", block: parsed.data });
    last = m.index + m[0].length;
  }
  const rest = body.slice(last).trim();
  if (rest) segments.push({ kind: "html", html: rest });
  return segments;
}
