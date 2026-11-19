/**
 * The Library: what people said in the conversations Sales kept (wave 3, docs/plans/cmo/2026-11-20-wave3-plan.md).
 * Post writes from it, so a draft cites a conversation by its one-line summary, never its title. Pure: the browser
 * imports it too.
 *
 * Privacy (Privacy page, PR #236): an entry keeps the public post's link (on its opportunity), community, date, one
 * summary line and a few short quotes. Never the author's profile.
 */
import { z } from "zod";

import { SALES_PLATFORMS, type SalesPlatform } from "./social/conversations";

/** Limits shared by the zod schemas and the SQL that stores them (`cmo_save_library`), so a quote stays short. */
export const LIBRARY_LIMITS = {
  summaryChars: 200,
  quoteChars: 280,
  quotesPerEntry: 4,
  themeNameChars: 80,
  /** Entries `my_library` returns per theme. */
  entriesPerTheme: 3,
} as const;

export const QUOTE_KINDS = ["pain", "evidence"] as const;
export type QuoteKind = (typeof QUOTE_KINDS)[number];

export const LibraryQuoteSchema = z.object({
  kind: z.enum(QUOTE_KINDS),
  text: z.string().trim().min(1).max(LIBRARY_LIMITS.quoteChars),
});
export type LibraryQuote = z.infer<typeof LibraryQuoteSchema>;

export const LibraryEntrySchema = z.object({
  opportunityId: z.uuid(),
  platform: z.enum(SALES_PLATFORMS),
  community: z.string().trim().min(1).max(120),
  postedAt: z.string().nullable(),
  /** One line, the post's point, not its title. */
  summary: z.string().trim().min(1).max(LIBRARY_LIMITS.summaryChars),
  quotes: z.array(LibraryQuoteSchema).max(LIBRARY_LIMITS.quotesPerEntry),
  themeId: z.uuid().nullable(),
});
export type LibraryEntry = {
  opportunityId: string;
  platform: SalesPlatform;
  community: string;
  postedAt: string | null;
  summary: string;
  quotes: LibraryQuote[];
  themeId: string | null;
};

export const LibraryThemeSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(LIBRARY_LIMITS.themeNameChars),
  count: z.number().int().min(0),
  thisWeek: z.number().int().min(0),
  usedInPosts: z.number().int().min(0),
});
export type LibraryTheme = { id: string; name: string; count: number; thisWeek: number; usedInPosts: number };

// Compile-time guard: the hand-written contract types and the schemas cannot drift apart.
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const _entrySame: Same<z.infer<typeof LibraryEntrySchema>, LibraryEntry> = true;
const _themeSame: Same<z.infer<typeof LibraryThemeSchema>, LibraryTheme> = true;
void _entrySame;
void _themeSame;

/**
 * One line the scan hands `cmo_save_library`, keyed by the conversation's url (the opportunity the same scan saved, or
 * an earlier one). An empty theme files it under "Other".
 */
export const LibrarySaveItemSchema = z.object({
  url: z.string().max(500),
  theme: z.string().trim().max(LIBRARY_LIMITS.themeNameChars),
  summary: z.string().trim().min(1).max(LIBRARY_LIMITS.summaryChars),
  quotes: z.array(LibraryQuoteSchema).max(LIBRARY_LIMITS.quotesPerEntry),
});
export type LibrarySaveItem = z.infer<typeof LibrarySaveItemSchema>;

/** A theme the week plan and post drafts write from (`cmo_library_top_themes`): recent entries only, newest first. */
export type LibraryTopTheme = { id: string; name: string; count: number; entries: Omit<LibraryEntry, "themeId">[] };
