/**
 * Nội dung landing (thiết kế "OpenCMO Landing v3"). Không có "use client": trang server
 * đọc cùng mảng này để dựng JSON-LD FAQPage, nên chữ trong schema và chữ trên trang
 * không bao giờ lệch nhau.
 */
import { DEPT_ICON, LUCIDE, type SocialKey } from "./icons";

export type DeptId = "video" | "post" | "sales";

export type Dept = {
  id: DeptId;
  numeral: string;
  short: string;
  name: string;
  goal: string;
  steps: string[];
  result: string;
  channels: SocialKey[];
};

// The order of the CMO loop (CLAUDE.md "Strategy"): words are written first, video is built from them, and the
// editor is where the founder finishes their own recordings by hand.
export const DEPTS: Dept[] = [
  {
    id: "post",
    numeral: "I",
    short: "Post",
    name: "Post Department",
    goal: "An AI post writer that knows your business.",
    steps: [
      "Reads your strategy and what you shipped this week",
      "Drafts posts, slides and video scripts in your voice for each platform",
      "You approve each post and its time; it posts then, on your account",
    ],
    result: "Posts for every platform, in your voice, every day.",
    channels: ["x", "linkedin", "threads", "facebook", "reddit"],
  },
  {
    id: "video",
    numeral: "II",
    short: "Video",
    name: "Video Department",
    goal: "Slideshows, post images and short clips from your own videos.",
    steps: [
      "Builds slideshows and post images from the words you approved, with your Brand Kit",
      "Cuts short clips from a video you recorded and finished in the editor",
      "The editor is where you fine-tune by hand: cut by words, captions, voice-over",
    ],
    result: "Visual posts from your plan, and clips from what you record.",
    channels: ["tiktok", "instagram", "youtubeshorts", "facebook", "threads"],
  },
  {
    id: "sales",
    numeral: "III",
    short: "Sales",
    name: "Sales Department",
    goal: "Find the conversations where people need what you built.",
    steps: [
      "Searches public conversations across nine platforms",
      "Shows why each one matters, with the link",
      "Drafts a helpful reply you post yourself",
    ],
    result: "Conversations worth joining, with a reply drafted.",
    channels: ["reddit", "x", "linkedin", "facebook", "threads", "ycombinator", "indiehackers", "youtube", "quora"],
  },
];

/** The three beats I · II · III, darkened word by word as the reader scrolls (Hero.tsx). */
export const BEATS = [
  { num: "I.", title: "It starts with your website.", body: "The AI CMO reads your site and competitors, and turns them into one strategy and one goal." },
  { num: "II.", title: "The plan takes shape.", body: "Your goal becomes a weekly calendar, mapped across the channels where your customers already are." },
  { num: "III.", title: "Three departments carry it.", body: "Post writes, Video builds from the approved words, Sales finds the conversations. You approve what goes out and when." },
];

export const DEMOS: Record<DeptId, { src: string; poster: string; label: string; alt: string; caption: string }> = {
  video: {
    src: "/demos/video.mp4",
    poster: "/demos/video.webp",
    label: "Video department · 5s",
    alt: "The Video editor: the founder asks the agent to punch up the hook of a video they recorded; captions and a voice-over are added",
    caption: "Finish a video you recorded: ask the editor to tighten the hook, restyle the captions or add a voice-over.",
  },
  post: {
    src: "/demos/post.mp4",
    poster: "/demos/post.webp",
    label: "Post department · 5s",
    alt: "The Post department turns this week's update into five platform drafts and schedules them after approval",
    caption: "One update from your week becomes a post for each platform, written in your voice, waiting for your approval.",
  },
  sales: {
    src: "/demos/sales.mp4",
    poster: "/demos/sales.webp",
    label: "Sales department · 5s",
    alt: "The Sales department scans nine platforms and surfaces three conversations with a drafted reply",
    caption: "Sales searches public conversations on nine platforms and brings back the ones where people need what you built.",
  },
};

/** Giá chạy trên trang: đọc từ PLANS ở server rồi truyền xuống (pricing.ts là server-only). */
export type Prices = { monthly: number; annual: number; annualBilled: number };

