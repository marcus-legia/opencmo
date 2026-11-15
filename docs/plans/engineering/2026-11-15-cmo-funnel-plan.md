# The CMO funnel for the owner (hardening backlog, step 4)

Owner, 2026-11-15: "qua đợt 4". Source: [`2026-11-15-web-app-hardening-backlog.md`](2026-11-15-web-app-hardening-backlog.md),
recommended order item 5.

## Why

The goal is $100k MRR, and the road is the CMO loop. Today there is no way to see where founders drop: how many who
sign up get their website read, approve a first card, post, and pay. The events are already recorded
(`product_events`, CMO review 3, 3.4: `onboarded`, `approve`, `schedule`, `posted`, written by triggers) but nothing
reads them.

## What

- **`cmo_funnel_report(p_days)`** (migration `20270126010000`, pgTAP `318`). It reads `auth.users`, `product_events`
  and `cmo_paid`, and adds no table.
  - Owners only (`app_owners`, the same check as `provider_spend_report`), under the owner's own session.
  - The cohort is the accounts that signed up in the window, minus owner accounts.
  - Each step counts the accounts that ever reached it: signed up → onboarded → approved a card → scheduled → posted;
    and pay (a plan, or credits bought).
  - Median time from sign-up to onboarded, to the first approved card, and to the first post.
  - Active this week: of the accounts at least 7 days old, how many approved a card in the last 7 days; the same
    for paying accounts.
  - Weekly sign-up cohorts.
- **`/app/settings/funnel`**, owner only (404 for anyone else), in the style of `/app/settings/costs`.
  - The steps with the percentage of sign-ups and of the step before.
  - The medians, the active share and the weekly cohorts.
  - Windows of 7, 30 and 90 days (`?days=`).
- **`lib/ops/funnel.ts`** (rows, percentages, durations) with `funnel.check.ts` in `check:contracts`.

No analytics vendor and no script in the founder's browser. When the owner needs session replay or A/B tests,
PostHog is the candidate (its own decision).

## Deploy order (owner)

`supabase db push` first, then the web deploy. A deploy before the push only gives the owner a 404 on this page.

## What to watch first

- **Signed up → onboarded.** The e2e baseline (`2026-11-15-e2e-in-ci-plan.md`) suggests the free first run may be
  broken. If so, this step will show it on production too.
- **Approved → posted.** This is where the loop turns into value for the founder.

## Out of scope

- Revenue numbers (MRR, churn). Those belong to Creem's dashboard until the billing tables carry them.
- Per-platform splits, and anything a founder sees.
