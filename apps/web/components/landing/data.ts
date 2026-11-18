/**
 * Nội dung landing. Không có "use client": trang server đọc cùng mảng này để dựng
 * JSON-LD FAQPage, nên chữ trong schema và chữ trên trang không bao giờ lệch nhau.
 *
 * Copy follows the 2026-11-17 positioning (owner): one audience (founders selling software to businesses), Sales
 * leads, Post comes with it, video is a side tool. Every claim here must be true of the product today (CLAUDE.md
 * "Don't ship coming soon"); Sales reads exactly the platforms in `lib/cmo/social/conversations.ts` SALES_PLATFORMS.
 */
import { LUCIDE, STEP_ICON, type SocialKey } from "./icons";

/**
 * The name the landing page shows. Only the landing page uses it for now: the site-wide `SITE_NAME` (legal pages,
 * emails, the app) changes with the domain move, in one pass.
 */
export const BRAND = "Ferreto";

/** Where Sales searches: the four platforms of `SALES_PLATFORMS`, as landing logos (Hacker News is `ycombinator`). */
export const SALES_SOURCES: SocialKey[] = ["reddit", "ycombinator", "threads", "facebook"];
/** Where Post publishes the weekly plan. */
export const POST_CHANNELS: SocialKey[] = ["x", "linkedin", "threads"];

export type Beat = { num: string; title: string; body: string; logos?: SocialKey[] };

/** The story I–IV under the hero, darkened word by word as the reader scrolls (ScrollEssay). */
export const BEATS: Beat[] = [
  { num: "I.", title: "You built it, then waited a hundred years.", body: "You posted on X every day for a month and got views but no signups." },
  { num: "II.", title: "Someone is asking for it today.", body: "A founder on Reddit wants a tool like yours. Someone on Hacker News is comparing alternatives. By the time you find the thread by hand, it is two days old." },
  {
    num: "III.",
    title: `${BRAND} finds them first.`,
    body: "It reads your website, learns what you sell and who buys it, and checks Reddit, Hacker News, Threads and Facebook groups through the week. Each person comes with the quote that shows they need it.",
    logos: SALES_SOURCES,
  },
  {
    num: "IV.",
    title: "You reach out as yourself.",
    body: "It drafts a reply that helps first, checked against the community's rules. You edit it and post it from your account. Then it plans your posts for the week on X, LinkedIn and Threads.",
    logos: POST_CHANNELS,
  },
];

/** "If this sounds like your week": the four strongest pains from the 2026-11 founder research. */
export const PAINS = [
  "You scroll Reddit for an hour looking for someone who needs your product.",
  "Your posts get views and no signups.",
  "You'd rather ship a feature than write a LinkedIn post.",
  "A subreddit removed your post for mentioning your own product.",
];

export const FIT = {
  good: "founders who sell to developers, marketers, agencies, freelancers and online stores.",
  poor: "you sell a consumer app, or your customers never write about their problems online.",
};

/** From a thread to a conversation. Each step is a job the product runs today. */
export const STEPS = [
  { icon: STEP_ICON.find, title: "Find", body: "Through the week, or whenever you ask, it searches Reddit, Hacker News, Threads and Facebook groups for people describing the problem you solve." },
  { icon: STEP_ICON.score, title: "Score", body: "Each thread gets a score out of 100, with the quote that earned it: the pain, the fit with what you sell, how fresh it is." },
  { icon: STEP_ICON.reach, title: "Reach", body: "It drafts a reply that helps first, using what it knows about your product, and tells you when a community allows no self-promotion. You edit it and post it yourself." },
  { icon: STEP_ICON.followUp, title: "Follow up", body: "Three days later it reads the thread again and shows what your reply got." },
  { icon: STEP_ICON.post, title: "Post", body: "It plans a week of posts for X, LinkedIn and Threads. You approve the week once." },
];

/** The scroll-darkened walkthrough that replaced the demo videos: Sales, then Post, then video. */
export const SHOWCASE: Beat[] = [
  { num: "Sales", title: "The people who need what you built.", body: "Sales searches Reddit, Hacker News, Threads and Facebook groups and brings them back with the quote and a drafted reply.", logos: SALES_SOURCES },
  { num: "Post", title: "A week of posts, approved once.", body: "One update from your week becomes a post for each platform, waiting for your approval.", logos: POST_CHANNELS },
  { num: "Video", title: "Clips from what you record.", body: "Finish a video you recorded: tighten the hook, restyle the captions or add a voice-over." },
];

