# E2E in CI (hardening backlog, step 1)

Owner, 2026-11-15: "Làm đợt 1". Source: [`2026-11-15-web-app-hardening-backlog.md`](2026-11-15-web-app-hardening-backlog.md),
recommended order item 1.

## Why

The repo has about 50 Playwright specs (`apps/web/e2e/`), and they run against a local Supabase stack with fake
models, a fake Zernio and the e2e worker (`packages/engine/tests/e2e_worker.py`), so they need no secret and spend
nothing. But no workflow runs them: a button that stops working reaches `main` and production unless someone runs
`npm run test:e2e` by hand, which takes a local build and a second Supabase stack.

## What

One workflow, `.github/workflows/e2e.yml`:

| Trigger | Runs | Why |
|---|---|---|
| Each PR, each push to `main` | **Smoke set**: `npm run test:e2e:smoke` | The CMO loop, sign-in and isolation, in about 10–15 minutes |
| Every night (02:17 UTC), and by hand | **Whole suite**, twice in parallel: the default build (`npm run test:e2e`) and the v2 build (`npm run test:e2e:v2`) | The editor specs are slow (real ffmpeg, Remotion); they run once a day |

- The smoke set runs on the v2 app (`NEXT_PUBLIC_OPENCMO_UI=v2`), which is what founders get.
- The runner's own Google Chrome drives the specs (`channel: chrome`), as `playwright.config.ts` asks: Playwright's
  Chromium cannot decode the editor's H.264 masters.
- Supabase CLI pinned to 2.117.0, like the database job.
- The e2e worker needs `packages/engine/.venv312`: the job builds it with Python 3.12 and `pip install -e packages/engine`.
- On failure, `apps/web/test-results` (traces, videos) is uploaded for 7 days.

## The smoke set

Chosen by the strategy's one question (does it keep the CMO loop working for a paying founder?), from the specs that
were green in the local baseline run of 2026-11-15:

- sign-in and isolation: `login`, `isolation`;
- the loop: `ui-v2-setup`, `ui-v2-activation`, `ui-v2-writer`, `ui-v2-core-drafts`, `ui-v2-decisions`, `ui-v2-today`,
  `ui-v2-dashboard`, `ui-v2-schedule`, `ui-v2-post-photos`, `ui-v2-pages`.

A spec that is red in the baseline stays out of the smoke set until it is fixed (it still runs every night). The list
lives in one place, the `test:e2e:smoke` script in `apps/web/package.json`, so a local run and CI run the same specs.

### Baseline, 2026-11-15 (local, `main` `fb2e003d`, v2 build, `login isolation ui-v2`)

101 passed, 6 failed, 12.6 minutes. The six were already red on `main`; this plan does not fix them, it keeps them
out of the smoke set (`isolation` whole, the other two by title with `--grep-invert`):

| Spec | What fails | First look |
|---|---|---|
| `ui-v2-activation` :30 and :88 | No first draft within 150 s of "Read my website" for a new account | **Fixed 2026-11-15, back in the smoke set.** Not the product: the fake site's title "paylane: invoicing that chases late payments" became the fake product name, the fake plan and draft repeated it, and the no-ai-slop gate (colon reveal, 2026-11-12) dropped every fake draft. `fakeDrafts` now cuts the name at a colon; `cmo.check` guards it |
| `isolation` :11 | User B opening user A's project lands on `/app/studio?item=…` and never shows "not found" | The v2 redirect; the test expects the v1 page |
| `login` :38 | No `retention-banner` for a free account | The banner is not on the v2 shell |
| `ui-v2-writer` :205 | The LinkedIn filter still lists an X draft | One core post serves every platform (D3); the test predates it |
| `ui-v2-look` :38 | Serious axe violations on Schedule at 390 px | Accessibility; not in the smoke set anyway |

Each is a separate fix. When one turns green, its exclusion comes out of `test:e2e:smoke`.

## After it is merged (owner)

- Watch a week of runs. Then make **`e2e (smoke)`** a required status check on `main` (Settings → Branches), next to
  `web (Next.js)` and `database (Supabase)`.
- A flaky spec (green and red on the same code) is fixed or taken out of the smoke set the same day: a required check
  that fails at random teaches everyone to ignore it.

## Out of scope

- Running against the Vercel preview URL. The preview talks to the production Supabase; tests that create users and
  posts must not. A per-PR database (Supabase Branching) is backlog item 6.
- Visual regression screenshots for the web app (backlog §1).
- Lighthouse CI (backlog item 2).
