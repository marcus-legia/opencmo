# Scan quality on real products (wave 4 B1, 2026-11-20)

Run with `lib/cmo/jobs/eval/scan-quality.ts`, real model and readers, in-memory store (no database written). Three
sites: `ferreto.io` (ours), `tally.so` (form builder), `plausible.io` (analytics); a free and a paid scan each.

## First run (before fixes): $0.345

| Site | Scan | Threads scored | Cards | Failed sources |
|---|---|---|---|---|
| ferreto.io | free / paid | 24 / 26 | 4 / 4 | Facebook, Threads |
| tally.so | free / paid | 9 / 9 | 0 / 0 | Facebook, Threads |
| plausible.io | free / paid | 11 / 14 | 1 / 0 (2 dropped: drafts failed checks) | Facebook, Threads |

Hand scoring of the 9 cards (7 threads; right person, real pain in their words, fresh under 7 days, reply worth
posting): **8/9 right person, 9/9 fresh (≤ 3 days), every drafted reply worth posting** (help first, no link, within
the community's rules). The one miss: a freelancer selling web builds, a partial fit. Card quality was good; volume
was the problem.

Problems found:
1. **ScrapeCreators was out of credits** ("Social research is paused (out of lookup credits)"), so Facebook groups and
   Threads failed for every user in production. The owner topped it up (1,200 credits).
2. **Reddit was searched over all time.** A manual check: "typeform too expensive per submission" gave 1 of 7 results
   under 7 days; with a one-week window, 7 of 7. Most results were dropped as too old.
3. **Hacker News gave 0 cards.** Not a bug: in 7 days Algolia has almost no stories for these niches ("typeform
   alternative" 0, "google analytics alternative" 1); comments are more numerous.
4. **Facebook, Threads and HN could fill 24 of the 30 scoring slots** once they answered, leaving Reddit, the room that
   gives most cards, about 6.

## Fixes

- Reddit searched over the scan's own age window (`timeframe: "month"`, matching `MAX_AGE_DAYS = 30`, most relevant
  first); Research and the competitor finder keep all time.
- The query prompt asks for at least three 2–3 word queries ("typeform alternative", "GA4 confusing").
- The smaller rooms take turns for at most half the 30 slots; Reddit keeps the rest.
- Lurk ↔ ScrapeCreators fallback when one provider is out of credits, refuses its key or is down (one lookup of the
  budget either way).
- Keeping a paid card whose draft failed its checks was tried and reverted: `cmo_save_opportunities` drops it in SQL,
  and changing that waits until after launch.

## Reruns

| Run | Threads scored (free: Ferreto / Tally / Plausible) | Cards (free) | Cost |
|---|---|---|---|
| 1, before fixes | 24 / 9 / 11 | 4 / 0 / 1 | $0.345 (free and paid) |
| 2, one-week window, short queries, social sources back | 30 / 30 / 30 | 1 / 1 / 2 | $0.403 (free and paid) |
| 3, plus the slot split | 30 / 30 / 30 | 2 / 0 / 3 | $0.210 (free only) |

Reading:
- Every scan now has the full 30 threads to score, outside the founder niche too. Cards are capped at 5 a scan and
  gated by the score bar; the cards that came out are still the right people and fresh.
- Facebook group and Threads posts were scored but none passed the bar in either rerun. Check whether they are the
  right people before the landing presents all four sources as equal (after launch).
- Tally gets 0–1 cards: few people write about forms where we look, in a week. A limit of the niche; the ICP fit test
  in onboarding should say so to such founders.
- In the harness, the paid scan shares the in-memory store with the free scan of the same site and skips threads the
  free scan saw, so the paid numbers understate.
- The reruns used a one-week window; the code now uses a month, as the scan keeps threads up to 30 days old.
