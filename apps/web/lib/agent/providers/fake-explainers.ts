/**
 * The explainers the fake model makes (`docs/explainer-v2-build.md`, C1/C5): storyboards with a
 * `visual` per beat, and scene code written only with the kit, as a model following the guide would.
 *
 * - `SHOWCASE_EXPLAINER`: Track A's v1 showcase (Shazam), with the pictures its code draws.
 * - `VACCINE_EXPLAINER`: Track A's v2 reference scene (`fixtures/vaccine.job.json`), subject first: Lucide
 *   icons (`syringe`, `shield-check`, `virus`, `dna`), a `cell` shape, one `Headline` row, a `Board` for the
 *   steps, a Lottie, the `paper` theme and the `playful` personality.
 */

import showcase from "../../../../../packages/clip-motion/fixtures/showcase.job.json";
import vaccine from "../../../../../packages/clip-motion/fixtures/vaccine.job.json";

type Format = "16:9" | "9:16" | "1:1";
type Theme = "blueprint" | "paper";
type Personality = "premium" | "corporate" | "playful" | "energetic";

export type FakeExplainer = {
  title: string;
  beats: { say: string; label?: string; visual: string }[];
  /** The motion spec with numbers the code was written from (`DIRECTION_HELP`). */
  direction: string;
  code: string;
  format: Format;
  theme?: Theme;
  personality?: Personality;
};

const SHOWCASE_VISUALS = [
  "a noisy waveform settles into a clean one",
  "a spectrogram grid fills in, time across and pitch up",
  "the brightest cells light up as dots",
  "lines link each peak to the few after it",
  "a mono code f1 | f2 | gap types in",
  "axes and a scatter of matches appear",
  "the matching dots line up on one straight line",
  "a check mark lands on the line",
];

export const SHOWCASE_EXPLAINER: FakeExplainer = {
  title: showcase.title,
  beats: showcase.beats.map((beat, index) => ({ ...beat, visual: SHOWCASE_VISUALS[index] ?? "the spectrogram stays on screen" })),
  direction: [
    "Visual centre: one spectrogram grid, 1500x600 px centred at 50%/52%, from beat 2 to the end; the camera pushes in 1.0 → 1.15 over beats 3-6, ease-in-out.",
    "Beat 1: the waveform draws left → right across 80% of the width in 1.2 s, ease-out, then calms (amplitude 100% → 30% over 0.8 s).",
    "Beat 2: grid cells fill column by column, 3 frames apart. Beat 3: the brightest 24 cells pop to dots (spring), the rest dim to 20% over 0.5 s.",
    "Beats 4-6: links draw 0.4 s each, ease-out; the mono code types at 20 chars/s; axes draw in 0.6 s, the scatter stagger 2 frames.",
    "Beat 7: matches slide onto one line over 1 s, ease-in-out. Beat 8: the check pops at 50%/45% and holds 1.5 s.",
    "Bar: resting text crisp, nothing clipped or overlapping, no jumps.",
  ].join(" "),
  code: showcase.code,
  format: showcase.format as Format,
};


export const VACCINE_EXPLAINER: FakeExplainer = {
  title: "How a vaccine trains your body",
  beats: [
    {
      say: "A vaccine trains your immune system before the real virus ever arrives.",
      label: "Training, not fighting",
      visual: "a syringe icon slides in from the left; a shield-check icon draws on the right",
    },
    {
      say: "It carries only a harmless piece of the virus, like a photo of a suspect.",
      label: "A harmless piece",
      visual: "a red virus icon splits into 3 small grey virus fragments",
    },
    {
      say: "Your immune cells study that piece and build antibodies that fit it.",
      label: "Antibodies that fit",
      visual: "an immune cell shape points an arrow at a fragment; a dna icon in a ring shape appears on the right",
    },
    {
      say: "When the real virus shows up, your body can recognise it at once.",
      label: "Ready for the real virus",
      visual: "a red virus icon moves right and is knocked back by a large shield-check icon, with a burst",
    },
    {
      say: "Show a harmless piece, build matching antibodies, and remember them for years.",
      label: "Three steps",
      visual: "a steps board on the left reveals three lines one by one; a syringe icon stands on the right",
    },
    {
      say: "That memory is why one small shot can protect you.",
      label: "Protected",
      visual: "a check mark lands in the centre; a confetti Lottie plays",
    },
  ],
  direction: [
    "One stage, the headline row at the top; the subject sits on the mid line (56% of the height) every beat.",
    "Beat 1: the syringe (380 px) enters at 27% of the width at 0.1 of the beat, ease-out 0.6 s; an arrow draws to 73% over 0.5 s; the shield-check pops on \"immune\".",
    "Beat 2: the virus (420 px) pops at the centre, then splits at 45% of the beat with a 320 px burst into 3 grey fragments, staggered 4 frames.",
    "Beat 3: the cell (320 px, 19% of the width) enters, an arrow draws to the first fragment over 0.5 s; the dna icon and its ring appear on \"antibodies\" at 82%.",
    "Beat 4: the virus slides 25% → 17% of the width over 0.4 s, is knocked back at 55% of the beat by the 420 px shield with a burst, and settles in 0.5 s.",
    "Beat 5: the steps board reveals three lines on \"show\", \"build\", \"remember\". Beat 6: the check pops at the centre, confetti plays once.",
    "Bar: resting text crisp, nothing clipped or overlapping, no jumps.",
  ].join(" "),
  code: vaccine.code,
  format: vaccine.format as Format,
  theme: vaccine.theme as Theme,
  personality: vaccine.personality as Personality,
};

/** The vaccine explainer for vaccine topics, the showcase for everything else. */
export const explainerFor = (ask: string): FakeExplainer => (/\bvaccin/i.test(ask) ? VACCINE_EXPLAINER : SHOWCASE_EXPLAINER);
