# Editor as the spearhead: phase roadmap (2026-10-19)

> Owner decision (see `CLAUDE.md`, "Strategy"): there is no paid-marketing budget, so OpenCMO's own
> marketing videos are made in OpenCMO's editor. The editor is built until it can make every video we
> need, phase by phase. The editor is also **what we sell first** (owner, 2026-10-19): video from a slash
> command, generated shots placed as B-roll, and the user's other videos brought in and edited together.
> Hence phase **ES** right after E0. This file splits the work into phases and items. **It is not a build plan:**
> each item gets its own research report (`docs/research/editor/`) and plan (`docs/plans/editor/`)
> before code.
>
> The state of the editor below comes from a scan of the code and docs on 2026-10-19 (op registry,
> `capabilities.ts`, `docs/ai-video-status.md`, `docs/ke-hoach-pr-sau.md`). Re-check it when an item is
> picked up. "Opus #n" points to the gap list in the internal repo
> (`opencmo-internal/docs/specs/2026-10-19-hoc-agent-opus-3-danh-sach.md`). Its section "Chiến lược build
> theo giai đoạn" places all 90 Opus items in these phases with a reason each; the tables below carry the
> items that land in E0–E6.

## 1. The videos OpenCMO needs

Every phase is judged by which of these it lets us make, end to end, in the editor.

| ID | Video | Where it goes | Source footage |
|---|---|---|---|
| V1 | Founder clip: build in public, opinions, lessons (30–60 s, 9:16) | X, Shorts, Reels, TikTok | The owner on camera |
| V2 | Product demo: "paste your URL, get a week of drafts" (60–120 s, 16:9 + 9:16) | Landing hero, YouTube, Product Hunt | Screen recording of OpenCMO |
| V3 | Feature launch / changelog short (15–45 s) | X, Shorts, changelog | Screen recording + voice |
| V4 | Explainer: how the AI CMO works (30–90 s) | Landing, YouTube | Motion graphics, captured pages |
| V5 | Tutorial / onboarding walkthrough (1–3 min) | Help, in-app, YouTube | Screen recording + voice |
| V6 | Proof post: real result, before/after, agent working sped up | X, LinkedIn | Screen recording, captured pages |

V2, V3, V5 and V6 all need **screen recordings of our own product**, which the editor cannot make today.
That is the largest gap, so the roadmap puts it right after the base is reliable.

## 2. Where the editor stands (2026-10-19)

