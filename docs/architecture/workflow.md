# End-to-end workflow

Status: **for review** (2026-10-27). Markdown twin of [`workflow.html`](workflow.html), written for agents; the two
must say the same thing. Built from [`ai-cmo.md`](ai-cmo.md), [`brain.md`](brain.md), [`studio.md`](studio.md),
[`approval.md`](approval.md), [`schedule-publish.md`](schedule-publish.md), [`writer.md`](writer.md) and
[`research-sales.md`](research-sales.md), with every owner decision recorded there up to 2026-10-27.

How the brain and the seven departments work together through one founder's week: who does what, which card the
founder sees, what costs credits, and what exists today.

## 1. Swimlane

Rows: You · Approval, Brain, Research, Writer, Studio, Sales, Schedule, Publish. Columns are the 11 steps below. After
step 11 the week's memory and lessons feed the next Sunday (step 2).

## 2. The 11 steps

| # | When | Who does what | Your card or action | Credits | Today |
|---|---|---|---|---|---|
| 1 | Once, at sign-up | **Research** reads the website and drafts the four marketing documents. **Publish** gives the Zernio connect link. The timezone comes from the browser | Read and edit the documents; connect X and the other accounts once; set the Brand Kit | onboarding | documents built; Zernio, timezone new |
| 2 | Sunday | **Research**: competitor outliers on X, top shorts in the niche, last week's metrics and reply outcomes. **Brain · Reviewer**: lessons per topic, voice notes from your edits, the goal's result, next week's goal, corrections from repeated edits | A correction card when a repeated edit becomes a rule | research ≈ 2; reviews free | competitors, lessons, goals built; niche video, corrections new |
| 3 | Monday | **Brain · Planner** writes the week: posts, one long video, shorts, a slideshow, Reddit items, each a work order with a brief, a due day, a budget and the department that does it | Approve the goal and the week plan (edit or remove items) | plan ≈ 1 | plan built; work order tree new |
| 4 | When a post is due | **Writer** drafts three versions per platform (X, Threads, LinkedIn) in your voice from memory; code checks length, words to avoid, numbers, no links, no hashtags; a checker on another provider reviews once | Approve, edit then approve, or skip with a reason | ≈ 1 per post | X built; other platforms new |
| 5 | When the video is due | **Writer** hands Studio a video brief (angle, three hooks, key points). **Studio**'s Video agent team: Director plans beats → code Reviewer → keyframes → shots between them, voice and music → one editable scene → render → look check | Card 1: storyboard + keyframe price. Card 2: contact sheet + exact video price (redo a keyframe). Card 3: the finished video (open it in the editor to tweak); approving marks it finished | keyframes, then video (shown on the cards) | long take built; brief, inbox cards, look check new |
| 6 | When a video is finished | **Studio** Shorts squad cuts 3 shorts from the finished edit (AI video or your own edit you marked finished), 9:16, styled; **Writer** writes captions per platform, hashtags only here | Approve the batch of 3 | no generation credits | new |
| 7 | When a slideshow is due | **Writer** writes the slide text; **Studio** Slideshow squad builds the slides from captured pages and the Brand Kit; MP4 and a PNG set from one document | Approve, with quick text edits per slide, or open in Slides | only if an AI image is needed | new |
| 8 | When a Reddit item is due | **Sales** finds threads, scores them with exact quotes, checks the subreddit's rules, drafts a help-first reply (no links, the product at most once, about 1 reply in 10) | Copy the reply, open the thread, post it yourself; mark replied or dismiss | scan ≈ 5 | scan built; rules check new |
| 9 | After any approval of something to post | **Schedule** proposes a time per platform (your data once there is enough, defaults before that), with gaps and daily caps, in your timezone | Approve the time and the account (changing either asks again) | free | new |
| 10 | At the approved time | **Publish**: the Modal clock finds the slot due; the worker posts through Zernio (X included); a signed webhook confirms. With no connected account, you get a notice with the composer filled in instead | Nothing, unless it failed (a card with the reason and a retry) | X API price passed through by Zernio | new |
| 11 | 24 hours after posting, and days after a reply | **Research** reads the numbers (Zernio for connected accounts) and re-reads Reddit threads you answered; everything goes to memory for Sunday | — | small | public metrics built; Zernio, reply outcomes new |

