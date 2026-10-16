/** Reading page captures (Track C's `page_captures`) under the user's RLS, for tools and ops. */

import { z } from "zod";

import type { CaptureState } from "@opencmo/editor-core";

import type { SupabaseClient } from "@/lib/api/handler";

/** A capture of this user by id, as `apply_style` and `capture_status` read it; null when there is none. */
export async function readCaptureState(supabase: SupabaseClient, id: string): Promise<CaptureState | null> {
  if (!z.string().uuid().safeParse(id).success) return null;
  const { data, error } = await supabase.from("page_captures").select("status, error").eq("id", id).maybeSingle();
  if (error || !data) return null;
  const row = data as { status: CaptureState["status"]; error: string | null };
  return { status: row.status, ...(row.error ? { error: row.error } : {}) };
}

