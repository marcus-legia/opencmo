/**
 * Library data that has no backend yet (Voice, writing skills). Business and Brand Kit read live
 * data. Typed here until Session A's `lib/screens/library.ts` lands (Requests, sessions file);
 * the content is the frame's sample, shown only with the "Sample data" tag.
 */

export type VoiceNote = { id: string; text: string; source: string };

export type SkillItem = { id: string; name: string; source: string; on: boolean };

export type LibrarySample = {
  voice: { notes: VoiceNote[]; cutWords: string[] };
  writingSkills: SkillItem[];
  videoSkills: SkillItem[];
};

export const LIBRARY_SAMPLE: LibrarySample = {
  voice: {
    notes: [
      { id: "v1", text: "Short sentences, one idea each.", source: "All platforms · from 6 edits · last Tue" },
      { id: "v2", text: "“We” on X, “I” on LinkedIn.", source: "Per platform · from 4 edits" },
      {
        id: "v3",
        text: "Name the feature, then show it.",
        source: "All platforms · replaces an older note “lead with the pain” (Oct 9)",
      },
    ],
    cutWords: ["game-changer", "unlock", "seamless", "leverage"],
  },
  writingSkills: [
    { id: "w1", name: "Plain writing (No AI Slop)", source: "Built in · guidance, never a hard filter", on: true },
    {
      id: "w2",
      name: "Platform profiles: X, Threads, LinkedIn",
      source: "Built in · length, tone, no links, hashtags only on videos",
      on: true,
    },
    { id: "w3", name: "Launch threads", source: "Yours · saved from a chat on Oct 18", on: false },
  ],
  videoSkills: [
    { id: "s1", name: "Senior dev listicle", source: "Built in style skill", on: true },
    { id: "s2", name: "OpenCMO demo cut", source: "Yours · saved from the editor Assistant", on: true },
  ],
};

/** Who reads what: product copy, not data (frame's side panel). */
export const WHO_READS: { who: string; what: string }[] = [
  { who: "Brain", what: "Business, always. Picks the rest into each brief." },
  { who: "Writer", what: "Business · Voice · Writing skills" },
  { who: "Studio and the editor", what: "Business · Brand Kit · Video skills" },
  { who: "Sales", what: "Business · Voice · Writing skills" },
  { who: "Research", what: "Business (competitors list)" },
];