**Every day, in the background:** the brain's progress check (code) looks at every work order (done, waiting on you,
stuck, over budget); only a stuck order costs one replan. Approval sends the morning digest in the app and by email;
links open the card, never decide it. The kill switch stops every order and every waiting slot within a minute.

**What the brain never does:** post anything you did not approve, with its time and account; reply on Reddit (Sales
has no post button); touch your own video edits (they stay hands-on in the editor until you mark one finished); spend
credits without a price on a card.

## 3. Cards in a typical week

Example: 5 posts, 1 long video, its 3 shorts, 1 slideshow, 2 Reddit replies. Batching keeps it near the daily budget of
about 10 cards.

| Card | How many | Step |
|---|---|---|
| Goal + week plan | 1 | 3 |
| Posts (versions per platform) | 5 | 4 |
| Video: storyboard price, contact sheet, finished video | 3 | 5 |
| Shorts batch | 1 | 6 |
| Slideshow | 1 | 7 |
| Reddit replies | 2 | 8 |
| Schedule (one per item; posts of one day can share a card) | ≈ 5–8 | 9 |
| Correction (some weeks) | 0–1 | 2 |

## 4. How the departments talk

| Wire | Carries |
|---|---|
| Work orders (rows) | The brain's orders to each department: brief, budget, depends on, due (`brain.md` §6) |
| Deliverables (rows) | What each department made, with a status; one table for posts, captions, videos, shorts, slideshows, replies |
| Approvals (rows) | Every card, with a snapshot of content, price, time and account (`approval.md`) |
| Event rules | A status change creates the next order: video approved → shorts; short approved → schedule; due → publish; posted → measure |
| The clock | Modal's daily schedule and its every-minute sweep wake everything; no machine stays on |
| Studio adapter, Zernio adapter | The two doors to heavy work and to the platforms; the brain uses the same doors as buttons and MCP |

## 5. Build order

Taken from each department's phases, ranked by the editor strategy: what lets us make and ship the next OpenCMO
marketing video comes first.

1. **Writer W0**: No AI Slop as guidance, post rules (no links, no hashtags), the `x-writing.md` fix. Small.
2. **Studio S0**: finish the long take on production (one real 60 s OpenCMO video).
3. **Approval A0–A1**: one approvals table with snapshots; Studio cards in the inbox.
4. **Brain B0–B1**: corrections and budget; work orders and deliverables.
5. **Studio S1–S2**: Studio adapter, finished state, named-timeline export, the Shorts squad.
6. **Schedule P0–P1** with **Approval A2–A3**: Zernio checks, accounts, timezone, scheduled posting, reminders.
7. **Brain B2–B3**: progress check, kill switch, digest, capability registry, event rules; the brain briefs Studio.
8. **Writer W1–W3**, **Studio S3**: other platforms, voice memory, captions; slideshows and post images.
9. **Research R0–R2**, **Sales R1**: data terms, niche video research, Sales safety.
10. Then the rest: Studio S4 look check, Schedule P2–P3, Research R3–R4, Brain B4 evals, Writer W4.

## 6. Open points

| # | Point | Recommendation |
|---|---|---|
| 1 | The look check: on every render or only before a card (Studio) | Only before a card |
| 2 | Week plan size by default | Start from the weekly goal and the card budget: about 5 posts, 1 video with 3 shorts, 1 slideshow, 2 Reddit items |
| 3 | Weekly credit budget per founder | Set after Brain B1 from measured credits per approved deliverable |
| 4 | Zernio checks (TikTok audit, price, terms) and ScrapeCreators' data terms | Before anything that depends on them goes on the landing page |

Credit figures are today's job prices (`cmo_job_price`) or what each card will show; generation prices come from the
model catalog.
