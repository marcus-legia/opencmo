/**
 * The founder's own photos on a text post (owner, 2026-11-13). SQL holds the same numbers (`post_photos_save`,
 * `reserve_upload`).
 */

/** A text post's photos go to every platform of its slot, and Threads and LinkedIn do not take WebP (`reserve_upload`). */
export const POST_PHOTO_TYPES = ["image/jpeg", "image/png"] as const;
export const PHOTO_MAX_BYTES = 10 * 1024 * 1024;
