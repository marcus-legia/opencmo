/**
 * Whether an Assistant turn's Undo may restore its checkpoint without throwing away edits made
 * after the turn. Pure, so the rule is testable without a database (`undo-guard.check.ts`).
 */

import { canonicalJson } from "@opencmo/clip-doc";

export const EDITED_AFTER_MESSAGE =
  "You edited this clip after the Assistant's change. Use Undo in the editor (Ctrl+Z) to step back through both.";

/**
 * First and last clip version a turn's writes produced; absent for turns recorded before versions were.
 * `lastHash`: the document fingerprint saved with `last`, when the write recorded one.
 */
export type Written = { first: number; last: number; lastHash?: string };

type Saved = { version?: unknown; document_hash?: unknown };

export type ToolCallRow = { name: string; result: (Saved & { clips?: ({ clip_id: string } & Saved)[]; [key: string]: unknown }) | null };

/** Versions per clip a turn wrote: every finished call's `version` (clip chat), or each clip in `apply_to_clips` (project chat). */
export function writtenVersions(rows: ToolCallRow[], clipId: string | null): Map<string, Written> {
  const map = new Map<string, Written>();
  const widen = (id: string, saved: Saved | null | undefined) => {
    const version = saved?.version;
    if (typeof version !== "number") return;
    const hash = typeof saved?.document_hash === "string" ? saved.document_hash : undefined;
    const seen = map.get(id);
    if (!seen) return void map.set(id, { first: version, last: version, ...(hash ? { lastHash: hash } : {}) });
    const newest = version > seen.last;
    const lastHash = newest ? hash : seen.lastHash;
    map.set(id, { first: Math.min(seen.first, version), last: Math.max(seen.last, version), ...(lastHash ? { lastHash } : {}) });
  };
  for (const row of rows) {
    if (clipId) widen(clipId, row.result);
    else if (row.name === "apply_to_clips") for (const clip of row.result?.clips ?? []) widen(clip.clip_id, clip);
  }
  return map;
}

/**
 * Every save bumps the version by exactly one, so with no newer request the clip must still be at
 * the turn's last version, or hold the very document the turn saved: the tab also saves when only the
 * library changes (an upload finishing, a generation landing), which moves the version but not the
 * document fingerprint, and is not an edit. A newer request that was undone already put the clip back to its own
 * checkpoint: then that request's first write must directly follow this turn's last one (nothing in
 * between), and the clip must still hold that checkpoint (nothing since that undo). Turns recorded
 * before versions were stored cannot be checked and restore as before.
 */
export async function unchangedSince(
  current: { version: number; document: unknown; document_hash?: string | null },
  written: Written | undefined,
  newer: { written: Written | undefined; checkpoint: (() => Promise<unknown>) | undefined } | null,
): Promise<boolean> {
  if (!written) return true;
  if (!newer) return current.version === written.last || (written.lastHash !== undefined && current.document_hash === written.lastHash);
  if (!newer.written || !newer.checkpoint) return true;
  if (newer.written.first !== written.last + 1) return false;
  return canonicalJson(current.document) === canonicalJson(await newer.checkpoint());
}
