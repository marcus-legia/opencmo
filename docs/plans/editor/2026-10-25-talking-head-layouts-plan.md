# Talking-head layouts that work in 16:9 and 9:16 (the base for every talking-head template)

Status: **built** (2026-10-25), steps 1-5; speaker framing inside a band is the next item (seats plan). Owner ask: many video templates like the reference reels (talking head with a
visual above or beside it, 9:16) and YouTube-style videos (16:9, the speaker in a small corner over the visual) must
come out of the editor, so the layout layer has to be right first. Extends
[`2026-10-24-talking-head-seats-plan.md`](2026-10-24-talking-head-seats-plan.md) (O8), which plans the seat shapes.

## What a render of every layout showed (2026-10-25)

Ten layouts rendered (16:9 and 9:16 × split-top/bottom, pip in two corners, side-by-side left/right, visual-only), each
with a chart over a spoken range and the clip's captions, frames looked at:

1. **16:9 pip is a portrait layout in a landscape frame.** The corner cell is 36% of the width (691 px of 1920, a third
   of the frame), and `panelRegionAt` leaves the visual a thin strip above the cell: the chart is squashed to a line.
2. **Captions move only for split-top/bottom** (`seatCaptions`). In pip and side-by-side they stay centred, over the
   chart or straddling the two columns.
3. **The panel is always `#0F172A`**: never the brand's colours, never the light background of the speaker's room.
4. **Wrong layouts for the canvas are allowed**: top/bottom on 16:9 crops the speaker to a band, a side column on 9:16
   is too narrow for the speaker or a visual. AI Producer's framing rules (`aip-framing/SKILL.md`, MIT) list exactly
   these as "do not use".
5. **`add_explainer` places only top/bottom**: no animation in the visual column, none behind a corner speaker.

## Plan (in order, each committed with tests and a render looked at)

1. **Canvas-aware geometry** (`editor-core/src/layout.ts`, `set_layout`).
   - pip default size by canvas: 9:16 keeps 0.36 of the width; 16:9 and 1:1 use 0.24 (a YouTube facecam, about 460 px
     of 1920).
   - `panelRegionAt` for pip on a landscape or square frame: the visual takes the side away from the cell, full height
     (portrait keeps the band above or below the cell).
   - The guide's table says which layout for which canvas (top/bottom splits are for 9:16, side-by-side for 16:9).
     Not refused in the op: side-by-side on 9:16 is an existing feature (tests and possibly users rely on it).
   - pip and the side column crop around the measured face (`speakerFocusX`) on landscape frames, where the video is
     not panned to the face.
2. **Captions per layout** (`seatCaptions`): pip → the bottom of the visual area, clear of the cell (16:9: centred in
   the visual side near the bottom; 9:16: above the cell's row); side-by-side → the bottom of the speaker's column.
   Same 0.3 s moves as the layout; still only an `offsetY`/`offsetX` track on the clip's own captions.
3. **Panel colour** (`LayoutRange.background`, `set_layout { background }`): any hex; default the brand kit's
   background when the clip has one, else today's dark. Light grounds flip nothing else (visuals keep their own
   colours).
4. **`add_explainer` places**: `left`/`right` (side-by-side, the animation in the visual column) and `behind` (pip:
   the animation full frame, the speaker in a corner cell), next to `top`/`bottom`.
5. **Look again**: the same ten renders, plus the new places, frames in `2026-10-25-talking-head-layouts-frames/`.

**Built (2026-10-25).** All five steps, plus two found while looking at the renders: drawn visuals on a light panel
take dark text (`onGround` in `ops/visuals.ts`), and the captions take a dark ink over a light panel (a `color` track,
AI Producer's caption `ink`). The split's visual area stops short of the seam so a chart's axis labels and the captions
never meet. Frames: `2026-10-25-talking-head-layouts-frames/landscape.jpg` (16:9 pip, side-by-side, explainer right and
behind) and `portrait.jpg` (9:16 splits, pip, the light "reels" split). Still wrong: on 9:16 `split-top` the speaker's
head is cropped in its band (the band keeps the 9:16 zoom) - next, from the measured head (seats plan step 2).

Later (the seats plan): speaker framing inside a band from the measured head (today the band keeps the 9:16 zoom),
circle/aperture shapes, morphs between layouts.

## Not doing

- New layout kinds before these work in both canvases.
- Templates as fixed documents: a template is a recipe of ops (layout + visuals + captions style) the Assistant runs.
