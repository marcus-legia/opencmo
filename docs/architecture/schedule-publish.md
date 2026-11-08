# Schedule and Publish

Status: **built** (`main` at `4f70a59`, 2026-11-08). Designed 2026-10-26, built in phases P0–P3 (P4–P6) and the CMO
review (#169–#180). Markdown twin of [`schedule-publish.html`](schedule-publish.html), written for agents; the two
must say the same thing. Parent pages: [`ai-cmo.md`](ai-cmo.md), [`approval.md`](approval.md).

Two departments that run back to back, the last step of the owner's sketch (2026-11-08). **Schedule** owns time: when
each approved deliverable goes out, on which platform and account. **Publish** owns the door to the platforms: one
adapter that posts through Zernio at the approved time, or hands the founder a ready composer when no account is
connected.

## 1. Verdict

- **Built: every platform through Zernio, X included** (owner, 2026-10-26). The founder connects each account once
  through Zernio's OAuth link; at the approved time the worker posts through Zernio and a signed webhook confirms.
  Tokens stay with Zernio; we never build a platform app.
- Still "assist, never act": nothing goes out without the founder's approval of content, time and account, on the
  founder's own account. The copy says "you approve when it posts".
- **Live only with the owner's switches:** `ZERNIO_API_KEY` with `OPENCMO_PUBLISH_LIVE=1`, and `ZERNIO_WEBHOOK_SECRET`
  (the Costs page shows both). Still
  to check before it is sold: Zernio's TikTok audit (or TikTok posts go private), its real price per connected
  account, and its terms for a SaaS reselling posting.
- The intent link is the fallback for a founder with no connected account, or when Zernio is down. X API cost passes
  through: ~$0.015 a post, ~$0.20 with a link.

## 2. Schedule and Publish as built (`main`, `4f70a59`)

State: ✅ done · 🟡 partial · ❌ not built.

| Part | Where | What it does | State |
|---|---|---|---|
| Timezone | `profiles.timezone` (`20261227093000`), set from the browser (`20270106010000`) | every slot, the digest hour and best time run in the founder's timezone | ✅ |
| Slots | `schedule_slots`, `schedule_propose`, `schedule_pick_time`, `schedule_change` | a time per platform for each approved deliverable; one `schedule` card per slot | ✅ |
| Default slots and rules | `packages/contracts/schedule-defaults.json`, `schedule_rules()` | Buffer 2026 times per platform, 3 hours between posts on one platform, daily caps, ±4 minutes of jitter | ✅ |
| Best time from data | `best_slots`, `best_slots_refresh`, `best_time_rules()` | the founder's own hours take over once a platform has 10 posts with metrics | ✅ |
| Firing | Modal `sweep` → `schedule_claim_due` → `jobs/publish-post.ts` → worker `publish_media` | a due slot is claimed with a lease and posted; past its window it is `missed` and asks again | ✅ |
| Accounts | `social_accounts`, `zernio_profiles`, `lib/departments/publish/accounts.ts` | connect and disconnect through Zernio; ids only, no tokens | ✅ |
| Adapter | `lib/departments/publish/adapter.ts`, `zernio.ts`, `intent.ts` | `zernio` for 6 platforms; `intent` for X, Threads, LinkedIn | ✅ |
| Webhook | `app/api/webhooks/zernio`, `webhook-handle.ts`, `zernio_receipts` | signed, with a receipts table against replays; sets slot and deliverable status | ✅ |
| Metrics | `jobs/pull-metrics.ts`, `metrics-source.ts`, `publish/analytics.ts`, `account_metrics` | public numbers, and Zernio analytics for connected accounts | ✅ |
| Outbound caps | `operation_log`, `cmo_decide_post`, `schedule_day_count` | 5 X approvals a day; daily caps per platform | ✅ |

## 3. What others teach

| Source | What it is | Take | Leave |
|---|---|---|---|
| Typefully | saved time slots; suggested X times from audience engagement; "natural posting times" ±4 min; queue and calendar with drag and drop | slots per platform; suggested times from own data; small jitter | — |
| Buffer | 2026 study of 52 million posts (best slots per platform; LinkedIn later in the day); queue; approvals separate from scheduling | default slots until the founder has own data | scheduling apart from approval |
| Zernio | ~15 platforms: profile per customer, OAuth connect, presigned media, `scheduledFor` + timezone, 409 on slot clash, queues (`queuedFromProfile`), webhooks, analytics, TikTok creator info, AI-generated label | adapter target for everything an intent link cannot reach; tokens stay with Zernio | its queue as our source of truth (our slots stay in our database) |
| TikTok Content Posting API | unaudited apps post privately to ≤ 5 users a day; audit checks the UI (creator nickname and avatar, privacy selector, interaction toggles) | show those fields on the schedule card; check Zernio's audit before selling TikTok posting | our own TikTok app |
| Threads web intent (Meta) | `threads.com/intent/post` with `text`, `url`, `tag`; opens the app on phones | Threads in remind mode with no API | — |
| LinkedIn share | `linkedin.com/sharing/share-offsite/?url=`; no confirmed text prefill | copy the text, then open LinkedIn | claiming one-tap LinkedIn posting |
| Postiz (AGPL) | open-source scheduler | read to learn slot and provider modelling | its code |

## 4. From approved to live

- **Schedule:** deliverable (approved) → proposed slot (best time per platform, founder's timezone, gaps, caps) →
  schedule card (platform, account, time; all three approved) → `waiting` (an edit raises a new card) → `due` (Modal
  `sweep`, every minute, lease).
- **Publish mode** (an account is connected): due → `publishing` → the worker uploads the media to Zernio
  (`publish_media`), then posts → signed webhook (status, post id, failure reason) → `published` → metrics after 24 h.
- **Intent mode** (no connected account for that platform): due → a notice (push, email, in-app: "time to post on
  X") → the founder posts through the intent link with the text filled in → published (paste the link, or metrics find
  it). TikTok, YouTube and Instagram have no web composer that takes a video: their card asks the founder to connect
  the account.
- **One adapter:** `publish(deliverable, slot)` → `{ status, external_id, url, error }`; the brain and event rules
  never know which path ran.

## 5. Schedule

As built (`schedule_slots`):

```
id, user_id
deliverable_id   the approved post, short, slideshow…
platform         x | threads | linkedin | tiktok | instagram | youtube
account_id       → social_accounts; null in intent mode
mode             publish | intent
publish_at       UTC; shown in the founder's timezone
window_ends_at   past it the slot is missed, never posted late
status           proposed | waiting | due | reminded | publishing | published | missed | failed | cancelled
approval_id      the schedule card
jitter_seconds   ±240, natural posting
options          platform fields (TikTok privacy and toggles, the AI-generated label)
idempotency_key, lease_until, attempts, media_task_id
external_id, external_url, error, published_at
```

How a time is picked (`schedule_rules()`, `best_time_rules()`):
- **Timezone first:** `profiles.timezone`, set at onboarding from the browser, editable.
- **Default slots** per platform from Buffer's 2026 study, stored as data (`schedule-defaults.json`).
- **The founder's own data** takes over once a platform has 10 published posts with metrics (best median views per
  hour, last 90 days).
- **Gaps and caps:** 3 hours between two posts on one platform; daily caps X 5, Threads 2, LinkedIn 1, TikTok 2,
  Instagram 1, YouTube 2; up to 3 proposals over the next 14 days.
- A short and its long video are not posted on the same platform the same day.
- Rules are code; no model picks the time.

The clock is Modal's `sweep`: it claims due slots with a lease and starts the publish job or the reminder. A slot past
its window becomes `missed` and raises a new card; it never posts late. Moving an item changes the time and supersedes
its card.

## 6. Publish

| Adapter | Platforms | Who taps post | Tokens | Cost | State |
|---|---|---|---|---|---|
| `zernio` (main) | X, Threads, LinkedIn, TikTok, Instagram, YouTube | the system at the approved time | held by Zernio; we keep account ids | ~$6 per connected account after 2 free (third-party listing); X posts at X's API price | ✅ live with the owner's key |
| `intent` (fallback) | X (intent), Threads (web intent), LinkedIn (copy + open) | the founder | none | $0 | ✅ |

- Media goes from the worker straight to Zernio's presigned upload, never through Next.js (web rule 3).
- Zernio webhooks land on a signed Vercel route with a receipts table against replays (like Creem's) and set slot and
  deliverable status; a failure raises a card with the reason and a retry that reuses the still-valid approval.
- Connecting an account is the founder's own OAuth through Zernio's connect link; `social_accounts` stores Zernio
  profile and account ids, platform and handle; disconnecting removes them.

## 7. Platform rules the card must show

| Platform | Rules |
|---|---|
| X | 280 characters; no hashtags and no links in posts (our rule); a link makes an API post cost more; no automated replies by keyword |
| Threads | 500 characters; no hashtags; web intent opens the app on phones |
| TikTok | creator nickname and avatar, privacy selector from the account's options, comment/duet/stitch toggles, AI-generated label toggle (the founder decides); photo posts up to 35 images |
| Instagram, YouTube | business or creator accounts for Instagram; vertical specs for Reels and Shorts; titles and descriptions per platform from Writer |
| LinkedIn | no confirmed text prefill on the share URL: copy, then open; API path through Zernio |

## 8. Rules and safety

| Rule | Guard |
|---|---|
| Nothing goes out without an approved time and account | schedule card snapshot (Approval rule 1); the publish job checks it again (`schedule_ready_check`) |
| Never late, never twice | `missed` after the window; lease on the slot; an idempotency key per slot to the adapter |
| Assist, never act on engagement | the adapter publishes only the founder's own posts; no likes, follows, comments, replies or multiple accounts |
| AI-generated label | decided 2026-10-26: the founder decides; the card shows the platform's toggle (off by default) with one line of help |
| Tokens | never in our database; the founder can disconnect any time |
| Kill switch | the brain's kill switch stops waiting slots too |

## 9. Measures

Slots posted on time (remind mode: within an hour of the notice) · missed and failed slots with reasons · median
views per slot hour per platform (feeds the best-time pick) · posts per week per platform against `cmo_goals`.

## 10. Build phases

All built: **P0** account connect, timezone, a Zernio profile per founder · **P1** scheduled posting through Zernio,
schedule cards, signed webhooks, the intent fallback · **P2** best time, jitter, gaps and caps · **P3** metrics
through Zernio.

What is left, ranked by the CMO loop (owner, 2026-11-08): the owner's Zernio checks (TikTok audit, price, terms) and
live keys; then a founder approves one post and schedules it within the first minutes (plan §4, "done when").

## 11. Decisions for the owner

| # | Question | Decision |
|---|---|---|
| 1 | Ship remind mode first, with no tokens? | **decided 2026-10-26: no**; everything through Zernio, the intent link only as a fallback |
| 2 | Allow posting at the approved time? | **decided: yes**, per slot with its own approval of content, time and account |
| 3 | Zernio or our own platform apps? | **decided: Zernio for every platform, X included**; check its TikTok audit, price and terms before launch |
| 4 | Minimum gap and daily cap per platform | **built**: 3 hours; caps X 5, Threads 2, LinkedIn 1, TikTok 2, Instagram 1, YouTube 2 |
| 5 | AI-generated label on AI video | **decided 2026-10-26: the founder decides**; a toggle on the card, off by default |
| 6 | Natural posting jitter | **built**: up to ±4 minutes |

## Sources

Code: `apps/web/lib/cmo/jobs/plan-week.ts`, `pull-metrics.ts`, `apps/web/components/cmo/workspace/actions.ts`
(`xIntent`), `supabase/schema/current.sql` (`content_items`, `cmo_mark_posted`, `operation_log`, `post_metrics`; no
timezone column); internal notes `opencmo-internal/docs/cmo/tham-khao.md` §4–5.

Outside:
- https://support.typefully.com/en/articles/9210135-scheduling-queue-and-calendar
- https://buffer.com/resources/best-time-to-post-social-media/
- https://www.socialpilot.co/insights/best-times-to-post-on-social-media
- https://docs.zernio.com/guides/queue-scheduling
- https://docs.zernio.com/accounts/get-tiktok-creator-info
- https://zernio.com/tiktok-api
- https://developers.tiktok.com/doc/content-posting-api-reference-direct-post
- https://bundle.social/blog/tiktok-api-approval
- https://developers.facebook.com/docs/threads/threads-web-intents
- https://werd.io/seeking-share-urls-for-every-platform/
- https://techcrunch.com/2026/04/22/x-makes-it-more-expensive-to-post-links-through-its-api/

Not verified: Zernio's TikTok audit status (its page says it handles platform approvals), its current price, and a
LinkedIn text prefill. Best-time studies come from scheduling vendors' own data.
