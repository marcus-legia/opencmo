# Gradient flow

A living colour field and one big number. Use it for results, growth, money and anything a SaaS or AI product
claims with a figure. The field never stops moving, so even a still beat feels alive.

## Palette
- Field: deep base `#0E0B24` with three blobs `#5B3DF5` (violet), `#FF6A3D` (orange), `#14B8A6` (teal). For a brand,
  swap the blobs for the brand colour and its two neighbours on the colour wheel; keep a dark base.
- Ink `#FFFFFF`, soft ink `rgba(255,255,255,0.72)`. Fills: a warm white gradient (`#FFD3B8 → #FFFFFF`) with a glow.

## Background
- `fx.GradientField` (speed 1-1.5, softness 150-190), `fx.Vignette` tinted with the base (0.3-0.4), `fx.Grain` 0.05.
- One `fx.LightSweep` near the end (18°, white at 25-30%) as the finishing sheen. Never two.

## Type
- The number: `font="Unbounded"`, weight 800, tracking -0.04 em, about 30% of the frame width, centred, line height 1.
- Labels: `font="Inter"`, weight 600, small caps feel (UPPERCASE, tracking 0.12-0.16 em), 38-42 px, soft ink.

## Motion (30 fps)
- The number rolls from 0 to its value over 34 frames on `out` while rising 40 px and fading in; it shows one decimal.
- Glass capsules enter 8 frames before they fill (fade + 24 px rise on `soft`), then fill over 26 frames on `out`,
  staggered 7 frames. Values appear when their capsule is most of the way full.
- Hold everything still after it lands; the field keeps flowing underneath.

## Composition
- Centre column: label at 17%, number at 20-34%, capsules from 50% down with 2.8% gaps, inside 9% side margins.
  Leave the bottom 17% for captions.

## Do / don't
- Do: frosted glass (`backdropFilter: blur(24px)`, white at 10%, a 1.5 px white border at 28%, a soft shadow).
- Don't: flat solid backgrounds, more than one number this big, pie charts, icons, a second accent colour.
