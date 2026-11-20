import "server-only";

/**
 * Signed URLs for Studio cards. A snapshot holds storage paths (a URL would change the hash on every read); the card
 * the founder looks at needs pictures, so the loader signs them here, under the founder's own session (RLS).
 * A path that will not sign leaves its picture empty; the card still shows and still decides.
 */

import type { SupabaseClient } from "@/lib/api/handler";

import type { ApprovalCard } from "./approval-card";
import type { ApprovalRow } from "./cards";

const SECONDS = 3600;

export async function sign(supabase: SupabaseClient, bucket: "media" | "exports", paths: string[], download = false): Promise<Map<string, string>> {
  const unique = [...new Set(paths.filter((p) => p && !p.includes("..")))];
  if (!unique.length) return new Map();
  // `download`: Storage answers with `Content-Disposition: attachment`, so the browser saves the file instead of playing it.
  const { data } = await supabase.storage.from(bucket).createSignedUrls(unique, SECONDS, download ? { download: true } : undefined);
  return new Map((data ?? []).flatMap((d, i) => (d?.signedUrl ? [[unique[i]!, d.signedUrl] as const] : [])));
}

const paths = (v: unknown, key: string): string[] =>
  Array.isArray(v) ? v.map((x) => (x as Record<string, unknown>)?.[key]).filter((p): p is string => typeof p === "string") : [];

/** The latest done render of each short's own edit, as `short clip id → exports path`. */
/** The latest finished export of each clip: its object and, when the edit set one, its cover time in that file. */
export async function latestRenders(supabase: SupabaseClient, clipIds: string[]): Promise<Map<string, { path: string; cover: number | null }>> {
  if (!clipIds.length) return new Map();
  const { data } = await supabase
    .from("tasks")
    .select("clip_id, output_path, output, finished_at")
    .in("clip_id", clipIds)
    .eq("kind", "render_document")
    .eq("status", "done")
    .order("finished_at", { ascending: false });
  const out = new Map<string, { path: string; cover: number | null }>();
  for (const t of (data ?? []) as { clip_id: string; output_path: string | null; output: { cover?: unknown } | null }[]) {
    if (!t.output_path || out.has(t.clip_id)) continue;
    const cover = typeof t.output?.cover === "number" && Number.isFinite(t.output.cover) && t.output.cover >= 0 ? t.output.cover : null;
    out.set(t.clip_id, { path: t.output_path, cover });
  }
  return out;
}

export async function shortRenders(supabase: SupabaseClient, clipIds: string[]): Promise<Map<string, string>> {
  return new Map([...(await latestRenders(supabase, clipIds))].map(([clip, render]) => [clip, render.path]));
}

export async function signStudioCards(supabase: SupabaseClient, cards: ApprovalCard[], rows: ApprovalRow[]): Promise<ApprovalCard[]> {
  const snapshot = new Map(rows.map((r) => [r.id, r.snapshot]));
  const studio = cards.filter((c) => c.kind === "price" || c.kind === "finished_video" || c.kind === "shorts_batch");
  if (!studio.length) return cards;

  const shortClips = studio.flatMap((c) => (c.body.kind === "shorts_batch" ? c.body.shorts.flatMap((s) => (s.shortClipId ? [s.shortClipId] : [])) : []));
  const renders = await shortRenders(supabase, shortClips);
  const [media, exports] = await Promise.all([
    sign(supabase, "media", studio.flatMap((c) => (c.kind === "price" ? paths(snapshot.get(c.id)?.keyframes, "path") : []))),
    sign(supabase, "exports", [
      ...studio.flatMap((c) => {
        const p = c.kind === "finished_video" ? snapshot.get(c.id)?.render_path : null;
        return typeof p === "string" ? [p] : [];
      }),
      ...renders.values(),
    ]),
  ]);

  return cards.map((card) => {
    const s = snapshot.get(card.id);
    switch (card.body.kind) {
      case "price": {
        const byIndex = new Map(
          (Array.isArray(s?.keyframes) ? (s.keyframes as { index?: unknown; path?: unknown }[]) : []).map((k) => [k.index, typeof k.path === "string" ? media.get(k.path) ?? null : null]),
        );
        return { ...card, body: { ...card.body, keyframes: card.body.keyframes.map((k) => ({ ...k, thumbUrl: byIndex.get(k.index) ?? null })) } };
      }
      case "finished_video": {
        const path = typeof s?.render_path === "string" ? s.render_path : null;
        return { ...card, body: { ...card.body, previewUrl: path ? exports.get(path) ?? null : null } };
      }
      case "shorts_batch":
        return {
          ...card,
          body: {
            ...card.body,
            shorts: card.body.shorts.map((x) => {
              const path = x.shortClipId ? renders.get(x.shortClipId) : undefined;
              return { ...x, previewUrl: path ? exports.get(path) ?? null : null };
            }),
          },
        };
      default:
        return card;
    }
  });
}
