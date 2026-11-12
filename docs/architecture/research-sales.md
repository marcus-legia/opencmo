# Research and Sales

Status: **built** (`main` at `4f70a59`, 2026-11-08), except R0, the data check. Designed 2026-10-27, built in phases
R1–R4 (P5–P6). Markdown twin of [`research-sales.html`](research-sales.html), written for agents; the two must say the
same thing. Parent pages: [`ai-cmo.md`](ai-cmo.md), [`brain.md`](brain.md).

The two departments that read the outside world. **Research** is the brain's eyes: it learns the market, finds what
works, and measures what the founder posted. It is step 1 of the owner's sketch (2026-11-08): the website becomes the
four documents everything else is written from. **Sales** finds people who need the product and drafts a helpful reply
the founder posts by hand.

## 1. Verdict

**Kept, the evidence rules:** Research keeps a hook only if it points to a real URL in what it read
(`competitor-research.ts`); Sales scores pain and evidence only with quotes copied exactly from the thread, checked by
the server, and computes timing and reach in code (`sales-scan.ts`); replies help first, mention the product at most
once at the end, have no links and no post button; outside text is data; every read has a credit budget.

**Built since:** niche video research for Studio; Sales safety (subreddit rules before drafting, rare product
mentions, excluded subreddits, co-occurrence); the closed loop (reply outcomes, Zernio metrics); Hacker News as a free
source for both departments.

**Left:** R0, the data check (owner: whether ScrapeCreators' terms and Reddit's data terms allow a paid product to
read them), before new Sales lead types. Sales charges before running since S3.5–S3.6: a scan asked in the CMO chat stops at a price card, "Scan now" on the Sales screen shows the same card, and the dead "Add N credits and finish" button is removed (a scan holds its credits before it starts and runs in one go).

## 2. Research and Sales as built (`main`, `4f70a59`)

State: ✅ done · 🟡 partial · ❌ not built.

| Part | Where | What it does | State |
|---|---|---|---|
| Onboarding | `lib/cmo/onboard.ts`, `site.ts` | reads the website, drafts the four marketing documents | ✅ |
| Research tools (CMO chat) | `lib/agent/cmo-research.ts` | `search_reddit`, `subreddit_posts`, `reddit_thread`, `x_profile`, `find_outliers`, `search_videos`, `search_threads`, `get_transcript`, `research_credits` via ScrapeCreators | ✅ |
| Competitor research | `jobs/competitor-research.ts`, `cmo_insights` (`kind = competitors`) | Sundays: top posts of up to 4 competitor X accounts; outliers vs each account's median; 3–6 hooks each with a real URL; ideas; Hacker News too | ✅ |
| Niche video research | `jobs/niche-video-research.ts`, `cmo_insights` (`kind = niche_video`) | top shorts on TikTok and YouTube for the strategy's topics: hook, format, lift, URL; the week's briefs wait on it | ✅ |
| Metrics | `jobs/pull-metrics.ts`, `metrics-source.ts`, `post_metrics`, `account_metrics` | public numbers of published posts, and Zernio analytics for connected accounts | ✅ |
| Sales scan | `jobs/sales-scan.ts`, `opportunities` | queries from pains and competitors → threads from 30 days on Reddit and Hacker News → excluded subreddits and co-occurrence → score (pain 25, evidence 15 with exact quotes; fit 25; timing 20, reach 15 in code) → ≥ 60 passes → reply drafts for the best | ✅ |
| Subreddit rules | `subreddit_rules` | before drafting: `mention_ok`, `help_only` or `skip` | ✅ |
| Rare product mentions | `sales-scan.ts` (`recentMentions`, `waitingMentions`) | about 1 reply in 10 may name the product; past it, help only | ✅ |
| Decisions | `cmo_decide_opportunity` | replied or dismissed; dismiss reason → memory; outcome row | ✅ |
| Reply outcomes | `jobs/reply-outcomes.ts` | a few days after "replied", re-reads the thread for answers or votes | ✅ |
| A card before a scan | `lib/agent/cmo-tools.ts` (`create_task`), `components/today/AgentSales.tsx` | a price card in the chat and behind "Scan now"; nothing is held before Approve | ✅ S3.5–S3.6 |
| Data terms (R0) | — | ScrapeCreators' and Reddit's terms for a paid product | ❌ owner |
| New lead types ([spec](../plans/cmo/2026-10-31-sales-finder-spec.md) F1–F10) | — | wait on R0 | ❌ |

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