export function savePercent(p: Prices): number {
  return Math.round((1 - p.annual / p.monthly) * 100);
}

/** Cách làm thường: ước tính, trang có ghi chú ngay dưới bảng. */
export const USUAL_STACK = [
  { who: "Freelance video editor", what: "4 short videos a week, with captions", price: 480 },
  { who: "Voice-over and caption tools", what: "Two subscriptions", price: 45 },
  { who: "Social media manager", what: "Posts for X, LinkedIn, Threads, Facebook and Reddit", price: 350 },
  { who: "Scheduling tool", what: "Queue and publish", price: 35 },
  { who: "Social listening tool", what: "Alerts when people mention your problem", price: 150 },
];

export const INCLUDED = [
  { icon: DEPT_ICON.cmo, title: "AI CMO", body: "Reads your site and plans your week around one goal" },
  { icon: DEPT_ICON.post, title: "Post department", body: "Drafts for X, LinkedIn, Threads, Facebook and Reddit" },
  { icon: DEPT_ICON.video, title: "Video department", body: "Slideshows, post images and clips from your own videos, plus the editor" },
  { icon: DEPT_ICON.sales, title: "Sales department", body: "Finds the conversations where people need what you sell, on 9 platforms" },
];

export function faqs(p: Prices | null): { q: string; a: string }[] {
  const price = p ? ` $${p.annual} a month billed annually, or $${p.monthly} month to month.` : "";
  return [
    { q: "What is an AI marketing team?", a: "OpenCMO is an AI CMO with three departments. It reads your website, plans your week and writes the posts, slides and video scripts. Video builds slideshows, post images and clips from your own videos, and Sales finds conversations where people need what you built. You approve what goes out and when." },
    { q: "Does OpenCMO post anything without me?", a: "No. Every post and reply waits in your inbox until you approve it. You can also edit or skip it." },
    { q: "What does it do with video?", a: "It builds slideshows and post images from the words you approved, and cuts short clips from videos you recorded and finished in the editor. In the editor you cut by editing the transcript and ask the agent for captions, B-roll or a voice-over." },
    { q: "Which platforms does Sales search?", a: "Public conversations on Reddit, X, LinkedIn, Facebook groups, Threads, Hacker News, Indie Hackers, YouTube comments and Quora. It drafts a reply; you post it yourself." },
    { q: "Will it like, follow or DM people for me?", a: "No. There are no automated likes, follows, DMs or replies. OpenCMO drafts; you decide what to say and where." },
    { q: "Is there a free trial?", a: `No. OpenCMO starts when you pick a plan.${price} Your first week's plan and drafts arrive within minutes of giving it your website.` },
    { q: "What does the plan include?", a: `Everything: the AI CMO, all three departments, and the editor with captions and voice-over.${price}` },
    { q: "Can I cancel?", a: "Yes, anytime. Annual plans are refunded for the unused months." },
  ];
}

export type MenuItem = { title: string; sub: string; href: string; social?: SocialKey; icon?: string };
export type Menu = { id: string; label: string; width: number; cols: 1 | 2; items?: MenuItem[]; href?: string };

const mi = (title: string, sub: string, href: string, o: { social?: SocialKey; icon?: string }): MenuItem => ({ title, sub, href, ...o });

