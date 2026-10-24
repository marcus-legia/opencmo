# Third-party notices

OpenCMO's own code is licensed under [AGPL-3.0-only](LICENSE). The following bundled assets
and content are third-party works distributed under their own licenses. Their license texts
live next to the files.

| What | Where | License |
|---|---|---|
| Clip fonts (32 families, e.g. Inter, Montserrat, Raleway, Bebas Neue) | `packages/clip-media/fonts/`, `apps/web/assets/fonts/` | SIL Open Font License 1.1 (`LICENSE-OFL.txt`) |
| DejaVu fonts | `packages/clip-media/fonts/DejaVu*` | Bitstream Vera / DejaVu license (`LICENSE-DejaVu.txt`) |
| Noto Emoji Animation by Google | `packages/clip-media/lottie/emoji/`; also drawn in explainer videos through the explainer kit's `<Lottie>` (`packages/clip-motion`) | CC BY 4.0 (`packages/clip-media/lottie/LICENSE.md`) |
| OpenCMO starter Lottie animations | `packages/clip-media/lottie/` | CC0-1.0 |
| Lucide icons | `packages/clip-icons/data/`, `apps/web/components/icons/` | ISC (`LUCIDE-LICENSE`, `LICENSE-lucide.txt`) |
| Marketing skill library (adapted) | `apps/web/lib/cmo/skills/` | MIT (`apps/web/lib/cmo/skills/LICENSE.md`) |
| Story design guidance from HyperFrames by HeyGen (adapted, rewritten) | `apps/web/lib/agent/guides.ts` (guide `explainer`) | Apache-2.0 (`apps/web/lib/agent/LICENSE-hyperframes.md`) |
| Motion design skill by LottieFiles (adapted) | `apps/web/lib/agent/motion-guide.ts` (incl. `EXPLAINER_MOTION`), `apps/web/lib/agent/guides.ts` (guide `explainer`, motion section), `packages/editor-core/src/motion/intro.ts` | MIT (`apps/web/lib/agent/LICENSE-motion-design.md`) |
| Rough-cut editing rules from video-use, cut-video, claude-code-video-editing-skill and takecut (adapted, rewritten) | `apps/web/lib/agent/guides.ts` (guide `roughcut`), `apps/web/lib/agent/retakes.ts` | MIT (`apps/web/lib/agent/LICENSE-roughcut.md`) |
| Talking-head editing order from palmier-skills `ugc-editing` (adapted, rewritten) | `apps/web/lib/agent/guides.ts` (guide `roughcut`) | Apache-2.0 (`apps/web/lib/agent/LICENSE-roughcut.md`) |
| Motion templates ported from opus-pro/opusclip-video-tools `remakes/opus-5.5` (`pf-mark-lockup`, `pf-phone-carousel`, `template-analytics-glow`), Copyright (c) 2026 OpusClip; code only, no media | `packages/clip-motion/templates/` | MIT (`packages/clip-motion/templates/LICENSE-opus-remakes.md`) |
| Motion helpers ported from opus-pro/opusclip-video-tools `remakes/opus-5.5/pf-type-snap` (`cappedTravel` → `kit.travel`, `snapProgress` → `kit.snap`, motion smear → `kit.smear` / `kit.Streak`), Copyright (c) 2026 OpusClip | `packages/clip-motion/src/kit/curves.ts`, `packages/clip-motion/src/kit/streak.tsx` | MIT (`packages/clip-motion/templates/LICENSE-opus-remakes.md`) |

Explainer videos are rendered with Remotion (`remotion`, `@remotion/bundler`, `@remotion/renderer`,
`@remotion/lottie`, installed from npm in `packages/clip-motion`), which is distributed under the
Remotion License (free for individuals and small companies; larger companies need a company
license: https://remotion.dev/license).

Voice previews in `apps/web/public/voices/` and demo clips in `apps/web/public/demos/` were
produced with OpenCMO and its configured providers for use in the product UI.

npm and Python dependencies are installed from their registries and are not vendored here;
each carries its own license.
