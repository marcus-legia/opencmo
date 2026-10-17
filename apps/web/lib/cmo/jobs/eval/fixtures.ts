/**
 * Fixture products shared by the `cmo:eval` cases. The first three are the original ones (their
 * rows must stay comparable with older runs); the rest add what they lacked: a consumer product,
 * a brand voice the drafts must keep, and a product whose documents have almost no numbers (so an
 * invented one stands out).
 */

import type { ClipInfo } from "../types";
import type { EvalFixture } from "./types";

const clip = (idx: number, hook: string, text: string): ClipInfo => ({
  id: `clip-${idx}`, idx, hook, reason: "A clear, self-contained point", start: idx * 60, end: idx * 60 + 35, score: 0.8, text,
});

export const FIXTURES: EvalFixture[] = [
  {
    name: "invoicing",
    docs: {
      product: { name: "Paylane", one_liner: "Invoicing that chases late payments.", pricing: "$12/month" },
      strategy: { icp: "Freelancers who invoice 3 to 15 clients a month", avoid: ["revolutionary", "game-changer"] },
      content_strategy: {
        pillars: [{ name: "Getting paid", ideas: ["The 3-7-14 reminder rule", "Why invoices go unpaid"] }],
        short_video: "Clips from my demo recordings and a weekly founder talk.",
      },
    },
    brief: "Why polite reminders on day 3, 7 and 14 get invoices paid",
    clips: [
      clip(0, "Most late invoices are forgotten, not refused", "Most late invoices are not refused. The client just forgot. So we send a polite reminder on day three, again on day seven, and a last one on day fourteen."),
      clip(1, "Stop writing awkward follow-up emails", "I used to write every follow-up by hand and it felt awkward every time. Now the reminders go out on their own and I never chase anyone."),
    ],
  },
  {
    name: "uptime",
    docs: {
      product: { name: "Pingwise", one_liner: "Uptime checks that tell you which deploy broke the site.", pricing: "Free for 5 monitors, $9/month after" },
      strategy: { icp: "Solo developers running 1 to 10 small SaaS apps", avoid: ["unleash", "seamless"] },
      content_strategy: { pillars: [{ name: "Shipping safely", ideas: ["Roll back in one click", "The deploy checklist"] }] },
    },
    brief: "The one check every solo developer should run after a deploy",
    clips: [
      clip(0, "Which deploy broke the site?", "When the site goes down at night, the first question is which deploy did it. Pingwise ties every check to the last deploy, so a red check points at a change."),
    ],
  },
  {
    name: "booking",
    docs: {
      product: { name: "Slotty", one_liner: "Booking pages for hair salons with deposits built in.", pricing: "$19/month per salon" },
      strategy: { icp: "Owners of salons with 2 to 6 chairs", avoid: ["disrupt", "synergy"] },
      content_strategy: { pillars: [{ name: "Fewer no-shows", ideas: ["Why deposits cut no-shows", "The reminder text that works"] }] },
    },
    brief: "How a small deposit cuts no-shows without scaring clients away",
    clips: [
      clip(0, "A small deposit changes who shows up", "Salon owners worry a deposit scares people off. In my experience it only filters out the people who were never going to come."),
      clip(1, "The reminder text that works", "Send one short text the day before. Name, time, and a link to move the booking. That is all it needs."),
    ],
  },
  {
    // Consumer app: the buyer is a parent at home, not a business; B2B phrasing reads wrong here.
    name: "meals",
    docs: {
      product: {
        name: "Pantrytide",
        category: "Mobile app",
        one_liner: "Weeknight dinners planned from what is already in your fridge.",
        audience: "Parents who cook for a family most weeknights",
        features: ["Scan or type what is in the fridge", "Five dinners a week, 30 minutes or less", "One shopping list for the gaps"],
        pricing: "$6/month, first two weeks free",
      },
      strategy: {
        icp: "Parents cooking for 3 to 5 people on weeknights, short on time",
        voice: "Warm and practical, like a friend who cooks. Short sentences.",
        avoid: ["hack", "life-changing", "superfood", "guilt"],
      },
      content_strategy: {
        pillars: [
          { name: "Less food waste", ideas: ["The half bag of spinach problem", "Cook the fridge before you shop"] },
          { name: "Fast weeknights", ideas: ["Three dinners from one tray", "What to do with leftover rice"] },
        ],
        short_video: "Short clips from my kitchen: one dinner from what was left in the fridge.",
      },
    },
    brief: "Planning dinners from what is already in the fridge instead of a recipe you have to shop for",
    clips: [
      clip(0, "Cook the fridge before you shop", "Before I write a shopping list I open the fridge. Half a bag of spinach, two eggs, some rice. That is tonight's dinner, not tomorrow's bin."),
      clip(1, "Leftover rice is a head start", "Cold rice from yesterday fries better than fresh. Add the eggs, whatever vegetables are going soft, and soy sauce. Fifteen minutes."),
    ],
  },
  {
    // A distinctive voice: drafts that slip into marketing tone should fail the judge here first.
    name: "changelog",
    docs: {
      product: {
        name: "Shipnote",
        category: "SaaS",
        one_liner: "A changelog page your users actually read.",
        features: ["Write updates in markdown", "Email digest to subscribers", "Embeddable widget"],
        pricing: "$15/month",
      },
      strategy: {
        icp: "Indie SaaS founders who ship weekly and forget to tell anyone",
        voice: "Dry, lowercase, a bit self-deprecating. No exclamation marks, no emoji, never sounds like an ad.",
        avoid: ["excited to announce", "game-changing", "supercharge"],
      },
      content_strategy: {
        pillars: [{ name: "Shipping in public", ideas: ["nobody reads release notes (they read changelogs)", "the update you shipped and never mentioned"] }],
      },
    },
    brief: "most users never hear about the features you ship",
    clips: [
      clip(0, "you shipped it. nobody knows.", "I shipped dark mode in March. In June a customer emailed asking for dark mode. That is the whole reason Shipnote exists."),
    ],
  },
  {
    // Almost no numbers in the documents: any statistic in a draft is invented.
    name: "pottery",
    docs: {
      product: {
        name: "Kilnhouse",
        category: "Online course",
        one_liner: "Wheel-throwing lessons by video for people with a home studio.",
        audience: "Hobby potters who learned the basics in a class and now throw at home",
        pricing: "One-time purchase, lifetime access",
      },
      strategy: {
        icp: "Hobby potters with their own wheel and no teacher nearby",
        voice: "Patient and encouraging; talks about mistakes as normal.",
        avoid: ["master", "effortless", "secret"],
      },
      content_strategy: {
        pillars: [{ name: "Fixing common mistakes", ideas: ["Why your pots crack while drying", "Centering without fighting the clay"] }],
        short_video: "Clips from my lesson recordings at the wheel.",
      },
    },
    brief: "Why pots crack while they dry and how to stop it",
    clips: [
      clip(0, "Your pot cracked while drying. Here is why.", "Most cracks start at the base. The rim dries first, the base stays wet, and the pot pulls itself apart. Cover the rim and let the base catch up."),
    ],
  },
];
