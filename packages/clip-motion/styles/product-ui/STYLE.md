# Product UI

The product is the subject. Use it for feature launches, demos and how-tos: show the real interface doing the one
thing the feature does, then confirm the result. With the user's screenshots, put them in `Image` (or `Phone` /
`Browser`); without them, build the relevant part of the UI in code as here — never a fake competitor UI.

## Palette
- Field `#F1F2EE` → `#E4E7E1` (warm light grey), surfaces `#FFFFFF`, ink `#16181D`, muted `#6B7280`, one brand accent
  (`#FF5A36` for OpenCMO), one state colour where the feature needs it (amber `#F5A524` for "flagged").

## Background
- A plain light field (`fx.Fill` with a subtle top-to-bottom gradient) and grain at 0.03-0.04. No patterns: the UI's
  own detail is the texture. Shadows do the depth: three layers (1-2 px, 12-24 px, 40-80 px blur, 6-14% black).

## Type
- Headline above the product: `font="Plus Jakarta Sans"`, 800, tracking -0.035 em, about 9.5% of the width.
- Sub-line and all UI text: `font="Inter"`, 500-600. UI text big enough to read on a phone (30-54 px at 1080 wide).

## Motion (30 fps)
- The window rises 120 px and un-tilts from rotateX 16° to 0 (perspective 1600, from its bottom edge) over 28 frames
  on `out`. A slow push on the product layer (1 → 1.04 over the clip).
- The cursor glides on `smooth` (22 frames), presses for 6 frames (scale 0.86), and the UI answers within 2-4 frames.
- UI changes are `snap` (about 22 frames): items shrink and the rest close up — layout, not fades.
- Confirmation: a dark pill toast rises 80 px on `back` (18 frames).

## Composition
- Headline in the top 15-25%, the window sized to its content at about 36-61%, the toast near 74%; side margins about 8%.
  Leave the bottom 17% for captions.

## Do / don't
- Do: real copy in the UI (a file name, real words); one action per beat; the cursor moves in straight eased lines.
- Don't: dark mode with glow, stock device mock-ups around code-built UI, emoji, more than one accent, fake numbers.
