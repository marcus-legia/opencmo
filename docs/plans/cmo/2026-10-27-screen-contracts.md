# Screen contracts (UI plan Task U0)

Code: [`apps/web/lib/screens/`](../../../apps/web/lib/screens/). One zod schema per screen, one fixture per screen
(`fixtures/`, built from the frames' sample content), one registry (`registry.ts`) and one route. Sessions B and C
code against the types; a change goes through a "Requests" note in
[`2026-10-27-cmo-build-sessions.md`](2026-10-27-cmo-build-sessions.md).

## How a screen gets its data

```
GET /api/v1/screens            → { screens: { [name]: { available, live: [fields] } } }   (the rail)
GET /api/v1/screens/[name]     → { data, live: { [field]: boolean } }
GET /api/v1/screens/[name]?sample=1   → the pure fixture, every field not live (look checks, e2e; never in production)
```

- Both routes answer 404 unless `NEXT_PUBLIC_OPENCMO_UI=v2`.
- A field is live when its name is in the screen's `live` list in `registry.ts` **and** its loader in `load.ts`
  returned it. A loader cannot make a field live by returning it; the list must say so too.
- A field that is not live is the fixture outside production and the screen's `empty` value in production. Sample
  data never reaches a production user; `screens.check.ts` asserts it for every screen.
- In production a screen answers 404 and the rail hides it until every field in its `release` list is live.
- The UI shows the "Sample data" tag on any part whose `live[field]` is false.
- A live value that does not match the contract drops back to its non-live value on its own (logged); the other
  fields of the screen stay live.
- Loaders run under the founder's RLS session; there is no service-role read.
- `cd apps/web && npm run check:contracts` runs `screens.check.ts`: every fixture and empty value parses, `live` and
  `release` name real fields, a live field has a loader, and the sample/empty rules hold.

Shared types (`common.ts`): `Department` (brain, research, writer, studio, sales, schedule, publish), `Platform`,
`Where` (platform + handle), `Account` (status `connected | reconnect | not_connected`, `noDataSince`), `Credits`
(used / budget), `CmoState` (mode `opencmo | claude`, `pausedAt`), `LogLine`, `SlotStatus`
(`proposed | waiting_founder | scheduled | posted | failed`). Times are ISO with an offset; a null number means
"not reported" (a dash), never zero.

Phases: B0, B1, B2 (brain), A0 (approval) are wave 1 and land in this PR; everything else is wave 2–3
(brain plan §6). "Today" means the data exists in a table now and the loader only has to read it.

## S1 Shell

| Field | Source | Live today | Live with |
|---|---|---|---|
| credits, plan, email, userId | `credit_balance`, `profiles.plan` (`ShellAccount`, `app/app/shell.ts`) | yes | — |
| pending | `lib/cmo/pending.ts`: `approvals` where `status = waiting` | yes | — |
| rail availability | `GET /api/v1/screens` | yes | — |

## S2 Dashboard (`dashboard.ts`)

| Field | Source | Live today | Live with |
|---|---|---|---|
| `cmo` | `brainMode()` (`lib/cmo/brain.ts`), `profiles.cmo_paused_at` | **live** | B2 |
| `week.goal` | `cmo_goals` (approved, this week) | **live** | B1 |
| `week.deliverables` | this week's orders: done / not cancelled | **live** | B1 |
| `week.workingNow` | `work_orders` running, by department | **live** | B1 |
| `week.wordsDraftedToday` | words of X drafts touched today | **live** | B1 |
| `week.credits` | the week root's `spent_credits` / `budget_credits` (`profiles.weekly_credit_budget` before a plan) | **live** | B0, B1 |
| `team.brain` | open `work_orders`, paused, next progress check (00:05 UTC) | **live** | B1, B2 |
| `team.nodes[]` | `work_orders` grouped by department (progress classifier) + waiting `approvals` | **live** | B1, A0 |
| `log[]` | `work_order_events`, newest first | **live** | B1 |
| `results.rows[]` | `post_metrics` (X today), Zernio later | partly (X) | R3 / P3 |
| `results.brainUsed` | `cmo_lessons` of last week | yes | B1 |
| `outToday[]` | X posts approved for today (`scheduled`) or posted today; `schedule_slots` later | **live** (X) | P1 |
| `digest` | `lib/cmo/digest.ts` `loadDigestInput` (waiting cards, posts out in 24 h, failed orders) | **live** | B2 |
| `queue[]` | `approvals` where `status = waiting` (`ApprovalCard`) | **live** | A0 |

## S3 Approval card (`approval-card.ts`)

Ten kinds: `post`, `reply`, `goal`, `script`, `price`, `finished_video`, `shorts_batch`, `slideshow`, `schedule`,
`correction`. Common fields: `id`, `kind`, `department`, `status` (`waiting | approved | edited | skipped | expired |
cancelled`), `title`, `summary`, `meta`, `priceCredits`, `postAt`, `account`, `raisedAt`, `expiresAt`, `decidedAt`,
`decidedVia` (`app | email | push | mcp`), `problem` (`expired | decided_elsewhere | needs_credits | failed` + text),
`contentHash` (sha256 of the JCS snapshot the card shows; sent back with the decision), `body` (one shape per kind,
`body.kind === kind`). A live card is built from the `approvals` row's snapshot only (`lib/screens/cards.ts`), so it
shows exactly what the hash covers.

```
GET  /api/v1/approvals/[id]   → ApprovalCard                     (/app/inbox/[id]; reminders link here)
POST /api/v1/approvals/[id]   { action, contentHash, text?, reason?, goal?, target? } → ApprovalCard
     post: approve | skip · reply: replied | dismissed · goal: approve | reject · correction: approve | edit | reject
     409-style refusals come back as `{ detail }`: "This card changed. Look at it again before deciding.",
     "This card was already decided.", "This card expired. A new one will ask again."
``` `PRIMARY_ACTION` names each kind's one filled button;
`DECIDABLE_IN_WAVE_1` lists the kinds whose decision works in this PR.

| Kind | Body source | Live with |
|---|---|---|
| post | `content_items` (text, alternates, checks, rationale) | A0 |
| reply | `opportunities` (thread, score parts, quotes, reply) | A0 |
| goal | `cmo_goals` + the week's order tree | A0 |
| correction | `cmo_corrections` | B0 + A0 |
| script, price, finished_video, shorts_batch, slideshow | Studio team cards | A1 |
| schedule | `schedule_slots` | A3 |

## S4 Analytics (`analytics.ts`)

| Field | Source | Live today | Live with |
|---|---|---|---|
| `range` | query `?range=7|30|90` | — | — |
| `accounts[]` | X connection today; Zernio accounts | partly | P0 |
| `kpis[6]` | `post_metrics` | partly (X) | R3, P3 |
| `daily[]` | `post_metrics` by day and platform | partly (X) | R3, P3 |
| `brainReads[]` | `cmo_lessons`, `cmo_memories` topic metrics | yes | B1 |
| `byAccount[]`, `posts[]` | `post_metrics` + `content_items` | partly (X) | R3, P3 |

## S5 Brain (`brain.ts`)

| Field | Source | Live today | Live with |
|---|---|---|---|
| `cmo` | `brainMode()`, `profiles.cmo_paused_at` | **live** | B2 |
| `week` | `cmo_goals`, the week root | **live** | B1 |
| `orders[]` | `work_orders` (parents before children; `parentId` null under the week root) | **live** | B1 |
| `learned[]` | active `cmo_corrections`, latest `cmo_lessons` per topic, recent skip reasons | **live** | B1 |
| `corrections[]` | `cmo_corrections` with their waiting card | **live** | B0 |
| `pastWeeks[]` | earlier week roots + their approved `cmo_goals` result | **live** | B1 |

## S6 Library (`library.ts`)

| Field | Source | Live today | Live with |
|---|---|---|---|
| `site` | latest `onboard` run's `cmo_runs.input.site` | **live** | W1-5 |
| `documents[]` | `marketing_documents_latest` + `DOCUMENTS` titles | **live** | W1-5 |
| `brandKits[]` | `brand_kits`, logo as a signed URL | **live** | W1-5 |
| `voice` | `marketing_documents.strategy` voice and avoid; learned notes | partly | W0–W1 (Writer) |
| `skills.writing` | built-in profiles; `editor_skills` | partly | W0–W1 |
| `skills.video` | `packages/skills`, `editor_skills` | yes | W1-5 |

## S7–S11 Department pages

| Screen | Field | Source | Live today | Live with |
|---|---|---|---|---|
| Research | `lastRunAt`, `nextRunAt` | `cmo_runs` kind `competitor_research`, `lib/cmo/loops.ts` | yes | W1-5 |
| Research | `insights[]`, `dropped` | `competitor_research` output (`CompetitorInsight`) | yes | W1-5 |
| Research | `results[]` | `post_metrics` 24 h after posting | partly (X) | R3 |
| Writer | `drafts[]` | `content_items` (X today), other kinds W1 | partly (X) | W0–W1 |
| Writer | `voice` | Library voice | partly | W0–W1 |
| Studio | `items[]` | `projects`, `editor_projects`, uploads (`/api/v1/projects`) | yes | U7b (Session C reads today's API) |
| Studio | `items[].approvalId`, generated kinds | Studio cards | no | A1, S1–S3 |
| Studio | `team` | long-take generations | no | B3 |
| Sales | `threads[]`, `week` | `opportunities` | yes | W1-5 |
| Sales | `mentions`, `stuck`, rule labels | Sales safety | no | R1 |
| Schedule | everything | `schedule_slots`, Zernio accounts | no | P0–P1 |

## S12 Settings, S13 Setup (`settings.ts`, `setup.ts`)

```
PUT  /api/v1/cmo/settings   { weeklyCreditBudget, timezone, digestHour | null } → the same, saved (save_cmo_settings)
POST /api/v1/cmo/pause      { paused: true | false } → { pausedAt }               (cmo_pause / cmo_resume)
```

| Screen | Field | Source | Live today | Live with |
|---|---|---|---|---|
| Settings | `accounts[]` | Zernio accounts | no | P0 |
| Settings | `cmo` | `brainMode()`, `profiles.cmo_paused_at` | **live** | B2 |
| Settings | `weeklyCreditBudget`, `timezone`, `digestHour` | `profiles` (`save_cmo_settings`) | **live** | B0 |
| Settings | `plan` | `profiles.plan`, `credit_balance` | **live** | W1-5 |
| Setup | `site`, `documents[]`, `step`, `done` | onboarding, `marketing_documents` | yes | W1-5 |
| Setup | `accounts[]` | Zernio | no | P0 |
| Setup | `hasBrandKit`, `goal` | `brand_kits`, `cmo_goals` | yes | W1-5 |
