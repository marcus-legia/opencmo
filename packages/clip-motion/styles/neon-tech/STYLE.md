# Neon tech

Data drawn as light on a deep black-blue. Use it for how software works: audio and video processing, AI and
automation, speed and precision. The subject is always a signal (a waveform, a timeline, a scan, a path), never a
device mock-up or clip-art.

## Palette
- Field `#04060C`. Light: cyan `#3BE8FF` for the signal, magenta `#FF3D7F` only for what is flagged or cut.
  Ink `#E8F1FF`, dim `#5A6B8C`. Glows are the same hue (drop-shadow 6 px + 22 px), never white.

## Background
- `fx.Fill` with a perspective grid in the lower 40% (13 converging lines, 9 rows that drift toward the viewer,
  cyan at 5-18%), `fx.Vignette` 0.5-0.6, `fx.Grain` 0.05. No gradients behind the subject.

## Type
- Kicker: `font="Source Code Pro"`, 600, tracking 0.2 em, 38 px, cyan with a soft glow.
- Headline and figures: `font="Space Grotesk"`, 700, tracking -0.03 em; headline about 11% of the width, figures 17%.
- Secondary: `font="Inter"` 500 in dim.

## Motion (30 fps)
- Signals draw on (36 frames, `smooth`), never fade in. A scan line (2 px ink with a cyan glow) sweeps once to
  "find" things; what it passes lights up.
- Edits are `snap` (24 frames): what is cut collapses, what remains closes up and re-centres.
- Figures count up with `out` over 26 frames. The glow breathes slowly (±15%, period ~2 s) so rests stay alive.

## Composition
- Kicker and headline top-left on an 8% margin; the signal across the middle (47%); the figure centred below (60%).
  Leave the bottom 17% for captions.

## Do / don't
- Do: draw real-looking data (seeded noise envelopes, not sine waves); label measured things in mono.
- Don't: icons, robots, circuit boards, lens flares, more than two hues of light, text inside the glow.
