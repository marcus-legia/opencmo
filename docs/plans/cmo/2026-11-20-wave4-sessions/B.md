# Session B — jobs, ops, quality

Plan: [`../2026-11-20-wave4-plan.md`](../2026-11-20-wave4-plan.md). Branch `claude/launch`. Every prompt that writes
for a reader embeds `NO_AI_SLOP`; each job change gets an eval case with the fake provider.

**Owns:** `apps/web/lib/cmo/jobs/*`, `lib/cmo/loops.ts`, `schedule.ts`, `today.ts`, `digest.ts`, `lib/screens/cards.ts`
(data only), `app/api/health/*`, `lib/ops/*`, the scan quality report in `docs/cmo/`.

## 4a

### - [x] B1. Scan quality on the real product (owner's decision 3; default: yes, about $5)
Run a free scan and a paid scan on three sites (the owner's Ferreto workspace and two test B2B SaaS sites you pick and
name in the report) with the real reader and model. Score every card by hand: right person (a buyer like the ICP),
real pain in their words, fresh (under 7 days), a reply worth posting. Write `docs/cmo/2026-11-2x-scan-quality.md`
(Vietnamese) with per-source numbers and the worst five cards with why. Any source under half "worth a reply": fix
its queries or scoring before launch, with an eval case for the fix. Spend stays under $10; stop and ask if not.

Status (B, 2026-11-19): **blocked on keys and network.** The harness is ready: `lib/cmo/jobs/eval/scan-quality.ts`
(reads the site, drafts the documents, runs a free and a paid scan on an in-memory store, writes `cards.json` and a
sheet to score by hand; stops at `--max-usd`). The cloud session cannot run it: no Claude API key, no Lurk or
ScrapeCreators key, and its network denies `hn.algolia.com`, `api.lurkapi.com`, `api.scrapecreators.com` and the
sites. Run it on the owner's machine with `.env.local`, or in a session that has them.

### - [x] B2. Health and alerts
`GET /api/health/cmo` (no auth, no personal data): reader configured and last success per platform, last scan
finished, queue depth, oldest queued run age. Confirm a failed Sales scan reaches the owner's failure alert like
other jobs (`lib/ops/failure-alerts.ts`); add it if not. Checks.

### - [x] B3. Feed card reach level (data)
The Sales card on the Feed (`lib/screens/cards.ts`, `reply` kind) carries the person's `reach_level` and the one-line
reason, like Sales. C shows it. Check updated.

## 4b (only after "4b go")

### - [x] B4. Delete the hidden job kinds
TikTok / Instagram / slideshow / script / photo-caption / niche-video / studio-order job kinds, their loops, prompts,
evals, contracts lines (`packages/contracts/capabilities.json`, task kinds) and checks. One commit per area. Tell A
under Requests in A.md which SQL is now unused.

### - [x] B5. Quote card render
From A4's `quote_card`: render a 1080×1350 PNG with the brand look (colours, font, logo from the Brand document), the
quote, the community; no name, no title, no link. Existing renderer, no AI, no credit. Stored like a post image.
Check with a golden image.

### - [x] B6. Email links (owner's decision 1 default)
A builder for "Open in Gmail" (`https://mail.google.com/mail/?view=cm&to=…&su=…&body=…`) and `mailto:` with the
person's published address, the subject and the drafted body plus the opt-out line; length limits handled (long bodies
copy instead). Check.

## Requests

(none yet)
- **From the owner (B1 run, 2026-11-20, report `docs/cmo/2026-11-20-scan-quality.md`):** run on the owner's machine,
  $0.35. Cards that came out are good (Reddit 8/9 right person, all fresh, every draft worth posting), but:
  (1) ScrapeCreators is out of credits, so Facebook and Threads failed every scan (the owner tops it up; nothing to
  code, but make sure `/api/health/cmo` shows it). (2) Reddit finds too few threads outside the founder niche (Tally 9,
  Plausible 11–14 scored vs Ferreto 24–26): add short 2–4 word keyword queries ("typeform alternative") beside the long
  ones, and search inside the subs of `strategy.where_they_ask`; eval case. (3) Hacker News gave 0 cards on all three:
  check what it returns for these queries. (4) A paid card whose draft fails its checks is dropped (Plausible lost 2):
  keep the card with an empty draft, as the free scan does. Then rerun the harness on the same three sites
  (command in the file's header; source `apps/web/.env.local` and unset the Supabase variables first).
- **Từ C (C4, rà chữ):** `lib/cmo/weekly-report.ts:120` "You chose one email a week: this report is it, every Monday."
  là một colon reveal (no-ai-slop). Đề nghị: "You chose one email a week, so this report comes every Monday." Chỉ đổi
  chữ; nếu có check hay test so nguyên văn thì đổi theo.
- **Done by the owner's session (2026-11-20):** the four B1 follow-ups are in: Reddit searched over the past week
  (`searchReddit`), short queries in the query prompt, the smaller rooms capped at half the 30 scoring slots, a paid card
  whose draft fails kept undrafted, and Lurk ↔ ScrapeCreators fallback. Reruns in the report. Nothing left for B in 4a.
