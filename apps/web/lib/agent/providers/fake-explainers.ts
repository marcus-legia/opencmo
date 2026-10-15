/**
 * The explainers the fake model makes (`docs/explainer-v2-build.md`, C1/C5): storyboards with a
 * `visual` per beat, and scene code written only with the kit, as a model following the guide would.
 *
 * - `SHOWCASE_EXPLAINER`: Track A's v1 showcase (Shazam), with the pictures its code draws.
 * - `VACCINE_EXPLAINER`: the v2 acceptance prompt, subject first: every noun of the narration is a
 *   Lucide icon (`virus`, `syringe`, `shield-check`, `dna`, `microscope`), one `Headline` row, a
 *   `Board` for the steps, the `paper` theme and the `playful` personality.
 */

import showcase from "../../../../../packages/clip-motion/fixtures/showcase.job.json";

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

const VACCINE_CODE = String.raw`const { Stage, Camera, Title, Headline, Board, Icon, Link, Check } = kit;
const b = kit.beat;
const full = kit.area('full');
const top = kit.area('top');
const left = kit.area('left');
const right = kit.area('right');
const headline = full.y + full.h * 0.07;
const mid = full.y + full.h * 0.55;
const fragments = [-1, 0, 1].map((k) => ({ x: full.x + full.w * (0.5 + k * 0.15), y: mid + k * 40 }));

return function Scene() {
  return (
    <Stage>
      <Camera keys={[{ at: b(2).from, zoom: 1.05, focus: [full.x + full.w / 2, mid] }, { at: b(4).from, zoom: 1 }]}>
        <Icon name="syringe" x={left.cx} y={mid} size={340} at={kit.at(0, 0.3)} exitAt={b(2).from} />
        <Icon name="shield-check" x={right.cx} y={mid} size={340} color="answer" at={kit.cue(0, 'immune')} exitAt={b(1).from} />
        <Icon name="virus" x={full.x + full.w / 2} y={mid} size={360} color="wrong" at={b(1).from + 6} exitAt={kit.cue(1, 'harmless')} />
        {fragments.map((f, i) => (
          <Icon key={i} name="virus" x={f.x} y={f.y} size={150} color="noise" at={kit.stagger(i, { at: kit.cue(1, 'harmless'), each: 5 })} exitAt={b(3).from} />
        ))}
        <Icon name="microscope" x={left.cx} y={mid} size={320} at={b(2).from + 6} exitAt={b(3).from} />
        <Link from={[left.cx + 170, mid]} to={[fragments[0].x - 80, fragments[0].y]} at={kit.cue(2, 'study')} exitAt={b(3).from} />
        <Icon name="dna" x={right.cx} y={mid} size={320} color="signal" at={kit.cue(2, 'antibodies')} exitAt={b(3).from} />
        <Icon name="virus" x={left.cx} y={mid} size={320} color="wrong" at={b(3).from + 6} exitAt={b(4).from} />
        <Icon name="shield-check" x={right.cx} y={mid} size={360} color="answer" at={kit.cue(3, 'recognise')} exitAt={b(4).from} />
        <Icon name="syringe" x={right.cx} y={mid} size={320} at={b(4).from + 6} exitAt={b(5).from} />
        <Check x={full.x + full.w / 2} y={mid} size={260} at={b(5).from + 10} />
      </Camera>

      <Title text="How a vaccine trains your body" kicker="Immune system" y={top.cy} exitAt={kit.at(0, 0.6)} />
      <Headline
        items={[
          { text: 'Training, not fighting', at: kit.at(0, 0.65) },
          { text: 'A harmless piece', at: b(1).from },
          { text: 'Antibodies that fit', at: b(2).from },
          { text: 'Ready for the real virus', at: b(3).from },
          { text: 'Three steps', at: b(4).from },
          { text: 'Protected', at: b(5).from },
        ]}
        y={headline}
      />
      <Board
        title="How it works"
        kind="steps"
        area={left}
        lines={['Show a harmless piece', 'Build matching antibodies', 'Remember for years']}
        at={kit.at(4, 0.05)}
        lineAt={[kit.at(4, 0.1), kit.cue(4, 'antibodies'), kit.cue(4, 'remember')]}
        exitAt={b(5).from}
      />
    </Stage>
  );
};`;

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
      visual: "a microscope icon links to a fragment; a dna icon appears on the right",
    },
    {
      say: "When the real virus shows up, your body can recognise it at once.",
      label: "Ready for the real virus",
      visual: "a red virus icon enters left; a large shield-check icon blocks it on the right",
    },
    {
      say: "Show a harmless piece, build matching antibodies, and remember them for years.",
      label: "Three steps",
      visual: "a steps board on the left reveals three lines one by one; a syringe icon stands on the right",
    },
    {
      say: "That memory is why one small shot can protect you.",
      label: "Protected",
      visual: "a check mark lands in the centre",
    },
  ],
  code: VACCINE_CODE,
  format: "16:9",
  theme: "paper",
  personality: "playful",
};

/** The vaccine explainer for vaccine topics, the showcase for everything else. */
export const explainerFor = (ask: string): FakeExplainer => (/\bvaccin/i.test(ask) ? VACCINE_EXPLAINER : SHOWCASE_EXPLAINER);
