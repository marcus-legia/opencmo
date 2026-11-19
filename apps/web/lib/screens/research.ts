/**
 * S7 Research (`Research.dc.html`).
 */

import { z } from "zod";

import { PlatformSchema, iso } from "./common";

export const InsightSchema = z.object({
  id: z.string(),
  type: z.enum(["hook", "format", "idea"]),
  /** Filter tab it belongs to. */
  scope: z.enum(["competitors", "niche_video"]),
  /** "X", "Shorts", "LinkedIn". */
  platform: z.string().max(40),
  text: z.string().max(300),
  evidence: z.string().max(200),
  /** "used in Thursday's post", "fed the video brief"; null = not used yet. */
  usedIn: z.string().max(120).nullable(),
  /** Every insight points to the post it came from; one without a link is dropped, never shown. */
  sources: z.array(z.url()).min(1),
  /** Niche video insights (P5 R2): the short's numbers as read; never the video itself. */
  video: z
    .object({
      views: z.number().int().min(0).nullable(),
      /** Views over the median of the same search: why it counts as an outlier. */
      outlier: z.number().min(0).nullable(),
      seconds: z.number().positive().nullable(),
      format: z.string().max(60).nullable(),
    })
    .optional(),
});

/** One competitor the founder added (wave 3 A6, `competitors`), with its weekly mentions in Sales conversations. */
export const CompetitorViewSchema = z.object({
  id: z.string(),
  name: z.string().max(80),
  site: z.string().max(253),
  logoUrl: z.url().nullable(),
  price: z.string().max(200).nullable(),
  offer: z.string().max(300).nullable(),
  addedVia: z.enum(["url", "chat"]),
  /** Mentions per week (Monday, `YYYY-MM-DD`), the last 8 weeks, oldest first; weeks with none are left out. */
  mentions: z.array(z.object({ week: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), count: z.number().int().min(0) })).max(8),
});
export type CompetitorView = z.infer<typeof CompetitorViewSchema>;

export const ResearchScreenSchema = z.object({
  lastRunAt: iso.nullable(),
  nextRunAt: iso.nullable(),
  insights: z.array(InsightSchema),
  /** Insights dropped this week for having no source link. */
  dropped: z.number().int().min(0),
  /** "Your results · 24 h after posting". */
  results: z.array(
    z.object({
      id: z.string(),
      title: z.string().max(200),
      platform: PlatformSchema,
      views: z.number().int().min(0).nullable(),
      replies: z.number().int().min(0).nullable(),
    }),
  ),
  /** Wave 3: the competitors the founder added by website or from Research's chat, newest first. */
  competitors: z.array(CompetitorViewSchema).max(20),
});
export type ResearchScreen = z.infer<typeof ResearchScreenSchema>;
