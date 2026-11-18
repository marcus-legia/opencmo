# Redesign: one customer, four tabs, Sales first (plan, 2026-11-19)

Source: owner review of the design canvas https://claude.ai/artifact/H7VT5UZAqnxDbVSrqEBFHZ (2026-11-18/19), the
feature review `opencmo-internal/docs/cmo/2026-11-18-ra-soat-tinh-nang.md`, and the project conclusion
(`opencmo-internal/research/0_writing/Strategy_opencmo/12 Ket luan du an.md`). Group A (free scan) is its own plan:
[`2026-11-18-free-scan-plan.md`](2026-11-18-free-scan-plan.md). Each wave below gets its own sessions file before code.

## Decisions (owner, 2026-11-18/19)

- **B2B channels only.** Posts go to X, LinkedIn and Threads. TikTok, Instagram, slideshows and carousels, the photo-post
  page (`/app/photos`) and the CMO's video scripts (`write_video_brief`, the script item, `/app/script`) go.
- **No Agents block.** Planner lives in the documents ("This week" in Strategy), Publisher in the Post week view,
  Studio becomes "make an image" in Post (low priority: it costs credits), Writer shows in Activity, Sales status sits
  on the Sales tab.
- **Research stays, display only.** It shows competitors (logo, site, price, what they sell, what people say). Finding
  new ones happens only when the founder asks in Research's chat, through the same Lurk API Sales uses. Add a
  competitor by pasting a website or from the chat.
- **The Library is Sales' store.** Every scan saves what people said (summary of each conversation, the quotes, source,
  outcome), grouped by theme. **Post writes only from the Library** and cites a one-line summary of each source
  conversation, never its title. A brief the founder writes in chat is the one exception.
- **Documents** (one page, "Your business"): Product · Strategy (ideal customer, pains, **where they ask**, positioning,
  **this week**) · Competitors · **Post plan** (topics from the Library, channels, rhythm; replaces Content Strategy and
  drops "On Reddit" and "Short videos") · **Brand** = Voice (pasted writing samples, how you say it is yours, words you
  never use) + Look (logo, colors, one font read from the site, product screenshots, two image styles). Quote cards
  wait until after launch.
- **Subdomains:** editor at `editor.ferreto.io`, blog at `blog.ferreto.io` (after launch; needs the cookie on `.ferreto.io`).

## Proposed by Claude, waiting for the owner (the canvas draws them)

1. **Four tabs:** Feed · Sales · Post · Analytics. Calendar becomes Post's week view; the Editor moves to the account menu.
2. **Credits out of sight for what the plan includes.** Scans, reply drafts and posts show no price; Settings › Plan
   shows one "used this month" bar. Only costly extras (an AI image) name a price. This keeps "One plan. Everything
   included." true. It also means group A's "Write the replies · 1 credit" becomes free for a paid account.
3. **Chat folds away** by default to a slim "Ask" rail; it opens on demand.
4. **"Strong match / Good match"** in place of "Score 86"; the number and its parts stay one click away.
5. **Funnel counts itself:** `reply-outcomes` marks "answered back"; a tracking link (UTM) in the founder's profile
   and posts counts sign-ups. Without this the funnel stays empty, because founders rarely mark it by hand.
6. **Launch date:** 23/11 with waves 1–2, or about 30/11 to ship wave 3 (Library + Post from Sales) first. Owner's call.

## Emails (proposed, canvas row "Emails")

Today (`lib/cmo/digest.ts`, `lib/notify/send.ts`): a digest every day at 7:00, weekends too; three "Today" rows where
the people asking come last; "Went out" and "Stuck" with no limit; one more email per card about to expire; a footer
that is false with autopilot on; `email_log` keeps card ids only, so nobody can see what was sent.

Proposed:
- **Morning email**, weekdays at 8:00 (founder can change), at most one a day. Subject and preview line lead with the
  people: "3 people asked about late invoices". Body: up to 3 people (source, match, one quote, one link), up to 2
  follow-ups, one line for posts (count and the next deadline). No "Went out", no "Stuck". Not sent when nothing is
  new; the day is still logged as "Skipped".
- **Expiring-card emails fold into the morning email** (the posts line names the next deadline).
- **Weekly report** on Mondays in place of that day's morning email: found, replied, answered back, signed up; what
  worked; what people said most; posts that went out.
- **Strong match push** right after a scan, for a person who fits well in a thread under a day old.
- **Log in Settings › Notifications**: every email and alert with time, kind, subject, status (sent, skipped, failed)
  and why it was sent. `email_log` gains `subject`, `summary jsonb` and a `skipped` status; no open or click tracking.
- Belongs to wave 2 (template, schedule, footer, fold the expiring emails) and wave 3 (weekly report, push, log page).

## Waves

| Wave | What | Size | When |
|---|---|---|---|
| 1. Group A | Free scan, locked reply drafts, "no one asked", Setup ends on Sales (running: C2 e2e and C3 left) | in progress | merge first |
| 2. Clean before launch | Four tabs; hide Photos, Agents, Studio, TikTok/Instagram, slideshows and scripts from every screen (hide, do not delete); credits hidden for included work; chat folds away; landing links that 404 removed; the digest footer sentence fixed; screens below that change only copy | small, mostly UI | 2–3 days |
| 3. Library and Post | Scans write to the Library; Library page; Post writes only from it with source summaries; documents restructured (Strategy fields, Post plan, Brand = Voice + Look); Research display only + Research chat with Lurk; funnel counts itself | medium | first 1–2 weeks after launch, or before a later launch |
| 4. Delete and extend | Delete the hidden TikTok/Instagram/slideshow/script code with migrations; phone layout for Sales and Feed; follow-up reminders; quote cards | large | after wave 3 |

## Screens (canvas boards)

App: Feed, Sales, Sales on a phone, Post (list), Post (week), Analytics, Your business (documents), Library, Research.
Before the app: Login, Onboarding (website → reading → first people), the free result with locked replies, No one
asked, Plan picker and checkout hand-off, Billing, Settings. Parts: top bar, left panel, chat.

## Rules every wave keeps

Assist, never act (no post button for replies). No "coming soon": a hidden feature is hidden, not teased. English on
every screen, copy through `no-ai-slop`. Every write through an RPC with its pgTAP test. Hide before delete: wave 2
removes entry points only, so a rollback is one revert.
