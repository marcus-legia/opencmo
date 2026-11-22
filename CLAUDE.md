# CLAUDE.md

Guidance for Claude Code and other coding agents in this repository. Human contributors: see
[CONTRIBUTING.md](CONTRIBUTING.md); the rules are the same. `[[path]]` is a wiki link to a file, from the root of this
repo; `[[internal:path]]` is a file in the sibling repo `../opencmo-internal` (the owner's notes, in Vietnamese).
A code comment citing `CLAUDE.md "<section>"` (Known traps, Verify by looking, Strategy…) means the section of that name,
now in `docs/agents/`.

## Read first, every session

1. [[internal:docs/cmo/2026-11-20-viec-truoc-launch]]: **the work note**, what is open before the 30/11 launch, what
   the owner must decide, what is done. Tick an item there when you finish it; add new work to it.
2. [[internal:research/0_writing/Strategy_opencmo/12 Ket luan du an]]: the project's conclusions (customer, product,
   price, marketing). It wins when anything here disagrees.
3. [[internal:research/0_writing/Strategy_opencmo/13 Landing page content]]: **the source of every word on the
   landing page.** Read it before changing landing copy. Keep the lines the owner chose; change only what the product
   changed since.
4. Whatever below touches your task: [[docs/agents/strategy]], [[docs/agents/product-rules]],
   [[docs/agents/engineering]], [[docs/agents/billing]], [[docs/agents/working-style]].

Write the owner's decisions into the work note (or the session's memory), not only into a plan: a decision buried in a
plan gets lost.

## Project

**Ferreto** (renamed from OpenCMO on 2026-11-18) finds the people already asking for what a founder built. It learns
the business from its website, searches Reddit, Hacker News, Threads and Facebook groups for people describing the
problem, scores each thread with quotes from it as evidence, and drafts a reply, a DM or an email that the founder
sends from their own account. **Post** (a week of posts for X, LinkedIn and Threads, approved once) comes with it;
**Video** (the editor for videos the founder records) is secondary.

- Domains: `ferreto.io` (app at `/app`); the blog at `blog.ferreto.io` from PR #246 (`lib/site.ts` `blogUrl`, never a hard-coded
  `/blog`); `ferreto.app` redirects (308) to `ferreto.io`; `opencmo.io` is no longer served (removed 2026-11-22). Package, SQL and env
  names (`@opencmo/*`, `OPENCMO_*`) keep the old name; everything a user reads says Ferreto.
- One system: Next.js + Supabase + a Modal worker. No second runtime. Motion is one renderer (Remotion,
  `clip-motion`); the editor is one runtime (`clip-render`). No three.js or Lottie.
- `docs/` holds only what stays current ([[docs/README]]); a wave's plan goes in its PR or the work note. The owner's
  own notes live in `../opencmo-internal`.

## Rules you must not break

Details and the reasons: [[docs/agents/product-rules]], [[docs/agents/strategy]], [[docs/agents/billing]].

- **Assist, never act.** Nothing goes out (reply, DM, email, post) unless the founder sends or approves it, from their
  own account. No automatic liking, following, commenting, several accounts or fake engagement. The one exception is
  narrow per-platform autopilot for single posts (X, Threads, LinkedIn); do not widen it.
- **One customer:** founders selling B2B/prosumer software. B2B channels only: no TikTok, Instagram, slideshows or video
  scripts (deleted in wave 4b).
- **Copy:** software, not a service ("drafts you approve and publish"). No "AI CMO", "in your voice", "marketing team",
  model names as features, "every day" for scans, or "coming soon". Name only the platforms the scan really reads.
  Every word a person reads goes through `NO_AI_SLOP`.
- **Video is the user's own:** upload only, no link import, no clipping tool.
- **Creem is the only payment provider.** Prices live in `billing_catalog`, never in code or copy. Image and video
  prompts go through Creem's Moderation API. Check a feature or a claim against Creem's prohibited and restricted
  lists before building it ([[docs/agents/billing]]).
- **Charge before running:** one estimate, one confirmation, then the job runs to the end.
- **One model provider: Claude** (Sonnet to write and plan, Haiku for small tasks).

## Engineering essentials

Details: [[docs/agents/engineering]].

- Every write goes through an ownership-checking RPC; money only through `credit_hold` / `credit_settle` /
  `credit_refund` / `credit_held`. Validate in three layers (zod, RPC, worker). Files never pass through Next.js.
- A migration needs a pgTAP test in `supabase/tests/`; then regenerate `supabase/schema/current.sql` with
  `scripts/dump-schema.sh`. A new table grants nothing to `anon`/`authenticated` beyond what the app reads.
- Peak RAM per job < 2 GB. Never load video frames into Python, no MoviePy, `-ss` before `-i`, user media read with an
  explicit format.
- Green tests do not prove a video works: extract a frame from the full-size file and look at it.

```bash
npm run dev                          # Docker → local Supabase → Next.js + worker (127.0.0.1:3000)
npm run db:reset && npm run db:test  # migrations + pgTAP
npm run typecheck && npm run build
cd apps/web && npm run check:contracts && npm run check:blog && npm run test:e2e
```

## Language

Everything in this repo is **English**: code, comments, docs, commits, PRs and all user-facing text, including SQL
`raise exception` messages, `jobs.error` and route-handler errors (they reach the user verbatim). Translate an older
Vietnamese comment when you touch its block. Comments explain why, not what. Exception: research reports in
`docs/research/` are in Vietnamese ([[docs/research/README]]).

## Working style

Details: [[docs/agents/working-style]].

- Don't expand scope; note out-of-scope ideas in the PR, an issue or the work note.
- Commit and push finished work to the task's branch and PR as you go, in English. Deploys, merges, production
  migrations and force-pushes wait for the owner.
- Parallel sessions share one branch and one PR, with file ownership decided before they start.
- You are also the owner's product advisor: recommend, with the cost and what it replaces; disagree when the evidence
  says so.
