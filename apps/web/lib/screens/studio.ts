/**
 * S9 Studio (`Studio.dc.html`).
 */

import { z } from "zod";

import { iso } from "./common";

export const STUDIO_KINDS = ["video", "short", "slideshow", "post_image", "upload"] as const;

export const StudioItemSchema = z.object({
  id: z.string(),
  kind: z.enum(STUDIO_KINDS),
  title: z.string().max(200),
  /** "AI video · 60 s · rendering 62%", "Your upload · edited yesterday". */
  subtitle: z.string().max(200),
  status: z.enum(["uploading", "processing", "running", "waiting_founder", "ready", "finished", "failed", "cancelled"]),
  /** 0–100 while uploading, processing or running. */
  progress: z.number().min(0).max(100).nullable(),
  favorite: z.boolean(),
  createdAt: iso,
  editedAt: iso.nullable(),
  /** The failure line, with "credits refunded" when they were. */
  failure: z.string().max(200).nullable(),
  /** Today's project id (`/api/v1/projects/:id`) for uploads and their edits. */
  projectId: z.string().nullable(),
  editorHref: z.string().max(200).nullable(),
  approvalId: z.string().nullable(),
  /** An own edit the founder can mark finished (Shorts are cut only from finished edits). */
  canMarkFinished: z.boolean(),
  /** The item drawer (`?item=<id>`): edits made from this upload. */
  edits: z.array(z.object({ id: z.string(), title: z.string().max(200), editedAt: iso, editorHref: z.string().max(200) })),
});
export type StudioItem = z.infer<typeof StudioItemSchema>;

export const StudioScreenSchema = z.object({
  items: z.array(StudioItemSchema),
  /** "Video team · now": the long take in progress, one line per step. */
  team: z
    .object({
      title: z.string().max(200),
      steps: z.array(z.object({ label: z.string().max(80), state: z.enum(["done", "running", "todo"]) })),
    })
    .nullable(),
});
export type StudioScreen = z.infer<typeof StudioScreenSchema>;
