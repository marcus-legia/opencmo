/**
 * The explainers the fake model makes (`docs/explainer-v2-build.md`, C1/C5): storyboards with a
 * `visual` per beat, and scene code written only with the kit, as a model following the guide would.
 *
 * - `SHOWCASE_EXPLAINER`: Track A's v1 showcase (Shazam), with the pictures its code draws.
 * - `VACCINE_EXPLAINER`: the motion-studio scene (`fixtures/vaccine-drawn.job.json`): its own palette, one shot per beat,
 *   every subject drawn in a Mark. It replaced Track A's icon scene (Lucide
 *   icons (`syringe`, `shield-check`, `virus`, `dna`), a `cell` shape, one `Headline` row, a `Board` for the
 *   steps, a Lottie, the `paper` theme and the `playful` personality).
 */

import showcase from "../../../../../packages/clip-motion/fixtures/showcase.job.json";
import vaccine from "../../../../../packages/clip-motion/fixtures/vaccine-drawn.job.json";

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
    "Warm paper direction: field #F4EFE6 to #E9E1D3, ink #1D2733, teal #0E9E86 for the body, red #D9384E for the virus, grey #9AA6B8 for harmless pieces; DM Serif Display titles, Inter 600 steps.",
    "One shot per beat; each title travels up 60 px with a 6 px capped overshoot over 18 frames. Subjects sit on the mid line (56%) and are scaled 1.45x together.",
    "Beat 1: the syringe slides from -500 px to 33% of the width over 21 frames (out); the shield outline draws on over 30 frames (smooth) from frame 20.",
    "Beat 2: the virus (r 110) pops on back over 14 frames, then at 45% of the beat splits into 3 grey fragments drifting 170 px out over 18 frames.",
    "Beat 3: three antibodies travel 150-250 px right toward the fragment, staggered 6 frames, 24 frames each (out).",
    "Beat 4: the virus sails from 95% to 62% of the width over half the beat (smooth); antibodies lock on in 16 frames (snap) and it turns grey.",
    "Beat 5: a rail draws down in 30 frames; three 100 px step lines slide 60 px in on show, build, remember. Beat 6: the shield draws in 26 frames, the check from frame 20.",
    "Bar: match every number, then make it as beautiful as possible; resting text crisp, nothing clipped or overlapping.",
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
      visual: "a drawn syringe slides in from the left; a teal shield outline draws on at the right",
    },
    {
      say: "It carries only a harmless piece of the virus, like a photo of a suspect.",
      label: "A harmless piece",
      visual: "a red spiked virus pops in at the centre, then splits into 3 small grey fragments that drift apart",
    },
    {
      say: "Your immune cells study that piece and build antibodies that fit it.",
      label: "Antibodies that fit",
      visual: "a teal immune cell on the left releases three Y-shaped antibodies that travel toward a grey fragment",
    },
    {
      say: "When the real virus shows up, your body can recognise it at once.",
      label: "Ready for the real virus",
      visual: "a red virus sails in from the right; antibodies lock onto it and it turns grey",
    },
    {
      say: "Show a harmless piece, build matching antibodies, and remember them for years.",
      label: "Three steps",
      visual: "a teal rail draws down the left; three big step lines slide in beside it on their cue words",
    },
    {
      say: "That memory is why one small shot can protect you.",
      label: "Protected",
      visual: "a teal shield draws on at the centre and a check mark draws inside it",
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
