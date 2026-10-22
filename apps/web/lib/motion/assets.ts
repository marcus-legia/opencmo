/**
 * Images an explainer scene shows (`kit.Image`): the user's own library objects. Previews get short-lived
 * signed URLs, which the engine's `preview_assets` downloads from the one allowed origin and encodes like a
 * final render; final renders get them inlined by the worker instead, so nothing here outlives a preview.
 */
import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { MotionAsset } from "@opencmo/clip-motion/job";

/** Long enough for a slow preview queue, short enough that a leaked job file is soon useless. */
export const PREVIEW_ASSET_SECONDS = 600;

/** Signed URLs for `{name, ref}` (`ref` = an object of the `media` bucket, under RLS) in one call, or a sentence for the model. */
export async function previewAssets(supabase: SupabaseClient, refs: { name: string; ref: string }[]): Promise<MotionAsset[] | string> {
  if (!refs.length) return [];
  const { data, error } = await supabase.storage.from("media").createSignedUrls(refs.map((item) => item.ref), PREVIEW_ASSET_SECONDS);
  const assets: MotionAsset[] = [];
  for (const [index, { name }] of refs.entries()) {
    const signed = data?.[index];
    if (error || !signed?.signedUrl || signed.error) return `Image "${name}" could not be opened. Pick it again from the library.`;
    assets.push({ name, src: signed.signedUrl });
  }
  return assets;
}
