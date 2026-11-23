import { CATEGORIES } from "@/content/blog/categories";
import { getAllPosts } from "@/lib/blog";
import { plansOnSale } from "@/lib/billing-catalog";
import { absoluteUrl, blogUrl, SITE_DESCRIPTION } from "@/lib/site";

// Prices are read at request time, like the pricing page: a build-time copy would print last month's numbers.
export const dynamic = "force-dynamic";

/**
 * `/llms.txt` (llmstxt.org): bản tóm tắt bằng Markdown cho mô hình ngôn ngữ —
 * What Ferreto is, its prices and the post index. Prices come from the catalogue, so they match the pricing page.
 */
export async function GET() {
  const posts = getAllPosts();
  // Only plans with a catalogue row have a price; none listed when the catalogue cannot be read.
  const paid = (await plansOnSale()).filter((plan) => plan.slug);
  const lines = [
    "# Ferreto",
    "",
    `> ${SITE_DESCRIPTION}`,
    "",
    "Ferreto is a customer-finding tool for founders who sell software to businesses. You enter your website; Ferreto reads it and writes down what you sell, who buys it and the problems they describe. Sales then searches Reddit, Hacker News, Threads and Facebook groups for people describing those problems. Each person comes with a score out of 100, the quote that earned it, and an idea for a reply, built from your business plan, that helps first and follows the community's rules; you write the reply in your own words. When someone is ready for more, it drafts a DM, or an email to an address they published. You send everything yourself, from your own accounts: Ferreto never replies, DMs, likes or follows on its own. After you reply, it rereads the thread, tracks who answered, and drafts one follow-up after four quiet days. Post plans a week of posts for X, LinkedIn and Threads from the questions Sales found; you approve the week once, and only accounts you connect are posted to.",
    "",
    "Your first scan is free, with no card: you see the people asking, in their own words. Replies, DMs, emails and further scans come with the paid plan.",
    "",
    "## Pricing",
    "",
    ...paid.map((plan) => `- ${plan.name}: $${plan.price}/month${plan.interval === "year" ? ` (billed $${plan.billedPrice} yearly)` : ""} — ${plan.features.join(", ")}`),
    ...(paid.length ? [] : [`- See ${absoluteUrl("/#pricing")} for current prices.`]),
    "- The AI work spends the plan's monthly credits, shown in the app. When they run out, new scans pause until the next month; drafts keep working.",
    "",
    "## Links",
    "",
    `- [Home](${absoluteUrl("/")}): product overview and pricing`,
    `- [Blog](${blogUrl()}): guides on finding customers, positioning, launching and posting, for founders`,
    "",
    ...CATEGORIES.flatMap((category) => {
      const inCategory = posts.filter((post) => post.category === category.slug);
      if (inCategory.length === 0) return [];
      return [
        `## ${category.name}`,
        "",
        ...inCategory.map((post) => `- [${post.title}](${blogUrl(`/${post.slug}`)}): ${post.description}`),
        "",
      ];
    }),
  ];
  return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=utf-8" } });
}
