# Editorial

A magazine spread in motion. Use it for founder stories, opinions, lessons and principles: anything that should feel
considered and human rather than techy. Type does most of the work; one drawn element per spread at most.

## Palette
- Paper `#EFE9DD` → `#E6DECF`, ink `#1A1A1A`, muted `#6F675C`, one accent vermilion `#E4572E` (or the brand colour,
  if it is saturated). Accent on one word or one element per spread, never more.

## Background
- Flat warm paper (`fx.Fill` gradient), heavy grain (0.06-0.08), a faint warm vignette (0.15-0.2). A hairline
  6-column grid (ink at 6%) and a 2 px rule under the folio. Nothing glows, nothing is blurred.

## Type
- Display: `font="DM Serif Display"` (or Playfair Display), weight 400, tracking -0.02 em, very large: 25-60% of the
  frame width. Captions and asides: `font="Fraunces"` italic 400, 40-48 px.
- Folio: `font="Inter"`, 500-600, UPPERCASE, tracking 0.16 em, 36 px: "No. 01" left, a section name right.

## Motion (30 fps)
- Lines rise out of their own baseline masks (`overflow: hidden` per line), 16 frames on `out`, staggered 5 frames.
- Rules draw on (`kit.drawOn`, 20 frames, `smooth`). Small elements fill or type in; nothing bounces.
- Between spreads: a hard cut (one Shot ends, the next starts). Within the video: a very slow push (1 → 1.035).

## Composition
- Left-aligned on an 8% margin, on the 6-column grid. Folio at 10%, display type from 17-35%, the drawn element
  around 60%, a caption near 74%. Big contrast of scale: one giant word or number, everything else small.

## Do / don't
- Do: let one word or number be enormous; leave real white space; set captions in italic serif.
- Don't: centre everything, use gradients or glow, animate letters one by one, use icons, add a second accent.
