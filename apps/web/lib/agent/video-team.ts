/**
 * The Video agent team behind `plan_video`.
 *
 * The editor Assistant is the director: it decides that the user wants an intro and passes the
 * brief. Specialists run inside the tool, each with its own prompt and schema: the Writer writes
 * the words, the Motion Director plans beats and personality, the Reviewer (code) checks the plan
 * and sends it back once with the issues, and the Builder (editor-core `add_intro`) turns it into one op.
 * Everything is prepared before the approval card, so the user approves exactly what is applied.
 */

import { z } from "zod";

import { findLotties, introSpecSchema, LOTTIE_PACK, readBrand, reviewIntro, type IntroSpec } from "@opencmo/editor-core";
import type { ClipDocument } from "@opencmo/clip-doc";

import { fakeAllowed, LlmError, llmReady, structured, type LlmUsage } from "@/lib/cmo/jobs/llm";

import { MOTION_DIRECTOR, WRITER } from "./motion-guide";
import { sanitize, type ToolSpec } from "./tools";

export const planVideoInput = z.object({
  recipe: z.enum(["intro"]).describe('What to make. "intro": an animated title card over the first seconds of the clip.'),
  brief: z.string().trim().max(500).optional().describe("The user's words about the intro: mood, what to say, colours. Copy them; do not invent."),
  title: z.string().trim().min(1).max(40).optional().describe("Only when the user gave the exact title text."),
  seconds: z.number().min(2).max(8).optional().describe("Only when the user asked for a length."),
});
export type PlanVideoInput = z.infer<typeof planVideoInput>;

/**
 * What `prepareVideo` reads: the tool's input plus, from an outside client (MCP), a finished
 * intro spec. The Assistant's schema does not offer `spec`; a given spec still goes through the
 * code Reviewer (`reviewIntro`) and the same storyboard card.
 */
export const planVideoFullInput = planVideoInput.extend({
  spec: introSpecSchema.optional().describe("A finished intro plan (personality, elements, beats). The server reviews it and sends back what to fix."),
});

export const PLAN_VIDEO_TOOL: ToolSpec = {
  name: "plan_video",
  description:
    'Plan and build an animated intro with the Video agent team: a writer, a motion director and a reviewer plan the words, beats, timing and easing from the brand and the clip, then the user approves a storyboard and the intro is added in one step (one undo). Use it whenever the user asks for an intro, an opening title or a title card; do not build intros by hand with add_text and keyframes. Pass the user\'s words as brief; read_skill "motion-profile" first if it exists and add it to the brief. It costs no credits beyond the assistant itself. After it is applied, capture frames at the end of each beat to check it.',
  schema: sanitize(z.toJSONSchema(planVideoInput, { io: "input" })).schema as Record<string, unknown>,
  strict: true,
  approval: true,
};

export type PreparedVideo = { recipe: "intro"; spec: IntroSpec; op: { op: "add_intro"; spec: IntroSpec } };

export type VideoCard = { clips: { id: string; label: string }[]; changes: string[]; credits: number; storyboard: Storyboard };

export type Storyboard = {
  seconds: number;
  personality: string;
  beats: { at: number; dur: number; label: string; motion: string }[];
  /** Column titles after Time; an intro's beats are "Element" / "Motion". */
  columns?: [string, string];
  /** Last row's text; null hides it (a full video has no exit beat). */
  closing?: string | null;
};

const writerSchema = z.object({ title: z.string().min(1).max(40), tagline: z.string().max(60).optional() });

const FAILED = "The video team could not plan this intro. Try again or describe it differently.";
/** Each specialist gets this long; two motion rounds plus the writer stay well inside a request. */
const CALL_MS = 45_000;

/** The spec the fake model returns: deterministic, and passes the review. */
function fakeSpec(title: string, tagline: string | undefined, seconds: number): IntroSpec {
  return {
    personality: "premium",
    emotion: "confident",
    seconds,
    background: { style: "gradient" },
    elements: [
      { key: "title", kind: "title", text: title },
      { key: "line", kind: "accent_line" },
      ...(tagline ? [{ key: "tagline", kind: "tagline" as const, text: tagline }] : []),
    ],
    beats: [
      { target: "title", at: 0.2, dur: 0.9, motion: "slide_up" },
      { target: "line", at: 0.7, dur: 0.5, motion: "draw" },
      ...(tagline ? [{ target: "tagline", at: 1.0, dur: 0.6, motion: "word_slide" as const }] : []),
    ],
  };
}

