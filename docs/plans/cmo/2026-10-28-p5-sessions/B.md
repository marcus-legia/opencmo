# Session B: slide ops, stills, Slideshow and Post image squads

Plan: [`../2026-10-28-p5-research-sales-slides-plan.md`](../2026-10-28-p5-research-sales-slides-plan.md) · rules: [`README.md`](README.md).

## You own

- `packages/editor-core/src/ops/slides.ts` (new) and its tests, the slide entries in the ops registry
- `packages/engine/opencmo/worker/render_stills_task.py` (new) and the Node still exporter in `packages/clip-export/`
- `apps/web/lib/departments/studio/` (`buildSlideshow`, `buildPostImage`, the squads)
- `apps/web/lib/cmo/agents/registry.ts` (slideshow visuals agent only, if one is needed)

## Order

B0 → (push, M1) → B1 → B2 → B3 → B4.

## Todo

- [ ] **B0 Contracts (push first)**: slide op signatures (`add_slide`, `move_slide`, `delete_slide`,
      `set_slide_duration`, `set_slide_text`) and the slideshow document shape (each slide a timed span on one
      timeline); adapter types `buildSlideshow(brief)` and `buildPostImage(brief)`; `render_stills` task input and
      output (one PNG per slide, a cover index).
- [ ] **B1 Slide ops** in `editor-core` with golden-document tests; listed in the ops registry so the Assistant and
      MCP get them; a slideshow document validates with `clip-doc`.
- [ ] **B2 `render_stills`**: one still per slide from `clip-render` (Node) at the slide's midpoint, PNG set zipped;
      measure peak RSS; MP4 keeps going through `render_document`.
- [ ] **B3 Slideshow squad**: `write_slides` (P3) → reviewer (code: text fits the frame, no invented numbers, words to
      avoid; sends back once) → visuals (captured pages and the founder's screenshots first, `/image` with
      moderation otherwise, never text inside the image) → builder (slide ops, Brand Kit) → MP4 + PNG set → one
      `slideshow` card through A's step RPC.
- [ ] **B4 Post image squad**: a frame of the founder's video or a captured page + a title layer; generate only when
      none fits; aspect per platform; Brand Kit; an `image` deliverable attached to its post.

## Requests

(Others append `[from → B] what, why`; answer here with the commit.)