**Strong already (V1, V4):** cut by transcript (`remove_words`, `remove_silence`, retakes), captions with
style and emphasis, `punch_in`, hook titles, `add_title` (text animator plan, PR #65), split layout,
proof cards from captured pages (`capture_page` + `add_proof`), explainers (`clip-motion`), charts,
diagrams, icons, Lottie, 3D, voiceover with ducking (`add_voiceover`, `duck_db`), `clean_audio`,
`replace_background`, brand kit, style skills (`apply_style`), AI shots (`create_video`, chains of up to 3),
Assistant + MCP over the same ops.

**Missing or unproven:**
- Screen recording in the product, cursor data, auto zoom/pan, device frames.
- Server export (`render_document`) not yet run on Modal production; export at 24/25/50/60 fps and project
  bloat after many cuts are open (`docs/ke-hoach-pr-sau.md` §1–2).
- Music bed as a managed track (versions, swap without re-render); no thumbnails/covers; no chapters.
- One source → several formats in one go (16:9 master → 9:16/1:1 cuts that follow the action).
- Templates for recurring videos (weekly changelog, demo) that the Assistant fills.

## 3. Phases

Sizes are first guesses (S ≤ 2 days, M ≤ 1 week, L > 1 week) and get fixed in each item's plan.
Every phase closes with its acceptance video, made by the owner in the editor and published.

**Order: E0 → ES → E1 → E2 → E3 → E4 → E5 → E6.** ES comes second because the editor is what we sell; it
takes the generation items that a paying user meets first (moved up from E1 and E6).

### E0. A base we can trust

Goal: what already exists works on production every time. Without this, every later phase ships on sand.

| Item | What | Size | Research questions for the deep-dive |
|---|---|---|---|
| E0.1 | Run `render_document` export on Modal production; watermark and signed download | S | What fails only on Modal (fonts, Lottie, GPU)? Time and RAM for a 60 s and a 3 min export |
| E0.2 | Exact export at 24/25/50/60 fps (`ke-hoach-pr-sau.md` §1) | M | Frame timing in `clip-export`; audio drift over 3 min |
| E0.3 | Project file stops growing after many cuts (§2) | M | What grows: transcript copies, history, marks? Migration for existing documents |
| E0.4 | Clear the deploy backlog the editor depends on (migrations, Modal secrets, Vercel env) | S | List from `VIEC-CAN-LAM.md` (internal) and open PR notes |
| E0.5 | Idempotency key on every paid request; a timeout never triggers a new paid run (Opus #85) | S | Where the 2026-10-11 "paid twice" came from; key scope per generation and export |
| E0.6 | The client reports each export's outcome (Opus #52) | S | Success rate on Modal production per format and length |
| E0.7 | Warn before leaving with unrendered or unsaved changes (Opus #53) | S | Which states count as unsaved in the document model |
| E0.8 | Internal debug page per project + per-project model override (Opus #83) | S | What to show (document, tasks, agent turns, costs); admin-only access |
| E0.9 | Feature flags, so E2–E3 work runs on production for the owner's account first (Opus #82, flags part) | S | Flags without breaking "don't ship coming soon": hidden, never teased |

**Acceptance:** a 60 s V1 clip of the owner, cut and captioned in the editor, exported on production; a
frame from the full-size file checked by eye.

### ES. The editor we sell: slash-command video, AI B-roll, your own videos together

Goal: a stranger can pay, open the editor, bring in their videos, type `/broll` or `/video`, get generated
shots placed on the right words, cut everything by text, and export. Most of the features exist
(`apps/web/lib/agent/slash.ts`, `place_broll`, PR #52 own-video editing, chained `/video`); what is missing is
proof on production, prices, and the path from payment to first export.

| Item | What | Size | Research questions |
|---|---|---|---|
| ES.1 | Credit price per model and per slash command, wired to billing (usage billing to Polar is not connected yet) | M | Margin per model at fal prices; what a $15 starter buys; `check:pricing` |
| ES.2 | Run every slash command live on production with real providers: `/video` with a chain, `/broll` stills → animate, `/animate`, `/edit` (Kling edit with an uploaded video, never called live), `/background`, `/music`, `/voiceover` | M | Failure modes per provider; fal concurrency on a new account; real wait vs the card's estimate |
| ES.3 | `/broll` on the user's own talk end to end: pick lines, stills, approve, animate, place on the quotes, one undo | S | Today it is two approvals (stills, then animate); measure whether users want one card for the whole pack |
| ES.4 | Bring other videos in: several uploads in one edit, cut any of them by words, use the user's own clips as B-roll (`place_broll` from the library) | S | Upload size/length caps; transcript wait per file; New edit with no master video |
| ES.5 | Prompt rules for generated shots (Opus #32, moved from E1.4): three motion layers, no moving text, no text in keyframes, "live-action" | S | Before/after on 10 shots per model |
| ES.6 | Check generated frames for garbled text before they reach the timeline (Opus #37, moved from E6.4) | M | VLM cost per frame; reuse `opencmo/ai/moderation.py` frame sampling |
| ES.7 | Landing and pricing page that show only real output made in the editor; no model names, nothing "coming soon" | M | Which three demos sell it; the landing video is this phase's acceptance video |
| ES.8 | First-run path: sign up → editor → a sample of the user's own upload → first `/broll` → export, with prices on every card | M | Where new users stop; free credits for the first video |

**Acceptance:** a 60 s landing video, made in the editor with `/broll` and `/video` over the owner's own
footage, that shows exactly this flow; and one real purchase that reaches an export.

### E1. Founder clips in minutes (V1)

Goal: the weekly V1 clip takes under 15 minutes from upload to published file.

| Item | What | Size | Research questions |
|---|---|---|---|
| E1.1 | Text animator + `add_title` lands (plan 2026-10-17, PR #65) | in flight | — |
| E1.2 | Active-speaker reframe for 2-person recordings (report 2026-10-18) | M | Scribe diarization vs face cues; `speaker_coverage` threshold |
| E1.3 | One-click "founder clip" style: hook title, emphasis, punch-ins, B-roll proof | S | Which existing style skill becomes the default; what still needs the Assistant |
| E1.4 | (moved to ES.5) | — | — |
| E1.5 | 👍/👎 + reason saved per Assistant and CMO chat message (Opus #81; today `ChatPanel.tsx` keeps it in `useState`) | S | Table and RPC; how the owner's ratings feed `agent:eval` |

**Acceptance:** three V1 clips in one week, each under 15 minutes of owner time.

### E2. Record our own product (V2, V3, V5, V6)

Goal: record OpenCMO in the browser and get a polished demo with no manual keyframing. Largest gap.

| Item | What | Size | Research questions |
|---|---|---|---|
| E2.1 | In-app recorder: tab/screen + mic + optional camera bubble, upload over TUS (web rule 3) | M | `getDisplayMedia` limits per browser; length and size caps; resumable upload of a live recording |
| E2.2 | Interaction log while recording our own app: clicks, typing, scroll, page changes with timestamps | M | Recording OpenCMO itself lets the app log its own DOM events, which a generic recorder cannot. Privacy: never log typed secrets |
| E2.3 | Auto zoom/pan from the log (click clusters → zoom in, idle → zoom out), smooth cursor, click ripples | L | How Screen Studio-style tools pick zoom targets and ease; as editor-core ops (`zoom_to`, keyframes) so the Assistant and buttons share them |
| E2.4 | Screen-recording look: padding, background, rounded corners, shadow, browser/device frame | S | Reuse the `add_proof` browser frame |
| E2.5 | 16:9 recording → 9:16/1:1 that follows the cursor and zoom targets | M | Reuse reframe logic with the cursor as the "face" |
| E2.6 | Cut dead time: long waits (agent thinking, uploads) sped up or cut, with a "sped up" marker | S | Detect idle from the log + frame diff; keep it honest on screen |
| E2.7 | Photo passthrough: product screenshots animated with ffmpeg pan/zoom, no model (Opus #40, moved up from generated shots) | S | Same zoom engine as E2.3; no credits, no invented UI |
| E2.8 | Blur a region over a time range (emails, keys, customer data) instead of AI inpaint (Opus #46, reshaped) | S | Region tracking when the page scrolls; blur must survive every export format |

Learn from, licence to be checked before reading code (copy only MIT/BSD/Apache-2.0 with notice):
Cap (AGPL by its own about page, some crates MIT), OpenScreen (listed as MIT), Screenize (listed as
Apache-2.0, macOS), Screenity (browser extension), Recordly, ScreenArc; Screen Studio (closed, behaviour only).

**Acceptance:** a 90 s V2 demo ("paste your URL → a week of drafts") in 16:9 and 9:16, recorded and
finished in the editor, used as the landing hero.

### E3. Tell the product story (V2–V5 with voice, music, structure)

Goal: from a recording or a brief, the Assistant assembles a finished story the owner approves.

| Item | What | Size | Research questions |
|---|---|---|---|
| E3.1 | Script → voiceover → recording aligned to the words (narrate a silent recording) | M | Align by interaction log events to script beats; reuse `sync_voiceover` |
| E3.2 | Recipes beyond `intro` in `plan_video`: demo, feature launch, tutorial, changelog | M | Beat structure per recipe; what the Reviewer (code) checks |
| E3.3 | Music bed as a track: pick, versions, swap without re-render, ducking under voice; runs in parallel and never fails the video (Opus #49, #50) | M | Licensing of generated music; reuse `duck_db` |
| E3.4 | Hook options: 3 hooks to pick from on the card (Opus #4) | S | Hook patterns for SaaS demos |
| E3.5 | Templates the owner saves and reuses weekly ("changelog short") | M | Template = document with slots; how the Assistant fills slots |
| E3.6 | Captured pages and explainers placed on script beats (`capture_page`, `add_explainer`) | S | Mostly exists; gap is placement by beat |
| E3.7 | Recipe planning: infer the recipe from the recording and brief, ask once on one card while the recording is processed, paid steps only through a button (Opus #13, #14, #17) | M | Signals that tell demo from launch from tutorial |
| E3.8 | Brief references assets with labels (`@demo-onboarding`, `@logo`) (Opus #27) | M | Mention syntax in the Assistant input; binding must use the exact asset |
| E3.9 | Shared pipeline context across script → voice → placement → music, with prompts per video type (Opus #28, #29) | M | What each step must see; prompt variants per recipe |
| E3.10 | Beat rules: never split a name or number; beats rejoin to the exact script (Opus #31) | S | Checker in code, retry with the failure reason |
| E3.11 | Timed shot script, voice preview and script preview before the paid run; voice-first variant that locks the script (Opus #42–45) | M | Card layout; cost of a preview vs a full run |
| E3.12 | Staleness ledger: an edited line marks the voice, captions and placements that must be redone (Opus #11) | M | Smallest redo set; how the user sees what changed |
| E3.13 | One card system in chat for script, hook, storyboard and video; message the agent mid-run; long-script handling (Opus #5, #3, #19) | M | Steering a running turn without losing work |

**Acceptance:** a 30 s V3 feature-launch short and a 2 min V5 tutorial, each from one recording plus a
brief, with at most two approvals.

### E4. One source, every format, straight into Post (V1–V6)

Goal: one master edit becomes every platform cut and lands as drafts in the Post department.

| Item | What | Size | Research questions |
|---|---|---|---|
| E4.1 | Export set: 16:9 + 9:16 + 1:1 from one document in one request | M | Credits and time per set; per-format overrides |
| E4.2 | Cover / thumbnail from a frame + title | S | What converts on YouTube vs X |
| E4.3 | Per-platform captions and chapters (YouTube) | S | Reuse CMO caption drafting |
| E4.4 | Translated captions for the same cut (`translate_captions` exists) | S | Which markets first |
| E4.5 | Hand-off: finished video → X draft in Post, user approves and publishes (rule: assist, never act) | M | Upload path to X; approval link (Opus #86) |
| E4.6 | Public share page `/share/{id}` with its own DTO (Opus #78) | S | Which fields are public; Opus leaked staff emails through this endpoint |
| E4.7 | Export at the source resolution (1440p/2160p) so recorded UI text stays sharp, instead of AI upscale (Opus #51, reshaped) | M | RAM and time at 2160p against the hard budgets |
| E4.8 | Per-project concurrency cap for export sets + email when a long job finishes (Opus #60, #58) | S | Cap value from the ~400 MB per ffmpeg budget |

**Acceptance:** one V2 demo becomes a YouTube video, three shorts and X drafts in under 30 minutes.

### E5. The Assistant does the repetitive parts (Opus agent learnings)

Goal: the weekly videos run mostly on their own, with the owner approving.

| Item | What | Size | Opus |
|---|---|---|---|
| E5.2 | Auto-continue timer on free, internal steps; paid and outgoing steps always wait | S | #1, #2 |
| E5.3 | Structured output contract + machine-readable failure for the next step | M | #8 |
| E5.4 | Atomic todo per user message, closed by the agent | M | #9 |
| E5.5 | Step outputs as records with ids; rerun from a step | L | #7 |
| E5.6 | One progress protocol for long tasks, estimated %, one shared SSE connection, "still running" notices | M | #54–57 |
| E5.7 | Spec as the single source of a recipe's plan; conflict check and end-of-turn review | M | #10, #12 |
| E5.8 | Glossary from internal terms to user words; split in-scope and out-of-scope asks; fast path for complete briefs; undo by turn | S | #15, #16, #18, #21 |
| E5.9 | Model chain per task with the measured reason in a comment | S | #20 |
| E5.10 | MCP polish: prepare vs start, `edit_clip` with dry run, renamed tools kept as no-op signposts, styles listed with use cases | M | #84, #87, #88, #90 |

**Acceptance:** "make this week's changelog short from today's recording" gives a finished V3 with one
approval.

### E6. Generated shots where real footage is missing (last)

Generation the paying user meets first is in ES. This phase is the deeper pipeline (keyframes first, style
maker); do it when ES users or E2–E4 videos show a real need.

| Item | What | Size | Opus |
|---|---|---|---|
| E6.1 | Keyframes first, video second; contact sheet before paying for video | L | #22, #23 |
| E6.2 | Edit one keyframe → redo only its two transitions | M | #24 |
| E6.3 | Style prompt with `[SUBJECT]` + style from reference images | M | #33, #34 |
| E6.4 | (moved to ES.6) | — | #37 |
| E6.5 | Pick the last frame among candidates; anchor assets from the Brand Kit; merge adjacent transitions; world bible for long stories; restyle as a branch | M | #25, #26, #41, #30, #47 |
| E6.6 | Style history and automatic style pick | S | #35, #36 |

## 4. Not now

AI inpaint and AI 4K upscale (reshaped into E2.8 and E4.7), Temporal-style workflow engine (Opus #59),
copy motion (#39), voice cloning and lip-sync (product rule), "recreate someone else's reel", desktop app
(`docs/spec-desktop-app.md` stays "for later").

Growth and billing items from the Opus list (phase **G** in the internal mapping: analytics, Explore +
Remix, onboarding rewards, cancel flow, referral, quotas, quality tiers…) wait until the owner calls them,
per the strategy. When G starts, Explore uses our own marketing videos from E1–E4 as its first items.

## 5. How an item moves from here to code

1. Pick the next item in phase order (finish a phase's acceptance video before starting the next phase,
   except small items that unblock it).
2. Research report in `docs/research/editor/` (format in `docs/research/README.md`): how others do it,
   repos and licences, what to copy or only learn.
3. Plan in `docs/plans/editor/` with sessions, contracts and the acceptance test; add a row to
   `docs/plans/editor/README.md`.
4. Build, check the hard budgets, look at a frame of the full-size export, and tick the item here.

## 6. Sources

Read 2026-10-19. Licences are as listed by these pages and must be confirmed in each repo before reading code.

- Cap: [cap.so/about](https://cap.so/about), [open-source page](https://cap.so/open-source-screen-recorder), [AlternativeTo](https://alternativeto.net/software/cap/about)
- OpenScreen, Recordly, Screenize, ScreenArc, Screenity: [AlternativeTo: Screen Studio alternatives](https://alternativeto.net/software/screen-story), [Screenize](https://alternativeto.net/software/screenize/about), [ScreenArc](https://www.alternativeto.net/software/screenarc/), [Screenity](https://alternativeto.net/software/screenity)
