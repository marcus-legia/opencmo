# Session S1: docs match the code, and the Agent Team artifact

Plan: [`../2026-11-08-cmo-review-2-plan.md`](../2026-11-08-cmo-review-2-plan.md) · rules: [`README.md`](README.md).

## You own

- `docs/architecture/**`: every `.md` together with its `.html` twin (CLAUDE.md: "change both together").
- `ARCHITECTURE.md`, §11 "as built".
- `docs/plans/cmo/2026-11-05-agent-team-models-moderation-spec.md`, §8 "Still to do".
- `docs/plans/cmo/2026-11-04-cmo-review-plan.md`, the B6 ticks.
- `docs/plans/cmo/README.md`, the index row.
- The artifact https://claude.ai/artifact/93Bja2KhKZp15KpyBKwDPs ("OpenCMO Agent Team"). Republish it to the same URL.

You touch no code. Read the code on `main` (and S2/S3 commits on this branch at the end) and write what it does.

The pages follow the owner's order of 2026-11-08 (plan §2.1): business information → Writer → approval → Video →
approval → Post, with the editor last. AI video is hidden in the web app (plan §2.2): write it as built but hidden,
not as missing and not as a feature a founder can use.

## Order

S1.1 → S1.2 → S1.3 → S1.4 → S1.5. Last of all, once S2 and S3 have pushed their final commits, run S1.6.

## Todo

- [ ] **S1.1 Status and "today" tables.** In every page:
  - Set "Status: proposed" to "Status: built", with the commit.
  - Rewrite the "today (`main`, `eb858ca`)" tables as one "done / partial / not built" table with code paths.
  - The audit list is in the plan §1.1. Check each line in the code before you write it:
    - `ai-cmo.md`: §1, lines 87–109 and §10.
    - `brain.md`: lines 3, 29–43, 120–126, 191–213 and 298–302.
    - `studio.md`: lines 12, 28–58, 76, 138 and 153.
    - `approval.md`: lines 30–35 and 84–89.
    - `writer.md`: lines 13–32, 57 and 75.
    - `schedule-publish.md`: lines 22 and 33.
    - `research-sales.md`: line 31.
    - `workflow.md`: lines 20–30 and 49.
- [ ] **S1.2 Remove what is wrong:**
  - Providers: Gemini, Groq and OpenAI-compat, "checker on another provider", "provider per agent by env, failover". The only per-agent setting is `CMO_AGENT_<ID>_MODEL` (`lib/cmo/agents/registry.ts`).
  - Moderation by an LLM, and "our rules". Prompts go to Creem only (`lib/generate/moderation.ts`, `opencmo/ai/moderation.py`). The output review is Haiku vision plus fal NSFW against `packages/contracts/creem-policy.json`.
  - Two `/video` cards and the contact sheet; `animate_video`; 3D and `render_three`.
  - The editor-spearhead order: `workflow.md` §5 and every page's build order rank work by "the next OpenCMO
    marketing video". Re-rank by the CMO loop (plan §2.1), and mark the old order as history.
  - Wrong counts: 20 agents (`registry.ts`), 12 job kinds (`lib/cmo/jobs/types.ts`), 25 models (`ai-models.json`), 42 eval tasks (`lib/agent/eval/tasks.ts`).
  - Check: `rg -n "Gemini|Groq|OpenAI-compat|contact sheet|animate_video|two cards|render_three|3D" docs/architecture` returns only lines marked as history.
- [ ] **S1.3 Add what is built but not written down.** One short section each, placed in the page that owns the topic:
  - `credit_orders`: open, draw, close, reaper; one-card `/video` with `startAfter`/`endAfter`; the review fixes migration `20270110010000`. Goes in `studio.md` and `workflow.md`.
  - Turn overage billing, and the explainer turn cap at `agent_3d_hold_credits()`. Goes in `brain.md`.
  - The Studio order hold (`20270109050000`). Goes in `studio.md`.
  - `plan_explainer` → preview → `add_explainer`, with re-planning in every turn (#180). Goes in `studio.md` and `approval.md`.
  - Creem moderation and the output review. Goes in `ai-cmo.md`.
  - The provider spend ledger and the Costs page. Goes in `ai-cmo.md`.
  - The step cut at 280 s (#178), which exists because of Vercel Hobby's 300 s limit. Goes in `brain.md`.
  - The editor's library merge (#176), and Studio listing editor edits (#177). Goes in `studio.md`.
- [ ] **S1.4 `README.md`, `ARCHITECTURE.md` §11, spec §8, B6.**
  - `docs/architecture/README.md`: these pages now describe what is built. Link this plan.
  - `ARCHITECTURE.md` §11: keep it in step with the pages.
  - Spec §8:
    - T6: strict tools are largely done; the real-API grammar test is still owed.
    - T3: the live key is set; the Creem review is still pending.
    - Add the production notes of 2026-11-08: the Anthropic 401 and the Creem live key.
  - Tick B6 in `2026-11-04-cmo-review-plan.md`.
  - Add the index row for this plan in `docs/plans/cmo/README.md`.
- [ ] **S1.5 Republish the Agent Team artifact** (read it with the Artifact tool first, then republish to the same URL):
  - Moderation nodes:
    - web prompt check: Creem API;
    - worker: Creem for the prompt, then Haiku vision plus fal NSFW for the output.
  - Add a "charge before running" lane or panel: one card → `credit_order_open` → pieces drawn from the hold → close. Cover `/video`, `plan_explainer` and the Studio hold.
  - "Open" list, current state:
    - the live Creem key and the Creem review;
    - the Anthropic key on Vercel and Modal;
    - T2: clean up the old keys;
    - T8: the explainer coder (optional);
    - Vercel Hobby;
    - Sales R0;
    - the S2 and S3 items of this plan.
  - Date it 2026-11-08 and cite PRs #169–#180.
  - Write it in Vietnamese, as before (it is for the owner).
- [ ] **S1.6 Final pass.** After S2 and S3 push their last commits:
  - add their changes to the pages: Costs live checks, the Sales price card, paid-first entry with the CMO's first
    week, AI video hidden, the week plan without AI video;
  - update the artifact's "open" list;
  - update the PR description.

## Checks

- Every claim names a code path, and each path exists on the branch (`git ls-files`).
- The `.md` and `.html` pages say the same thing.
- The `rg` check in S1.2 passes.

## Requests

_(other sessions write here)_
