/**
 * Brief có cấu trúc → prompt cho model sinh ảnh/video (spec visual-grounding).
 *
 * Trước đây agent đưa thẳng một prompt tự do cho Veo, và ảnh/video ra lạc đề:
 * không có gì buộc prompt bám câu người nói. Giờ agent điền brief (câu trích,
 * ý, chủ thể, hành động, bối cảnh, phong cách…), server kiểm câu trích có thật
 * trong transcript rồi ghép prompt theo một khuôn. Thuần — không gọi mạng —
 * nên test được bằng snapshot.
 *
 * Câu trích KHÔNG vào prompt: model ảnh/video thấy chữ là vẽ chữ ra hình.
 */

import { z } from "zod";

import { SHOT_STYLES } from "@opencmo/editor-core";

export const STYLES = SHOT_STYLES;
export const CAMERAS = ["static", "slow push-in", "slow pull-out", "pan left", "pan right", "orbit", "handheld", "top-down"] as const;

export const briefShape = {
  quote: z.string().trim().min(2).max(300).describe("The exact words from <clip_context> this media illustrates."),
  idea: z.string().trim().min(3).max(300).describe("What the viewer should understand from the picture, in one sentence."),
  subject: z.string().trim().min(2).max(200).describe("The main thing in the frame: a concrete person, object or place."),
  action: z.string().trim().max(200).optional().describe("What the subject does (video: the motion)."),
  setting: z.string().trim().max(200).optional().describe("Where it happens, time of day, surroundings."),
  style: z.enum(STYLES).optional().describe("Keep the same style for every shot in a clip."),
  camera: z.enum(CAMERAS).optional().describe("Video only: the camera move."),
  mood: z.string().trim().max(100).optional().describe("Lighting and feeling, e.g. warm morning light, tense, calm."),
  avoid: z.array(z.string().trim().min(1).max(80)).max(8).optional().describe("Things that must not appear."),
};

export type Brief = {
  /** Absent on a project without a script: the media is placed by time instead. */
  quote?: string;
  idea: string;
  subject: string;
  action?: string;
  setting?: string;
  style?: (typeof STYLES)[number];
  camera?: (typeof CAMERAS)[number];
  mood?: string;
  avoid?: string[];
};

const STYLE_TEXT: Record<(typeof STYLES)[number], string> = {
  photo: "Photorealistic photograph, natural colors, sharp focus, shallow depth of field.",
  cinematic: "Cinematic film still, dramatic but natural lighting, rich color grading, 35mm lens.",
  "3d-render": "Clean 3D render, soft studio lighting, smooth materials, subtle shadows, minimal background.",
  illustration: "Editorial illustration, bold simple shapes, limited color palette, clean lines.",
  flat: "Flat vector illustration, solid colors, simple geometric shapes, minimal detail.",
};

/**
 * Video wants footage words, not stills words: "photorealistic photograph" makes video models hold
 * a frozen frame, "live-action" makes them move.
 */
const VIDEO_STYLE_TEXT: Record<(typeof STYLES)[number], string> = {
  ...STYLE_TEXT,
  photo: "Live-action footage, natural colors, sharp focus, shallow depth of field.",
  cinematic: "Cinematic live-action footage, dramatic but natural lighting, rich color grading, 35mm lens.",
};

/**
 * How shots move, in every video prompt. Three layers of motion (camera, subject, surroundings)
 * because one layer alone reads as a still with a slow zoom; starting mid-action and never easing
 * out because models otherwise slow to a frozen last second; empty areas and readable text are
 * pinned because models fill blank space with objects and melt letters as they move.
 */
const MOTION_RULES =
  "Three layers of motion at once: the camera moves, the subject acts, and the surroundings move (light, people in the distance, steam, leaves). Start in the middle of the action and keep moving to the last frame; never slow to a stop or freeze. Empty areas of the frame stay empty. Anything readable already in the frame stays still and sharp.";

const NO_TEXT = "No text, letters, numbers, captions, logos, watermarks or UI in the frame";

/**
 * Brief xin một thứ model sinh làm hỏng (sơ đồ, biểu đồ, chữ, con số): trả
 * câu gợi ý tool vẽ sẵn của editor; null khi brief ổn.
 */
