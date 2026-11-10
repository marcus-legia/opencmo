import { CATEGORIES } from "@/content/blog/categories";
import { getAllPosts } from "@/lib/blog";
import { plansOnSale } from "@/lib/billing-catalog";
import { SITE_DESCRIPTION, absoluteUrl } from "@/lib/site";

// Prices are read at request time, like the pricing page: a build-time copy would print last month's numbers.
export const dynamic = "force-dynamic";

/**
 * `/llms.txt` (llmstxt.org): bản tóm tắt bằng Markdown cho mô hình ngôn ngữ —
 * What OpenCMO is, its prices and the post index. Prices come from the catalogue, so they match the pricing page.
 */
export async function GET() {
  const posts = getAllPosts();
  // Only plans with a catalogue row have a price; none listed when the catalogue cannot be read.
  const paid = (await plansOnSale()).filter((plan) => plan.slug);
  const lines = [
    "# OpenCMO",
    "",
    `> ${SITE_DESCRIPTION}`,
    "",
    "OpenCMO is software for founders. You enter your website; an AI CMO reads it, writes a strategy and plans your week, and three departments draft the work: Post (posts for X, Threads and LinkedIn in your voice, plus slides and video scripts), Video (slideshows and post images from the approved words, short clips cut from videos you recorded and finished in the editor, where you cut by words and add captions and a voice-over) and Sales (public conversations where people describe the problem you solve, with a reply drafted for you to post yourself). Nothing is published without your approval, and only to accounts you connect. Your first plan and drafts are free. Pick a plan to approve and post them.",
    "",
    "## Pricing",
    "",
    ...paid.map((plan) => `- ${plan.name}: $${plan.price}/month${plan.interval === "year" ? ` (billed $${plan.billedPrice} yearly)` : ""} — ${plan.features.join(", ")}`),
    ...(paid.length ? [] : [`- See ${absoluteUrl("/#pricing")} for current prices.`]),
    "- Credits are spent per piece of work (for example 1 credit per post draft).",
    "",
    "## Links",
    "",
    `- [Home](${absoluteUrl("/")}): product overview and pricing`,
    `- [Blog](${absoluteUrl("/blog")}): marketing how-to guides, tips and playbooks for founders`,
    "",
    ...CATEGORIES.flatMap((category) => {
      const inCategory = posts.filter((post) => post.category === category.slug);
      if (inCategory.length === 0) return [];
      return [
        `## ${category.name}`,
        "",
        ...inCategory.map((post) => `- [${post.title}](${absoluteUrl(`/blog/${post.slug}`)}): ${post.description}`),
        "",
      ];
    }),
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
