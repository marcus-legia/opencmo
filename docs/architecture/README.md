# Architecture

How OpenCMO's AI CMO and its departments work, **as built** (`main` at `4f70a59`, 2026-11-08, plus S2 of the CMO
review 2 plan on `cmo-review-2` at `6ce5c69`). The pages were written
as designs on 2026-10-25–27, built in P1–P6 and the CMO review (#169–#180), and rewritten to match the code for the
[CMO review 2 plan](../plans/cmo/2026-11-08-cmo-review-2-plan.md) (S1). Every claim names a code path.
[`ARCHITECTURE.md`](../../ARCHITECTURE.md) at the repo root covers the whole system; its §11 summarises these pages.

**Order of work (owner, 2026-11-08): the AI CMO first, the editor last.** The pages follow one loop: business
information → Writer → approval → Video → approval → Post. `/video` (the full AI video) is built and hidden in the web app behind one switch (`CREATE_VIDEO_HIDDEN` in `lib/agent/hidden.ts`, S2.4);
the MCP tool and the evals keep it. Every other slash command stays.

Every page is a pair with the same name: an `.html` page for people (diagrams, opens in any browser) and an `.md`
twin for agents. The two must say the same thing; change both in the same commit. The HTML body is rendered from the
markdown, with the page's diagrams kept.

| Page | What |
|---|---|
| [`ai-cmo.html`](ai-cmo.html) · [`ai-cmo.md`](ai-cmo.md) | The CMO brain and its seven departments: the loop, the system by its call paths, moderation, provider costs, build or buy, contracts, gaps |
| [`brain.html`](brain.html) · [`brain.md`](brain.md) | The CMO brain: agents, work orders, the runtime without a browser, the step cut, Studio orders, memory, the Library, budgets and gates, what a turn costs |
| [`studio.html`](studio.html) · [`studio.md`](studio.md) | Studio, the video department: the adapter, squads, charge before running (`credit_orders`, explainers, the order hold), Shorts, Slideshow, Post image, the look check |
| [`approval.html`](approval.html) · [`approval.md`](approval.md) | Approval, the founder's department: one approvals table and decide RPC, card kinds, rules, reminders, the card budget, safety |
| [`schedule-publish.html`](schedule-publish.html) · [`schedule-publish.md`](schedule-publish.md) | Schedule and Publish: every platform through Zernio at the approved time, the intent fallback, slots, best time, platform rules |
| [`writer.html`](writer.html) · [`writer.md`](writer.md) | Writer, the words department: a writer per platform, no-ai-slop in every prompt, voice notes, platform profiles, words for Studio |
| [`research-sales.html`](research-sales.html) · [`research-sales.md`](research-sales.md) | Research and Sales: evidence rules, niche video research, subreddit rules, reply outcomes, Hacker News, data risk (R0) |
| [`workflow.html`](workflow.html) · [`workflow.md`](workflow.md) | End to end: one founder's week in 11 steps with code paths, the cards, the wiring, charge before running, the order of work |
