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
  code: vaccine.code,
  format: vaccine.format as Format,
  theme: vaccine.theme as Theme,
  personality: vaccine.personality as Personality,
};

/** The vaccine explainer for vaccine topics, the showcase for everything else. */
export const explainerFor = (ask: string): FakeExplainer => (/\bvaccin/i.test(ask) ? VACCINE_EXPLAINER : SHOWCASE_EXPLAINER);
