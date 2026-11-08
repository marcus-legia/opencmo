# Session S2: paid-first activation, the AI CMO first, `/video` hidden

Plan: [`../2026-11-08-cmo-review-2-plan.md`](../2026-11-08-cmo-review-2-plan.md) · rules: [`README.md`](README.md).

Goal: a founder who pays gives the website and within 10 minutes sees the week plan and the first drafts. They approve
one post and schedule it. One card per job and no dead end. Signup keeps 0 credits (owner, 2026-11-08): the product
has no free trial and says so.

The order is the owner's sketch (plan §2.1): business information → Writer → approval → Video → approval → Post. The
editor is the last step, where the founder fine-tunes by hand. `/video` is hidden; every other slash command stays
(plan §2.2).

## You own

- Landing: `apps/web/components/landing/**`, `apps/web/app/page.tsx`, `apps/web/app/llms.txt/route.ts`, the blog CTA
  (`components/blog/**` or wherever `BlogCta` lives), `apps/web/lib/pricing.ts`.
- Legal: `apps/web/app/(legal)/**`.
- Entry and setup: `apps/web/app/app/page.tsx`, `apps/web/app/app/setup/**`, `apps/web/components/screens/setup/**`,
  `apps/web/components/shell-v2/**`, `apps/web/lib/cmo/onboard.ts`.
- The week plan: `apps/web/lib/cmo/jobs/plan-week.ts` and its checks.
- Editor: `apps/web/components/editor/**` (Assistant panel, upload, `ContinueInClaude.tsx`, `ContactSheet.tsx`).
- Agent, editor side:
  - `apps/web/lib/agent/scope.ts` **above `cmoScope`** (that is `clipScopeWith`);
  - `create-video.ts`, `generate-tool.ts`, `edit-tool.ts`, `guides.ts`, `slash.ts`, `prompt.ts`, `long-take.ts`;
  - the editor eval tasks in `lib/agent/eval/tasks.ts`, `video-usecases.check.ts`, `client-plans.check.ts`.
- Cards: `apps/web/components/cards/**`.
- Studio dead code: `apps/web/lib/cmo/jobs/studio-orders.ts` (the contact-sheet and `animate_video` branches only),
  `apps/web/lib/departments/studio/adapter.ts`.
- Writer screen: `apps/web/components/screens/writer/**`.
- Library screen: `apps/web/components/screens/library/**`.

## Order

S2.1 → S2.2 → S2.3 → S2.4 → S2.5 → S2.6 → S2.7 → S2.8. Each item: research note, code, its check, commit, push.

## Todo

- [x] **S2.1 Paid-first entry, honest copy, the CMO pitch.** `0d6353a`
  - Landing (`Hero.tsx`, `LandingNav.tsx`, `PricingSection.tsx`, `FaqSection.tsx`, `data.ts`):
    - drop "Start free";
    - lead with the AI CMO: it reads your website, plans your week, writes the posts, slides and scripts, and you
      approve what goes out and when;
    - no "full AI video from a sentence" claim (`/video` is hidden, plan §2.2), and no "3D" (removed 2026-10-24);
    - the editor is described as where you finish and fine-tune your own videos;
    - prices still come from the catalogue.
  - Sign-in with 0 credits and no plan lands on pricing / Creem checkout. After payment, the Creem success URL opens
    the CMO's first step (the website), not the editor.
  - Hide the "Continue in Claude" path for accounts that cannot use it (`components/editor/assistant/ContinueInClaude.tsx`, `/api/v1/cmo/mode`).
  - Check: an e2e on a preview with Creem test mode, sign-in → checkout → website step.
  - Note. Now: the nav says "Start free" (`LandingNav.tsx:135`); `data.ts` leads with Video, "3D" in four places
    (`:30`, `:115`, `:124`, `:127`); `/app` sends every account to Setup whatever its plan (`app/app/page.tsx:36`);
    Creem returns to `/app/billing?paid=1` (`checkout/route.ts:43`); `ContinueInClaude` shows for unpaid accounts that
    cannot make the API key it asks for (`create_api_key` raises "API keys are part of the paid plans").
    Change: copy in the CMO loop order (Post, Video, Sales), no 3D, no AI video, a "no free trial" FAQ; `/app` sends an
    account with no plan and 0 credits to `/app/billing?start=1&site=…`; a plan's checkout returns to
    `/app?paid=1&site=…`, which lets the founder through to the website step even if the webhook is a few seconds late;
    `/cmo/mode` returns `can_connect` and the card hides without a plan.
    Check: typecheck, `check:contracts`; the Creem test-mode e2e needs a preview with Creem test keys (owner), not run here.
