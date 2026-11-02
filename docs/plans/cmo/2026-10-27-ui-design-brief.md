# OpenCMO app redesign: brief for Claude Design

Status: **draft for U0** (2026-10-27). Paste sections 1–5 into Claude Design. Source of truth for the flow:
[`docs/architecture/workflow.md`](../../architecture/workflow.md). Plan: [`2026-10-27-ui-down-brain-first-plan.md`](2026-10-27-ui-down-brain-first-plan.md).

## 1. Product in one paragraph

OpenCMO is an AI CMO for solo founders. It learns the business from its website. Each week it plans the marketing and
has its departments draft the work: Writer (posts and captions), Studio (videos, shorts, slideshows, made in our video
editor), Sales (Reddit threads worth answering, with a draft reply), Research (what works for competitors and in the
niche), and Schedule and Publish (posts go out at the time the founder approved). **Nothing goes out without the
founder's approval, on their own account.** The founder's job is to approve, edit or skip cards. Ten cards a day at
most, mostly on the phone.

## 2. Design principles

1. **The Inbox is the product.** Approving must be fast and safe: what goes out, where, when and for how many credits
   is always on the card.
2. **Show the work, not the AI.** Each department's output shows its sources: URLs for research and exact quotes for
   Reddit scores. Don't use model names, sparkles or "magic" copy. The copy describes software ("drafts you approve
   and publish"), not a service.
3. **One brain, many departments.** The founder always sees what the CMO is doing now, what waits on them, and what is
   stuck. A kill switch stops everything.
4. **Real states, not happy paths.** Every screen shows empty, loading, waiting on you, running, failed (with reason
   and retry), out of credits, and not connected. Don't show "coming soon".
5. **Phone-first for Home and Inbox**, desktop-first elsewhere; light and dark; 16 px gutters at phone width.
6. All UI text in English.

## 3. Sitemap

Updated 2026-10-27 after the first design round: Home and Inbox became one **Dashboard** (the team as a live graph of
pixel robots, results of the last 7 days, and the only approval queue); the Week calendar moved to **Schedule**;
**Analytics** shows data from every connected account (through Zernio) and what the brain learns from it; the
**Library** holds documents, Brand Kit, voice and skills (see `docs/architecture/brain.md` section 8b). The canvas is
the source of truth for layout (https://claude.ai/artifact/QqAc6RuZi44osR3YAXAuNw); the first sitemap below is kept
for the record.

```
Dashboard ─ Analytics ─ Brain ─ Library ┬ Business (4 documents)
                                        ├ Brand Kit
                                        ├ Voice
                                        └ Skills
Departments: Research · Writer · Studio (→ Editor) · Sales · Schedule (calendar)
Settings · Setup (first run)
```

First version:

```
Home (Today) ─ Inbox ─ Week ─ Departments ┬ Writer
                                          ├ Studio  → opens the Editor (existing, not redesigned)
                                          ├ Sales
                                          └ Research
             ─ Activity ─ Memory ─ Settings ┬ Accounts (Zernio), timezone
                                            ├ Budget, kill switch, brain mode
                                            ├ Brand Kit
                                            └ Billing
Setup (first run)
```

## 4. Screens

| # | Screen | Shows | Actions | States beyond the default | Live in |
|---|---|---|---|---|---|
| 1 | **Shell** | rail with the sitemap; credits; Inbox count; the CMO's current status ("Drafting 2 posts") | navigate; open the CMO chat | phone: bottom tabs Home · Inbox · Week · More | A0 |
| 2 | **Home / Today** | the week's goal and progress; what waits on you; what the CMO is doing; stuck orders with the reason; today's posts with time and account | open a card; retry or cancel a stuck order; kill switch; chat with the CMO | first week (no data); paused; out of credits | B2 |
| 3 | **Inbox** | cards, newest first, grouped by day; filter by kind | approve, edit, skip with reason, per card (section 5) | empty ("nothing waits on you"); expired card; card already decided on another device | A0 (post, reply, goal) → A1 → A3 |
| 4 | **Week** | goal; the plan as items per day, each with its department, status and due; calendar of approved slots per platform | approve the plan; remove or move an item; open an item | plan not approved yet; a slot that failed to post | B1, P1 |
| 5 | **Writer** | drafts by platform and status; voice notes learned from edits | open a draft; edit a voice note | no posts yet | D1 |
| 6 | **Studio** | videos, shorts, slideshows, post images, with status and price; "finished" badge | open in the editor; mark finished; cut shorts from a finished edit | rendering (progress); failed render; price waiting on you | D2 |
| 7 | **Sales** | Reddit threads with score, quoted evidence, subreddit rule (product mention allowed / help only), draft reply | copy reply and open thread; mark replied; dismiss with reason | rules say skip; reply limit reached (help only) | A0 (today's scan), D4 |
| 8 | **Research** | the four marketing documents; insights with source URLs; competitor outliers; niche shorts; results per post | edit a document; add a competitor | insight without a URL is never shown | B1, D4 |
| 9 | **Activity** | the brain's work orders as a tree: department, brief, status, credits used vs budget, timing | open an order; cancel | stuck; over budget; waiting on another order | B1 |
| 10 | **Memory** | voice, lessons per topic, corrections, rules from edits, each with its source | edit, delete, approve a proposed rule | nothing learned yet | B0 |
| 11 | **Setup** | website → the four documents drafted; connect accounts; timezone; Brand Kit; first week's goal | approve each step; skip connecting (posts then open the platform's composer) | site unreadable; account connect failed | A0 |
| 12 | **Settings** | accounts (Zernio) with status; timezone; weekly credit budget; kill switch; brain mode (OpenCMO's or the founder's own Claude through MCP); API keys; Brand Kit; Billing | connect, disconnect, change | account needs reconnecting | B0, P0 |

## 5. Card kinds (the Inbox)

Every card shows the department that made it, why the CMO wants it, and the credits. A card that posts also shows the
platform, the account and the time.

| Kind | Shows | Actions |
|---|---|---|
| `post` | text per platform, 1–2 alternates, checks passed | approve, edit then approve, skip with reason |
| `reply` | Reddit thread, score with quoted evidence, subreddit rule, reply draft | copy and open thread, mark replied, dismiss |
| `goal` | goal, metric, target | approve, change target, reject |
| `price` | what will be made, credits, wait time | approve, redo one keyframe, cancel |
| `script` | storyboard: words, picture, motion per beat | approve, edit a beat, send back |
| `finished_video` | player, length, a frame | approve (marks finished), open in editor, send back |
| `shorts_batch` | 3 shorts with hook and reason each | approve the batch, send back |
| `slideshow` | slides, MP4 and PNG | approve, quick text edit per slide, open in Slides |
| `schedule` | platform, account, date and time, the deliverable | approve, change time (asks again), cancel |
| `correction` | a rule learned from edits, with the edits it came from | approve, edit, reject |

Also design: the morning digest email (what waits, what went out, what is stuck), and the push notification text.

## 6. Out of scope

The inside of the video editor (it gets the new tokens later), the landing page, the blog.
