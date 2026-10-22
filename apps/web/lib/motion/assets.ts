/**
 * Images an explainer scene shows (`kit.Image`): the user's own library objects. Previews get short-lived
 * signed URLs, which `clip-motion` fetches in Node from the one allowed origin and inlines before Chromium
 * opens; final renders get them inlined by the worker instead, so nothing here outlives a preview.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { MotionAsset } from "@opencmo/clip-motion/job";

/** Long enough for a slow preview queue, short enough that a leaked job file is soon useless. */
export const PREVIEW_ASSET_SECONDS = 600;

/** Signed URLs for `{name, ref}` (`ref` = an object of the `media` bucket, under RLS), or a sentence for the model. */
export async function previewAssets(supabase: SupabaseClient, refs: { name: string; ref: string }[]): Promise<MotionAsset[] | string> {
  const assets: MotionAsset[] = [];
  for (const { name, ref } of refs) {
    const { data, error } = await supabase.storage.from("media").createSignedUrl(ref, PREVIEW_ASSET_SECONDS);
    if (error || !data?.signedUrl) return `Image "${name}" could not be opened. Pick it again from the library.`;
    assets.push({ name, src: data.signedUrl });
  }
  return assets;
}