- [x] **S2.2 The first week within minutes.** `990cd39` `SetupScreen.tsx`, `lib/cmo/onboard.ts`:
  - one step: the website. Reading it, writing the four documents and planning the first week run at once, not with
    the nightly plan;
  - the founder lands on the Dashboard / inbox and watches the plan and the first drafts arrive;
  - documents, accounts, Brand Kit and the goal are asked for later, inline, when a task needs them (Brand Kit when
    the first slideshow is built, an account when the first post is scheduled);
  - remove the disabled Connect step (line 276).
  - Check: minutes from website submitted to the first draft card, on the preview, written in the PR.
  - Note. Now: Setup has five steps (`SetupScreen.tsx`), the Connect button is disabled (`:276`), and the first plan
    waits for the Monday loop (`lib/cmo/loops.ts:40`) or a button. `runOnboarding` (`lib/cmo/onboard.ts`) only writes
    the documents.
    Change: Setup is the website step only and sends the founder to the Dashboard. On a founder's first onboarding,
    `runOnboarding` queues `plan_week` and `post_draft` as ordinary runs (1 credit each, same caps and holds) and
    `kickCmoRunsInOrder` (`jobs/start.ts`) runs them one after the other after the response, so the draft reads the
    plan's first post; the sweep picks up whatever the time limit cuts. A founder back from Creem before the webhook
    is retried for ~20 s. Documents are edited in Library; the goal is on the plan card.
    Check: typecheck, `check:contracts`. The minutes on a preview are not measured from this session (no preview with
    a paid test account); the owner's checklist in the PR asks for it.
- [x] **S2.3 The rail follows the sketch.** `4073ee9` `components/shell-v2/nav.ts`:
  - Dashboard (the inbox) first, then the departments in the sketch's order: Writer, Studio, Schedule; Editor stays
    last;
  - Research, Brain and Analytics stay reachable but do not lead.
  - Note. Now: `NAV_MAIN` puts Analytics, Brain and Library beside the Dashboard, and Research leads the departments
    (`nav.ts:32-44`). Change: Dashboard alone on top; Writer, Studio, Schedule, then Sales; a "More" group with
    Library, Research, Analytics and Brain; Editor last. The tab bar, the shell's tabs and `lib/agent/panel.ts` read the
    new group. Check: typecheck, `panel.check`, `columns.check`.
