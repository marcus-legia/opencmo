/**
 * Photo posts (daily core drafts D7, owner 2026-11-12): the founder's own photos, posted as a TikTok photo post or an
 * Instagram or Threads carousel. SQL holds the same numbers (`photo_post_check`, `reserve_upload`).
 */

export const PHOTO_PLATFORMS = ["tiktok", "instagram", "threads"] as const;
export type PhotoPlatform = (typeof PHOTO_PLATFORMS)[number];

/** Photos a platform takes in one post (Zernio's docs, 2026-11-12). */
export const PHOTO_LIMIT: Record<PhotoPlatform, number> = { tiktok: 35, instagram: 20, threads: 20 };
export const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
export const PHOTO_CAPTION_MAX = 2200;

export type PhotoPost = { id: string; photos: string[]; caption: string; platforms: PhotoPlatform[]; status: "draft" | "scheduled" | "cancelled" };

/** Why this set cannot go to these platforms yet, or null when it can; the same rules and words as SQL. */
export function photoPostProblem(count: number, platforms: readonly PhotoPlatform[], caption: string): string | null {
  if (count === 0) return "Add at least one photo.";
  for (const p of platforms) {
    if (count > PHOTO_LIMIT[p]) return `${p === "tiktok" ? "TikTok" : p === "instagram" ? "Instagram" : "Threads"} takes up to ${PHOTO_LIMIT[p]} photos.`;
  }
  if (platforms.length === 0) return "Pick at least one platform.";
  if (!caption.trim()) return "Write a caption, or let the CMO write one.";
  if ([...caption].length > PHOTO_CAPTION_MAX) return `A caption is ${PHOTO_CAPTION_MAX.toLocaleString("en-US")} characters at most.`;
  return null;
}