const MISUSE = /\b(diagrams?|charts?|graphs?|infographics?|flow ?charts?|formulas?|equations?|statistics?|percent(age)?s?|numbers?|labels?|captions?|titles?|text|words?|letters?|timeline|steps? \d|explainer|3d (explanation|visual|diagram))\b/i;

export function briefMisuse(brief: Pick<Brief, "idea" | "subject" | "action">): string | null {
  const text = [brief.subject, brief.action ?? ""].join(" ");
  if (!MISUSE.test(text)) return null;
  return "AI images and video get diagrams, charts, numbers and text wrong. Draw it instead with add_diagram, add_chart, add_graph, add_icon or add_text (pass the same quote); use generate_media only for a concrete real-world scene.";
}

const sentence = (text: string): string => {
  const trimmed = text.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  const capital = trimmed[0]!.toUpperCase() + trimmed.slice(1);
  return /[.!?]$/.test(capital) ? capital : `${capital}.`;
};

const VERTICAL = "Vertical 9:16 composition: main subject in the upper two thirds, calm lower third (captions go there).";

/** Prompt cuối theo khuôn của từng loại, trong trần ký tự của model. */
export function composePrompt(brief: Brief, kind: "image" | "video", options: { maxChars: number; aspectRatio?: string; duration?: number }): string {
  const style = brief.style ?? (kind === "video" ? "cinematic" : "photo");
  const vertical = (options.aspectRatio ?? "9:16") === "9:16";
  const parts = [
    sentence(`${brief.subject}${brief.action ? `, ${brief.action}` : ""}${brief.setting ? `, ${brief.setting}` : ""}`),
    sentence(`The shot conveys: ${brief.idea}`),
    brief.mood ? sentence(`Mood: ${brief.mood}`) : "",
    kind === "video" ? VIDEO_STYLE_TEXT[style] : STYLE_TEXT[style],
    kind === "video"
      ? sentence(`Camera: ${brief.camera ?? "slow push-in"}; one continuous shot${options.duration ? ` of about ${options.duration} seconds` : ""}, smooth natural motion`)
      : "",
    kind === "video" ? MOTION_RULES : "",
    vertical ? VERTICAL : "",
    `${NO_TEXT}${brief.avoid?.length ? `; also avoid: ${brief.avoid.join(", ")}` : ""}.`,
  ].filter(Boolean);
  return capped(parts, options.maxChars);
}

/** Within the model's character cap, dropping the middle (style detail) before the subject or the text rule. */
function capped(parts: string[], maxChars: number): string {
  const kept = parts.filter(Boolean);
  const prompt = kept.join(" ");
  if (prompt.length <= maxChars) return prompt;
  const essential = [kept[0], kept.at(-1)].join(" ");
  return essential.length <= maxChars ? essential : essential.slice(0, maxChars);
}

/**
 * A long take's keyframe: the still a shot starts (and the shot before it ends) on. It never asks
 * for text: image models garble letters, and words on screen are editor text layers instead.
 */
export function composeKeyframePrompt(keyframe: string, style: (typeof STYLES)[number], options: { maxChars: number; aspectRatio?: string }): string {
  return capped(
    [
      sentence(keyframe),
      "A single frame from a continuous film shot, caught mid-action.",
      STYLE_TEXT[style],
      (options.aspectRatio ?? "9:16") === "9:16" ? VERTICAL : "",
      `${NO_TEXT}; no signs, screens or packaging with words.`,
    ],
    options.maxChars,
  );
}

/**
 * A long take's shot between keyframes: the frames already fix the subject, place and light, so
 * the prompt is about motion. `joins`: the shot must end on the next keyframe.
 */
export function composeShotPrompt(
  shot: { motion: string; keyframe: string },
  style: (typeof STYLES)[number],
  options: { maxChars: number; aspectRatio?: string; duration?: number; joins: boolean },
): string {
  return capped(
    [
      sentence(shot.motion),
      sentence(`It starts on: ${shot.keyframe}`),
      options.joins
        ? `One continuous shot${options.duration ? ` of about ${options.duration} seconds` : ""} that moves from the first frame and arrives exactly on the last frame.`
        : `One continuous shot${options.duration ? ` of about ${options.duration} seconds` : ""}.`,
      MOTION_RULES,
      VIDEO_STYLE_TEXT[style],
      `${NO_TEXT}; no new text appears.`,
    ],
    options.maxChars,
  );
}
