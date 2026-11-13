/**
 * Every prompt that writes words a person reads or hears carries the no-ai-slop guide (owner, 2026-11-05).
 * Exported prompts are checked by value; prompts private to a job are checked in their source file.
 * Run: NODE_OPTIONS=--conditions=react-server npx tsx lib/cmo/skills/no-ai-slop.check.ts
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { DIRECTOR } from "@/lib/agent/create-video";
import { WRITER } from "@/lib/agent/motion-guide";
import { SYSTEM_PROMPT } from "@/lib/agent/prompt";
import { PHOTO_CAPTION_SYSTEM } from "@/lib/cmo/jobs/photo-caption";
import { REPURPOSE_SYSTEM } from "@/lib/cmo/jobs/repurpose-post";
import { CAPTION_SYSTEM, SLIDES_SYSTEM, VIDEO_BRIEF_SYSTEM, YOUTUBE_SYSTEM } from "@/lib/cmo/writer/prompts";
import { CLIP_EDITOR } from "@/lib/departments/studio/shorts/squad";

import { NO_AI_SLOP, skillText } from "./index";

const guide = skillText("no-ai-slop");
assert.ok(NO_AI_SLOP.includes(guide), "NO_AI_SLOP carries the whole skill");

const prompts: Record<string, string> = {
  "Editor Assistant": SYSTEM_PROMPT,
  "Video director (/video, Studio)": DIRECTOR,
  "Intro writer (plan_video)": WRITER,
  "Shorts clip editor": CLIP_EDITOR,
  "Caption writer": CAPTION_SYSTEM,
  "YouTube writer": YOUTUBE_SYSTEM,
  "Video brief writer": VIDEO_BRIEF_SYSTEM,
  "Slides writer": SLIDES_SYSTEM,
  "Repurpose writer": REPURPOSE_SYSTEM,
  "Photo caption writer": PHOTO_CAPTION_SYSTEM,
};
for (const [name, prompt] of Object.entries(prompts)) assert.ok(prompt.includes(guide), `${name} carries no-ai-slop`);

const root = join(__dirname, "..", "..", "..");
const sources = [
  "lib/agent/scope.ts", // CMO chat
  "lib/cmo/generate.ts", // onboarding documents
  "lib/cmo/jobs/plan-week.ts",
  "lib/cmo/jobs/review-week.ts",
  "lib/cmo/jobs/competitor-research.ts",
  "lib/cmo/jobs/niche-video-research.ts",
  "lib/cmo/jobs/draft-post.ts",
  "lib/cmo/jobs/draft-thread.ts",
  "lib/cmo/jobs/sales-scan.ts",
  "lib/cmo/jobs/judge.ts",
  "lib/cmo/jobs/distill-ratings.ts", // rules from the founder's ratings (cmo-review-3 2.2)
];
for (const file of sources) {
  const text = readFileSync(join(root, file), "utf8");
  assert.match(text, /\$\{NO_AI_SLOP\}|skillText\("no-ai-slop"\)/, `${file} puts no-ai-slop in its system prompt`);
}

console.log("no-ai-slop: every writing prompt carries the guide");
