# Research reports

Written by the scheduled research routine (twice a week) and by agents acting as product advisor
(`CLAUDE.md`, "Product advisor role"). One file per report: `YYYY-MM-DD-<topic>.md`.

## Rotation

Each run picks the next area in this list after the last report's area, unless something urgent happened
(a major launch, a security advisory that affects our stack):

1. AI agents: tool design, agent loops, memory, evals
2. Video editing: editor features, caption/motion styles, short-form formats, competitors' releases
3. Security: LLM/agent security (prompt injection, tool abuse), web app security, Supabase/Next.js advisories
4. Workflows and automation: job engines, schedulers, marketing automation, social APIs
5. Growth for solo-founder SaaS: pricing, onboarding, activation, distribution (what is working now)
6. Editor skills and creative templates: style libraries, prompt/skill packaging, reference repos

## Report format

```markdown
# <Area>: <one-line headline>  (YYYY-MM-DD)

## TL;DR
3–5 bullets: what changed in the world, what it means for OpenCMO.

## Findings
For each finding: what it is, link(s), why it matters to us, evidence (numbers, stars, dates).

## Repos worth learning from
| Repo | What to learn | Files to read | Licence | Copy or learn only |

## Recommendations
Ranked. Each: what to do, cost (S/M/L), what it improves (activation, retention, revenue, cost, risk),
and which doc/PR/track it belongs to. "Do nothing" is a valid recommendation.

## Sources
Every URL used, with the date read.
```

Rules: English; cite everything; no copied code in reports; facts older than 6 months are marked as such; a
claim without a source is labelled as opinion.

## Index

Newest first. Each run adds one line and checks this list so it does not repeat a source.

| Date | Area | Report | Key sources |
|---|---|---|---|
| 2026-10-16 | Video editing | (seed) reference reel review, led to `docs/style-skills-build.md` | Instagram reel "5 Plugins To Code Like A Senior Dev" |
