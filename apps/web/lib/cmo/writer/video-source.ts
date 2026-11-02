import "server-only";

/**
 * What a caption is written from: an edit's own spoken words, read as the founder (the brain's short-lived JWT, under
 * RLS) the way the Shorts squad reads them, never as the service role. Words only, never frames.
 */

import { normalizeManifest } from "@opencmo/clip-assets";
import { spokenWords } from "@opencmo/editor-core";

import { clipContext } from "@/lib/api/clips";
import { ApiError } from "@/lib/api/errors";
import { readEditorProject, serverMedia, serverOpContext } from "@/lib/editor/apply";
import { brainClientFor } from "@/lib/mcp/auth";

import type { VideoSource } from "./types";

/** About two minutes of speech; enough for a caption, and the prompt stays small. */
export const TRANSCRIPT_MAX = 6000;

/** The first sentence said, as the caption's hook to build on (at most 160 characters). */
export function firstLine(transcript: string): string {
  const sentence = /^.*?[.!?](?=\s|$)/.exec(transcript)?.[0] ?? transcript;
  return sentence.slice(0, 160).trim();
}

export async function readVideoSource(userId: string, clipId: string): Promise<VideoSource | null> {
  const supabase = brainClientFor(userId);
  const { data: clip, error } = await supabase
    .from("clips")
    .select("hook, kind, start_seconds, end_seconds")
    .eq("id", clipId)
    .maybeSingle<{ hook: string | null; kind: string; start_seconds: number | string; end_seconds: number | string }>();
  if (error) throw new Error(`clips read: ${error.message}`);
  if (!clip) return null;
  let context: Awaited<ReturnType<typeof clipContext>>;
  let project: Awaited<ReturnType<typeof readEditorProject>>;
  try {
    context = await clipContext(supabase, clipId);
    project = await readEditorProject(supabase, clipId);
  } catch (error) {
    // An edit with no document (never opened, or gone) has no words to caption: the run skips it.
    if (error instanceof ApiError && error.status === 404) return null;
    throw error;
  }
  const media = await serverMedia(supabase, context, clipId, project.document, normalizeManifest(project.manifest));
  const words = await spokenWords(project.document, serverOpContext(supabase, context, clipId, media));
  const said = words.map((word) => word.text.trim()).filter(Boolean).join(" ").replace(/\s+([,.!?;:])/g, "$1");
  const transcript = said.length > TRANSCRIPT_MAX ? `${said.slice(0, TRANSCRIPT_MAX - 1)}…` : said;
  const spoken = words.length ? words[words.length - 1]!.end : 0;
  const seconds = Math.max(spoken, Number(clip.end_seconds) - Number(clip.start_seconds), 1);
  const hook = firstLine(transcript);
  return {
    clipId,
    kind: clip.kind === "short" ? "short" : "video",
    title: clip.hook?.trim() || hook || "Your video",
    ...(hook ? { hook } : {}),
    transcript,
    seconds,
  };
}
