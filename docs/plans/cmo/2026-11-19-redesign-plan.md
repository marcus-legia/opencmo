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

## Decisions of 2026-11-19

- **Launch on 30/11**, so wave 3 (Library and Post from Sales) ships before it.
- **A free account sees** its week plan, its first post drafts and its free Sales scan (replies locked).
- **The free scan** runs right after onboarding: from the website Ferreto takes the problem, the words customers
  use and the competitors, and searches the communities for people asking about them in the last 30 days.
- Left to Claude by the owner, and taken: **four tabs; credits hidden behind one fair-use bar; chat folds away;
  "Strong / Good match"; the funnel counts itself.** When the free scan finds no one, the founder may edit Strategy
  and run it **once more** for free. **Annual plan: $690 a year** (two months free, about 17%), set in
  `billing_catalog`, changeable as a new Creem product.
- Legal pages and landing links rewritten (PR #236): no named data providers, a section on the public posts we keep.

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
- **Expiring-card emails are removed** (owner, 2026-11-19): the morning email's posts line names the next deadline;
  a founder with autopilot on gets a push before a post goes out.
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

## Open items found in the review of 2026-11-19 (not designed yet)

- Screens: a paid account before its first scan; a scan that failed or a source that did not answer; Sales "not set
  up" (no reader key); the Following up tab and its nudge drafts; "I replied" asking for the reply link (needed for
  the funnel); the tracking link setup for sign-ups; the 100% used state; delete account and export data; light theme.
- What a free account sees on Post and Feed after its free scan.
- Legal: Terms and Privacy still describe video and clips; Privacy must say the Library keeps public posts' quotes and
  summaries, and how a removed post is dropped. Reddit/ScrapeCreators/Lurk data terms (R0) still unchecked.
- Creem: store description and screenshots must match the Sales-first product before review.

## Reaching out: reply, DM, email (owner flagged 2026-11-19; note 12 P1)

Every person in Sales gets three tabs: **Public reply** (the first step), **DM**, **Email**. The founder always sends.
- DM: one message, after the public reply or when the post asks for tools; the community's DM rule is read like its
  posting rules; "Copy and open" the platform's chat. No sequences.
- Email: only to an address the person published (their site or profile). Drafted into the founder's own Gmail
  (Gmail connect, drafts scope only), never sent by Ferreto; one email per person, an opt-out line, no lists.
- "I sent it" moves the person to Following up; after 4 days without an answer a nudge is drafted.
- Daily caps keep it personal; the Acceptable Use Policy already forbids bulk and unsolicited messaging.
- Waves (owner, 2026-11-19): **DM drafts in wave 3, before 30/11.** **Email drafts into Gmail in wave 4**, after
  launch, because Google reviews the Gmail scope; until then the Email tab offers Copy only.

### Who is ready for a DM or an email (owner agreed 2026-11-19)

One check for every platform, from the person's own post and its thread only; Ferreto never reads or keeps a
personal profile.
1. A buyer like the founder's customers, in their own words ("I run a two-person studio"); vendors and unclear
   authors are left out.
2. Wants it now (the existing evidence quote).
3. Warm: answered the founder's public reply, still active in the thread, or wrote "DM me / email me".
4. Fresh: posted in the last 7 days.
5. A way to reach them: the platform has DMs and the community allows them; for email, an address in the post or
   thread, or on the business website they linked in it.

Reply first is the default. **DM ready** = 1, 2, 4, a DM path, and 3 or a post asking for tools. **Email ready** =
DM ready + an email by rule 5 + warm or invited. The tabs stay locked until a person qualifies, with the reason in
one line; the founder may still paste an address they know. Hacker News has no DMs. To check "warm" outside Reddit
and Hacker News, `reply-outcomes` gains Threads and Facebook group re-reads (manual marking until then).
