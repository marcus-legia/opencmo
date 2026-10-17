/**
 * Bài eval của agent editor (spec agent-editor §6): câu lệnh như người dùng
 * gõ, chấm bằng code trên document cuối — không chấm bằng model. Mỗi grader
 * chỉ đòi điều câu lệnh đòi, và không cho qua khi agent làm hỏng thứ khác
 * (cắt quá tay, `check` còn lỗi).
 */

import type { ClipDocument } from "@opencmo/clip-doc";
import {
  BUILTIN_LOTTIES,
  MASTER_SRC,
  clipWords,
  findQuote,
  findSilences,
  isRemoved,
  keptDuration,
  keptRanges,
  readCaptionState,
  readCaptionStyle,
  readFrame,
  readLayout,
  toOutput,
  walk,
  type CheckReport,
  type Entity,
  type Transcript,
} from "@opencmo/editor-core";

import { CAPABILITY_IDS, isReady } from "@opencmo/editor-core/capabilities";
import icons from "../../../../../packages/clip-icons/data/icons.json";

import type { PreparedGeneration } from "../generate-tool";
import { ROUGHCUT_TRANSCRIPT, SECOND_TALK, SECOND_TRANSCRIPT, TRANSCRIPT, addSecondTalk } from "./fixture";
import { PAID_TOOLS, before, forbidden, inOrder, maxSteps, toolUsed, trajectory, writes } from "./trajectory";

/** The shared clip with an introduction as its first line, for the name-tag task. */
const INTRO_TRANSCRIPT: Transcript = [
  {
    text: "Hi I'm Linh founder of Paylane and this is how we grow",
    words: "Hi I'm Linh founder of Paylane and this is how we grow".split(" ").map((text, index) => ({ text, start: Math.round((0.3 + index * 0.31) * 100) / 100, end: Math.round((0.3 + index * 0.31 + 0.26) * 100) / 100 })),
  },
  ...TRANSCRIPT.slice(1),
];

export type Outcome = {
  document: ClipDocument;
  report: CheckReport;
  tools: string[];
  generations?: PreparedGeneration[];
  /** Every tool call with its input, in order. */
  calls?: { name: string; input: unknown }[];
  /** Price cards the user was shown (first line is the summary). */
  cards?: { tool: string; changes: string[]; credits: number }[];
  /** Everything the Assistant wrote to the user. */
  reply?: string;
  /** `--until-card`: the run stopped at the first card, nothing was applied. */
  untilCard?: boolean;
};
export type Grade = { pass: boolean; notes: string[] };

export type EvalTask = {
  id: string;
  prompt: string;
  /** Sửa document mẫu trước khi chạy (cài sẵn lỗi cho bài "sửa lỗi"). */
  setup?: (document: ClipDocument) => void;
  /** The clip's transcript when the task needs other words than the shared fixture's. */
  transcript?: Transcript;
  /** More transcripts by path, for videos the setup adds. */
  transcripts?: Record<string, Transcript>;
  /** Câu trả lời khi agent hỏi (`ask_user`). */
  answer?: string;
  grade: (outcome: Outcome) => Grade;
};

type Found = { entity: Entity; tag: string; parent: Entity | null };
function all(document: ClipDocument): Found[] {
  const out: Found[] = [];
  walk(document, ({ entity, tag, parent }) => out.push({ entity, tag, parent }));
  return out;
}
const texts = (document: ClipDocument) => all(document).filter((item) => item.tag === "text");
const words = () => TRANSCRIPT.flatMap((segment) => segment.words);

function state(document: ClipDocument) {
  const caption = readCaptionState(document);
  const window = caption?.window ?? { start: 0, end: 30 };
  const removed = caption?.removed ?? [];
  const kept = keptRanges(window, removed);
  return { window, removed, kept, duration: keptDuration(kept) };
}

/** Mốc trên timeline clip (sau cắt) của một từ nguồn. */
function clipTime(document: ClipDocument, text: string): number | null {
  const word = words().find((item) => item.text.toLowerCase() === text.toLowerCase());
  return word ? toOutput(word.start, state(document).kept) : null;
}

function check(notes: string[], ok: boolean, message: string): boolean {
  if (!ok) notes.push(message);
  return ok;
}

/** Luật chung: không còn lỗi `check`, không cắt quá 30% clip. */
function sane(outcome: Outcome, notes: string[]): boolean {
  const errors = outcome.report.issues.filter((issue) => issue.severity === "error");
  const a = check(notes, !errors.length, `check still has errors: ${errors.map((issue) => issue.code).join(", ")}`);
  const b = check(notes, state(outcome.document).duration >= 21, `cut too much: ${state(outcome.document).duration}s left`);
  return a && b;
}

/** A blank "New edit": no speaker, nothing placed, the default 10 s work area. */
function blankEdit(document: ClipDocument): void {
  const scene = document.stage.children[0] as unknown as Entity;
  scene.children = [];
  scene.workarea = [0, 10];
}

/**
 * A whole video was asked for: create_video is the tool reached, with the length (and frame) the
 * user asked for, and its card says so. Without `--until-card` the video must also be on the timeline.
 */
function gradeVideo(outcome: Outcome, want: { seconds: number; aspect?: string }): Grade {
  const notes: string[] = [];
  const priced = (outcome.calls ?? []).filter((call) => ["create_video", "generate_media", "add_voiceover", "add_3d_scene", "add_explainer"].includes(call.name));
  const first = priced[0];
  if (!check(notes, first?.name === "create_video", `the first paid tool was ${first?.name ?? "none"}, not create_video (tools: ${outcome.tools.join(", ")})`)) return { pass: false, notes };
  // One video card, not a retry loop that shows the founder a new price each time.
  if (!trajectory(notes, toolUsed(outcome.calls ?? [], "create_video", { max: 2 }))) return { pass: false, notes };
  const input = first!.input as { seconds?: number; aspect?: string };
  const seconds = check(notes, (input.seconds ?? 30) === want.seconds, `asked for ${want.seconds}s, create_video got seconds ${input.seconds ?? "(default 30)"}`);
  const aspect = !want.aspect || check(notes, input.aspect === want.aspect, `asked for ${want.aspect}, create_video got aspect ${input.aspect ?? "(the edit's frame)"}`);
  const card = (outcome.cards ?? []).find((item) => item.tool === "create_video");
  const shown = check(notes, Boolean(card) && new RegExp(`^Create a ${want.seconds}s ${want.aspect ?? "9:16"} video`).test(card!.changes[0] ?? ""), `card: ${card?.changes[0] ?? "never reached a create_video card"}`);
  if (outcome.untilCard) return { pass: seconds && aspect && shown, notes };
  const workarea = (outcome.document.stage.children[0] as unknown as { workarea?: number[] }).workarea;
  const length = check(notes, workarea?.[1] === want.seconds, `work area ${JSON.stringify(workarea)}`);
  const voice = check(notes, all(outcome.document).some((item) => (item.entity.src as { generate?: string } | undefined)?.generate === "voice"), "no voice-over");
  const errors = outcome.report.issues.filter((issue) => issue.severity === "error");
  const clean = check(notes, !errors.length, `check still has errors: ${errors.map((issue) => issue.code).join(", ")}`);
  return { pass: seconds && aspect && shown && length && voice && clean, notes };
}

const hasAnimation = (entity: Entity, phase?: "in" | "out") =>
  ((entity.animations as { phase?: string }[] | undefined) ?? []).some((animation) => !phase || (animation.phase ?? "in") === phase);

