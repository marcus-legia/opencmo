# Session C — copy, e2e, owner run

Plan: [`../2026-11-18-free-scan-plan.md`](../2026-11-18-free-scan-plan.md). Branch `claude/free-scan`.
Read the plan's Global constraints first.

**Owns:** `apps/web/components/landing/data.ts` (the FAQ entries only, not menus or footer), `PricingSection.tsx`
(the small print under the form), `apps/web/app/login/page.tsx`, any chat/agent text that describes what is free
(`grep -rn "first plan and drafts\|three X drafts\|drafts are free" apps/web`), new e2e spec(s) under `apps/web/e2e/`,
`docs/plans/cmo/README.md` (one row).

## Tasks

### - [x] C1. Copy says what the free tier is (after A1)

- FAQ (`data.ts` about line 111) and the pricing small print (`PricingSection.tsx:71`): free = one real scan, the
  people asking with their own words; replies are written once you pick a plan; nothing is posted for you. Keep the
  current FAQ question list; change the answers that name the free tier.
- Login (`app/login/page.tsx:32,38,52`): sell the same promise as the hero ("See who is asking for what you built"),
  not "Your marketing team is ready". Keep the product name as `SITE_NAME` there (renaming is a later group).
- Every other place the grep finds that promises free drafts.
- Copy per `no-ai-slop.md`. Typecheck; look at landing and login at 1440px and 390px.
- Commit `Free scan C1: one promise for the free tier` and push.

### - [ ] C2. e2e (after A4 and B4)

- One Playwright spec on the local stack with `OPENCMO_AI_FAKE=1` and the fake social reader: landing form with a
  site → login (the test helper the other specs use) → Setup reads at once → ends on `/app/sales` → cards with a quote
  and no reply text in the DOM → "Pick a plan" opens the sheet with "reply to these people".
- A second case: an account marked paid (fixture), cards without drafts → "Write the replies" → drafts appear.
- Update `e2e/design.spec.ts` or other specs only where this change breaks them.
- `npm run test:e2e` for the new spec and the specs it touches. Commit `Free scan C2: e2e for the free scan` and push.

### - [ ] C3. Owner run and whole-PR review

- Run the full path by hand on the local stack (`npm run dev`), screenshots at 1440px and 390px into the PR.
- Review the whole branch diff against the plan: no reply text reaches a free account (loader, API
  `/api/v1/cmo/opportunities`, chat tools in `lib/agent/cmo-tools.ts`), copy rules, English only, pgTAP for every
  migration, schema dump current.
- Full checks: `npm run db:reset && npm run db:test`, `cd apps/web && npm run typecheck && npm run build`,
  `npm run check:contracts`.
- Add the plan's row to `docs/plans/cmo/README.md`. Open the PR `claude/free-scan` → `main` with the screenshots and
  what was checked. Do not merge.

C1 notes (2026-11-18): also changed the billing pages, `PlanSheet` body line, the chat paywall line, `llms.txt`
and the Free plan's features in `lib/pricing.ts`, plus `e2e/ui-v2-activation.spec.ts` for the new PlanSheet line.
Left for their owners: Setup's "This first run is free" lines (B), the 402 text of `cmo_require_paid` (A, still true),
and the "AI CMO" tagline in `lib/site.ts`, `BlogCta.tsx`, `oauth/consent` and "in your voice" in `llms.txt` (renaming
group). `check:pricing` needs the Supabase CLI and was not run in the C1 container.

## Requests

- [ ] **From B (B4), for C2:** `e2e/ui-v2-setup.spec.ts` predates B4 and will fail as written:
  - `/app/setup?site=paylane.test` now starts reading at once for an account that never onboarded, so the
    "Start with your website." heading and the "Read my website" click no longer happen there. Open `/app/setup`
    without `?site=` for the website-step shots and the click, or assert the autostart instead.
  - The progress list has 8 steps when the free scan was queued (`Finding people who describe the problem` between
    the Content plan and the plan); 7 when the social reader is not set up.
  - Setup ends on `/app/sales` while the scan runs or when it found threads, on `/app` otherwise
    (`setupDestination` in `lib/cmo/onboard-status.ts`). The `toHaveURL(/\/app$/)` checks need the fake social reader's
    outcome in mind.
  - Selectors B added for C2: `data-testid="sales-reply-locked"` (a free card's "Pick a plan" line),
    `data-testid="sales-none"` (the "No one asked" verdict), the button `Write the replies · 1 credit`.