- **Research:** sources (site, X, Reddit, TikTok, YouTube, Threads via ScrapeCreators; Hacker News search) → onboarding (`read_site` →
  four documents) → competitors (outliers vs own median; a hook needs a real URL) → niche video (top shorts → hooks
  for Studio briefs) → metrics (public, and Zernio for connected accounts) → out: documents, insights, ideas
  with URLs, memory.
- **Sales:** find (queries from pains and competitors on Reddit and Hacker News; ≤ 30 threads, ≤ 30 days) → score (exact quotes for pain and
  evidence; fit; timing and reach in code) → rules check (subreddit forbids self-promotion → help only, or skip)
  → reply draft (< 120 words, help first, product once at the end, no links) → card (copy + open thread; replied or
  dismiss; no post button) → outcome (re-read the thread later → memory).
- **Shared:** outside text is data (`lib/cmo/untrusted.ts`); every claim links to its source; a credit budget per call
  (`ScBudget`, `research_credits`); daily limits in SQL; dismiss reasons → memory; outcomes in `cmo_draft_outcomes`;
  the brain decides when each runs (`loops.ts`).

## 5. Research

| Job | Gives | To | State |
|---|---|---|---|
| Know the market (`onboard`) | the four documents | every department | ✅ |
| What works for competitors (`competitor_research`) | hooks with URLs, formats, ideas (`cmo_insights`) | Planner, Writer | ✅ X and Hacker News |
| What works in the niche on video (`niche_video_research`) | top shorts on TikTok and YouTube for the founder's topics: hook, length, format, URL | Writer's video brief, Studio's Director | ✅ |
| What worked for the founder (`pull_metrics`) | views, likes, replies, reposts per post | memory, best-time picks, Writer | ✅ public and Zernio |
| Technical communities (Hacker News, `lib/cmo/social/hn.ts`) | threads and comments on the founder's topics | Writer ideas, Sales | ✅ |

An insight without a URL from the data read is dropped. `cmo_insights.kind` is `competitors` or `niche_video`.

## 6. Sales

| Addition | How | State |
|---|---|---|
| Subreddit rules check | before drafting, read the subreddit's rules and mark it: product mention allowed, help only, or skip | ✅ |
| Rare product mentions | count replied threads with and without a product mention; past ~1 in 10, the next drafts are help only and the card says why | ✅ |
| Reply in the founder's voice | voice notes and no-ai-slop guidance, as in Writer; < 120 words; no links (decided) | ✅ |
| Outcome check | a few days after "replied", re-read the thread for replies or votes on the founder's reply; store it with the outcome | ✅ |
| Excluded subreddits and co-occurrence | per-founder lists (`sales_settings`); queries needing two terms together | ✅ |
| More sources | Hacker News (free) | ✅; X and Threads conversations wait on R0 |
| A price card before every scan | `cmoScope.plan()` prices `create_task{agent:"sales"}` like every paid tool | ✅ S3.5 |

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

Built: **R1** Sales safety · **R2** research for Studio · **R3** the closed loop (reply outcomes, Zernio metrics) ·
**R4** Hacker News. Not built: **R0**, the data check, which the owner answers before new Sales lead types.

What is left, ranked by the CMO loop (owner, 2026-11-08): ScrapeCreators' response shapes checked against real responses (S3.4 built the capture script and the checks; the owner runs it once with the real key, until then the fixtures are marked assumed); then R0. Done: no Sales scan spends credits without a card (S3.5–S3.6).

## 10. Decisions for the owner

| # | Question | Decision (owner, 2026-10-27: as recommended) |
|---|---|---|
| 1 | Check ScrapeCreators' and Reddit's terms before selling Sales? | yes, R0 first; **still open** on 2026-11-08 |
| 2 | Product mentions in replies | only where the subreddit allows, about 1 reply in 10 at most; otherwise help only (built) |
| 3 | Add Hacker News | yes, free (built) |
| 4 | Niche video research | yes (built, R2) |
| 5 | Always-on keyword alerts | not now; scans run when the week's plan has a Reddit item |
| 6 | AI search visibility (GEO) | later |
| 7 | New Sales lead types | **decided 2026-11-08**: fix what exists; new types wait on R0 |

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
