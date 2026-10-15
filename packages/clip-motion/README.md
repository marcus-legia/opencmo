# clip-motion

Explainer animations rendered with [Remotion](https://www.remotion.dev) on the worker. The Assistant writes a
short scene with the **motion kit**; this package compiles it, renders stills for review, and renders the
final MP4 (with the narration muxed in). The result is generated media on the clip, like 3D Studio: it is not
editable in the editor.

```
clip-motion preview <job.json> <outdir>                      → PreviewResult JSON (half-size JPEG stills + layout issues)
clip-motion render  <job.json> <out.mp4> [--audio voice.mp3]  → {"frames","seconds","msPerFrame"}
clip-motion serve                                            → {"ready":true}, then one PreviewResult line per
                                                               stdin line {"job": MotionJob, "outdir": "…"}
```

Exit codes: 0 ok (a preview with layout issues is still 0) · 2 bad arguments · 3 invalid job · 4 the scene
code failed (last stderr line is the message for the agent; never retried) · 1 anything else.

| Env | Use |
|---|---|
| `OPENCMO_MOTION_SCALE` | 0.25–1, dev only (smaller, faster renders) |
| `OPENCMO_MOTION_CHROME` | Chrome Headless Shell path (default: the newest in `/opt/pw-browsers`, else Remotion downloads one) |
| `OPENCMO_MOTION_CONCURRENCY` | render tabs, default 2 |
| `OPENCMO_MOTION_GL` | Chromium GL backend, default `angle` (`angle-egl` on a GPU; `swangle` is 5× slower on CPU) |
| `OPENCMO_MOTION_CACHE` | bundle cache dir, default `$TMPDIR/opencmo-motion` |
| `OPENCMO_EDITOR_FONTS` | fonts dir, default `packages/clip-media/fonts` |
| `OPENCMO_MOTION_ICONS` | Lucide icon data, default `packages/clip-icons/data/icons.json` |
| `OPENCMO_MOTION_LOTTIE` | built-in Lottie animations, default `packages/clip-media/lottie` |

Fonts, icon data and Lottie files are copied into one public dir of the Remotion bundle (`src/assets.ts`), so
scenes load them from the local bundle server and never from the network.

The job contract (`MotionJob`, `PreviewResult`, `estimateDuration`) is in `src/job.ts` and
`docs/explainer-build.md`. `fixtures/showcase.job.json` (v1) and `fixtures/vaccine.job.json` (v2) are the reference scenes.

## Scene code

The scene is the **body** of `(React, R, kit) => { …; return function Scene() { … } }`. JSX and TypeScript
annotations are allowed; imports are not.

- `R` is a safe part of Remotion: `AbsoluteFill`, `Sequence`, `Series`, `Freeze`, `Loop`, `useCurrentFrame`,
  `useVideoConfig`, `interpolate`, `interpolateColors`, `spring`, `measureSpring`, `Easing`, `random`.
- Not allowed (rejected with the line number): `fetch`, `XMLHttpRequest`, `WebSocket`, `import`, `require`,
  `eval`, `Function`, `Date`, `Math.random`, timers, `document`, `window`, storage, `constructor`, Remotion media
  and render control. Every render of a job must be identical: randomness comes from `kit.random(seed)` or the
  seeded data helpers, time comes from the frame.
- Compute data once above `return function Scene()`; inside `Scene` only compose kit components.

## Kit API

All positions are pixels in the composition (1920×1080, 1080×1920 or 1080×1080). All times are **frames**
(30 fps), almost always taken from the timing helpers. Every component accepts `at` (enter frame), `dur` (enter
length), `exitAt` and `exitDur`; before `at` and after its exit it renders nothing.

### Layout
- `<Stage grid? ambient?>` – the field of the job's theme: `blueprint` (navy, drifting grid, bloom, vignette) or
  `paper` (warm off-white, faint grid, soft shadows instead of glows). Wrap the whole scene in it. `ambient`
  adds soft motes drifting behind everything (the ambient motion layer); on by default when the job sets a
  personality.
- `<Camera keys={[{ at, focus: [x, y], zoom, dur? }]}>` – slow push-ins and pans of everything inside; each key
  eases (critically damped) from the previous framing. Keep text outside the Camera.
- `kit.area('full' | 'hero' | 'left' | 'right' | 'top' | 'bottom')` → `{ x, y, w, h, cx, cy }` inside the safe
  area (6% margins, bottom 17% kept free for captions). Any `{ x, y, w, h }` works wherever an area is taken.
- `kit.place(area, [u, v])` → pixels of a normalised point (y down). `kit.plot(area, [u, v])` → pixels of a data
  point in the plot of `area` (y up), aligned with `Axes`, `Scatter` and `FitLine`.
- `kit.width`, `kit.height`, `kit.portrait`, `kit.fps`, `kit.frames`, `kit.beats`.
- `kit.theme` (`blueprint` | `paper`) and `kit.personality` (`premium` | `corporate` | `playful` | `energetic`), from
  the job's optional `theme` and `personality` (defaults `blueprint` and `premium`). A job without them renders
  exactly as in v1.

### Text (labels of at most 5 words)
- `<Title text kicker? y? size?>` – big serif headline, words rise in one by one.
- `<Label text x? y? area? anchor? size? color? swapTo? swapAt? strikeAt?>` – the main on-screen words. `swapTo`
  replaces the text at `swapAt`; `strikeAt` strikes it through in the "wrong" colour.
- `<Mono …same>` – data text such as `f1 | f2 | gap`, typed in.
- `<Counter to from? count? x? y? size? prefix? suffix? decimals?>` – a number counting up.

### Data and marks
- `<DotField count? seed? area? layout="scatter|grid|cluster" points? size? glow? filterAt? threshold? morphTo? morphAt?>`
  – up to 4000 glowing dots. `filterAt`: dim dots fade to noise, bright ones (≥ `threshold`) flare.
  `morphTo` (normalised points): dots fly there from `morphAt`.
- `<Spectrogram data={kit.spectrogram(seed, { cols, rows, peaks })} area? peaksAt? constellationAt?>` – a
  time × pitch heat map that sweeps in; `peaksAt` dims all but the peaks, `constellationAt` keeps only peaks.
  `data.peaks[i].x/y` are normalised: `kit.place(area, [p.x, p.y])`.
- `<Waveform area? seed? noise? cleanAt? amp?>` – breathing audio bars; `noise` mixes in grey noise, `cleanAt`
  removes it.
- `<Axes area x? y?>`, `<Scatter area points={[{ x, y }]} highlight? highlightAt?>`,
  `<FitLine area from={[u, v]} to={[u, v]}>` – a plot; `kit.trend(seed, { n, slope, spread })` gives points.
- `<Link from={[x, y]} to={[x, y]} curve? dashed? dots? width?>` – a line that draws itself.
- `<Box area | x y w h label? dashed?>` – a highlighted region.
- `<Check x y size kind="check|cross">` – a ring and a check (or a cross).
- `<Icon name x y size color?>` – a line icon that draws itself. Any of the ~1,850 Lucide names of
  `packages/clip-icons` (`virus`, `syringe`, `shield-check`, `dna`, `microscope`…; the Assistant searches them
  with `find_icons`). The 16 v1 names (`kit.icons`: mic, music, phone, search, database, wave, bolt, user, lock,
  server, cloud, chart, clock, globe, key, play) keep their v1 drawings. An unknown name fails with the 5 closest
  names.
- `<Lottie name x? y? size? loop? speed?>` – a built-in animation that plays from `at` in step with the frame:
  the OpenCMO pack (`walk`, `run`, `wave`, `point`, `cheer`, `heart-beat`, `lightbulb-on`, `rocket-launch`,
  `target-hit`, `confetti`…, CC0) and the Noto animated emoji (`emoji/brain`, `emoji/robot`, `emoji/rocket`…,
  CC BY 4.0). `kit.lotties` lists every name (the Assistant searches them with `find_lotties`). Pops in like the
  other marks; `loop` defaults to true, `speed` 0–4. Costs about 5 ms per frame for three on screen.

### Text board (v2)
- `<Headline items={[{ text, at, color? }]} y? size? exitAt?>` – the one headline row (≤ 6 words each). Each item
  has fully left before the next rises in, so headlines never overlap. Use it instead of several `Label`s.
- `<Board kind="steps|facts|compare" title? lines={['…']} area? lineAt? at exitAt>` – up to 3 lines of ≤ 8 words,
  revealed one by one; `compare` lines are `"left | right"`.
- Text `exitAt` (Title, Label, Mono, Counter, Board) is the frame the text is **gone by**; a `swapTo` now replaces
  the words in turn (old out, then new in).

### Shapes and motion (v2)
- `<Shape kind x? y? size? color? color2? fill? label? secondary? breathe? rotate? seed?>` – `kind` is one of
  `kit.shapes`: `circle`, `cell` (membrane + nucleus), `blob` (organic, breathes), `ring` (draws on), `pill`,
  `capsule` (two colours: `color`, `color2`), `star`. Pops in with the personality's wind-up and overshoot.
  `label` (≤ 3 words) sits under it; `secondary` adds a halo that follows a few frames late.
- `<Path d x? y? size? color? fill? draw? width?>` – any SVG path in a 24×24 box, drawn on (for shapes the kit
  does not have).
- `<Arrow from={[x, y]} to={[x, y]} curve? color? width? dashed? head?>` – draws itself, the head pops in as it lands.
- `<Group x? y? keys={[{ at, x?, y?, scale?, rotate?, dur? }]} react={{ at, from: [x, y], strength? }}>` – moves its
  children together. Key `x`/`y` are offsets in pixels from where the children are drawn; `x`/`y` of the group is
  the pivot for scale and rotate. `react` knocks the group away from `from` at `at` and lets it settle.
- `<Burst at x? y? count? size? color? seed?>` – a 24-frame particle burst for an impact or a success.

### Timing
- `kit.beat(i)` → `{ from, to, frames }` of beat `i`.
- `kit.cue(i, 'word')` → the frame where that word of beat `i` is spoken (first word of a phrase; the beat start
  when the word is not in it).
- `kit.at(i, 0..1)` → a frame part-way through beat `i`.

The preview uses estimated timings (2.4 words/s); the final render uses the real word timings of the voice, so
anything placed with these helpers lands on the narration in both.

### Motion and colour
- `kit.enter(frame, { at, dur, ease })` → 0..1, `kit.stagger(i, { at, each })`, `kit.morph(a, b, t)`,
  `kit.lerp`, `kit.random(seed)` (a seeded `() => number`).
- `kit.ease.out` (power3), `kit.ease.hero` (critically damped spring), `kit.ease.inOut`, `kit.ease.linear`. Nothing
  bounces.
- `kit.color.signal` gold (what we follow) · `answer` teal (the result; the Brand Kit accent replaces it) ·
  `wrong` red · `noise` grey-blue · `text` · `dim` · `field` · `ink` (outlines) · `accent2` (a second neutral
  highlight) · `soft` (panels). Each theme has its own values with the same meanings. Pass a name
  (`color="answer"`) or `#rrggbb`.

### Look and personality (v2)
The job's `theme` and `personality` set the look and the tempo for the whole video; the scene code never picks
easing or durations.

| theme | for |
|---|---|
| `blueprint` | tech, data, software, signals, money flows |
| `paper` | science, health, people, how-to, everyday topics |

| personality | entrances | for |
|---|---|---|
| `premium` | 22 frames, no overshoot | serious, finance, B2B |
| `corporate` | 16 frames, 3% overshoot | business, product walkthroughs |
| `playful` | 15 frames, wind-up + 14% overshoot | consumer, science for everyone |
| `energetic` | 10 frames, 20% overshoot | launches, sport, sales |

Every entrance gets the personality's wind-up (anticipation) and overshoot for scale and position, while
opacity and drawing stay monotone. Marks keep three motion layers: the primary entrance, a `secondary` halo or
follow on shapes, and the Stage's ambient layer. A job without `personality` keeps v1 timings exactly.

### Preview layout report (v2)
Stills at beat midpoints are returned to the Assistant; extra layout samples (6 frames after each beat starts,
and every beat's midpoint, at quarter size) are only measured. Issues: text over text, outside the safe area,
text under 36 px, a frame more than 85% empty, **a beat with no picture** (no icon, shape, Lottie, path or data
mark; a Board alone does not count) and **a beat where nothing moves** (Lottie, dot fields and blobs move inside
their box and are not reported).

## Example

The full v2 reference scene is `fixtures/vaccine.scene.jsx` (paper, playful: icons, a cell shape, a Group that
is knocked back, bursts, a steps Board, a Lottie). A short one:

```jsx
const { Stage, Title, Label, DotField, Check } = kit;
const b = kit.beat;
const field = kit.area('full');

return function Scene() {
  return (
    <Stage>
      <Title text="Why most leads go cold" exitAt={kit.at(0, 0.6)} />
      <DotField area={field} count={1200} seed={4} at={kit.at(0, 0.5)} filterAt={kit.cue(1, 'reply')} threshold={0.85} />
      <Label text="Thousands of visitors" y={field.y + 60} at={b(1).from} swapTo="A few reply" swapAt={kit.cue(1, 'reply')} />
      <Check x={kit.width / 2} y={kit.height * 0.45} at={b(2).from + 10} />
    </Stage>
  );
};
```

## Do and don't (for the guide)

- **One continuous scene.** Transform what is on screen (swap a label, filter the dots, morph, push the
  camera) instead of cutting to something new. About one change per beat.
- **At most three things move at once.** Start the next only when the previous has landed.
- **Subject first.** Every beat shows the things its narration names: an icon (`find_icons`), a built-in Lottie
  (`find_lotties`) or a kit shape. Never an icon whose name does not match the noun.
- **One `Headline`** for the headline row (≤ 6 words an item); a `Board` when a beat lists steps, facts or a
  comparison. Text `exitAt` is when the text is gone, so the next one can enter at that frame.
- **Three motion layers** each beat: the primary change, a secondary reaction (a halo, a `Group react`, a
  `Burst`), and the ambient Stage.
- **Colour has meaning**: gold = signal, teal = answer, red = wrong, grey = noise. Do not pick other colours.
- Place every change on the narration with `kit.cue` / `kit.at`, never with hard-coded frame numbers.
- Keep text outside `Camera`, and visuals inside the safe area (the preview reports what leaves it).
- Fix every issue the preview reports, and look at every still: overlapping text, empty frames and things off
  screen are the common failures.
- Don't use `Sequence` to time things (it shifts frames for everything inside); use `at`.

## Development

- `npm run check:clip-motion`: typecheck, unit tests and golden stills of the showcase (blueprint) and the vaccine
  scene (paper) (needs ffmpeg and Chrome Headless Shell 1194; `UPDATE_GOLDEN=1` rewrites `fixtures/golden/`, look
  at the images before committing).
- Edit `fixtures/<name>.scene.jsx`, then `node scripts/build-showcase.ts` embeds it into `<name>.job.json`.
- `node scripts/bench.ts <job.json> <from> <to> [gl] [concurrency]`: ms/frame for a frame range, to compare GL
  backends or concurrency before changing the defaults.

After changing `packages/clip-media/lottie`, run `node scripts/build-lotties.ts` (a test keeps `src/kit/lotties.ts`
equal to the folder).
