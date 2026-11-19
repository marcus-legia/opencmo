/**
 * Posts from the Library (wave 3 B3; owner, 2026-11-19): the week plan picks its topics from the themes people raised
 * in Sales conversations, and each post carries the conversations it was written from as `PostSource[]`, cited by
 * their one-line summary, never the thread's title. Shared by `plan_week` and `post_draft`. Pure.
 *
 * Summaries and quotes came from public posts through a model: they are data in the prompts, escaped like threads.
 */

import { z } from "zod";

import { LIBRARY_LIMITS, type LibraryTopTheme } from "../library";
import { SALES_PLATFORMS, PLATFORM_LABEL } from "../social/conversations";
import { cleanUntrusted, escapeAttribute, escapeForTag } from "../untrusted";
import type { PostSource } from "./types";

/** A post cites at most this many conversations. */
export const SOURCES_MAX = 3;

/** The line the week plan and a post draft say when the Library is empty: nothing is written on its own. */
export const NO_LIBRARY = "No posts planned: your Library has no conversations from Sales yet. Run a scan, or ask in the chat for a post on a topic you choose.";

/** One Library conversation as the prompts name it (`c1`, `c2`…), with its theme. */
export type SourceRef = { ref: string; theme: string; entry: LibraryTopTheme["entries"][number] };

/** Every recent conversation of the top themes, numbered in theme order so a retry sees the same ids. */
export function libraryRefs(themes: LibraryTopTheme[]): SourceRef[] {
  let n = 0;
  return themes.flatMap((t) => t.entries.map((entry) => ({ ref: `c${++n}`, theme: t.name, entry })));
}

const data = (s: string, max: number) => escapeForTag(cleanUntrusted(s).replace(/\s+/g, " ").trim()).slice(0, max);

/** The Library for a prompt: themes, most raised first, each with its conversations' summaries and short quotes. */
export function libraryBlock(themes: LibraryTopTheme[], refs = libraryRefs(themes)): string {
  if (!refs.length) return "<library>\n(empty: Sales has not saved any conversations yet)\n</library>";
  const body = themes
    .filter((t) => t.entries.length)
    .map((t) => {
      const lines = refs
        .filter((r) => r.theme === t.name)
        .map((r) => {
          const quotes = r.entry.quotes.slice(0, 2).map((q) => ` "${data(q.text, LIBRARY_LIMITS.quoteChars)}"`).join("");
          return `- [${r.ref}] ${PLATFORM_LABEL[r.entry.platform]}, ${data(r.entry.community, 120)}: ${data(r.entry.summary, LIBRARY_LIMITS.summaryChars)}${quotes}`;
        });
      return `<theme name="${escapeAttribute(cleanUntrusted(t.name))}" conversations="${t.count}">\n${lines.join("\n")}\n</theme>`;
    });
  return `<library>\n${body.join("\n")}\n</library>`;
}

/** A Library conversation as a post's source. */
export const toSource = (r: SourceRef): PostSource => ({
  opportunityId: r.entry.opportunityId,
  summary: r.entry.summary.slice(0, LIBRARY_LIMITS.summaryChars),
  platform: r.entry.platform,
  community: r.entry.community.slice(0, 120),
});

/** The sources a model named by id: known ids only, once each, at most `SOURCES_MAX`. */
export function sourcesFor(ids: readonly string[] | undefined, refs: SourceRef[]): PostSource[] {
  const byRef = new Map(refs.map((r) => [r.ref, r]));
  const out: PostSource[] = [];
  for (const id of ids ?? []) {
    const r = byRef.get(id.trim().replace(/^\[|\]$/g, "").toLowerCase());
    if (r && !out.some((s) => s.opportunityId === r.entry.opportunityId)) out.push(toSource(r));
    if (out.length >= SOURCES_MAX) break;
  }
  return out;
}

/** A theme's newest conversations as sources, for a slot the model left without any. */
export function themeSources(theme: string, refs: SourceRef[]): PostSource[] {
  return refs.filter((r) => r.theme === theme).slice(0, 2).map(toSource);
}

const PostSourceSchema = z.object({
  opportunityId: z.string().min(1).max(500),
  summary: z.string().trim().min(1).max(LIBRARY_LIMITS.summaryChars),
  platform: z.enum(SALES_PLATFORMS),
  community: z.string().max(120),
});

/** The sources stored on a content item (`body.sources`); anything else there reads as none. */
export function storedSources(body: Record<string, unknown> | null | undefined): PostSource[] {
  const raw = Array.isArray(body?.sources) ? body.sources : [];
  return raw.flatMap((s) => {
    const parsed = PostSourceSchema.safeParse(s);
    return parsed.success ? [parsed.data] : [];
  }).slice(0, SOURCES_MAX);
}

/** The conversations a post is written from, for the writer: summaries and the quotes the Library keeps. */
export function sourcesBlock(sources: PostSource[], themes: LibraryTopTheme[]): string {
  const quotes = new Map(themes.flatMap((t) => t.entries.map((e) => [e.opportunityId, e.quotes] as const)));
  const lines = sources.map((s, i) => {
    const said = (quotes.get(s.opportunityId) ?? []).slice(0, 2).map((q) => ` "${data(q.text, LIBRARY_LIMITS.quoteChars)}"`).join("");
    return `- [${i + 1}] ${PLATFORM_LABEL[s.platform]}, ${data(s.community, 120)}: ${data(s.summary, LIBRARY_LIMITS.summaryChars)}${said}`;
  });
  return `<sources>\n${lines.join("\n")}\n</sources>`;
}
