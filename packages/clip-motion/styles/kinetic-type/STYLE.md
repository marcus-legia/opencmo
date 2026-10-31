# Kinetic type

Type is the picture. Use it when a beat has no physical subject (a promise, a claim, a number, a call to action), for
hooks, and for launch lines. One idea per screen, three rows at most, set big.

## Palette
- Field `#141617` (warm near-black), ink `#EEF0EA`, muted `#8D938F`, one accent `#C9EF8A` (lime) on the word that
  carries the meaning. A light variant: field `#F2F0EA`, ink `#141617`, accent `#FF5A36`. Never more than one accent.

## Background
- A flat field with `fx.Vignette` (0.4-0.55) and `fx.Grain` (0.05-0.07). Hairline rules (1-1.5 px, ink at 5-14%)
  frame the type: one under the kicker, one over the footer, faint row guides. No gradients, no shapes.

## Type
- `font="display"`, weight 800, tracking -0.045 em, line height 1.02, ALL CAPS for the rows. Row size about 16% of the
  frame width (176 px at 1080 wide). Left-aligned on a margin of about 8% of the width.
- Chrome: a small kicker (34 px, weight 700, tracking 0.18 em) with a 16 px accent dot; a footer line (34 px, muted).

## Motion (30 fps)
- Entrance: each word travels in from the right about 1.3 frame widths over 22 frames with `kit.travel` (overshoot
  capped at 24 px), rows staggered by 3 frames, wrapped in `Streak` so it smears in motion and is crisp at rest.
- Hand-over: the next phrase pushes the old one out, row by row (2-frame stagger, 21 frames, `kit.snap` with 14 px of
  overshoot) through a feathered seam mask, so the two phrases never overlap.
- A slow push on the type block for the whole clip (scale 1 → 1.045, linear, from the left margin) keeps resting rows
  alive; the chrome stays fixed. Hold the resting rows at least 1.2 s.

## Composition
- One column, left edge fixed. The rows sit in the vertical centre; the kicker in the top 10%, the footer near 86%.
  Each row is its own `overflow: hidden` window: words enter and leave through its edges.

## Do / don't
- Do: measure words with `kit.measure` to place seams and streaks; accent only the last word of the phrase.
- Don't: centre-align rows, animate letters one by one, add icons, rotate type, use more than one font.
