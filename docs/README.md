# docs/

Only documents that stay true go here. A wave's plan, its session splits and its screenshots belong in the PR (or the
owner's work note in `../opencmo-internal`), not in this folder. When code changes what a page here says, fix the
page in the same PR.

| Path | What | Read it when |
|---|---|---|
| [`../ARCHITECTURE.md`](../ARCHITECTURE.md) | The system: shape, data and security, media budget, editor, Sales/Post and the job engine, clock, providers, deploy order | Before touching a part you have not worked on |
| [`agents/`](agents/) | Rules for agents: [strategy](agents/strategy.md), [product rules](agents/product-rules.md), [engineering](agents/engineering.md), [billing](agents/billing.md), [working style](agents/working-style.md) | Every session, for the parts your task touches (`CLAUDE.md`) |
| [`runbooks/incident.md`](runbooks/incident.md) | What to do when something is broken for founders | During an incident |
| [`cmo/2026-11-20-scan-quality.md`](cmo/2026-11-20-scan-quality.md) | Sales scan quality measured on real products | Before changing the scan's queries or scores |
| [`research/`](research/README.md) | Weekly research reports (in Vietnamese), one folder per track | Before proposing work in that track |
| `creem-llm.txt`, `zernio.txt` | The providers' own docs, saved for agents | Before changing billing or posting |
| `shots/` (git-ignored) | Screenshots the e2e specs write | After an e2e run; `git add -f` the ones a PR shows |

## Older documents

Plans, specs, design frames and the old architecture pages were removed on 2026-11-21, once built. Code comments and
migrations still cite them by path (`docs/plans/…`, `docs/architecture/…`, `docs/specs/…`). Every one is in git:
commit `9661594` is the last with all of `docs/plans/`, `docs/architecture/` and `docs/qa/`.

```bash
git show 9661594:docs/plans/cmo/2026-11-14-sales-finder-plan.md   # one file
git log --all --oneline -- 'docs/specs/*'                          # older ones, removed before
```

The owner's notes (strategy, landing copy, the work note, old specs) are in `../opencmo-internal`.
