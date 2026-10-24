# Talking-head seats: card, circle and aperture placed from the measured face (plan O8)

Status: **plan** (2026-10-24). Item O8 of [`2026-10-24-opus-animation-plan.md`](2026-10-24-opus-animation-plan.md),
planned separately as that plan asks. Nothing here is built yet.

## Why

A founder clip alternates two kinds of moment: the speaker owns the frame, and a visual owns it with the speaker
kept on screen. Today `set_layout` gives the second kind as splits (`split-top`, `split-bottom`, `pip`,
`side-by-side`, `visual-only`, `cell`). AI Producer's framing skill (opus-pro/ai-producer-plugin
`aip-framing/SKILL.md`, MIT) shows what a pro producer adds on top:

- **Seat forms**, not only splits: a `card` (a rounded window resting on an opaque ground), a `circle` (equal sides,
  the head centred), an `aperture` (a ground with a hole cut where the head is).
- **Positions per canvas**, from numbers, not taste: on 9:16 a card low-centred at about 78% of the width with the
  payload above, or a low-centred circle; on 1:1 a low or upper card, or a lower-corner circle at 30-36% of the
  width; on 16:9 a side-column card at 30-40% of the width with the payload beside it, or a lower-corner circle at
  22-28% of the height. Never a full-width speaker window on portrait footage (it draws the head at full source
  scale and crops a close-up).
- **The head stays whole** (crown to jaw, room to breathe): when it cannot fit, the seat narrows or deepens; the crop
  never picks which edge to cut. The seat fills at cover scale and no further.
- **A caption band per moment**: under a portrait seat the band sits between the payload and the seat (about y
  920-1110 of 1920); under a landscape seat it is the bottom band (y 800-890 of 1080). Where the ground is light, the
  caption takes a dark ink for that window. The caption never shrinks into the seat and never crosses the payload.
- **A seat arrives once per run**: adjacent moments sharing a framing keep the seat still; only the payload turns
  over. A new framing arrives at a beat boundary, from full frame or as a morph from the previous seat.

## What we have and what is missing

| Need | Today | Gap |
|---|---|---|
| Face position over time | `scene.marks.reframe.track` `[sourceSecond, focusX]` exists only in documents made before 2026-10-20: the engine's face pass (`steps/reframe.py`, MediaPipe) was removed with the clipping pipeline, and new uploads get no track | a new face pass on upload |
| Head height and size (crown, jaw) | not measured | the new pass keeps the detector's box: `[t, cx, cy, w, h]` |
| Speaker in a window | `set_layout` `pip` and `cell` (rect + `focus`) | shapes (radius 50%, a hole), per-canvas positions, head-fit rule |
| Caption per moment | one caption position per layer | a band (position + ink) per layout range |
| Morph between framings | layouts switch at range edges | animate box, crop and radius together over 0.3-0.5 s |

## Plan (each step its own PR, in this order)

1. **Measure the head** (engine + `clip-doc`). A face pass on upload, after the remux: low-resolution frames (2 per
   second, 320 px) streamed from one `ffmpeg` subprocess with the demuxer allowlist, MediaPipe's Tasks
   `FaceDetector` on each (MediaPipe left the engine's dependencies with the clipping pipeline and comes back as an
   optional extra), never more than one frame in Python memory (hard budgets 1, 2, 6); measured with
   `/usr/bin/time -v` on a 45-minute upload under the 2 GB peak. It writes the reframe mark's `track` again plus an
   optional `faces: [t, cx, cy, w, h][]` (source seconds, fractions of the source). Clips without `faces` fall back
   to `pip`. The `ffmpeg-ram-budget` skill applies. Test: an engine fixture with a known face position.
2. **Seat geometry** (`editor-core/src/layout.ts`, pure functions). `seatRect(form, position, canvas)` with the numbers
   above, and `seatCrop(rect, head, source)` → `objectPosition` + `fits` (the head box with 18% margin above and 12%
   below fits inside the rect at cover scale), returning a narrower rect when it does not. Unit tests per canvas and
   per form, including a head that only fits after narrowing.
3. **Modes** (`clip-doc` `LAYOUT_MODES`, `set_layout`, `rebuildLayout`). New modes `card`, `circle`, `aperture` with
   `position` (`low`, `mid`, `upper`, `left`, `right`, `corner-left`, `corner-right`, validated per canvas: an
   invalid one is refused with the allowed list). The ground is an opaque rect (brand background or a dark field),
   the speaker a muted view of the master clipped to the seat (the master keeps the sound, as `pip` does today), the
   panel region is the band the seat leaves. Aperture: an even-odd path hole on the head, from `faces`.
4. **Caption band per range** (`captions` + layout). Each layout range may carry `caption: { position, ink? }`;
   `rebuildLayout` derives it from the seat's band by default (the table above) and moves or re-inks the master
   captions inside that range only. Check (`check.ts`) gains `caption-crosses-panel`.
5. **Morph and runs** (`rebuildLayout`). Adjacent ranges with the same seat merge into one run (no re-entry);
   changing seat → morph box, crop and radius over 0.35 s on `glide`; from full frame → the seat grows from the
   speaker's own rect.
6. **Assistant** (`guides.ts` layout guide, tool descriptions, fake eval). The selection rule: seat when a visual
   owns the frame but the face carries trust; overlay (today's titles and visuals over full-frame footage) when the
   payload is small; full cover (explainer, B-roll) when the picture explains alone. Eval: a 9:16 founder clip
   where the agent seats the speaker in a low card under a chart and the captions sit in the band.
7. **Check by looking**: export a real 9:16 and 16:9 founder clip with each form; frames from the full-size file
   show the whole head in every seat and the captions in their band.

## Cost and order on the roadmap

About six PRs, three to four days (the face pass is the biggest; it also brings face tracking back to `set_frame`
and `punch_in` for new uploads, which today centre the frame). It should come after the active-speaker reframe work (it shares the face
measurement) and before more caption patterns: seats are what make a founder clip with visuals look produced,
which is the next OpenCMO marketing video after the product tour.

## Not doing

- Cutouts (the speaker cut free of the background): needs a matte per frame; out of the 2 GB budget for now.
- Second video sources in a seat (two speakers): one audible speaker only, as AI Producer also keeps.
