# Schedule and Publish

Status: **proposed** (2026-10-26), research before build. Markdown twin of
[`schedule-publish.html`](schedule-publish.html), written for agents; the two must say the same thing. Parent pages:
[`ai-cmo.md`](ai-cmo.md), [`approval.md`](approval.md).

Two departments that run back to back. **Schedule** owns time: when each approved deliverable goes out, on which
platform and account. **Publish** owns the door to the platforms: one adapter that either hands the founder a ready
composer or, once the owner decides, posts through Zernio at the approved time.

## 1. Verdict

- **Decided 2026-10-26: every platform through Zernio, X included** (owner's call, to keep it simple). The founder
  connects each account once through Zernio's OAuth link; at the approved time the worker posts through Zernio and a
  webhook confirms. Tokens stay with Zernio; we never build a platform app; X goes the same way (Zernio passes X's
  API price through).
- This is still "assist, never act": nothing goes out without the founder's approval of content, time and account, on
  the founder's own account. The copy changes from "you post it" to "you approve when it posts"; landing and cards
  must say so.
- **Before it ships:** check Zernio's TikTok audit (or TikTok posts go private), its real price per connected account,
  and its terms for a SaaS reselling posting. The intent link stays only as a fallback for a founder with no
  connected account (or when Zernio is down). X API cost passes through: ~$0.015 a post, ~$0.20 with a link.
- **Found in the code:** no timezone anywhere for a founder; scheduling at a time needs one first.

## 2. Today (`main`, `eb858ca`)

| Part | Where | What it does | State |
|---|---|---|---|
| Week plan days | `content_items.day`, `plan-week.ts` | each item has a day, not a time | day only |
| Posting to X | `xIntent()` in `components/cmo/workspace/actions.ts` | opens `x.com/intent/post?text=…`; the founder taps post | built |
| Marking posted | `cmo_mark_posted` | approved → published, optional checked X URL, logged in `operation_log` | built |
| Outbound caps | `operation_log`, `cmo_decide_post` | 5 X approvals a day | built |
| Metrics | `pull-metrics.ts`, `post_metrics` | public views, likes, replies, reposts | built |
| Timezone, time slots, reminders, other platforms, connected accounts, adapter | none | — | missing |

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

- **Schedule:** deliverable (approved) → proposed slot (best time per platform, founder's timezone, gaps) → schedule
  card (platform, account, time; all three approved) → waiting (`schedule_slots`; an edit raises a new card) → due
  (Modal `sweep`, every minute, lease).
- **Remind mode (v1, no tokens):** due → notice (push, email, in-app: "time to post on X") → the founder posts through
  the intent link with the text filled in → published (paste the link, or metrics find it) → metrics.
- **Adapter mode (after the owner decides):** due → `publish_post` work order (worker) → Zernio (media uploaded from
  the worker, then the post) → signed webhook (status, post id, failure reason) → published → metrics after 24 h.
- **One adapter:** `publish(item, slot)`: `intent` (X, Threads web intent, LinkedIn and Facebook copy + open);
  `zernio` (TikTok, IG, YouTube, LinkedIn, Threads, FB…); `x_api` (optional, pay per post).

## 5. Schedule

```
id, user_id
deliverable_id   the approved post, short…
platform         x | threads | linkedin | tiktok | instagram | youtube…
account_id       → social_accounts (adapter mode); null in remind mode
publish_at       UTC; shown in the founder's timezone
mode             remind | publish
status           proposed | waiting | due | reminded | publishing | published | missed | failed | cancelled
approval_id      the schedule card
jitter_seconds   ±4 min, natural posting
external_id, external_url, error
```

How a time is picked:
- **Timezone first:** new `profiles.timezone`, set at onboarding from the browser, editable.
- **Default slots** per platform from published studies (Buffer 2026), stored as data.
- **The founder's own data** takes over once a platform has ~10 published posts with metrics (best median views).
- **Gaps and caps:** a few hours between two posts on one platform; daily cap per platform in SQL.
- A short and its long video are not posted on the same platform the same day.
- Rules are code; a model only explains the pick in one line on the card (optional).

The clock is Modal's `sweep`: it claims due slots with a lease and creates a publish work order or a reminder. A slot
past its window becomes `missed` and raises a new card; it never posts late. The calendar gains a time per item and
drag and drop; moving an item changes the time and supersedes its card.

## 6. Publish

| Adapter | Platforms | Who taps post | Tokens | Cost | State |
|---|---|---|---|---|---|
| `zernio` (main, decided) | every platform: X, TikTok, Instagram, YouTube, LinkedIn, Threads, Facebook, Pinterest, Bluesky… | the system at the approved time | held by Zernio; we keep account ids | ~$6 per connected account after 2 free (third-party listing); X posts at X's API price | new |
| `intent` (fallback) | X (intent), Threads (web intent), LinkedIn and Facebook (copy + open) | the founder | none | $0 | X built |

- One function `publish(deliverable, slot)` → `{ status, external_id, url, error }`; the brain and event rules never
  know which adapter ran.
- Media goes from the worker straight to Zernio's presigned upload, never through Next.js (web rule 3).
- Zernio webhooks land on a signed Vercel route with a receipts table against replays (like Polar's) and set slot and
  deliverable status; a failure raises a card with the reason and a retry that reuses the still-valid approval.
- Connecting an account is the founder's own OAuth through Zernio's connect link; `social_accounts` stores Zernio
  profile and account ids, platform and handle; disconnecting removes them.

## 7. Platform rules the card must show

| Platform | Rules |
|---|---|
| X | 280 characters; at most two hashtags; a link makes an API post cost more; no automated replies by keyword |
| Threads | 500 characters; no hashtags; web intent opens the app on phones |
| TikTok | creator nickname and avatar, privacy selector from the account's options, comment/duet/stitch toggles, AI-generated label for AI video; photo posts up to 35 images |
| Instagram, YouTube, Facebook | business or creator accounts for Instagram; vertical specs for Reels and Shorts; titles and descriptions per platform from Writer |
| LinkedIn | no confirmed text prefill on the share URL: copy, then open; API path through Zernio |

## 8. Rules and safety

| Rule | Guard |
|---|---|
| Nothing goes out without an approved time and account | schedule card snapshot (Approval rule 1); the publish order checks it again |
| Never late, never twice | `missed` after the window; lease on the slot; idempotency key per slot to the adapter |
| Assist, never act on engagement | the adapter publishes only the founder's own posts; no likes, follows, comments, replies or multiple accounts |
| Honest AI video | AI-generated label where offered, always on for long-take video |
| Tokens | never in our database in adapter mode; the founder can disconnect any time |
| Kill switch | the brain's kill switch stops waiting slots too |

## 9. Measures

Slots posted on time (remind mode: within an hour of the notice) · missed and failed slots with reasons · median
views per slot hour per platform (feeds the best-time pick) · posts per week per platform against `cmo_goals`.

## 10. Build phases

- **P0 Zernio checks and account connect:** TikTok audit, price, terms; `profiles.timezone`; a Zernio profile per
  founder; `social_accounts` with connect and disconnect, X first.
- **P1 Scheduled posting through Zernio:** a time per calendar item; `schedule_slots`; schedule cards (Approval A3);
  `sweep` fires due slots into `publish_post` orders; media from the worker; signed webhooks with receipts; TikTok
  fields on the card; intent fallback for founders with no connected account.
- **P2 Best time:** default slots as data; own slots once a platform has enough posts; jitter; gaps and caps.
- **P3 Metrics through Zernio:** Zernio analytics next to today's public reading.

P1 needs Approval A0–A1 and the A3 schedule card. Studio S2–S3 (shorts, slideshows) go out the same way.

## 11. Decisions for the owner

| # | Question | Recommendation |
|---|---|---|
| 1 | Ship remind mode first, with no tokens? | **decided 2026-10-26: no**; everything through Zernio, the intent link only as a fallback |
| 2 | Allow posting at the approved time (adapter mode)? | **decided: yes**, per slot with its own approval of content, time and account; landing and cards say "you approve when it posts" |
| 3 | Zernio or our own platform apps? | **decided: Zernio for every platform, X included**; check its TikTok audit, price and terms before launch |
| 4 | Minimum gap and daily cap per platform | 3 hours and the existing 5 a day for X; others from data |
| 5 | AI-generated label on AI video | always on |
| 6 | Natural posting jitter | yes, up to ±4 minutes |

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
