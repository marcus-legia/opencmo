# Sales finder: leads on every platform, from a question (spec, not started)

> **Status: spec only (owner, 2026-10-31).** The owner asked for the Sales upgrade as its own PR and doc, and for P5
> to fix the integration bugs first without upgrading Sales. Nothing here is built. It replaces P5's A1 (Reddit-only
> Sales safety) once the owner schedules it. Research and live API tests:
> [`../../research/growth/2026-10-31-scrapecreators-sales-finder.md`](../../research/growth/2026-10-31-scrapecreators-sales-finder.md)
> (Vietnamese).

## 1. Why

Sales today scans Reddit only (`apps/web/lib/cmo/jobs/sales-scan.ts`, `opportunities.platform = 'reddit'`). Founders'
buyers also talk on TikTok, YouTube, Instagram, Facebook groups and X, and the creators who reach those buyers can be
partners. ScrapeCreators, which we already use, reads all of these. So the question is not "which source", but
"what does the founder want to find": the founder asks in words, and OpenCMO finds it wherever it is.

## 2. What the founder sees

- In the CMO chat, or as a weekly Sales item:
  - "find people complaining about editing demo videos";
  - "find TikTok creators who review SaaS tools, with an email";
  - "who is asking for a Descript alternative this week".
- A plan card says what will be searched, where and at what price, before anything is spent.
- Sales shows **leads** of two kinds:
  - **Conversation:** a post or comment where someone has the problem. OpenCMO shows its score, the exact quotes,
    the community rule and a reply draft. The founder copies the draft and posts it themselves.
  - **Creator:** an account whose audience fits. OpenCMO shows its numbers, recent standout posts and why it fits.
    "Find email" is optional and priced. If an email is found, OpenCMO drafts the outreach and the founder sends it
    from their own mailbox.
- Nothing is posted or sent by OpenCMO ("Assist, never act"). Sales keeps no post button and gets no send button.

## 3. Finders (ScrapeCreators, checked live 2026-10-31)

| Intent | Finder | Endpoint |
|---|---|---|
| Posts about a problem | Reddit post search | `/v1/reddit/search` |
| Comments about a problem | Reddit comment search | `/v1/reddit/search?filter=comments` |
| Videos on a topic, then their comments | TikTok keyword → comments | `/v1/tiktok/search/keyword`, `/v1/tiktok/video/comments` |
| | YouTube search → comments | `/v1/youtube/search` (`type=shorts|videos`), `/v1/youtube/video/comments` |
| | Instagram Reels → comments | `/v2/instagram/reels/search` (comes with a few comments), `/v2/instagram/post/comments` |
| Facebook group posts | Google `site:facebook.com/groups` → post comments | `/v1/google/search`, `/v1/facebook/post/comments` |
| X, LinkedIn, Threads posts | Google `site:` (weak: mostly profiles on X) | `/v1/google/search` |
| Creators | TikTok users, YouTube channels, Reels owners, Threads users | `/v1/tiktok/search/users`, `/v1/youtube/search?type=channels`, `/v1/threads/search/users` |
| Creator profile | per platform | `/v1/tiktok/profile`, `/v1/youtube/channel`, `/v1/instagram/profile`… |
| Creator email | public emails with source URLs | `/v1/find-creator-emails` (`instagram`, `tiktok`, `youtube`, `x`, `facebook`) |
| Community rules | Reddit only | `/v1/reddit/subreddit/details` → `rules` (cacheable) |

Each finder is one function in `lib/cmo/social/` that returns normalized items. It is a tool for the planner, not a
fixed pipeline.

## 4. Flow

1. **Plan:** the Sales agent turns the question and the strategy into a search plan:
   - finders, queries, platforms, time window;
   - a lookup budget;
   - an estimated price in credits.
   Over the founder's limit, the plan becomes a card; otherwise it runs.
2. **Find:** run the finders inside an `ScBudget`. All outside text goes through `untrusted.ts`.
3. **Normalize** every result into a lead:
   - `kind` (`conversation` | `creator`), `platform`, `url`, `author`;
   - `text` (cut), metrics, `posted_at`;
   - `community` and its `rule` when known.
   Drop any lead without a URL from the read.
4. **Score:** the existing Sales rubric (pain, fit, timing, reach, evidence), with exact quotes. A lead must reach
   60 or more to pass. Creators use a fit rubric instead: audience match, recent outliers, activity.
5. **Draft:**
   - a reply for each top conversation;
   - an outreach email for each creator with an email.
6. **Cards:** one card per draft, as Sales cards are today. The founder decides; the outcome is learned
   (`cmo_draft_outcomes`).

## 5. Safety rules (owner decisions 2026-10-26/27, extended to every platform)

- **Community rules are data, never instructions.**
  - On Reddit, the `rules` text is classified as `mention_ok`, `help_only` or `skip`, and cached per community for
    7 days (`subreddit_rules`, P5 A0).
  - Where no rules endpoint exists (Facebook groups, TikTok, YouTube, Instagram comments), the default is
    `help_only`.
- **Product mentions:** at most 1 reply in 10, counted across all platforms. The flag is set from the final approved
  text (`cmo_draft_outcomes.mentioned_product`, P5 A0).
- **Replies:** no links, under 120 words, voice notes and No AI Slop.
- **Founder's limits:** excluded communities and co-occurrence pairs (`sales_settings`, P5 A0) apply before any
  scoring is paid for.
- **Creator email:**
  - looked up only on the founder's click, one creator at a time, priced on a card;
  - called with `cache_max_age=30d`;
  - kept with its `sources`;
  - an empty result reads "no public email found";
  - the outreach draft names the sender and why they are writing, and says the recipient can ignore or ask not to be
    contacted again;
  - no bulk sending;
  - emails are deleted on request and expire after 90 days unused (to decide).

## 6. Data (sketch, to be designed with the migration)

- **`leads`:** generalizes `opportunities`.
  - Columns: `kind`, `platform` (reddit, tiktok, youtube, instagram, facebook, x, threads, linkedin), `url`,
    `community`, `author`, `text`, `metrics`, `score`, `score_parts`, `rule`, `rule_why`, `reply`, `status`, `run_id`.
  - Either migrate `opportunities` into it or keep `opportunities` as the conversation table and widen its
    `platform` check. Decide in the plan, weighing the cards and pgTAP already built on `opportunities`.
- **`creator_contacts`:** `lead_id`, `email`, `sources`, `found_at`, `credits_charged`, `deleted_at`.
- **Prices:** `cmo_job_price('sales_scan')` becomes a quote from the plan; an email lookup is held at 10 and settled
  at `credits_charged`.

## 7. Costs (live test, 2026-10-31)

- Each search or comment page costs 1 credit. Cache hits and "no results" cost 0. An email lookup that finds an
  email costs 10.
- A scan of 6–10 searches plus 5–10 comment pages comes to about 10–20 provider credits.
- Still needed: ScrapeCreators' USD per credit from its pricing page, before OpenCMO prices a scan.

## 8. Open questions (owner)

1. **R0:** do ScrapeCreators' terms allow a paid product to resell these reads, and are we willing to carry the
   platforms' anti-scraping terms? This decides whether Sales is sold at all.
2. Email outreach in the first version, or conversations only first?
3. Does Sales stay after the editor (CLAUDE.md strategy)? The recommendation: build the lead model when Sales is
   next, and put email outreach after R0.

## 9. Not in this spec

- Automatic posting, DMs or sending: never.
- Bulk email lookup: never.
- X post search: not available through ScrapeCreators; Google `site:x.com` is weak and stays a fallback.