/** What the product never does: assist, never act (CLAUDE.md "Product rules"). */
export const PROMISES = [
  `${BRAND} drafts. You read, edit and post from your own accounts.`,
  "It never likes, follows, comments or replies on its own, and never uses extra accounts.",
  "It tells you when a subreddit bans self-promotion, so you help instead of pitch.",
  "We don't promise a number of customers. You see every conversation it found and what came of it.",
];

/** Giá chạy trên trang: đọc từ PLANS ở server rồi truyền xuống (pricing.ts là server-only). */
export type Prices = { monthly: number; annual: number; annualBilled: number };

export function savePercent(p: Prices): number {
  return Math.round((1 - p.annual / p.monthly) * 100);
}

/** The usual way, by hand. Estimates, footnoted under the pricing grid. */
export const USUAL_WAY = [
  { who: "Scrolling Reddit and Hacker News by hand", cost: "1 to 3 hours a day" },
  { who: "A keyword alert or social listening tool", cost: "free to $150 a month" },
  { who: "A scheduler for X, LinkedIn and Threads", cost: "$6 to $35 a month" },
  { who: "Writing a week of posts", cost: "an afternoon every week" },
];

export const INCLUDED = [
  { icon: STEP_ICON.find, title: "Searches on four platforms", body: "Reddit, Hacker News, Threads and Facebook groups" },
  { icon: STEP_ICON.score, title: "Scored threads", body: "Each with the quote that shows why" },
  { icon: STEP_ICON.reach, title: "Drafted replies", body: "From your business plan, checked against each community's rules" },
  { icon: STEP_ICON.post, title: "A week of posts", body: "For X, LinkedIn and Threads, approved in one go" },
    { icon: LUCIDE.wand, title: "Fair use, no per-click prices", body: "One allowance you can see in Settings" },
];

export function faqs(p: Prices | null): { q: string; a: string }[] {
  const price = p ? ` $${p.annual} a month billed annually, or $${p.monthly} month to month.` : "";
  return [
    { q: `What does ${BRAND} do?`, a: `${BRAND} reads your website, then searches Reddit, Hacker News, Threads and Facebook groups for people describing the problem you solve. Each one comes with the quote that shows why, and a draft reply based on your business plan. You post it from your own account. It also plans a week of posts for X, LinkedIn and Threads.` },
    { q: `Does ${BRAND} post anything without me?`, a: "No. Every post and reply waits in your inbox until you approve it. You can also edit or skip it." },
    { q: "What does it do with video?", a: "It builds slideshows and post images from the words you approved, and cuts short clips from videos you recorded and finished in the editor. In the editor you cut by editing the transcript and ask the agent for captions, B-roll or a voice-over." },
    { q: "Which platforms does Sales search?", a: "Reddit, Hacker News, Threads and Facebook groups. It drafts a reply; you post it yourself." },
    { q: "Will it like, follow or DM people for me?", a: `No. There are no automated likes, follows, DMs or replies. ${BRAND} drafts; you decide what to say and where.` },
    { q: "Is there a free trial?", a: `Your first scan is free, with no card. Give it your website, and within minutes you see the people asking for what you built, each with the words they wrote. Pick a plan and it writes a reply to each one. You post each reply yourself; nothing is posted for you.${price}` },
    { q: "What does the plan include?", a: `Everything: the searches, the drafted replies, the weekly posts, and the editor with captions and voice-over.${price}` },
    { q: "Can I cancel?", a: "Yes, anytime. Annual plans are refunded for the unused months." },
  ];
}

export type MenuItem = { title: string; sub: string; href: string; social?: SocialKey; icon?: string };
export type Menu = { id: string; label: string; width: number; cols: 1 | 2; items?: MenuItem[]; href?: string };

export const MENUS: Menu[] = [
  { id: "how", label: "How it works", width: 0, cols: 1, href: "#departments" },
  { id: "pricing", label: "Pricing", width: 0, cols: 1, href: "#pricing" },
  { id: "faq", label: "FAQ", width: 0, cols: 1, href: "#faq" },
  { id: "blog", label: "Blog", width: 0, cols: 1, href: "/blog" },
];

export type FootLink = { t: string; href: string; social?: SocialKey };

const fl = (t: string, href: string, social?: SocialKey): FootLink => ({ t, href, social });

export const FOOTER_COLUMNS: { title: string; links: FootLink[] }[] = [
  { title: "Product", links: [fl("How it works", "#departments"), fl("Pricing", "#pricing"), fl("FAQ", "#faq")] },
  { title: "Resources", links: [fl("Blog", "/blog")] },
];