const srcOf = (entity: Entity): string[] => [
  ...(typeof entity.src === "string" ? [entity.src] : []),
  ...(((entity.paints as { src?: unknown }[] | undefined) ?? []).flatMap((paint) => (typeof paint.src === "string" ? [paint.src] : []))),
];

/** Things an explainer can draw (`docs/explainer-v2-build.md`, kit API v2): Lucide icons, built-in Lotties, kit shapes. */
const ICON_NAMES = new Set(Object.keys((icons as { icons: Record<string, unknown> }).icons));
const LOTTIE_NAMES = new Set(BUILTIN_LOTTIES().map((entry) => entry.name));
const SHAPE_KINDS = new Set(["circle", "cell", "blob", "ring", "pill", "capsule", "star", "arrow", "path"]);

/** Does a storyboard `visual` name something drawable? Single words and hyphen-joined pairs ("shield check"). */
function drawable(visual: string): boolean {
  const words = visual.toLowerCase().split(/[^a-z0-9/-]+/).filter(Boolean);
  const names = [...words, ...words.slice(1).map((word, index) => `${words[index]}-${word}`)];
  return names.some((name) => ICON_NAMES.has(name) || LOTTIE_NAMES.has(name) || SHAPE_KINDS.has(name));
}

/** The last `add_explainer` call's storyboard and code (the spec keeps neither the visuals nor the code). */
function storyboardOf(outcome: Outcome) {
  const call = [...(outcome.calls ?? [])].reverse().find((item) => item.name === "add_explainer");
  const input = (call?.input ?? {}) as { beats?: { say?: string; visual?: string }[]; code?: string; theme?: string; personality?: string };
  return { beats: input.beats ?? [], code: input.code ?? "" };
}

