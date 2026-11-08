# Session S2: paid-first activation, editor first

Plan: [`../2026-11-08-cmo-review-2-plan.md`](../2026-11-08-cmo-review-2-plan.md) · rules: [`README.md`](README.md).

Goal: a founder who pays reaches a finished video in the editor in under 10 minutes, with one card per job and no
dead end. Signup keeps 0 credits (owner, 2026-11-08): the product has no free trial and says so.

## You own

- Landing: `apps/web/components/landing/**`, `apps/web/app/page.tsx`, `apps/web/app/llms.txt/route.ts`, the blog CTA
  (`components/blog/**` or wherever `BlogCta` lives), `apps/web/lib/pricing.ts`.
- Legal: `apps/web/app/(legal)/**`.
- Entry and setup: `apps/web/app/app/page.tsx`, `apps/web/app/app/setup/**`, `apps/web/components/screens/setup/**`,
  `apps/web/components/shell-v2/**`.
- Editor: `apps/web/components/editor/**` (Assistant panel, upload, `ContinueInClaude.tsx`, `ContactSheet.tsx`).
- Agent, editor side:
  - `apps/web/lib/agent/scope.ts` **above `cmoScope`** (that is `clipScopeWith`);
  - `create-video.ts`, `generate-tool.ts`, `guides.ts`, `slash.ts`, `prompt.ts`, `long-take.ts`;
  - the editor eval tasks in `lib/agent/eval/tasks.ts`, `video-usecases.check.ts`, `client-plans.check.ts`.
- Cards: `apps/web/components/cards/**`.
- Studio dead code: `apps/web/lib/cmo/jobs/studio-orders.ts` (the contact-sheet and `animate_video` branches only),
  `apps/web/lib/departments/studio/adapter.ts`.
- Writer screen: `apps/web/components/screens/writer/**`.
- Library screen: `apps/web/components/screens/library/**`.

## Order

S2.1 → S2.2 → S2.3 → S2.4 → S2.5 → S2.6 → S2.7 → S2.8. Each item: research note, code, its check, commit, push.

## Todo

- [ ] **S2.1 Paid-first entry, honest copy.**
  - Landing (`Hero.tsx`, `LandingNav.tsx`, `PricingSection.tsx`, `FaqSection.tsx`, `data.ts`):
    - drop "Start free";
    - lead with the editor pitch from CLAUDE.md (`/video`, `/broll`, edit your own videos together);
    - prices still come from the catalogue.
  - Sign-in with 0 credits and no plan lands on pricing / Creem checkout. After payment, the Creem success URL opens the Editor.
  - Hide the "Continue in Claude" path for accounts that cannot use it (`components/editor/assistant/ContinueInClaude.tsx`, `/api/v1/cmo/mode`).
  - Check: an e2e on a preview with Creem test mode, sign-in → checkout → editor.
- [ ] **S2.2 Setup cut to the website step.** `SetupScreen.tsx`:
  - the website is read in the background, and the founder goes straight to the editor;
  - documents, accounts, Brand Kit and the goal are asked for later, inline, when a task needs them;
  - remove the disabled Connect step (line 276).
- [ ] **S2.3 Editor first.**
  - Put Editor at the top of the rail (`components/shell-v2/nav.ts`).
  - In `AssistantPanel.tsx`, starters for a blank edit: `/video` about the founder's product, `/explain …`, Upload. Talking-head starters only when the edit has speech.
- [ ] **S2.4 `/video` costs what people expect** (`create-video.ts`):
  - Default to 15 s and the cheaper shot model. `pickShotModel` today is "quality first".
  - The one card offers a quality and length choice, with the price of each option before Approve. The card and its storyboard stay one card.
  - Update the guide text, `slash.ts`, `video-usecases.check.ts` and the eval tasks.
  - Check: the card's credits for a default `/video`, written in the PR.
- [ ] **S2.5 `/broll` in one card** (`guides.ts:169` and `:414`, `generate-tool.ts`):
  - stills and animation are priced on one card;
  - 1 variant by default; variants are an option on the card.
  - This matches roadmap ES.3 and "charge once". The Assistant does not ask a second price question.
- [ ] **S2.6 No dead ends.**
  - Hide the disabled "arrives with…" buttons in Setup and Library. Sales is S3's.
  - Warn before leaving the page while an upload runs (`components/editor/upload/UploadPanel.tsx`).
  - When transcription failed, the editor says so and offers a retry, instead of "no speech".
  - No connected account: the X draft card offers "Copy and open" and "I posted it" at once, and skips the schedule card (`components/cards/ApprovalCard.tsx`, the writer screen).
  - The Assistant's "Keep going for up to 10 more?" pause (`AssistantPanel.tsx`): check how often a single request hits it; if it is common, raise the step limit for that request.
- [ ] **S2.7 Copy and price fixes from the 2026-11-06 review:**
  - Terms: a Creem cancel ends the plan at once (`app/(legal)/terms/page.tsx`). Either say that, or ask S3 for a migration that keeps the plan until the period ends; owner's call, write it in the PR.
  - `llms.txt` and the blog CTA read the catalogue at request time, not at build time.
  - `pricing.ts`: no hardcoded fallback prices; a page with no catalogue row shows no price.
- [ ] **S2.8 Dead code.**
  - Remove the `animate_video` and contact-sheet leftovers: `studio-orders.ts` redo branch and `withKeyframe` / `pendingGenerations`, `adapter.ts:116`, `ContactSheet.tsx`, the `redo` types in the Assistant client, the stale `animate_video` stub in `clipScopeWith`, and the "under the 24" comment in editor-core `create-video.ts`.
  - Keep `redo_keyframe`.

## Checks

- `npm run typecheck`
- `cd apps/web && npm run check:contracts`
- the Assistant eval, `npm run agent:eval -- --provider fake`
- the editor e2e that applies
- After S2.4: a 15 s `/video` on the preview deployment, with an exported frame looked at (CLAUDE.md "Verify by looking").

## Requests

_(other sessions write here)_
