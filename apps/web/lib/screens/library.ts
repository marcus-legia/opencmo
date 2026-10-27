/**
 * S6 Library (`Library.dc.html`): Business (four documents), Brand Kit, Voice, Skills. One copy of each thing,
 * read by the brain and every department (docs/architecture/brain.md §8b).
 */

import { z } from "zod";

import { iso } from "./common";

/** Same kinds as `marketing_documents.kind` (`lib/cmo/documents.ts`). */
export const LibraryDocumentSchema = z.object({
  kind: z.enum(["product", "strategy", "competitors", "content_strategy"]),
  title: z.string().max(80),
  summary: z.string().max(300),
  fields: z.number().int().min(0),
  /** Who wrote the current version; `agent` + no edit = "drafted from your site, not edited yet". */
  editedBy: z.enum(["agent", "user"]),
  editedAt: iso,
  /** Extra line after the field count: "Research updates the outliers · you pick the competitors". */
  note: z.string().max(120).nullable(),
});

const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

/**
 * A view of one `brand_kits` row. Not editor-core's `BrandKitSchema` on purpose: this module is imported by
 * client pages, and editor-core pulls the renderer's font table in with it.
 */
export const LibraryBrandKitSchema = z.object({
  id: z.string(),
  name: z.string().max(60),
  colors: z.object({ primary: hex, secondary: hex, accent: hex, text: hex, background: hex }),
  fonts: z.object({ heading: z.string().max(60), body: z.string().max(60) }),
  captionStyle: z.string().max(40),
  aspect: z.enum(["9:16", "1:1", "4:5", "16:9"]),
  fit: z.enum(["cover", "contain", "fill"]),
  logo: z
    .object({
      /** Signed URL of the logo in the `brand` bucket. */
      url: z.url().nullable(),
      corner: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]),
      /** Width as a share of the frame: 0.08 = "8% of the frame". */
      size: z.number().min(0.05).max(0.4),
    })
    .nullable(),
});

export const VoiceNoteSchema = z.object({
  id: z.string(),
  text: z.string().max(200),
  /** "All platforms · from 6 edits · last Tue". */
  source: z.string().max(200),
  /** An older note this one replaced, quoted. */
  replaces: z.string().max(200).nullable(),
});

export const LibrarySkillSchema = z.object({
  id: z.string(),
  name: z.string().max(80),
  origin: z.enum(["built_in", "yours"]),
  note: z.string().max(120),
  enabled: z.boolean(),
});

export const LibraryScreenSchema = z.object({
  /** The site Research read: "Research drafted these from opencmo.io". */
  site: z.string().max(200).nullable(),
  documents: z.array(LibraryDocumentSchema).max(4),
  brandKits: z.array(LibraryBrandKitSchema),
  voice: z.object({ notes: z.array(VoiceNoteSchema), wordsCut: z.array(z.string().max(40)) }),
  skills: z.object({ writing: z.array(LibrarySkillSchema), video: z.array(LibrarySkillSchema) }),
});
export type LibraryScreen = z.infer<typeof LibraryScreenSchema>;
