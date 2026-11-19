# Free scan: a new founder sees the people asking before paying (group A)

Source: feature review 2026-11-18 (`opencmo-internal/docs/cmo/2026-11-18-ra-soat-tinh-nang.md`, group A), against the
project conclusion (`opencmo-internal/research/0_writing/Strategy_opencmo/12 Ket luan du an.md`). Owner chose group A
first, 2026-11-18. Sessions: [`2026-11-18-free-scan-sessions/`](2026-11-18-free-scan-sessions/).

## Why

The landing promises "See who's asking". Today a new founder gets four documents, a week of X ideas and one X draft;
Sales is the 4th tab, its scan costs 5 credits and needs a plan, so the first thing they see from Sales is a paywall.
The conclusion fixed the free tier as **one real scan**: a few cards with the thread's own words as evidence, the reply
drafts behind the paywall.

## What changes (and nothing else)

1. **The first `sales_scan` of an unpaid account is free**, like the first `plan_week` / `post_draft`
   (`cmo_first_run_free`). Onboarding queues it right after the documents, before the week's plan.
2. **A free scan writes no reply drafts.** It finds, scores, reads the community rules and saves the cards; the
   `draft_reply` step is skipped. Cost: no drafting call for free accounts, and nothing to hide from a founder who could
   read the `opportunities` row through RLS (a draft hidden only in the UI is not locked).
3. **After paying, one click writes the replies** for the cards that have none: a new job `sales_reply_drafts`.
4. **The scan says whether the product fits.** Its output keeps what it searched and how much it read; zero cards show
   "No one asked about this in the last 30 days" with the searches it ran, and no paywall push.
5. **Setup and the first screen lead to Sales**: Setup's third step is "First people", Setup ends on `/app/sales`,
   a `?site=` from the landing starts reading at once.
6. **Copy agrees everywhere**: landing FAQ and pricing note, login page, PlanSheet title.

Out of scope (later groups of the review): Sales scan cadence apart from the plan, Today ordering, digest email,
landing nav 404s, renaming to Ferreto inside the app, scan quality (sort/timeframe), UI v1 beyond the PlanSheet title.

## Global constraints

- Production runs UI **v2** (`NEXT_PUBLIC_OPENCMO_UI="v2"`, checked 2026-11-18). Build and verify v2; v1 only gets the
  PlanSheet action text.
- Product rules (`CLAUDE.md`): nothing unbuilt on screen, assist never act (no post button), English on every screen,
  copy per `apps/web/lib/cmo/skills/no-ai-slop.md` (no em dashes, no "X, not Y" contrasts, no hype).
- Every write through an RPC; every migration with its pgTAP test; `supabase` 2.117.0 from `/usr/local/bin`; after a
  migration run `scripts/dump-schema.sh`. Money only through the credit module.
- A free account never receives reply text: not from the job, the loader, the API or the chat tools.
- Free work is bounded: one free scan per account (a failed one gives it back at most twice, the same rule as the
  other free runs), only after the documents exist.
- Verification per task: `cd apps/web && npm run typecheck`, the `.check.ts` scripts touched, `npm run db:test` for SQL,
  `npm run build` before the last push, and a look at the screen in a browser for UI tasks.

## The shared contract (A1 pushes this first; B and C build on it)

```ts
// apps/web/lib/cmo/jobs/types.ts
export type SalesScanVerdict = "found" | "none";
export type SalesScanOutput = {
  cards: number;
  skipped: number;
  dropped: number;
  refund: boolean;
  platforms: SalesPlatform[];
  failed: SalesPlatform[];
  free: boolean;         // ran as the account's free scan: no drafts were written
  queries: string[];     // what it searched, shown when nothing was found
  scanned: number;       // threads read after filtering
  verdict: SalesScanVerdict; // "none" when cards === 0
};
```

- An opportunity with `reply = ''` and `rule <> 'skip'` is **not drafted yet**. No new column.
- New job kind `sales_reply_drafts`: input `{}`; drafts every `in_review` opportunity of the founder with `reply = ''`
  and `rule <> 'skip'` (newest 10); price **1 credit**, daily limit 5; paid accounts only (`cmo_require_paid`'s 402).
- New loader fields (B owns `lib/screens/load.ts`): `sales.free: boolean` (account unpaid), `sales.lastScan:
  SalesScanOutput | null`, and each card's `drafted: boolean`.

## Sessions

| Session | Owns | Tasks |
|---|---|---|
| A — SQL and jobs | migrations, pgTAP, `current.sql`, `lib/cmo/jobs/*`, `lib/cmo/onboard.ts`, `lib/cmo/jobs/start.ts` | A1 contract · A2 SQL · A3 free scan without drafts · A4 onboarding queues the scan · A5 `sales_reply_drafts` |
| B — app screens (v2) | `components/today/AgentSales.tsx`, `components/screens/setup/*`, `lib/cmo/onboard-status.ts`, `lib/screens/load.ts` (sales block), `components/billing/PlanSheet.tsx` callers | B1 loader · B2 cards without drafts · B3 fit verdict · B4 Setup leads to Sales |
| C — copy, e2e, owner run | `components/landing/data.ts` (FAQ only), `PricingSection.tsx`, `app/login/page.tsx`, `lib/cmo/agents`/chat tool text that names the free tier, e2e specs, this plan's README row | C1 copy · C2 e2e · C3 owner run and review |

Order: A1 first (contract). B1 and C1 start after A1. B2–B4 need A2–A3 on the branch to see real data; C2 after A4 and B4.

## Done when

A new account on a local stack (fake AI and fake social reader) pastes a site on the landing, signs in, and without
paying sees cards on `/app/sales` with the quote, source, score and age, and a locked reply with "Pick a plan to reply
to these people"; after a test plan, "Write the replies" fills the drafts. A site nobody asks about ends on the
"no one asked" screen with the searches listed. `db:test`, typecheck, build and the new e2e pass.
