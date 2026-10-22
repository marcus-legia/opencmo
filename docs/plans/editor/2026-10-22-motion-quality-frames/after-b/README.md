# After Session B (Task B6): two real OpenCMO clips

Both clips start from Session B's templates. Only their `SLOTS` were edited; the motion, direction and beats are the
templates' own. Both are silent `motion-clip` jobs: kind `clip`, beats timed by their seconds, no voice track
(`ffprobe` shows a single video stream).

| File | What |
|---|---|
| `opencmo-logo-reveal.mp4` | **Logo reveal**, 16:9, 4 s, from `mark-lockup`. Slots: the OpenCMO mark, "OpenCMO", "Your AI marketing team.", background `#141A36`. |
| `logo-reveal-{1,2,3.96}.jpg` | Full-size frames at 25%, 50% and the last frame. |
| `opencmo-phone-carousel.mp4` | **Phone carousel**, 9:16, 5 s, from `phone-carousel`, with three real OpenCMO screens. |
| `phone-carousel-{1.25,2.5,4.96}.jpg` | Full-size frames at 25%, 50% and the last frame. |

**Material.** The logo is `apps/web/public/icon.svg`, rendered to a transparent 1024 px PNG. The three screens are
the landing page of this branch (`next dev`) captured at 390×844 @2x: the hero, "Three departments" and "One team.
One price.". Both went through the worker's `motion_assets` encoder before the render. The logo stayed PNG with
alpha; the screens became JPEG at their 780×1688 size.

## Logo reveal

- Rounds: 1 preview (9 chosen stills, no issues). The full-size render then showed a hard-edged dark band under the
  tile at rest. The template kept a CSS motion-blur filter on even at zero blur, and the filter region clipped the
  tile's soft shadow. Fixed in the template (the filter is only on while the tile moves, as in the remake), then
  re-rendered.
- Render: 120 frames, 14 s, 94-103 ms/frame. **Peak RAM: 569 MB** single process, **1,021 MB** process tree.
- What still could be better: the tagline is the remake's quiet grey. It reads, but a brand accent on one word
  would land harder.

## Phone carousel

- Rounds: 2. The first render had the phone's island covering the top of each web page (the "OpenCMO · START FREE"
  header). Fixed in `kit.Phone`: a phone with an image now keeps a status bar strip (14% of the screen width) under
  the island, so the screenshot starts below it, as on a real phone. The golden test checks it.
- Render: 150 frames, 15 s, 88-93 ms/frame. **Peak RAM: 581 MB** single process, **1,771 MB** process tree. Under
  the 2 GB budget, but the closest of all renders in this plan.
- What still could be better: in 9:16 the phones fill only the middle ~900 px of the 1920 px height. A headline
  above, or a second row, would use the space; the template keeps the remake's single band.

## Compared with the remakes

The Opus CDN that hosts each remake's `compare.jpg` is blocked from the cloud session (proxy 403), so the ports were
checked against their `TASK.md` numbers and code instead of side by side with the remake's video:
- mark-lockup: tile 384 px, 0.64 → 1 / -12° / 10 px blur in 0.5 s, rise to y 370 at 0.52 in 1.1-1.8 s, letters
  0.035 s apart. Matches.
- phone-carousel: shifts at 1.0-1.65 s and 2.3-2.95 s, 24 px overshoot cap, 0-4-0 px blur, settle at 1.03. Matches;
  geometry refitted to 9:16.
- analytics-glow: frame timings kept in 60 fps units. Matches; card scaled 2.3x to 1080 p.

**Owner step (plan B6 step 3):** publish the better of the two as landing material. Recommendation: the phone
carousel. It shows the real product and fits a 9:16 social post; the logo reveal works as the intro of a longer video.