export async function prepareVideo(
  input: unknown,
  context: { document: ClipDocument; clipContext: string },
  onUsage: (usage: LlmUsage) => Promise<void>,
): Promise<{ prepared: PreparedVideo; card: VideoCard } | string> {
  const parsed = planVideoFullInput.safeParse(input);
  if (!parsed.success) return `${parsed.error.issues[0]?.path.join(".") ?? ""}: ${parsed.error.issues[0]?.message ?? "Invalid input."}`;
  const request = parsed.data;
  const brand = readBrand(context.document);
  const hasLogo = Boolean(brand?.logo);
  const seconds = request.seconds ?? 4;

  let spec: IntroSpec;
  try {
    if (request.spec) {
      const issues = reviewIntro(request.spec, { hasLogo });
      if (issues.length) return `Fix the plan and send it again: ${issues.join(" ")}`;
      spec = request.spec;
    } else if (fakeAllowed()) {
      spec = fakeSpec(request.title ?? "Watch this first", request.brief ? "A quick walkthrough" : undefined, seconds);
    } else {
      if (!llmReady("writer") || !llmReady("motion")) return "The video team is not set up on this server yet.";
      const words = request.title
        ? { title: request.title }
        : await structured({
            agent: "writer",
            label: "video.writer",
            failure: FAILED,
            maxTokens: 1000,
            timeoutMs: CALL_MS,
            onUsage,
            system: WRITER,
            prompt: `<brief>${request.brief ?? "(none)"}</brief>\n${context.clipContext}`,
            schema: writerSchema,
          });
      const lotties = [...new Set([...findLotties(`${request.brief ?? ""} ${words.title}`, 6), ...LOTTIE_PACK.slice(0, 6)].map((entry) => entry.name))].join(", ");
      const facts = [
        `<words>${JSON.stringify(words)}</words>`,
        `<brief>${request.brief ?? "(none)"}</brief>`,
        `<project>${JSON.stringify({ brand_colors: brand?.colors ?? null, brand_logo: hasLogo, seconds_requested: request.seconds ?? null, lotties })}</project>`,
      ].join("\n");
      let issues: string[] = [];
      let draft: IntroSpec | null = null;
      // One fix round: the reviewer's notes go back to the motion director, then we stop.
      for (let round = 0; round < 2; round++) {
        draft = await structured({
          agent: "motion",
          label: "video.motion",
          failure: FAILED,
          maxTokens: 4000,
          timeoutMs: CALL_MS,
          onUsage,
          system: MOTION_DIRECTOR,
          prompt: issues.length ? `${facts}\n<previous>${JSON.stringify(draft)}</previous>\n<reviewer>${issues.join("\n")}</reviewer>\nFix every reviewer note.` : facts,
          schema: introSpecSchema,
        });
        issues = reviewIntro(draft, { hasLogo });
        if (!issues.length) break;
      }
      if (issues.length || !draft) return `The plan still had problems after one revision: ${issues.slice(0, 3).join(" ")}`;
      spec = draft;
    }
  } catch (err) {
    return err instanceof LlmError ? err.message : FAILED;
  }
  const issues = reviewIntro(spec, { hasLogo });
  if (issues.length) return issues.join(" ");

  const labels = new Map(spec.elements.map((element) => [element.key, element.text ? `${element.kind}: “${element.text}”` : element.lottie ? `${element.kind}: ${element.lottie}` : element.kind]));
  const storyboard: Storyboard = {
    seconds: spec.seconds,
    personality: spec.personality,
    beats: [...spec.beats].sort((a, b) => a.at - b.at).map((beat) => ({ at: beat.at, dur: beat.dur, label: labels.get(beat.target) ?? beat.target, motion: beat.motion.replace("_", " ") })),
  };
  return {
    prepared: { recipe: "intro", spec, op: { op: "add_intro", spec } },
    card: {
      clips: [],
      changes: [`Add a ${spec.seconds}s intro (${spec.personality}, ${spec.emotion})`],
      credits: 0,
      storyboard,
    },
  };
}