/** Every icon name the scene code draws (`<Icon name="virus" …>`). */
const codeIcons = (code: string): string[] => [...code.matchAll(/<Icon\b[^>]*?\bname=["'{`]+([a-z0-9-]+)/g)].map((match) => match[1]!);

const masters = (document: ClipDocument) => all(document).filter((item) => item.tag === "video" && item.entity.src === MASTER_SRC);

export const TASKS: EvalTask[] = [
  {
    id: "roughcut",
    prompt: "/roughcut my talk. Just do it, no need to ask.",
    transcript: ROUGHCUT_TRANSCRIPT,
    grade(outcome) {
      const notes: string[] = [];
      const { window, removed } = state(outcome.document);
      const line = (index: number) => ROUGHCUT_TRANSCRIPT[index]!.words;
      const cut = (index: number) => line(index).every((word) => isRemoved(word, removed));
      const kept = (index: number, skip = "") => line(index).filter((word) => word.text !== skip).every((word) => !isRemoved(word, removed));
      const retakes = check(notes, cut(2) && cut(4), "the false start or the first take of the repeated sentence is still in");
      const last = check(notes, kept(3) && kept(5), "a kept take lost words (keep the LAST take whole)");
      const rest = check(notes, kept(0) && kept(6, "uh") && kept(7), "cut words of a sentence said only once");
      const fillers = check(notes, cut(1) && line(6).filter((word) => word.text === "uh").every((word) => isRemoved(word, removed)), "um/uh still in the video");
      const left = findSilences({ transcript: ROUGHCUT_TRANSCRIPT, window, removed }, { minGap: 1 });
      const tight = check(notes, !left.length, `pauses left: ${left.map((item) => `${item.start}-${item.end}`).join(", ")}`);
      const errors = outcome.report.issues.filter((issue) => issue.severity === "error");
      const clean = check(notes, !errors.length, `check still has errors: ${errors.map((issue) => issue.code).join(", ")}`);
      return { pass: retakes && last && rest && fillers && tight && clean, notes };
    },
  },
  {
    id: "second-video",
    prompt: "Remove the filler words from the second video only. Leave the main video as it is.",
    setup: addSecondTalk,
    transcripts: { [SECOND_TALK.transcript]: SECOND_TRANSCRIPT },
    grade(outcome) {
      const notes: string[] = [];
      const second = readCaptionState(outcome.document, SECOND_TALK.id);
      const main = state(outcome.document);
      if (!check(notes, Boolean(second), "the second video lost its transcript link")) return { pass: false, notes };
      const fillers = SECOND_TRANSCRIPT.flatMap((segment) => segment.words).filter((word) => /^(um|uh)$/.test(word.text));
      const cut = check(notes, fillers.every((word) => isRemoved(word, second!.removed)), "um/uh still in the second video");
      const kept = SECOND_TRANSCRIPT.flatMap((segment) => segment.words).filter((word) => !/^(um|uh)$/.test(word.text));
      const careful = check(notes, kept.every((word) => !isRemoved(word, second!.removed)), "cut words that are not fillers from the second video");
      const untouched = check(notes, main.removed.length === 0, `the main video was cut too (${main.removed.length} ranges)`);
      const errors = outcome.report.issues.filter((issue) => issue.severity === "error");
      const clean = check(notes, !errors.length, `check still has errors: ${errors.map((issue) => issue.code).join(", ")}`);
      return { pass: cut && careful && untouched && clean, notes };
    },
  },
  {
    id: "filler",
    prompt: "Remove the filler words.",
    grade(outcome) {
      const notes: string[] = [];
      const { removed } = state(outcome.document);
      const gone = (text: string) => words().filter((word) => word.text === text).every((word) => isRemoved(word, removed));
      const fillers = check(notes, gone("um") && gone("uh"), "um/uh still in the video");
      const cutWords = words().filter((word) => isRemoved(word, removed)).length;
      const careful = check(notes, cutWords <= 4, `removed ${cutWords} words (expected about 3)`);
      // Found by the filler finder, not guessed from the transcript; no credits; a short path.
      const calls = outcome.calls ?? [];
      const path = trajectory(notes, inOrder(calls, ["find_filler_words", "remove_words"]), forbidden(calls, PAID_TOOLS, "paid tools"), maxSteps(calls, 6));
      return { pass: fillers && careful && path && sane(outcome, notes), notes };
    },
  },
  {
    id: "pauses",
    prompt: "Tighten the pacing by cutting the long pauses.",
    grade(outcome) {
      const notes: string[] = [];
      const { window, removed } = state(outcome.document);
      const left = findSilences({ transcript: TRANSCRIPT, window, removed }, { minGap: 0.8 });
      const tight = check(notes, !left.length, `pauses left: ${left.map((item) => `${item.start}-${item.end}`).join(", ")}`);
      const kept = words().filter((word) => !isRemoved(word, removed)).length;
      const words_ = check(notes, kept >= words().length - 3, `cut ${words().length - kept} spoken words`);
      const calls = outcome.calls ?? [];
      const path = trajectory(notes, forbidden(calls, PAID_TOOLS, "paid tools"), maxSteps(calls, 6));
      return { pass: tight && words_ && path && sane(outcome, notes), notes };
    },
  },
  {
    id: "hook",
    prompt: "Add a bold hook title in the first 3 seconds that says: Nobody tells you this.",
    grade(outcome) {
      const notes: string[] = [];
      const hook = texts(outcome.document).find((item) => /nobody tells you this/i.test(String(item.entity.text)));
      if (!check(notes, Boolean(hook), "no hook text")) return { pass: false, notes };
      const start = Number(hook!.entity.start ?? 0);
      const end = Number(hook!.entity.end ?? 16);
      const timing = check(notes, start <= 0.5 && end >= 1.5 && end <= 4.5, `hook runs ${start}-${end}s`);
      const moves = check(notes, hasAnimation(hook!.entity, "in"), "hook has no entrance animation");
      const bold = check(notes, Number(hook!.entity.fontWeight ?? 400) >= 700, "hook is not bold");
      return { pass: timing && moves && bold && sane(outcome, notes), notes };
    },
  },
  {
    id: "square",
    prompt: "Make this clip square.",
    grade(outcome) {
      const notes: string[] = [];
      const frame = readFrame(outcome.document);
      const square = check(notes, frame?.width === frame?.height && Boolean(frame), `frame is ${frame?.width}x${frame?.height}`);
      return { pass: square && sane(outcome, notes), notes };
    },
  },
  {
    id: "broll",
    prompt: "Show the B-roll from the library while they talk about better hooks.",
    grade(outcome) {
      const notes: string[] = [];
      const broll = all(outcome.document).find((item) => srcOf(item.entity).includes("assets/broll.mp4"));
      if (!check(notes, Boolean(broll), "B-roll not placed")) return { pass: false, notes };
      const at = clipTime(outcome.document, "hooks") ?? 10;
      const start = Number(broll!.entity.start ?? 0);
      const near = check(notes, Math.abs(start - (at - 2)) <= 3, `B-roll starts at ${start}s, "better hooks" is around ${at}s`);
      return { pass: near && sane(outcome, notes), notes };
    },
  },
  {
    id: "captions",
    prompt: "Use the classic caption style with a yellow highlight.",
    grade(outcome) {
      const notes: string[] = [];
      const style = readCaptionStyle(outcome.document);
      const preset = check(notes, style?.preset === "classic", `preset is ${style?.preset}`);
      const yellow = check(
        notes,
        (style?.colors ?? []).some((color) => {
          const value = parseInt(color.slice(1, 7), 16);
          return (value >> 16) > 200 && ((value >> 8) & 255) > 170 && (value & 255) < 110;
        }),
        `colors are ${JSON.stringify(style?.colors)}`,
      );
      return { pass: preset && yellow && sane(outcome, notes), notes };
    },
  },
  {
    id: "zoom",
    prompt: "Add a punch-in zoom on the speaker when they say 'first three seconds'.",
    grade(outcome) {
      const notes: string[] = [];
      const zoomed = masters(outcome.document).some((item) =>
        ((item.entity.tracks as { property: string; keyframes: { value: unknown }[] }[] | undefined) ?? []).some(
          (track) => ["scale", "scaleX", "scaleY"].includes(track.property) && track.keyframes.some((key) => Number(key.value) > 1.04),
        ),
      );
      const scaledGroup = all(outcome.document).some(
        (item) => (item.tag === "group" || item.tag === "scene") && ((item.entity.tracks as { property: string }[] | undefined) ?? []).some((track) => track.property.startsWith("scale")),
      );
      const ok = check(notes, zoomed || scaledGroup, "no scale keyframes on the speaker video");
      return { pass: ok && sane(outcome, notes), notes };
    },
  },
  {
    id: "fix",
    prompt: "Check this clip for problems and fix them.",
    setup(document) {
      const scene = document.stage.children[0] as unknown as { children: Record<string, unknown>[] };
      scene.children.push(
        { kind: "text", id: "ghost", text: "Draft note", opacity: 0, start: 2, end: 6, fontSize: 60, color: "#FFFFFF" },
        { kind: "rect", id: "stray", fill: "#FF0000", x: 5000, y: 5000, width: 200, height: 200, start: 0, end: 4 },
      );
    },
    grade(outcome) {
      const notes: string[] = [];
      const left = outcome.report.issues.filter((issue) => issue.node_id === "ghost" || issue.node_id === "stray");
      const ok = check(notes, !left.length, `still flagged: ${left.map((issue) => issue.code).join(", ")}`);
      return { pass: ok && sane(outcome, notes), notes };
    },
  },
  {
    id: "ask",
    prompt: "Make it better.",
    answer: "Tighten the pacing and add a hook title.",
    grade(outcome) {
      const notes: string[] = [];
      const asked = check(notes, outcome.tools.includes("ask_user"), "did not ask what 'better' means");
      // Asking is pointless if it edits first: nothing changes until the founder has answered.
      const waited = trajectory(notes, forbidden(before(outcome.calls ?? [], "ask_user"), writes, "edited before asking"));
      return { pass: asked && waited && sane(outcome, notes), notes };
    },
  },
  {
    id: "cta",
    prompt: "Add a call to action 'Follow for more' in the last 2 seconds.",
    grade(outcome) {
      const notes: string[] = [];
      const cta = texts(outcome.document).find((item) => /follow for more/i.test(String(item.entity.text)));
      if (!check(notes, Boolean(cta), "no call to action")) return { pass: false, notes };
      const { duration } = state(outcome.document);
      const start = Number(cta!.entity.start ?? 0);
      const end = Number(cta!.entity.end ?? 16);
      const timing = check(notes, start >= duration - 2.6 && end >= duration - 0.3, `CTA runs ${start}-${end}s, clip is ${duration}s`);
      return { pass: timing && sane(outcome, notes), notes };
    },
  },
  {
    id: "restyle",
    prompt: "Make the title uppercase, bigger, and give it a black outline.",
    setup(document) {
      const scene = document.stage.children[0] as unknown as { children: Record<string, unknown>[] };
      scene.children.push({
        kind: "text", id: "title0", text: "watch this", start: 0, end: 3, y: 300, width: 1080, height: 216,
        textAlign: "center", textBaseline: "middle", fontSize: 72, fontWeight: 700, color: "#FFFFFF", fontFamily: "Inter",
      });
    },
    grade(outcome) {
      const notes: string[] = [];
      const title = texts(outcome.document).find((item) => /watch this/i.test(String(item.entity.text)));
      if (!check(notes, Boolean(title), "title is gone")) return { pass: false, notes };
      const entity = title!.entity;
      const upper = check(notes, entity.textCase === "upper" || String(entity.text) === "WATCH THIS", "not uppercase");
      const bigger = check(notes, Number(entity.fontSize ?? 0) > 72, `fontSize ${entity.fontSize}`);
      const outline = check(
        notes,
        ((entity.strokes as { color: string }[] | undefined) ?? []).some((stroke) => /^#(0{6}|000)/i.test(stroke.color)),
        "no black stroke",
      );
      return { pass: upper && bigger && outline && sane(outcome, notes), notes };
    },
  },
  {
    id: "endfade",
    prompt: "Fade to black at the very end of the clip.",
    grade(outcome) {
      const notes: string[] = [];
      const { duration } = state(outcome.document);
      const found = all(outcome.document);
      const videoFade = masters(outcome.document).some(
        (item) =>
          hasAnimation(item.entity, "out") ||
          ((item.entity.tracks as { property: string; keyframes: { value: unknown }[] }[] | undefined) ?? []).some(
            (track) => track.property === "opacity" && Number(track.keyframes.at(-1)?.value) <= 0.1,
          ),
      );
      const overlay = found.some(
        (item) =>
          item.tag === "rect" &&
          /^#0{3,6}/i.test(String(item.entity.fill ?? "")) &&
          Number(item.entity.start ?? 0) >= duration - 3 &&
          (hasAnimation(item.entity, "in") || ((item.entity.tracks as { property: string }[] | undefined) ?? []).some((track) => track.property === "opacity")),
      );
      const container = found.some((item) => ["sequence", "group", "scene"].includes(item.tag) && hasAnimation(item.entity, "out"));
      const ok = check(notes, videoFade || overlay || container, "no fade at the end");
      return { pass: ok && sane(outcome, notes), notes };
    },
  },
  {
    id: "steps",
    prompt: "When I say 'start with the result then show how you got there', show those two steps as a simple diagram on screen.",
    grade(outcome) {
      const notes: string[] = [];
      const visual = all(outcome.document).find(
        (item) => item.tag === "group" && (item.entity.marks as { visual?: { op?: string } } | undefined)?.visual?.op === "add_diagram",
      );
      if (!check(notes, Boolean(visual), "no diagram")) return { pass: false, notes };
      const entity = visual!.entity;
      const input = (entity.marks as { visual: { input: { nodes: { label: string }[] } } }).visual.input;
      const two = check(notes, input.nodes.length >= 2 && input.nodes.length <= 4, `${input.nodes.length} nodes`);
      const labels = input.nodes.map((node) => node.label.toLowerCase()).join(" | ");
      const words = check(notes, /result/.test(labels) && /(how|got|process|steps?|show)/.test(labels), `labels: ${labels}`);
      // Hiện trong lúc người nói nói câu đó (mốc clip của "start" … "there").
      const from = clipTime(outcome.document, "result");
      const start = Number(entity.start ?? 0);
      const end = Number(entity.end ?? 0);
      const timed = check(notes, from !== null && start <= from + 0.5 && end >= from + 1.5, `shown ${start}-${end}s, phrase at ${from}s`);
      return { pass: two && words && timed && sane(outcome, notes), notes };
    },
  },
  {
    id: "number",
    prompt: "When I say 'the first three seconds', put a big on-screen 3 SECONDS stat to hammer it home.",
    grade(outcome) {
      const notes: string[] = [];
      const at = clipTime(outcome.document, "three");
      const chart = all(outcome.document).find((item) => {
        const visual = (item.entity.marks as { visual?: { op?: string; input?: { type?: string; data?: { value: number }[] } } } | undefined)?.visual;
        return item.tag === "group" && visual?.op === "add_chart" && visual.input?.type === "stat" && visual.input.data?.[0]?.value === 3;
      });
      const bigText = texts(outcome.document).find((item) => /\b3\b|three/i.test(String(item.entity.text)) && Number(item.entity.fontSize ?? 0) >= 120);
      const found = chart ?? bigText;
      if (!check(notes, Boolean(found), "no big 3 on screen")) return { pass: false, notes };
      const start = Number(found!.entity.start ?? (found!.parent?.start as number | undefined) ?? 0);
      const end = Number(found!.entity.end ?? (found!.parent?.end as number | undefined) ?? 0);
      const timed = check(notes, at !== null && start <= at + 0.5 && end >= at + 0.8, `shown ${start}-${end}s, word at ${at}s`);
      return { pass: timed && sane(outcome, notes), notes };
    },
  },
  {
    id: "split",
    prompt: "While I explain 'start with the result then show how you got there', split the screen: me at the bottom, those two steps as a diagram on top.",
    grade(outcome) {
      const notes: string[] = [];
      const from = clipTime(outcome.document, "result");
      const ranges = readLayout(outcome.document);
      const split = ranges.find((range) => range.mode === "split-bottom" && from !== null && range.start <= from + 0.5 && range.end >= from + 1.5);
      if (!check(notes, Boolean(split), `layout: ${JSON.stringify(ranges)}`)) return { pass: false, notes };
      const diagram = all(outcome.document).find(
        (item) => item.tag === "group" && (item.entity.marks as { visual?: { op?: string } } | undefined)?.visual?.op === "add_diagram",
      );
      const placed = check(notes, Boolean(diagram), "no diagram");
      const covers = outcome.report.issues.filter((issue) => issue.code === "covers-speaker");
      const clear = check(notes, !covers.length, `covers the speaker: ${covers.map((issue) => issue.message).join("; ")}`);
      // Chia đôi chỉ trong đoạn giải thích, không cả clip.
      const short = check(notes, split!.end - split!.start <= 15, `split ${split!.start}-${split!.end}s`);
      return { pass: placed && clear && short && sane(outcome, notes), notes };
    },
  },
  {
    id: "icon",
    prompt: "When I say 'growing an audience', pop a fitting animated icon on screen.",
    grade(outcome) {
      const notes: string[] = [];
      const at = clipTime(outcome.document, "growing");
      const found = all(outcome.document).find((item) => {
        const visual = (item.entity.marks as { visual?: { op?: string; input?: { name?: string; animation?: string } } } | undefined)?.visual;
        return item.tag === "group" && (visual?.op === "add_icon" || visual?.op === "add_lottie");
      });
      if (!check(notes, Boolean(found), "no icon")) return { pass: false, notes };
      const input = (found!.entity.marks as { visual: { op: string; input: { name?: string; animation?: string; motion?: string } } }).visual.input;
      const name = String(input.name ?? input.animation ?? "");
      const fits = check(notes, /user|people|person|trend|grow|chart|sprout|rocket|arrow-up|walk|cheer|megaphone/.test(name), `icon: ${name}`);
      const start = Number(found!.entity.start ?? 0);
      const end = Number(found!.entity.end ?? 0);
      const timed = check(notes, at !== null && start <= at + 0.5 && end >= at + 0.8, `shown ${start}-${end}s, word at ${at}s`);
      return { pass: fits && timed && sane(outcome, notes), notes };
    },
  },
  {
    id: "emoji",
    prompt: "Add a fitting animated emoji reaction when I say 'people lose viewers'.",
    grade(outcome) {
      const notes: string[] = [];
      const at = clipTime(outcome.document, "lose");
      const found = visuals(outcome.document).find((item) => item.op === "add_lottie");
      if (!check(notes, Boolean(found), "no animation")) return { pass: false, notes };
      const animation = String((found!.input as { animation?: string }).animation ?? "");
      const emoji = check(notes, animation.startsWith("emoji/"), `not an emoji: ${animation}`);
      const fits = check(notes, /scream|fearful|anxious|cry|sob|weary|pensive|skull|grimacing|astonished|open-mouth|exploding|chart-down|broken|warning/.test(animation), `emoji: ${animation}`);
      const timed = check(notes, at !== null && found!.start <= at + 0.5 && found!.end >= at + 0.8, `shown ${found!.start}-${found!.end}s, word at ${at}s`);
      return { pass: emoji && fits && timed && sane(outcome, notes), notes };
    },
  },
  {
    id: "explain3d",
    prompt: "Add a 3D visual that explains how growing an audience compounds.",
    grade(outcome) {
      const notes: string[] = [];
      const noGen = check(notes, !outcome.tools.includes("generate_media"), "used generate_media for an explainer");
      // "3D" → cảnh code (spec code-scenes); visual vẽ phẳng vẫn chấp nhận được cho ý trừu tượng.
      const scene = outcome.generations?.find((item) => item.model.id === "studio-3d");
      const drawn = visuals(outcome.document).find((item) => ["add_graph", "add_diagram", "add_chart"].includes(item.op));
      const visual = scene ? { start: Number((scene.op as { start?: number }).start ?? -1), quote: scene.quote } : drawn;
      if (!check(notes, Boolean(visual), "no 3D animation or drawn visual")) return { pass: false, notes };
      const previewed = check(notes, !scene || outcome.tools.includes("preview_3d"), "added a 3D scene without previewing it");
      const at = clipTime(outcome.document, "growing");
      const grounded = check(notes, at !== null && Math.abs(visual!.start - at) <= 1.5, `starts ${visual!.start}s, "growing" at ${at}s`);
      const quoted = check(notes, quoteFound(outcome.document, visual!.quote), `quote not in transcript: ${visual!.quote ?? "(none)"}`);
      return { pass: noGen && previewed && grounded && quoted && sane(outcome, notes), notes };
    },
  },
  {
    id: "brollgen",
    prompt: "Generate a B-roll shot for 'watch the numbers change'.",
    grade(outcome) {
      const notes: string[] = [];
      const gen = outcome.generations?.find((item) => item.model.kind === "video" || item.model.kind === "image");
      if (!check(notes, Boolean(gen), "no AI image/video prepared")) return { pass: false, notes };
      const quoted = check(notes, quoteFound(outcome.document, gen!.quote), `quote not in transcript: ${gen!.quote ?? "(none)"}`);
      const prompt = gen!.spec.prompt.toLowerCase();
      const noText = check(notes, !prompt.includes("watch the numbers change"), "the spoken line leaked into the prompt (models draw it as text)");
      const noWords = check(notes, /no text/.test(prompt), "prompt does not forbid text in the frame");
      const at = clipTime(outcome.document, "numbers");
      const start = Number((gen!.op as { start?: number }).start ?? 0);
      const timed = check(notes, at !== null && Math.abs(start - at) <= 1.5, `starts ${start}s, "numbers" at ${at}s`);
      return { pass: quoted && noText && noWords && timed && sane(outcome, notes), notes };
    },
  },
  {
    id: "intro",
    prompt: "Make an intro for this clip.",
    grade(outcome) {
      const notes: string[] = [];
      const intro = all(outcome.document).find((item) => item.tag === "group" && (item.entity.marks as { visual?: { op?: string } } | undefined)?.visual?.op === "intro");
      if (!check(notes, Boolean(intro), "no intro group from plan_video")) return { pass: false, notes };
      const used = check(notes, outcome.tools.includes("plan_video"), "the intro was not built by the video team");
      // The plan comes first: no priced piece before the storyboard, and one plan, not a loop of them.
      const calls = outcome.calls ?? [];
      const planned = trajectory(notes, forbidden(before(calls, "plan_video"), PAID_TOOLS, "paid tools before plan_video"), toolUsed(calls, "plan_video", { max: 2 }));
      const start = check(notes, intro!.entity.start === 0, `intro starts at ${String(intro!.entity.start)}s`);
      const animated = check(
        notes,
        ((intro!.entity.children as Entity[] | undefined) ?? []).filter((child) => child.tracks || child.animations).length >= 2,
        "fewer than two animated elements",
      );
      return { pass: used && planned && start && animated && sane(outcome, notes), notes };
    },
  },
  {
    id: "videoedit",
    prompt: "Make the part from 2 to 6 seconds look like night.",
    grade(outcome) {
      const notes: string[] = [];
      const layer = all(outcome.document).find((item) => (item.entity.marks as { visual?: { op?: string } } | undefined)?.visual?.op === "edit_video");
      if (!check(notes, Boolean(layer), "no AI edit layer")) return { pass: false, notes };
      const paint = ((layer!.entity.paints as { src?: { sourceVideo?: string; duration?: number } }[] | undefined) ?? [])[0];
      const own = check(notes, paint?.src?.sourceVideo === "assets/master.mp4", "the edit does not read the clip's own video");
      const range = check(notes, layer!.entity.start === 2 && layer!.entity.end === 6, `range is ${String(layer!.entity.start)}-${String(layer!.entity.end)}s`);
      const muted = check(notes, layer!.entity.muted === true, "the edit plays its own sound over the speaker");
      const gen = outcome.generations?.find((item) => item.model.limits.clipVideo);
      const priced = check(notes, Boolean(gen), "no priced generation for the edit");
      return { pass: own && range && muted && priced && sane(outcome, notes), notes };
    },
  },
  {
    id: "bgswap",
    prompt: "Replace the background behind me with a bright office.",
    grade(outcome) {
      const notes: string[] = [];
      const swap = all(outcome.document).find((item) => item.tag === "group" && (item.entity.marks as { visual?: { op?: string } } | undefined)?.visual?.op === "replace_background");
      if (!check(notes, Boolean(swap), "no background swap group")) return { pass: false, notes };
      const [background, cutout] = (swap!.entity.children as Entity[] | undefined) ?? [];
      const paint = ((cutout?.paints as { alpha?: string; src?: { sourceVideo?: string } }[] | undefined) ?? [])[0];
      const keyed = check(notes, paint?.alpha === "stacked" && paint.src?.sourceVideo === "assets/master.mp4", "the speaker is not a stacked-alpha cut-out of the clip's own video");
      const behind = check(notes, Boolean(background) && background!.name === "New background", "no new background under the cut-out");
      const gen = outcome.generations?.find((item) => item.model.limits.removeBackground);
      const priced = check(notes, Boolean(gen) && (gen!.extra?.length ?? 0) === 1, "the card does not hold the cut-out and the background together");
      const prompt = String(gen?.extra?.[0]?.spec.prompt ?? "");
      // "no people" asks for an empty room: only people the prompt actually puts in it count.
      const asked = prompt.replace(/\b(no|without)\s+\w+/gi, "");
      const noPeople = check(notes, !/\b(person|people|man|woman|crowd)\b/i.test(asked), `background prompt has people: ${prompt}`);
      return { pass: keyed && behind && priced && noPeople && sane(outcome, notes), notes };
    },
  },
  {
    id: "videocreate",
    prompt: "/video a 15 second video introducing our hotel booking app",
    // A blank "New edit".
    setup(document) {
      const scene = document.stage.children[0] as unknown as Entity;
      scene.children = [];
      scene.workarea = [0, 10];
    },
    grade(outcome) {
      const notes: string[] = [];
      const gen = outcome.generations?.find((item) => (item.op as { op?: string }).op === "create_video");
      if (!check(notes, Boolean(gen), "no create_video from /video")) return { pass: false, notes };
      const shots = all(outcome.document).filter((item) => ((item.entity.paints as { src?: { generate?: string } }[] | undefined) ?? []).some((paint) => paint.src?.generate === "video"));
      const covered = check(notes, shots.length >= 2, `${shots.length} video shots placed`);
      const parallel = check(notes, (gen!.extra?.length ?? 0) >= shots.length - 1, "not every shot, voice and music start together");
      const voice = check(notes, all(outcome.document).some((item) => (item.entity.src as { generate?: string } | undefined)?.generate === "voice"), "no voice-over");
      const workarea = (outcome.document.stage.children[0] as unknown as { workarea?: number[] }).workarea;
      const length = check(notes, workarea?.[1] === 15, `work area ${JSON.stringify(workarea)}`);
      return { pass: covered && parallel && voice && length && sane(outcome, notes), notes };
    },
  },
  // What founders type for a whole video (PR 45 scenarios 13-14), graded on what they get back:
  // the card they approve (`--until-card`) or the video placed on the timeline.
  {
    id: "video-slash",
    prompt: "/video a 20-second video introducing a note-taking app for students: calm voice-over, light music, clean modern visuals. No people, no brand logos.",
    setup: blankEdit,
    grade: (outcome) => gradeVideo(outcome, { seconds: 20 }),
  },
  {
    id: "video-plain",
    // No slash command: the system prompt alone must route a whole video to create_video.
    prompt: "Make me a 20-second video introducing a note-taking app for students.",
    setup: blankEdit,
    grade: (outcome) => gradeVideo(outcome, { seconds: 20 }),
  },
  {
    id: "video-outro",
    prompt:
      '/video 5-second vertical outro, cinematic and clean. A sleek laptop on a minimal desk at golden hour, its screen glowing with soft colorful blocks sliding into a neat row. No people, no brand logos. Voiceover: "Your videos, cut into clips. You approve, you post. OpenCMO."',
    setup: blankEdit,
    grade: (outcome) => gradeVideo(outcome, { seconds: 5 }),
  },
  {
    id: "video-square",
    prompt: "/video a 15-second square video for Instagram about a budgeting app for freelancers",
    setup: blankEdit,
    grade: (outcome) => gradeVideo(outcome, { seconds: 15, aspect: "1:1" }),
  },
  {
    id: "video-own-clip",
    // On the speaker's own clip /video refuses: the user must be told where to go, not get a loop.
    prompt: "/video make a video about what I'm saying here",
    grade(outcome) {
      const notes: string[] = [];
      const placed = check(notes, !(outcome.generations ?? []).some((item) => (item.op as { op?: string }).op === "create_video"), "a /video was planned over the user's own footage");
      const tries = (outcome.calls ?? []).filter((call) => call.name === "create_video").length;
      const noLoop = check(notes, tries <= 2, `create_video tried ${tries} times`);
      const told = check(notes, /new edit|\/broll|b-roll/i.test(outcome.reply ?? ""), `the user is not told what to do instead: ${(outcome.reply ?? "").slice(0, 200)}`);
      return { pass: placed && noLoop && told, notes };
    },
  },
  // Explainers (docs/explainer-build.md): the script is shown and approved before any code or credit.
  {
    id: "explain-script",
    prompt: "/explain How Shazam recognizes a song in a noisy bar",
    setup: blankEdit,
    grade(outcome) {
      const notes: string[] = [];
      const reply = outcome.reply ?? "";
      const waited = check(notes, !outcome.tools.some((name) => ["preview_explainer", "add_explainer"].includes(name)), `tools before the user said go: ${outcome.tools.join(", ")}`);
      const beats = reply.split("\n").filter((line) => /^\s*(\d+[.)]|[-*•]|beat\s*\d+)/i.test(line));
      const scripted = check(notes, beats.length >= 3, `script has ${beats.length} beats: ${reply.slice(0, 300)}`);
      const asked = check(notes, /\?\s*$/.test(reply.trim()) || outcome.tools.includes("ask_user"), "does not ask before making it");
      return { pass: waited && scripted && asked, notes };
    },
  },
  {
    id: "explain-make",
    prompt: "/explain How a vaccine teaches your immune system, 16:9. I trust your script, no need to show it: go ahead and make it.",
    setup: blankEdit,
    grade(outcome) {
      const notes: string[] = [];
      const previewed = outcome.tools.indexOf("preview_explainer");
      const added = outcome.tools.lastIndexOf("add_explainer");
      const order = check(notes, previewed >= 0 && added > previewed, `tools: ${outcome.tools.join(", ")}`);
      const gen = outcome.generations?.find((item) => item.model.id === "motion-explainer");
      if (!check(notes, Boolean(gen), "no explainer prepared")) return { pass: false, notes };
      const scene = gen!.spec.scene as { template?: string; code_ref?: string; beats?: { say: string; label?: string }[] } | undefined;
      const ref = check(notes, scene?.template === "explainer" && /^[0-9a-f]{64}$/.test(scene.code_ref ?? ""), `scene: ${JSON.stringify(scene).slice(0, 200)}`);
      const beats = scene?.beats ?? [];
      const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
      const paced = check(notes, beats.length >= 3 && beats.every((beat) => words(beat.say) >= 4 && words(beat.say) <= 24), `beat lengths: ${beats.map((beat) => words(beat.say)).join(", ")}`);
      const labels = check(notes, beats.every((beat) => !beat.label || words(beat.label) <= 5), "a label is longer than 5 words");
      const board = storyboardOf(outcome).beats;
      const pictured = check(notes, board.length === beats.length && board.every((beat) => beat.visual?.trim()), "a beat has no visual in the storyboard");
      const shape = check(notes, gen!.spec.aspectRatio === "16:9", `format ${gen!.spec.aspectRatio}`);
      const placed = check(
        notes,
        all(outcome.document).some((item) => ((item.entity.paints as { src?: { model?: string } }[] | undefined) ?? []).some((paint) => paint.src?.model === "motion-explainer")),
        "the explainer is not on the clip",
      );
      // Not `sane`: a blank edit is exactly as long as its explainer, which may be under 21 s.
      const errors = outcome.report.issues.filter((issue) => issue.severity === "error");
      const clean = check(notes, !errors.length, `check still has errors: ${errors.map((issue) => issue.code).join(", ")}`);
      return { pass: order && ref && paced && labels && pictured && shape && placed && clean, notes };
    },
  },
  // Explainer v2 (docs/explainer-v2-build.md): the subject is on screen, mapped noun by noun before any code.
  {
    id: "explain-vaccine",
    prompt: "/explain How a vaccine teaches your immune system to fight a virus. 16:9, about 30 seconds, voice Aria. Go ahead and make it, no need to show the script.",
    setup: blankEdit,
    grade(outcome) {
      const notes: string[] = [];
      const previewed = outcome.tools.indexOf("preview_explainer");
      const added = outcome.tools.lastIndexOf("add_explainer");
      const order = check(notes, previewed >= 0 && added > previewed, `tools: ${outcome.tools.join(", ")}`);
      const gen = outcome.generations?.find((item) => item.model.id === "motion-explainer");
      if (!check(notes, Boolean(gen), "no explainer prepared")) return { pass: false, notes };
      const scene = gen!.spec.scene as { theme?: string; personality?: string } | undefined;
      const look = check(notes, Boolean(scene?.theme && scene.personality), `theme ${scene?.theme ?? "(none)"}, personality ${scene?.personality ?? "(none)"}`);
      const { beats, code } = storyboardOf(outcome);
      const unpictured = beats.filter((beat) => !drawable(beat.visual ?? "")).map((beat) => beat.visual ?? "(none)");
      const pictured = check(notes, beats.length >= 3 && !unpictured.length, `visuals that name no icon, Lottie or shape: ${unpictured.join(" | ")}`);
      const drawn = codeIcons(code);
      const unknown = drawn.filter((name) => !ICON_NAMES.has(name));
      const real = check(notes, !unknown.length, `unknown icons in the code: ${unknown.join(", ")}`);
      const subject = new Set(drawn.filter((name) => /virus|syringe|shield|dna|microscope|biohazard|pill|bacteria|heart-pulse/.test(name)));
      const onTopic = check(notes, subject.size >= 3, `subject icons: ${[...subject].join(", ") || "none"}`);
      const offTopic = drawn.filter((name) => /database|server|cpu|hard-drive/.test(name));
      const relevant = check(notes, !offTopic.length, `icons unrelated to vaccines: ${offTopic.join(", ")}`);
      const headline = check(notes, /<Headline\b/.test(code), "no Headline row in the scene code");
      const shape = check(notes, gen!.spec.aspectRatio === "16:9", `format ${gen!.spec.aspectRatio}`);
      return { pass: order && look && pictured && real && onTopic && relevant && headline && shape, notes };
    },
  },
  {
    id: "blankgen",
    prompt: "Create an AI image at 2s of our booking app on a laptop.",
    // A blank "New edit": no speaker, no captions, nothing to quote.
    setup(document) {
      const scene = document.stage.children[0] as unknown as Entity;
      scene.children = [];
      scene.workarea = [0, 10];
    },
    grade(outcome) {
      const notes: string[] = [];
      const gen = outcome.generations?.find((item) => item.model.kind === "image");
      if (!check(notes, Boolean(gen), "no AI image prepared")) return { pass: false, notes };
      const op = gen!.op as { start?: number; length?: number };
      const timed = check(notes, op.start === 2, `starts at ${op.start ?? 0}s, asked for 2s`);
      const unquoted = check(notes, gen!.quote === undefined, `quoted "${gen!.quote}" on a project without a script`);
      const placed = check(notes, JSON.stringify(outcome.document).includes('"generate":"image"'), "the image is not on the timeline");
      return { pass: timed && unquoted && placed && Boolean(op.length), notes };
    },
  },
  {
    id: "brollset",
    prompt: "Generate B-roll: AI shots for the lines that name something concrete",
    grade(outcome) {
      const notes: string[] = [];
      const stills = (outcome.generations ?? []).filter((item) => item.model.kind === "image");
      // Guide broll: ảnh tĩnh trước (rẻ), nhiều shot trong MỘT lượt để duyệt chung một thẻ.
      const several = check(notes, stills.length >= 2, `${stills.length} stills prepared`);
      const noVideo = check(notes, !(outcome.generations ?? []).some((item) => item.model.kind === "video"), "animated before the user saw the stills");
      const quotes = stills.map((item) => item.quote ?? "");
      const grounded = check(notes, quotes.every((quote) => quoteFound(outcome.document, quote)), `quotes: ${quotes.join(" | ")}`);
      const distinct = check(notes, new Set(quotes).size === quotes.length, "two shots on the same line");
      const hook = clipTime(outcome.document, "nobody");
      const starts = stills.map((item) => Number((item.op as { start?: number }).start ?? 0));
      const offHook = check(notes, hook === null || starts.every((start) => start > hook + 1), `starts ${starts.join(", ")}s; hook at ${hook}s`);
      const short = check(
        notes,
        stills.every((item) => {
          const length = (item.op as { length?: number }).length;
          return length !== undefined && length >= 1.5 && length <= 4;
        }),
        "each shot should stay 1.5-4 s",
      );
      // B-roll pack: every still comes with variants for the user to pick from.
      const packed = check(notes, stills.every((item) => (item.variants?.length ?? 0) >= 1), "stills without variants");
      return { pass: several && noVideo && grounded && distinct && offHook && short && packed && sane(outcome, notes), notes };
    },
  },
  {
    id: "code3d",
    prompt: "Make a 3D animation for 'the first three seconds' — it's the hero moment of this clip.",
    grade(outcome) {
      const notes: string[] = [];
      // Spec code-scenes: preview trước rồi mới đặt — model phải NHÌN cảnh trước khi trả tiền render.
      const previewed = outcome.tools.indexOf("preview_3d");
      const added = outcome.tools.indexOf("add_3d_scene");
      const order = check(notes, previewed >= 0 && added > previewed, `tools: ${outcome.tools.join(", ")}`);
      const gen = outcome.generations?.find((item) => item.model.id === "studio-3d");
      if (!check(notes, Boolean(gen), "no 3D animation prepared")) return { pass: false, notes };
      const scene = gen!.spec.scene as { template?: string; code_ref?: string } | undefined;
      const code = check(notes, scene?.template === "code" && /^[0-9a-f]{64}$/.test(scene.code_ref ?? ""), `scene: ${JSON.stringify(scene)}`);
      const quoted = check(notes, quoteFound(outcome.document, gen!.quote), `quote not in transcript: ${gen!.quote ?? "(none)"}`);
      const at = clipTime(outcome.document, "three");
      const start = Number((gen!.op as { start?: number }).start ?? -1);
      const timed = check(notes, at !== null && Math.abs(start - at) <= 1.5, `starts ${start}s, "three" at ${at}s`);
      const placed = check(
        notes,
        all(outcome.document).some((item) => ((item.entity.paints as { src?: { model?: string } }[] | undefined) ?? []).some((paint) => paint.src?.model === "studio-3d")),
        "the render is not on the clip",
      );
      return { pass: order && code && quoted && timed && placed && sane(outcome, notes), notes };
    },
  },
  {
    id: "voiceover",
    prompt: "Repurpose this clip: replace the speaker with a new AI narration in your own words, with captions for the new voice.",
    grade(outcome) {
      const notes: string[] = [];
      const gen = outcome.generations?.find((item) => item.model.kind === "voice" && (item.op as { op?: string }).op === "add_voiceover");
      if (!check(notes, Boolean(gen), "no voiceover prepared")) return { pass: false, notes };
      const op = gen!.op as { mode?: string; text?: string; captions?: boolean };
      const replace = check(notes, op.mode === "replace", `mode ${op.mode}`);
      // Kịch bản của chính agent: không chép nguyên một câu dài của người nói.
      const script = (op.text ?? "").toLowerCase();
      const copied = TRANSCRIPT.map((segment) => segment.text.toLowerCase().trim()).filter((line) => line.split(/\s+/).length >= 8 && script.includes(line));
      const own = check(notes, copied.length === 0, `script copies the speaker: ${copied[0] ?? ""}`);
      // Vừa clip: ~3 từ/giây (WORDS_PER_SECOND), cho rộng tới 3.5.
      const count = script.split(/\s+/).filter(Boolean).length;
      const fits = check(notes, count > 0 && count <= state(outcome.document).duration * 3.5, `${count} words for a ${state(outcome.document).duration}s clip`);
      const placed = all(outcome.document).find((item) => item.tag === "audio" && (item.entity.marks as { voiceover?: unknown } | undefined)?.voiceover);
      const onClip = check(notes, Boolean(placed), "the voiceover is not on the clip");
      const muted = check(notes, masters(outcome.document).every((item) => item.entity.muted === true), "the original speech still plays");
      const captions = check(
        notes,
        all(outcome.document).some((item) => item.tag === "captions" && (item.entity.marks as { voiceover?: unknown } | undefined)?.voiceover),
        "no captions for the new voice",
      );
      return { pass: replace && own && fits && onClip && muted && captions && sane(outcome, notes), notes };
    },
  },
  {
    id: "grade",
    prompt: "Give the whole clip a warm cinematic color grade.",
    grade(outcome) {
      const notes: string[] = [];
      const effectsOf = (entity: Entity) => (entity.effects as { type: string; value: number; params?: Record<string, number[]> }[] | undefined) ?? [];
      const shots = masters(outcome.document);
      if (!check(notes, shots.length > 0, "no master video")) return { pass: false, notes };
      let ok = true;
      for (const { entity } of shots) {
        const effects = effectsOf(entity);
        ok = check(notes, effects.length > 0, `${entity.id} has no grade`) && ok;
        // Ấm = kênh đỏ được đẩy hơn kênh xanh (gain của wheels hoặc temperature dương).
        const gain = effects.find((effect) => effect.type === "wheels")?.params?.gain;
        const warm = (gain ? gain[0]! > gain[2]! : false) || effects.some((effect) => effect.type === "temperature" && effect.value > 0);
        ok = check(notes, warm, `${entity.id} is not warmer`) && ok;
        const extreme = effects.some((effect) => ["saturation", "temperature", "highlights", "shadows"].includes(effect.type) && Math.abs(effect.value) > 0.6);
        ok = check(notes, !extreme, `${entity.id} grade is heavy-handed`) && ok;
      }
      return { pass: ok && sane(outcome, notes), notes };
    },
  },
  {
    id: "arrange",
    prompt: "Put the speaker side by side with some B-roll from the library.",
    grade(outcome) {
      const notes: string[] = [];
      const scene = outcome.document.stage.children[0] as unknown as { width: number; marks?: { layout?: { ranges?: { mode: string; rect?: number[] }[] } } };
      const cell = scene.marks?.layout?.ranges?.find((range) => range.mode === "cell");
      let ok = check(notes, !!cell, "the speaker is not in a layout cell");
      if (cell) ok = check(notes, (cell.rect?.[2] ?? 1) <= 0.5 + 1e-6, `speaker cell too wide: ${cell.rect}`) && ok;
      // B-roll lấp nửa còn lại của khung.
      const media = all(outcome.document).filter((item) => item.tag === "rect" && ((item.entity.paints as { type?: string }[] | undefined) ?? []).some((paint) => paint.type === "video" || paint.type === "image"));
      const half = media.some((item) => Math.abs(Number(item.entity.width) - scene.width / 2) < 2);
      ok = check(notes, half, "no B-roll fills half the frame") && ok;
      return { pass: ok && sane(outcome, notes), notes };
    },
  },
  {
    id: "verifygate",
    // The library has no logo: a placement leaves a missing-media error, and the Assistant must not
    // finish with it (the verify gate in loop.ts gives it one more step to fix or explain it).
    prompt: "Add our logo assets/logo.png in the top-left corner for the first 3 seconds (gate test).",
    grade(outcome) {
      const notes: string[] = [];
      const missing = outcome.report.issues.filter((issue) => issue.code === "missing-source");
      const ok = check(notes, !missing.length, `left a missing-media error: ${missing.map((issue) => issue.message).join("; ")}`);
      return { pass: ok && sane(outcome, notes), notes };
    },
  },
  {
    id: "grounded",
    prompt: "Make this clip more visual.",
    grade(outcome) {
      const notes: string[] = [];
      const list = visuals(outcome.document);
      if (!check(notes, list.length > 0, "no visuals")) return { pass: false, notes };
      let ok = true;
      for (const item of list) {
        const hit = quoteHit(outcome.document, item.quote);
        ok = check(notes, Boolean(hit), `${item.op} has no quote from the transcript (${item.quote ?? "none"})`) && ok;
        if (hit) ok = check(notes, Math.abs(item.start - hit.start) <= 0.6, `${item.op} starts ${item.start}s, its line at ${hit.start}s`) && ok;
        ok = check(notes, item.start >= 3, `${item.op} covers the hook (starts ${item.start}s)`) && ok;
      }
      return { pass: ok && sane(outcome, notes), notes };
    },
  },
  {
    id: "name-tag",
    prompt: "Add my name and role when I introduce myself: I'm Linh, founder of Paylane",
    transcript: INTRO_TRANSCRIPT,
    grade(outcome) {
      const notes: string[] = [];
      const titles = visuals(outcome.document).filter((item) => item.op === "add_title");
      if (!check(notes, titles.length === 1, `${titles.length} add_title visuals, want exactly one`)) return { pass: false, notes };
      const title = titles[0]!;
      const { window, removed } = state(outcome.document);
      const hit = title.quote ? findQuote(clipWords(INTRO_TRANSCRIPT, window, removed), title.quote) : null;
      const quoted = check(notes, Boolean(hit), `quote not in transcript: ${title.quote ?? "(none)"}`);
      // On screen when the introduction is spoken, not at a time the model made up.
      const timed = check(notes, hit !== null && Math.abs(title.start - hit.start) <= 0.6, `starts ${title.start}s, introduction at ${hit?.start ?? "?"}s`);
      const named = check(notes, /\blinh\b/i.test(String(title.input.title ?? "")), `title: ${String(title.input.title)}`);
      const role = check(notes, /founder|paylane/i.test(`${String(title.input.sub ?? "")} ${String(title.input.title ?? "")}`), `no role: ${String(title.input.sub)}`);
      const inside = check(notes, title.start >= 0 && title.end <= state(outcome.document).duration + 0.01, `shown ${title.start}-${title.end}s, outside the clip`);
      const unsafe = outcome.report.issues.filter((issue) => issue.code === "text-unsafe" || issue.code === "caption-overlap" || issue.code === "captions-covered");
      const safe = check(notes, !unsafe.length, `check: ${unsafe.map((issue) => issue.code).join(", ")}`);
      return { pass: quoted && timed && named && role && inside && safe && sane(outcome, notes), notes };
    },
  },
  {
    // Style skills (docs/style-skills-build.md A8): one Edit Plan, one apply_style, quotes not seconds.
    id: "style-listicle",
    prompt: "/style senior-dev-listicle",
    grade(outcome) {
      const notes: string[] = [];
      const calls = outcome.calls ?? [];
      const styled = calls.filter((call) => call.name === "apply_style");
      if (!check(notes, styled.length === 1, `${styled.length} apply_style calls, want exactly one`)) return { pass: false, notes };
      type Plan = {
        hook?: { lines: string[] };
        emphasis?: { quote: string }[];
        chapters?: { quote: string }[];
        list?: { quote: string; reveal?: { quote: string }[] };
        proofs?: { capture_id: string; quote: string }[];
      };
      const plan = ((styled[0]!.input as { plan?: Plan }).plan ?? {}) as Plan;
      const quotes = [
        ...(plan.emphasis ?? []).map((item) => item.quote),
        ...(plan.chapters ?? []).map((item) => item.quote),
        ...(plan.list ? [plan.list.quote, ...(plan.list.reveal ?? []).map((item) => item.quote)] : []),
        ...(plan.proofs ?? []).map((item) => item.quote),
      ];
      const missing = quotes.filter((quote) => !quoteFound(outcome.document, quote));
      const quoted = check(notes, !missing.length, `quotes not in the transcript: ${missing.join(" | ")}`);
      // Emphasis is rare: at most one emphasized phrase per 2 s of speech.
      const starts = (plan.emphasis ?? []).map((item) => quoteHit(outcome.document, item.quote)?.start).filter((start): start is number => start !== undefined).sort((a, b) => a - b);
      const crowded = starts.slice(1).filter((start, index) => start - starts[index]! < 2);
      const sparse = check(notes, !crowded.length, `${crowded.length} emphasized words within 2 s of the previous one`);
      const long = (plan.hook?.lines ?? []).filter((line) => line.trim().split(/\s+/).length > 8);
      const hook = check(notes, Boolean(plan.hook) && !long.length, plan.hook ? `hook lines over 8 words: ${long.join(" | ")}` : "no hook");
      // A proof needs a capture the Assistant saw ready; this clip cites no page.
      const unproven = (plan.proofs ?? []).filter((proof) => !calls.some((call) => call.name === "capture_status" && (call.input as { capture_id?: string }).capture_id === proof.capture_id));
      const proofs = check(notes, !unproven.length, `${unproven.length} proofs without a checked capture`);
      // The receipt reaches the user: what was skipped, and what is not available while a capability isn't ready.
      const unready = CAPABILITY_IDS.some((id) => !isReady(id));
      const reply = outcome.reply ?? "";
      const reported = check(
        notes,
        /skipped/i.test(reply) && (!unready || /not available|unavailable/i.test(reply)),
        `the reply does not report the receipt (skipped${unready ? ", unavailable" : ""})`,
      );
      return { pass: quoted && sparse && hook && proofs && reported && sane(outcome, notes), notes };
    },
  },
];

/** Visual (group có mark `visual`) với op, mốc và câu trích. */
function visuals(document: ClipDocument): Array<{ op: string; start: number; end: number; quote?: string; input: Record<string, unknown> }> {
  return all(document)
    .filter((item) => item.tag === "group" && (item.entity.marks as { visual?: unknown } | undefined)?.visual)
    .map((item) => {
      const visual = (item.entity.marks as { visual: { op: string; input?: Record<string, unknown> & { quote?: string } } }).visual;
      return { op: visual.op, start: Number(item.entity.start ?? 0), end: Number(item.entity.end ?? 0), quote: visual.input?.quote, input: visual.input ?? {} };
    });
}

function quoteHit(document: ClipDocument, quote: string | undefined) {
  if (!quote) return null;
  const { window, removed } = state(document);
  return findQuote(clipWords(TRANSCRIPT, window, removed), quote);
}

const quoteFound = (document: ClipDocument, quote: string | undefined): boolean => Boolean(quoteHit(document, quote));
