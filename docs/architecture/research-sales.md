# Research and Sales

Status: **proposed** (2026-10-27), research before build. Markdown twin of [`research-sales.html`](research-sales.html),
written for agents; the two must say the same thing. Parent pages: [`ai-cmo.md`](ai-cmo.md), [`brain.md`](brain.md).

The two departments that read the outside world. **Research** is the brain's eyes: it learns the market, finds what
works, and measures what the founder posted. **Sales** finds people who need the product and drafts a helpful reply the
founder posts by hand.

## 1. Verdict

**Keep the evidence rules:** Research keeps a hook only if it points to a real URL in what it read
(`competitor-research.ts`); Sales scores pain and evidence only with quotes copied exactly from the thread, checked by
the server, and computes timing and reach in code (`sales-scan.ts`); replies help first, mention the product at most
once at the end, have no links and no post button; outside text is data; every read has a credit budget.

**Add, in order:** a data check first (GummySearch closed for lack of a commercial Reddit licence; confirm what
ScrapeCreators' terms allow); research for Studio (top shorts in the niche → hooks for video briefs); Sales safety
(subreddit rules before drafting, rare product mentions); close the loop (re-read a thread after the founder replied;
Zernio metrics for connected accounts); Hacker News as a cheap source.

## 2. Today (`main`, `eb858ca`)

| Part | Where | What it does | State |
|---|---|---|---|
| Onboarding | `lib/cmo/onboard.ts`, `site.ts` | reads the website, drafts the four marketing documents | built |
| Research tools (CMO chat) | `lib/agent/cmo-research.ts` | `search_reddit`, `subreddit_posts`, `reddit_thread`, `x_profile`, `find_outliers`, `search_videos`, `search_threads`, `get_transcript`, `research_credits` via ScrapeCreators | built |
| Competitor research | `jobs/competitor-research.ts`, `cmo_insights` | Sundays: ~100 top posts of up to 4 competitor X accounts; outliers vs each account's median; 3–6 hooks each with a real URL; ideas | built (X only) |
| Metrics | `jobs/pull-metrics.ts`, `post_metrics` | public numbers of published posts, matched by link or first words | built |
| Sales scan | `jobs/sales-scan.ts`, `opportunities` | 6–8 queries from pains and competitors → ≤ 30 threads from 30 days → score (pain 25, evidence 15 with exact quotes; fit 25; timing 20, reach 15 in code) → ≥ 60 passes → reply drafts for the best 5 | built |
| Decisions | `cmo_decide_opportunity` | replied or dismissed; dismiss reason → memory; outcome row | built |
| Niche video research, subreddit rules, reply outcomes, HN, Zernio metrics | none | — | missing |

## 3. What others teach

| Source | What it is | Take | Leave |
|---|---|---|---|
| GummySearch | Reddit audience research; no new sign-ups from 2025-11-30 after failing to secure a commercial Reddit API licence; closing late 2026 | a Reddit feature lives or dies on licensed data access; check ours | an audience database on Reddit data |
| F5Bot | free keyword alerts for Reddit, Hacker News, Lobsters | Hacker News as a source; alerts on the founder's keywords | — |
| Syften | paid monitoring (~$20–30/month); alert only when terms co-occur; exclude subreddits | co-occurrence filters; per-founder excluded subreddits | — |
| Octolens | 13+ platforms, AI relevance, sentiment, intent; API ~$0.007 a mention from $119/month | intent as a first filter before expensive scoring; a buy option later | monitoring everything |
| Reddit's rules | Content Policy rule 2 (authentic content, no spam or manipulation); subreddit self-promotion rules vary; the 90/10 norm (community); LLM-sounding replies get flagged | read subreddit rules before drafting; rare product mentions; No AI Slop guidance and voice memory in replies | anything that posts for the founder |
| Okara (internal notes) | its Reddit replies were reported as obviously AI and removed by moderators | few replies, human, approved and posted by hand | volume |
| Okara's GEO agent | tracks how a brand appears in ChatGPT, Claude, Perplexity | noted for later | now |
| Hacker News search (Algolia) | public search API, ~10,000 requests an hour per IP (third-party figure), no key | a free source for technical founders | — |

## 4. Flow

- **Research:** sources (site, X, Reddit, TikTok, YouTube, Threads via ScrapeCreators) → onboarding (`read_site` →
  four documents) → competitors (outliers vs own median; a hook needs a real URL) → niche video (new: top shorts →
  hooks for Studio briefs) → metrics (public today; Zernio for connected accounts) → out: documents, insights, ideas
  with URLs, memory.
- **Sales:** find (queries from pains and competitors; ≤ 30 threads, ≤ 30 days) → score (exact quotes for pain and
  evidence; fit; timing and reach in code) → rules check (new: subreddit forbids self-promotion → help only, or skip)
  → reply draft (< 120 words, help first, product once at the end, no links) → card (copy + open thread; replied or
  dismiss; no post button) → outcome (new: re-read the thread later → memory).
- **Shared:** outside text is data (`lib/cmo/untrusted.ts`); every claim links to its source; a credit budget per call
  (`ScBudget`, `research_credits`); daily limits in SQL; dismiss reasons → memory; outcomes in `cmo_draft_outcomes`;
  the brain decides when each runs (`loops.ts`).

## 5. Research

| Job | Gives | To | State |
|---|---|---|---|
| Know the market (`onboard`) | the four documents | every department | built |
| What works for competitors (`competitor_research`) | hooks with URLs, formats, ideas (`cmo_insights`) | Planner, Writer | built (X) |
| What works in the niche on video (`niche_video_research`) | top shorts on TikTok, YouTube Shorts, Reels for the founder's topics: hook, length, format, URL; transcripts via `get_transcript` | Writer's video brief, Studio's Director | new |
| What worked for the founder (`pull_metrics`) | views, likes, replies, reposts per post | memory, best-time picks, Writer | built; Zernio analytics later |
| Technical communities (Hacker News) | threads and comments on the founder's topics | Writer ideas, Sales | new |

An insight without a URL from the data read is dropped (unchanged). `cmo_insights.kind` grows beyond `competitors`
(the SQL check allows only that today).

## 6. Sales

| Addition | How | Why |
|---|---|---|
| Subreddit rules check | before drafting, read the subreddit's rules through the reader and mark it: product mention allowed, help only, or skip | each subreddit sets its own rules; a removed comment hurts the founder's account |
| Rare product mentions | count replied threads with and without a product mention; past ~1 in 10, the next drafts are help only and the card says why | the 90/10 community norm; marketing-looking replies get flagged |
| Reply in the founder's voice | voice memory and No AI Slop guidance, as in Writer; < 120 words; no links (decided) | LLM-sounding replies get removed |
| Outcome check | a few days after "replied", re-read the thread for replies or votes on the founder's reply; store it with the outcome | learn which threads and replies work |
| Excluded subreddits and co-occurrence | per-founder lists; queries needing two terms together | fewer false matches before paying for scoring |
| More sources | Hacker News first (free); X and Threads conversations later | where technical buyers talk |

Unchanged by design: Sales has no post button; the card copies the reply and opens the thread; the founder posts by
hand and marks it replied.

## 7. Data risk

GummySearch closed because it could not get a commercial licence from Reddit. Our Reddit reading goes through
ScrapeCreators. Before Sales is on the landing page, confirm in writing what ScrapeCreators' terms allow for a paid
product and whether Reddit's data terms reach us through them. If unclear: the official Reddit API under a commercial
agreement, or Sales on other sources (Hacker News, X, Threads) first.

## 8. Measures

- **Research:** insights used (ideas that became approved posts or videos); insights dropped for a missing URL; credits
  per week.
- **Sales:** threads passed per scan; replied vs dismissed (reasons); replies that got answers or votes; removed replies
  reported by the founder; credits per replied thread.

## 9. Build phases

- **R0** Data check: ScrapeCreators' terms for a paid product and Reddit's data terms; decide the fallback.
- **R1** Sales safety: subreddit rules check, rare product mentions, voice memory and No AI Slop guidance in replies,
  excluded subreddits.
- **R2** Research for Studio: niche video research feeding Writer's video brief and Studio's Director;
  `cmo_insights.kind` widened.
- **R3** Close the loop: reply outcome check; metrics through Zernio (with Schedule P3).
- **R4** Hacker News as a source for both departments.

## 10. Decisions for the owner

| # | Question | Recommendation |
|---|---|---|
| 1 | Check ScrapeCreators' and Reddit's terms before selling Sales? | yes, R0 first |
| 2 | Product mentions in replies | only where the subreddit allows, about 1 reply in 10 at most; otherwise help only |
| 3 | Add Hacker News | yes, free; after R1–R3 |
| 4 | Niche video research | yes, it feeds the editor strategy (R2) |
| 5 | Always-on keyword alerts | not now; scans run when the week's plan has a Reddit item |
| 6 | AI search visibility (GEO) | later |

## Sources

Code: `apps/web/lib/cmo/` (`onboard.ts`, `site.ts`, `jobs/sales-scan.ts`, `jobs/competitor-research.ts`,
`jobs/pull-metrics.ts`, `social/`), `apps/web/lib/agent/cmo-research.ts`, `supabase/schema/current.sql`
(`cmo_decide_opportunity`, `cmo_insights`, `opportunities`, `post_metrics`); internal notes
`opencmo-internal/docs/cmo/tham-khao.md` (Okara, ScrapeCreators).

Outside:
- https://syncsuptech.substack.com/p/gummysearch-shuts-down
- https://newsletter.failory.com/p/when-reddit-pulls-over
- https://devtoolpicks.com/blog/best-gummysearch-alternatives-2026
- https://redship.io/best-f5bot-alternatives
- https://octolens.com/docs/index.md, https://octolens.com/social-listening-api
- https://redship.io/blog/reddit-self-promotion-rules
- https://www.darwinapps.com/blog/reddit-marketing-guide-2026/
- https://npmjs.com/package/hacker-news-api

Most sources are vendor blogs; read Reddit's rules on its Content Policy and each subreddit's rules page.
