# Paper cutout

Layers of cut paper with real shadows, entering with parallax and a slight stop-motion step. Friendly and handmade:
use it for consumer and lifestyle topics, health and habits, education, and journeys or plans over time.

## Palette
- Sky `#FCE9D8` → `#F8D7C0`; four layers from light to dark in one warm family (`#F4B183`, `#E8875E`, `#C9634A`,
  `#8E3F3A`); paper white `#FFF8EE`; ink `#3A2421`; one bright accent `#FFCF5C`. For a cool brand use the same
  structure in blues or greens: light → dark layers, one warm accent.

## Background
- A soft sky gradient (`fx.Fill`), heavy grain (0.07-0.09). Depth comes only from stacking and shadows: every paper
  piece gets `drop-shadow(0 10px 14px rgba(70,30,20,0.28)) drop-shadow(0 2px 3px rgba(70,30,20,0.25))`.

## Type
- `font="Archivo Black"` (or Anton for tall type), UPPERCASE, about 10% of the width, on a paper strip that is slightly
  rotated (-2°) and casts the same shadow. One word may take a layer colour.

## Motion (on twos: 15 poses a second)
- Hold every pose for two frames (`f - f % 2`) and add a 2-3 px seeded wobble per pose (`kit.noise`): it reads as
  stop-motion, not as a glitch.
- Layers slide up from 35-50% of the height, back to front, 4 frames apart, 18 frames on `out` (parallax: the far
  layers travel less). Pieces pop on `back` (10-14 frames). Paths reveal along their length.

## Composition
- Big horizon bands in the lower half (layer tops from 50% to 74%), a sun or object behind them in the upper right,
  the title strip top-left on an 8% margin. Leave the bottom 17% for captions (the dark front layer may fill it).

## Do / don't
- Do: few, big shapes; curved hand-cut edges (Bézier hills, not sine lines); shadows on every piece.
- Don't: gradients on the paper, outlines, glow, smooth 30 fps motion, photos, icons.