- [x] **S2.4 Hide `/video`** (plan §2.2): `0074fa3`
  - Only `/video` (`create_video`). `/animate`, `/background`, `/edit`, `/broll` and the rest stay as they are.
  - One switch (one constant or one capability in `editor-core/capabilities.ts`, whichever the slash menu and
    `clipScopeWith` already read) hides `create_video` from the slash menu, the Assistant's tool list in the web app
    and the starters. The tool, the MCP server and the evals keep the code.
  - The Assistant must not offer a full AI video in words either: the guide text and the prompt stop suggesting it
    while it is hidden.
  - `AssistantPanel.tsx`: blank-edit starters drop `/video`; talking-head starters only when the edit has speech.
  - Update `video-usecases.check.ts` and the eval tasks so they do not expect `/video` in the web app.
  - Check: the slash menu on the preview, and the Assistant eval green.
  - Note. Now: `/video` is offered wherever `create_video` is in `clipToolSpecs` (`slash.ts:45`, `scope.ts:163`); the
    prompt routes "a whole video" to it (`prompt.ts:16`), and so does the blank guide (`guides.ts:410`); the input says
    "commands like /video". Change: one switch, `CREATE_VIDEO_HIDDEN` in `lib/agent/hidden.ts`. `clipToolSpecs({ assistant: true })`
    (the Assistant's scope and the slash-menu route) leaves `create_video` out, so the menu drops `/video` and a typed
    `/video` is answered "not available here"; MCP lists it as before and Studio calls `scope.plan` by name. The prompt
    and the blank guide say a whole AI video is not made here and offer an explainer, an intro or shots one by one.
    Blank edits get blank starters; the talk starters need speech. The eval runs the web tool list: the six whole-video
    tasks grade "none made, alternatives offered" while hidden (their graders stay). Check: `video-usecases.check`
    (only `/video` leaves the menu), `agent-design.check`, `agent:eval --provider fake` 38/42: the 4 `explain-*` fail
    the same on the base commit (no explainer preview worker here). Not done here: the slash menu and an
    upload/cut/`/animate`/export with a looked-at frame on a preview (no local stack in this session).
- [x] **S2.5 The week plan has no AI video** `df4a1ff` (`plan-week.ts`):
  - remove the "one-minute AI video" item (`:35`) and the fallback that adds one when the brief says "video"
    (`:151`);
  - a video item is a slideshow, or short clips cut from a finished edit of the founder's own video when one exists
    (Studio Shorts squad);
  - keep video scripts and storyboards in the Writer's output when the strategy calls for a video the founder records
    themselves.
  - Check: `plan-week` checks and the CMO eval.
  - Note. Now: the prompt allows one "one-minute AI video" a week (`plan-week.ts:35`), `toPlanItems` keeps it as Shorts and
    `fakePlan` adds one when the brief says "video" (`:151`); SQL turns each into `write_video_brief` + `build_video`.
    Clips of the founder's own video are ordered by `cut_shorts_order_for` when an edit is finished, not by the plan.
    Change: the prompt plans only a slideshow as video; `toPlanItems` drops every other video item; `videosAsked` and the
    fake's video are gone; the brain eval flags any AI video. Scripts for a video the founder records need an item that
    orders only the brief: SQL, so it is a request in S3's file. The p2/p3 acceptance scripts (`lib/screens/p2-,
    p3-acceptance.e2e.ts`) seed a Studio video through the brief "make 1 video"; that step no longer plans one.
    Check: `jobs.check`, `studio-orders.check`, `coverage.check`, `cmo:eval --provider fake` all green.
- [ ] **S2.6 No dead ends.** Partly done in `b15480b`; the X card waits on S3 (see the note).
  - Hide the disabled "arrives with…" buttons in Setup and Library. Sales is S3's.
  - Warn before leaving the page while an upload runs (`components/editor/upload/UploadPanel.tsx`).
  - When transcription failed, the editor says so and offers a retry, instead of "no speech".
  - No connected account: the X draft card offers "Copy and open" and "I posted it" at once, and skips the schedule card (`components/cards/ApprovalCard.tsx`, the writer screen).
  - The Assistant's "Keep going for up to 10 more?" pause (`AssistantPanel.tsx`): check how often a single request hits it; if it is common, raise the step limit for that request.
  - Note. Now: Library's Voice panel has a disabled "Add a note" (`LibraryScreen.tsx:129`; Setup's disabled Connect went
    with S2.2); `UploadPanel` aborts the transfer on unmount with no warning (`:96`); a video whose transcript never came
    shows "no video speech" (`TranscriptPanel.tsx:163`); a post with no connected account still gets an `intent` slot and a
    schedule card (`schedule_propose`). Change: the disabled button is gone; while a file is sending, closing the tab or
    following a link to another page asks first, and the progress says to keep the page open; a video in the edit with
    no transcript says the words could not be got and offers "Select the video to try again" (the inspector's Generate
    captions). Not done: the X card's "Copy and open" + "I posted it" needs one SQL change (request in S3's file); the
    client part waits for it. The Assistant's "Keep going for up to 10 more?" is the per-request credit budget, not a
    step limit (`MAX_STEPS` is 40); how often it shows needs production data: `select count(*) filter (where
    pause_reason = 'budget') * 1.0 / count(*) from agent_turns where created_at > now() - interval '14 days'` (owner).
    Check: typecheck, `layout.check`.
- [x] **S2.7 Copy and price fixes from the 2026-11-06 review:** `f03fe8f`
  - Terms: a Creem cancel ends the plan at once (`app/(legal)/terms/page.tsx`). Either say that, or ask S3 for a migration that keeps the plan until the period ends; owner's call, write it in the PR.
  - `llms.txt` and the blog CTA read the catalogue at request time, not at build time, and say nothing about AI video.
  - `pricing.ts`: no hardcoded fallback prices; a page with no catalogue row shows no price.
  - Note. Now: Terms say the plan stays until the period ends (`terms/page.tsx:50`), but `recompute_plan` drops it on a
    Creem `canceled` at once (only `scheduled_cancel` keeps it); `llms.txt` is `force-static` and pitches the editor; the
    blog page is built once with its CTA price; `PLANS` holds 69 / 57.5 / 690 and 580 credits as fallbacks.
    Change: Terms say what the code does (the plan ends when the cancellation arrives, which can be at once; credits
    stay). Owner's call: if the plan should last to the period's end, S3 needs a migration keeping `canceled` paid until
    `current_period_end`. `llms.txt` is dynamic, describes the CMO loop and no AI video, says there is no free trial, and
    lists only plans with a catalogue row; the blog page revalidates every 10 minutes and its CTA prints no price
    without a row; `PLANS` carries no paid price or credits; `offerPrices` is null without both rows, and then the
    landing hides the pricing section, the FAQ drops the numbers and Billing shows no price for a plan.
    Check: typecheck, `check:blog`, `check:contracts`.
- [x] **S2.8 Dead code.** `814dbb7`
  - Remove the `animate_video` and contact-sheet leftovers: `studio-orders.ts` redo branch and `withKeyframe` / `pendingGenerations`, `adapter.ts:116`, `ContactSheet.tsx`, the `redo` types in the Assistant client, the stale `animate_video` stub in `clipScopeWith`, and the "under the 24" comment in editor-core `create-video.ts`.
  - Keep `redo_keyframe` and `create_video` (hidden, not dead).
  - Note. Now: the two-card `/video` went on 2026-11-06, but `studio-orders.ts` still runs a contact-sheet redo and an
    `animate_video` step (`withKeyframe`, `pendingGenerations`), `adapter.ts:116` allows a redo only for `animate_video`, the
    Assistant still renders a `ContactSheet` and sends `redo`, `clipScopeWith` keeps an `animate_video` stub, and the
    editor-core comment says 24 generations in flight (the limit is 40). Change: all of that is gone; a step still
    decided "redo" fails with "Redo the keyframe from the editor instead" rather than running something else; the
    comment counts 18 shots + 19 keyframes + voice + music = 39 under 40. `redo_keyframe` and `create_video` stay. The
    server's `redo` field on a decision (`lib/agent/loop.ts`, not S2's) is left; nothing sends it now.
    Check: typecheck, `studio-orders.check`, `studio.check`, `check:contracts` green.


## Code review (2026-11-08, after S2.1–S2.8)

`/code-review high 975bc56..HEAD` found 10 problems; all are fixed in the commit after this note:

1. A pending Studio price card still offered "Redo a keyframe", which now fails the whole order: the button and its
   picker are gone (`ApprovalCard.tsx`).
2. Removing the `animate_video` stub made an old card throw on Approve and Cancel: an approval for a tool the clip scope
   no longer has now closes as "Out of date", nothing charged (`scope.ts`), with no tool-specific stub.
3. The first draft was queued with the plan, so the sweep could claim it first: `kickFirstWeek` (`jobs/start.ts`)
   queues the draft (`enqueue_cmo_run_for`) only once the plan is `done`.
4. Two jobs in `after()` could outlive the route: each starts only when it can finish before the deadline
   (265 s from the start of onboarding); otherwise the sweep runs the plan and the daily loop drafts.
5. The paid-first redirect also locked out founders who had started: it applies only to an account with no
   documents (`app/app/page.tsx`).
6. Paid-first was only a page redirect: the onboarding route refuses (402) an account with no plan and no credits,
   after waiting up to 15 s for a late Creem webhook (`lib/paid-first.ts`).
7. Fixed by 5: after onboarding the founder has documents, so a late webhook no longer sends them back to billing.
8. "Select the video to try again" led nowhere for an upload's master (not a library asset): the note now says to
   upload the video again, which transcribes it again; no button.
9. A first onboarding that failed after saving some documents never got its first week: the check is now "no
   `plan_week` run yet", not "no documents".
10. Without the catalogue the landing had no `#pricing`: a short pricing section with no numbers keeps the anchor.

Checks after the fixes: typecheck, `check:contracts`, `capabilities.check`, `agent:eval --provider fake` 38/42 (the
same 4 `explain-*` as the base commit).

## Checks

- `npm run typecheck`
- `cd apps/web && npm run check:contracts`
- the Assistant eval, `npm run agent:eval -- --provider fake`
- the CMO checks for `plan-week`
- the editor e2e that applies
- After S2.2: website → first draft card on the preview deployment, in minutes, written in the PR.
- After S2.4: an upload, a cut, an `/animate` and an export in the editor still work, with an exported frame looked at (CLAUDE.md
  "Verify by looking").

## Requests

_(other sessions write here)_
