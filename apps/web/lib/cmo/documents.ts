/**
 * Bộ document marketing của tầng CMO (docs/cmo/san-pham.md §3.1).
 *
 * File này dùng chung client + server: schema zod (route kiểm body, generate ép
 * model ra đúng hình), nhãn tiếng Anh và mô tả field để màn sửa tự vẽ form.
 *
 * Schema KHÔNG đặt `.max()` cho chuỗi: structured output của Claude bỏ qua ràng
 * buộc độ dài, nên model vượt là `parse` hỏng cả lượt. Độ dài cắt bằng
 * `clampDocument` sau khi nhận, và DB chặn tổng 64 KB.
 */

import { z } from "zod";

/**
 * Documents v2 (wave 3 A4, owner 2026-11-18/19): Strategy gains where they ask and this week; Post plan replaces
 * Content Strategy; Brand holds the voice (moved out of Strategy) and the look.
 */
export const DOCUMENT_KINDS = ["product", "strategy", "competitors", "post_plan", "brand"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

const list = z.array(z.string());

export const ProductSchema = z.object({
  name: z.string().describe("Product or company name"),
  category: z.string().describe("Category in one or two words, e.g. 'SaaS', 'Mobile app', 'Agency'"),
  one_liner: z.string().describe("What it does, in one sentence a customer would say"),
  description: z.string().describe("Two or three sentences: what it is, who it is for, why it is different"),
  audience: z.string().describe("Who buys it"),
  problems: list.describe("Problems it solves, in the customer's words"),
  features: list.describe("Main features or capabilities, as stated on the website"),
  pricing: z.string().describe("Pricing as stated on the website, or 'Not listed on the website'"),
  x_handle: z.string().optional().describe("The product's or founder's X handle if the website links to it, else empty. Never guess."),
});

export const StrategySchema = z.object({
  icp: z.string().describe("Ideal customer profile: role, company type, situation"),
  pains: list.describe("The pains that make them look for a solution"),
  where_they_ask: list.describe("Communities and places where these customers ask about the problem: subreddits, forums, groups"),
  positioning: z.string().describe("One positioning statement: for whom, what category, key difference"),
  value_props: list.describe("Three to five reasons to choose this product"),
  this_week: z.string().describe("This week's focus, in one line, or empty"),
});

export const CompetitorsSchema = z.object({
  competitors: z
    .array(
      z.object({
        name: z.string(),
        website: z.string().describe("Homepage URL, or empty if unsure"),
        difference: z.string().describe("How this product differs from it"),
        x_handle: z.string().optional().describe("Its X handle only if you are sure, else empty"),
      }),
    )
    .describe("Up to five real, well-known alternatives. Fewer is better than guessing."),
});

/** Where posts go (B2B channels only, owner 2026-11-18). */
export const POST_CHANNELS = ["x", "linkedin", "threads"] as const;
export type PostChannel = (typeof POST_CHANNELS)[number];

export const PostPlanSchema = z.object({
  /**
   * The founder's content plan (owner, 2026-11-27): free text, like a CLAUDE.md for their posts. The week planner and
   * the writer follow it. Optional, so older documents and the onboarding's structured output still parse; cut at
   * 6,000 characters by `clampDocument`.
   */
  content_plan: z
    .string()
    .optional()
    .describe("The founder's content plan in their own words: what to write, the mix each day, topics, what never to write"),
  topics: list.describe("Three to six topics to post about, from what customers say (the Library), in their words"),
  channels: z.array(z.enum(POST_CHANNELS)).describe("Where the founder posts: x, linkedin and/or threads"),
  rhythm: z.string().describe("A realistic weekly rhythm for a solo founder"),
});

export const BrandSchema = z.object({
  voice: z.string().describe("How the brand sounds, in one or two sentences"),
  voice_samples: list.describe("Up to five pieces of the founder's own writing, pasted by them. Leave empty."),
  intro_line: z.string().describe("One line the founder uses to say what they make, in the first person"),
  avoid: list.describe("Words, claims or tones to avoid"),
  look: z
    .object({
      logo_url: z.string().describe("The logo's https URL from the website, or empty"),
      colors: list.describe("Two to four brand colours as #rrggbb, from the website"),
      font: z.string().describe("The website's main font family, or empty"),
      screenshots: list.describe("Storage paths of product screenshots the founder uploaded. Leave empty."),
      image_styles: list.describe("Two short descriptions of image styles that fit the brand"),
    })
    .describe("How the brand looks"),
});

export const DOCUMENT_SCHEMAS = {
  product: ProductSchema,
  strategy: StrategySchema,
  competitors: CompetitorsSchema,
  post_plan: PostPlanSchema,
  brand: BrandSchema,
} as const;

export type DocumentBodies = {
  product: z.infer<typeof ProductSchema>;
  strategy: z.infer<typeof StrategySchema>;
  competitors: z.infer<typeof CompetitorsSchema>;
  post_plan: z.infer<typeof PostPlanSchema>;
  brand: z.infer<typeof BrandSchema>;
};

/** Một lượt onboarding trả về đủ bốn document trong một lần gọi model. */
export const OnboardingSchema = z.object(DOCUMENT_SCHEMAS);
export type OnboardingDrafts = z.infer<typeof OnboardingSchema>;

/** Cách vẽ form: mỗi field là chữ ngắn, đoạn dài, danh sách dòng, hoặc nhóm lặp. */
export type Field =
  | { key: string; label: string; type: "text" | "long" | "list"; max?: number }
  | { key: string; label: string; type: "group"; fields: Field[]; max: number }
  /** A fixed set of values, any of them (Post plan's channels). */
  | { key: string; label: string; type: "choices"; options: readonly { value: string; label: string }[] }
  /** One nested object (Brand's look). */
  | { key: string; label: string; type: "object"; fields: Field[] };

export const DOCUMENTS: Record<DocumentKind, { title: string; summary: string; fields: Field[] }> = {
  product: {
    title: "Product Information",
    summary: "What you sell and who it is for.",
    fields: [
      { key: "name", label: "Name", type: "text" },
      { key: "category", label: "Category", type: "text" },
      { key: "one_liner", label: "One-liner", type: "text" },
      { key: "description", label: "Description", type: "long" },
      { key: "audience", label: "Who buys it", type: "long" },
      { key: "problems", label: "Problems it solves", type: "list" },
      { key: "features", label: "Main features", type: "list" },
      { key: "pricing", label: "Pricing", type: "long" },
      { key: "x_handle", label: "Your X handle", type: "text" },
    ],
  },
  strategy: {
    title: "Marketing Strategy",
    summary: "Who you are talking to, where they ask, and this week's focus.",
    fields: [
      { key: "icp", label: "Ideal customer", type: "long" },
      { key: "pains", label: "Their pains", type: "list" },
      { key: "where_they_ask", label: "Where they ask", type: "list" },
      { key: "positioning", label: "Positioning", type: "long" },
      { key: "value_props", label: "Why choose you", type: "list" },
      { key: "this_week", label: "This week", type: "text" },
    ],
  },
  competitors: {
    title: "Competitor Analysis",
    summary: "The alternatives your customers compare you with.",
    fields: [
      {
        key: "competitors",
        label: "Competitors",
        type: "group",
        max: 8,
        fields: [
          { key: "name", label: "Name", type: "text" },
          { key: "website", label: "Website", type: "text" },
          { key: "difference", label: "How you differ", type: "long" },
          { key: "x_handle", label: "X handle", type: "text" },
        ],
      },
    ],
  },
  post_plan: {
    title: "Post plan",
    summary: "What to post about, where, and how often.",
    fields: [
      { key: "content_plan", label: "Content plan", type: "long" },
      { key: "topics", label: "Topics", type: "list" },
      {
        key: "channels",
        label: "Channels",
        type: "choices",
        options: [
          { value: "x", label: "X" },
          { value: "linkedin", label: "LinkedIn" },
          { value: "threads", label: "Threads" },
        ],
      },
      { key: "rhythm", label: "Weekly rhythm", type: "long" },
    ],
  },
  brand: {
    title: "Brand",
    summary: "How you sound and how you look.",
    fields: [
      { key: "voice", label: "Brand voice", type: "long" },
      { key: "voice_samples", label: "Your writing samples", type: "list", max: 5 },
      { key: "intro_line", label: "How you introduce what you make", type: "text" },
      { key: "avoid", label: "Words you never use", type: "list" },
      {
        key: "look",
        label: "Look",
        type: "object",
        fields: [
          { key: "logo_url", label: "Logo", type: "text" },
          { key: "colors", label: "Colours", type: "list", max: 4 },
          { key: "font", label: "Font", type: "text" },
          { key: "screenshots", label: "Product screenshots", type: "list", max: 8 },
          { key: "image_styles", label: "Image styles", type: "list", max: 2 },
        ],
      },
    ],
  },
};

const LIMITS = { text: 200, long: 1500, list: 12, item: 300 };
/** A writing sample is longer than a list item: up to 600 characters each (owner, 2026-11-19). */
const ITEM_LIMITS: Record<string, number> = { voice_samples: 600 };
/** The content plan is a whole page of the founder's own rules, not a field (owner, 2026-11-27). */
const TEXT_LIMITS: Record<string, number> = { content_plan: 6000 };
/** Values a list keeps only when they look right: a colour as #rrggbb, a logo on https. */
const ITEM_RULES: Record<string, (v: string) => boolean> = { colors: (v) => /^#[0-9a-fA-F]{6}$/.test(v) };
const TEXT_RULES: Record<string, (v: string) => boolean> = { logo_url: (v) => v === "" || /^https:\/\/\S+$/.test(v) };

/** Cắt mọi chuỗi và danh sách theo mô tả field — chạy trên cả bản agent lẫn bản người sửa. */
export function clampDocument(kind: DocumentKind, body: Record<string, unknown>): Record<string, unknown> {
  return clampFields(DOCUMENTS[kind].fields, body);
}

function clampFields(fields: Field[], body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const value = body[field.key];
    if (field.type === "object") {
      out[field.key] = clampFields(field.fields, value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {});
    } else if (field.type === "choices") {
      const allowed = new Set(field.options.map((o) => o.value));
      out[field.key] = [...new Set((Array.isArray(value) ? value : []).filter((v): v is string => typeof v === "string" && allowed.has(v)))];
    } else if (field.type === "group") {
      const rows = Array.isArray(value) ? value : [];
      out[field.key] = rows
        .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
        .slice(0, field.max)
        .map((row) => clampFields(field.fields, row));
    } else if (field.type === "list") {
      const items = Array.isArray(value) ? value : [];
      const rule = ITEM_RULES[field.key];
      out[field.key] = items
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim().slice(0, ITEM_LIMITS[field.key] ?? LIMITS.item))
        .filter((item) => item && (!rule || rule(item)))
        .slice(0, field.max ?? LIMITS.list);
    } else {
      const text = typeof value === "string" ? value.trim().slice(0, TEXT_LIMITS[field.key] ?? LIMITS[field.type]) : "";
      out[field.key] = TEXT_RULES[field.key] && !TEXT_RULES[field.key]!(text) ? "" : text;
    }
  }
  return out;
}

/** True when clamping dropped text or list items (not when it only reordered keys or filled blanks). */
export function wasCut(before: unknown, after: unknown): boolean {
  if (typeof before === "string") return typeof after !== "string" || after.length < before.trim().length;
  if (Array.isArray(before)) {
    const kept = Array.isArray(after) ? after : [];
    return kept.length < before.length || before.some((item, i) => wasCut(item, kept[i]));
  }
  if (before && typeof before === "object") {
    const kept = after && typeof after === "object" ? (after as Record<string, unknown>) : {};
    return Object.entries(before as Record<string, unknown>).some(([key, value]) => key in kept && wasCut(value, kept[key]));
  }
  return false;
}
