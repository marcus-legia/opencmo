/**
 * Checks a job's source before it reaches the database.
 *
 * Kept out of the route so `source.check.ts` can run each case: this is the "job points at
 * someone else's file" guard, which must never fail silently. Links are refused outright —
 * the user edits their own uploaded video only; `create_upload_edit()` refuses them again.
 */

export const UPLOAD_ONLY = "Upload the video file to edit it.";

/** Client-side check before a file is sent; the bucket and `reserve_upload` enforce the real limits. */
export function validateVideoFile(file: { size: number }, maxBytes: number): string | null {
  if (file.size <= 0) return "This file is empty.";
  if (file.size > maxBytes) return `Videos must be smaller than ${Math.round(maxBytes / 1024 ** 3)} GB.`;
  return null;
}

export function sourceProblem(source: string, userId: string): string | null {
  if (!source.startsWith("storage://")) return UPLOAD_ONLY;
  // The `storage://...` string comes from the client. Without the owner check anyone could start
  // a job on another user's file, and the worker (service role, past RLS) would process it.
  // Exactly TWO segments: `<uid>/../../someone/x.mp4` also starts with a valid uid.
  const segments = source.slice("storage://".length).split("/");
  if (segments.length !== 2 || segments[0] !== userId || segments[1].includes("..")) {
    return "That upload is no longer available. Please try again.";
  }
  return null;
}
