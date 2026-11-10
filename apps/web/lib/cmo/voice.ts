/**
 * The founder's voice as the CMO learns it (cmo-review-3 group 2): the rating sheet (2.2) and the Voice page (2.3).
 * Every read runs under the founder's own session (RLS); every write goes through an owner-checking RPC.
 *
 * `rateDraftsPending` is the hand-off to Today (session B): the "Rate your first drafts" row shows while it is true.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

/** Up to five versions on one sheet: the first post's versions, then the next waiting posts' first versions. */
export const SHEET_MAX = 5;

export type RatingDraft = { itemId: string; version: number; words: string; platform: string; idea: string };
export type RatingRule = { id: string; rule: string };
export type RatingSheet = {
  /** Versions to rate now; empty when nothing waits or the founder rated today. */
  drafts: RatingDraft[];
  /** The latest round: its job's state and the rules it proposed, still to accept. Null before the first round. */
  latest: { round: string; at: string; state: "learning" | "ready" | "failed" | "done"; rules: RatingRule[] } | null;
  /** The founder rated in the last 24 hours (one round a day). */
  ratedToday: boolean;
};

type ItemRow = { id: string; platform: string | null; idea: string; body: { text?: unknown; alternates?: unknown; thread?: unknown } | null; created_at: string };

const versionsOf = (body: ItemRow["body"]): string[] => {
  const text = typeof body?.text === "string" ? body.text : "";
  const alternates = Array.isArray(body?.alternates) ? body.alternates.filter((a): a is string => typeof a === "string") : [];
  return [text, ...alternates].slice(0, 3);
};

/** Waiting post drafts, oldest card first, as `ratingSheet` and Today read them. */
async function waitingPosts(supabase: SupabaseClient): Promise<ItemRow[]> {
  const { data: cards, error } = await supabase
    .from("approvals")
    .select("ref_id, created_at")
    .eq("kind", "post")
    .eq("ref_kind", "content_item")
    .eq("status", "waiting")
    .order("created_at", { ascending: true })
    .limit(10);
  if (error) throw new Error(`waiting post cards: ${error.message}`);
  const ids = ((cards ?? []) as { ref_id: string }[]).map((c) => c.ref_id);
  if (!ids.length) return [];
  const { data: items, error: itemsError } = await supabase
    .from("content_items")
    .select("id, platform, idea, body, created_at")
    .in("id", ids)
    .eq("status", "in_review");
  if (itemsError) throw new Error(`waiting posts: ${itemsError.message}`);
  const byId = new Map(((items ?? []) as ItemRow[]).map((i) => [i.id, i]));
  return ids.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
}

/**
 * The drafts to put on the sheet: every version of the first waiting post, then the first version of the next ones,
 * up to five. A thread is rated by its first post (the card approves the thread as written).
 */
export function sheetDrafts(posts: readonly ItemRow[]): RatingDraft[] {
  const out: RatingDraft[] = [];
  posts.forEach((post, index) => {
    const versions = versionsOf(post.body);
    const take = index === 0 ? versions : versions.slice(0, 1);
    take.forEach((words, version) => {
      if (words.trim() && out.length < SHEET_MAX) out.push({ itemId: post.id, version, words, platform: post.platform ?? "X", idea: post.idea });
    });
  });
  return out;
}

/** True while Today should offer "Rate your first drafts": a post card waits and the founder never rated a round. */
export async function rateDraftsPending(supabase: SupabaseClient): Promise<boolean> {
  const { count, error } = await supabase.from("cmo_draft_ratings").select("id", { count: "exact", head: true });
  if (error) throw new Error(`draft ratings: ${error.message}`);
  if ((count ?? 0) > 0) return false;
  const { count: cards, error: cardsError } = await supabase
    .from("approvals")
    .select("id", { count: "exact", head: true })
    .eq("kind", "post")
    .eq("status", "waiting");
  if (cardsError) throw new Error(`waiting post cards: ${cardsError.message}`);
  return (cards ?? 0) > 0;
}

export async function ratingSheet(supabase: SupabaseClient, now = new Date()): Promise<RatingSheet> {
  const { data: last, error } = await supabase
    .from("cmo_draft_ratings")
    .select("round, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ round: string; created_at: string }>();
  if (error) throw new Error(`draft ratings: ${error.message}`);
  const ratedToday = !!last && now.getTime() - new Date(last.created_at).getTime() < 86_400_000;
  let latest: RatingSheet["latest"] = null;
  if (last) {
    const [{ data: runs }, { data: rules }] = await Promise.all([
      supabase.from("cmo_runs").select("status").eq("kind", "distill_ratings").eq("input->>round", last.round).order("created_at", { ascending: false }).limit(1),
      supabase.from("cmo_corrections").select("id, rule, status").eq("source", "ratings").eq("round_id", last.round).order("created_at", { ascending: true }),
    ]);
    const status = ((runs ?? []) as { status: string }[])[0]?.status ?? "queued";
    const list = (rules ?? []) as { id: string; rule: string; status: string }[];
    const proposed = list.filter((r) => r.status === "proposed").map((r) => ({ id: r.id, rule: r.rule }));
    const decided = list.length > 0 && proposed.length === 0;
    latest = {
      round: last.round,
      at: last.created_at,
      state: status === "failed" ? "failed" : status !== "done" ? "learning" : decided || list.length === 0 ? "done" : "ready",
      rules: proposed,
    };
  }
  return { drafts: ratedToday ? [] : sheetDrafts(await waitingPosts(supabase)), latest, ratedToday };
}