export const MENUS: Menu[] = [
  {
    id: "product", label: "Product", width: 380, cols: 1,
    items: [
      mi("AI CMO", "Turns one goal into a weekly plan", "/ai-cmo", { icon: DEPT_ICON.cmo }),
      mi("AI post writer", "Posts for X, LinkedIn, Threads and more", "/ai-post-writer", { icon: DEPT_ICON.post }),
      mi("AI video editor", "Finish your own videos: captions, cuts, voice-over", "/ai-video-editor", { icon: DEPT_ICON.video }),
      mi("Customer conversations", "Find people asking for what you built", "/find-customers", { icon: DEPT_ICON.sales }),
      mi("Brand kit", "Your colors, fonts and captions", "/brand-kit", { icon: LUCIDE.palette }),
    ],
  },
  {
    id: "solutions", label: "Solutions", width: 360, cols: 1,
    items: [
      mi("Solo founders", "Marketing without hiring", "/for/solo-founders", { icon: LUCIDE.user }),
      mi("Indie hackers", "Launch and grow in public", "/for/indie-hackers", { icon: LUCIDE.rocket }),
      mi("SaaS startups", "Content from what you ship", "/for/saas", { icon: LUCIDE.layers }),
      mi("Agencies", "One team for every client", "/for/agencies", { icon: LUCIDE.briefcase }),
      mi("Creators & coaches", "Plan, write and finish every recording", "/for/creators", { icon: LUCIDE.mic }),
    ],
  },
  {
    id: "channels", label: "Channels", width: 560, cols: 2,
    items: ([
      ["tiktok", "TikTok videos", "/channels/tiktok"],
      ["youtubeshorts", "YouTube Shorts", "/channels/youtube-shorts"],
      ["instagram", "Instagram Reels", "/channels/instagram-reels"],
      ["x", "X posts", "/channels/x"],
      ["linkedin", "LinkedIn posts", "/channels/linkedin"],
      ["threads", "Threads posts", "/channels/threads"],
      ["facebook", "Facebook pages & groups", "/channels/facebook"],
      ["reddit", "Reddit marketing", "/channels/reddit"],
    ] as const).map(([k, t, href]) => mi(t, "", href, { social: k })),
  },
  {
    id: "resources", label: "Resources", width: 380, cols: 1,
    items: [
      mi("Blog", "Founder-led marketing, week by week", "/blog", { icon: LUCIDE.book }),
      mi("Guides", "Playbooks for each channel", "/guides", { icon: LUCIDE.compass }),
      mi("Free tools", "Hook, caption and post generators", "/tools", { icon: LUCIDE.wand }),
      mi("Compare", "OpenCMO vs Buffer, Hootsuite", "/compare", { icon: LUCIDE.scale }),
      mi("Changelog", "What shipped this month", "/changelog", { icon: LUCIDE.history }),
    ],
  },
  { id: "pricing", label: "Pricing", width: 0, cols: 1, href: "#pricing" },
  { id: "faq", label: "FAQ", width: 0, cols: 1, href: "#faq" },
];

export type FootLink = { t: string; href: string; social?: SocialKey };

const fl = (t: string, href: string, social?: SocialKey): FootLink => ({ t, href, social });

export const FOOTER_COLUMNS: { title: string; links: FootLink[] }[] = [
  { title: "Product", links: [fl("AI CMO", "/ai-cmo"), fl("AI video editor", "/ai-video-editor"), fl("AI post writer", "/ai-post-writer"), fl("Customer conversations", "/find-customers"), fl("Brand kit", "/brand-kit"), fl("Pricing", "#pricing")] },
  { title: "Solutions", links: [fl("Solo founders", "/for/solo-founders"), fl("Indie hackers", "/for/indie-hackers"), fl("SaaS startups", "/for/saas"), fl("Agencies", "/for/agencies"), fl("Creators & coaches", "/for/creators")] },
  { title: "Channels", links: [fl("TikTok videos", "/channels/tiktok"), fl("YouTube Shorts", "/channels/youtube-shorts"), fl("Instagram Reels", "/channels/instagram-reels"), fl("LinkedIn posts", "/channels/linkedin"), fl("Reddit marketing", "/channels/reddit"), fl("X posts", "/channels/x")] },
  { title: "Free tools", links: [fl("Video hook generator", "/tools/hook-generator"), fl("Caption generator", "/tools/caption-generator"), fl("LinkedIn post generator", "/tools/linkedin-post-generator"), fl("X thread writer", "/tools/x-thread-writer"), fl("Reddit thread finder", "/tools/reddit-thread-finder")] },
  { title: "Resources", links: [fl("Blog", "/blog"), fl("Guides", "/guides"), fl("OpenCMO vs Buffer", "/compare/buffer"), fl("OpenCMO vs Hootsuite", "/compare/hootsuite"), fl("Changelog", "/changelog")] },
  { title: "Connect", links: [fl("X", "#", "x"), fl("LinkedIn", "#", "linkedin"), fl("YouTube", "#", "youtube"), fl("TikTok", "#", "tiktok"), fl("Reddit", "#", "reddit")] },
];
