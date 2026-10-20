/**
 * Fixture products shared by the `cmo:eval` cases. The first three are the original ones (their
 * rows must stay comparable with older runs); the rest add what they lacked: a consumer product,
 * a brand voice the drafts must keep, and a product whose documents have almost no numbers (so an
 * invented one stands out).
 */

import type { EvalFixture } from "./types";

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
  },
  {
    name: "uptime",
    docs: {
      product: { name: "Pingwise", one_liner: "Uptime checks that tell you which deploy broke the site.", pricing: "Free for 5 monitors, $9/month after" },
      strategy: { icp: "Solo developers running 1 to 10 small SaaS apps", avoid: ["unleash", "seamless"] },
      content_strategy: { pillars: [{ name: "Shipping safely", ideas: ["Roll back in one click", "The deploy checklist"] }] },
    },
    brief: "The one check every solo developer should run after a deploy",
  },
  {
    name: "booking",
    docs: {
      product: { name: "Slotty", one_liner: "Booking pages for hair salons with deposits built in.", pricing: "$19/month per salon" },
      strategy: { icp: "Owners of salons with 2 to 6 chairs", avoid: ["disrupt", "synergy"] },
      content_strategy: { pillars: [{ name: "Fewer no-shows", ideas: ["Why deposits cut no-shows", "The reminder text that works"] }] },
    },
    brief: "How a small deposit cuts no-shows without scaring clients away",
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
  },
];
