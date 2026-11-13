# Writer: the words department

Status: **built** (`main` at `4f70a59`, 2026-11-08). Designed 2026-10-26, built in phases W0–W4 (P1–P6) and the CMO
review (#169–#180). Markdown twin of [`writer.html`](writer.html), written for agents; the two must say the same
thing. Parent pages: [`ai-cmo.md`](ai-cmo.md), [`brain.md`](brain.md), [`studio.md`](studio.md).

Writer writes every word that goes out: posts, threads, captions, video titles and descriptions, the brief a video
starts from, the text on slides; in the founder's voice, from the founder's documents, through code checks and a
second look before a card. In the owner's sketch of 2026-11-08 Writer is step 2: words are written, and approved,
before anything is built from them.

## 1. Verdict

**Built:** a writer agent per platform profile (X, Threads, LinkedIn posts; Instagram, TikTok, YouTube captions), each
drafting three versions → code checks per profile → the checker (Claude, in a separate context, so the draft does not
persuade it) → one fix → a card (`draft-post.ts`); X threads (`draft-thread.ts`); the video brief and slide text for
Studio; no-ai-slop as guidance in every prompt that writes for a reader; voice learned from approvals and edits; a
learning loop and evals with a cascade judge.

**Not built:** articles (later; owner, 2026-11-08: after the loop works for posts, slides and clips).

## 2. Writer as built (`main`, `4f70a59`)

State: ✅ done · 🟡 partial · ❌ not built.

| Part | Where | What it does | State |
|---|---|---|---|
| Agents | `lib/cmo/agents/registry.ts` | `x_writer`, `threads_writer`, `linkedin_writer`, `instagram_writer`, `tiktok_writer`, `youtube_writer`, `brief_writer`, `writer` (intro words), `director` (long-take script), `checker` (Haiku) | ✅ |
| Post draft job | `jobs/draft-post.ts`, `lib/cmo/writer/` | 3 versions with an angle each and a rationale; the checker in a separate context; one fix; a card with alternates | ✅ X, Threads, LinkedIn |
| X threads | `jobs/draft-thread.ts` | a thread when the founder asks for one | ✅ |
| Words for Studio | `write_caption`, `write_video_brief` (`lib/cmo/writer/jobs.ts`) | captions per platform (hashtags only here), YouTube title and description, the video brief. `write_slides` was removed on 2026-11-13 (F2): a photo post with a caption replaces it | ✅ |
| Code checks | `jobs/check-post.ts`, `lib/cmo/writer/checks.ts` | length per profile, words to avoid, numbers that must be in the documents, no links, hashtags per profile | ✅ |
| Platform profiles | `packages/contracts/platforms.json`, `lib/cmo/platforms.ts` | one data file read by the prompts, the checks, the cards and SQL's `platform_profile()` | ✅ |
| no-ai-slop | `lib/cmo/skills/no-ai-slop.md`, `NO_AI_SLOP`, `no-ai-slop.check.ts` | the guide in every prompt that writes for a reader; the check fails when a writing prompt does not carry it | ✅ |
| Voice | `voice_notes_for`, `cmo_memories`, `cmo_lessons` | notes learned from approvals and edits, newer win | ✅ |
| Learning | `cmo_draft_outcomes`, `edit-taxonomy.ts`, `classify-edits.ts` | version chosen, similarity, edit modes; skip reasons → memory; repeated edit modes → a correction card | ✅ |
| Articles | — | — | ❌ later |

The two conflicts of 2026-10-26 are fixed: `x-writing.md` no longer teaches the binary contrast, colon reveal and recap
ending, and the fake drafts no longer open with a faux-insight setup.

## 3. What others teach

| Source | What it is | Take | Leave |
|---|---|---|---|
| No AI Slop (petergyang, MIT, attached repo) | edit and detect modes; preserve voice; minimum effective edit; 20+ named patterns; banned words; eval checklist | the rules as Writer's guidance, never as code | its chat questions and output format; scoring |
| Wikipedia "Signs of AI writing" | WikiProject AI Cleanup catalog: negative parallelism, rule of three, summarizing, vague analysis, heavy bolding…; no single sign proves AI | a second source for the pattern list; signs are things to fix, not a detector | an "AI score" |
| Writer.com | style guide enforced during generation: approved terms, restricted terms rewritten before review, a content score | words to avoid and approved terms as data, applied before the founder sees a draft | a content score number |
| SuperX, Postory, VoiceMoat | X tools that learn style from past posts | learning voice from the founder's own posts, kept in memory | a fixed voice model per user |
| Tweet Hunter | AI writing next to ~3 million high-performing tweets | inspiration from proof; our outlier research does it from the founder's niche | a generic viral library |
| Typefully, Hypefury | mostly scheduling; generic AI or templates and viral hooks | — | hook templates |
| Platform limits (2026 roundups) | LinkedIn 3,000 (≈210 visible), Instagram 2,200 (≈125 visible), TikTok 2,200 safe through APIs, YouTube title 100 / description 5,000, Threads 500 | platform profiles as data with headroom | — |

## 4. Design: one pipeline, many platforms and kinds

- **Inputs, all feeding the writer:** brief (work order: idea, angle, platforms, due day); documents (product,
  strategy with voice and words to avoid, competitors); voice notes; corrections (tier 0 memory); platform profile
  (data).
- **Chain:** Writer (LLM; one agent per platform profile; 3 versions; one shared `post` skill) → code checks (length,
  words to avoid, numbers; no links; hashtags per profile; the no-ai-slop gate, `lib/cmo/slop.ts`) → checker (Claude
  Haiku in a separate context; facts, voice, and the AI-sounding text a pattern list cannot catch) → a failed check
  goes back to the writer once → a version that still fails the code is dropped → card (versions side by side;
  approve, edit, skip).
- **Learning loop**, for every kind: edited → similarity + edit mode and a voice note; skipped → memory; repeated edit
  modes → a correction card, read first next time. Approved as is is recorded but is not a voice note the writer
  reads (2026-11-12): it is the writer's own text.
- Per-platform and per-founder differences are data; the prompt stays stable (prompt cache).
- **Who writes the video script:** Writer owns words that go out as text; Studio's Director owns long-take beats. For a
  video, Writer hands Studio a **video brief** (angle, three hook options, key points, call to action) and later writes
  captions, title and description from the finished video. The Slideshow squad's writer step is Writer's
  `write_slides`.
- **Over MCP** the founder's Claude can write instead (`checkRubric()` in `steps.ts`); code checks stay the last gate.

## 5. no-ai-slop in Writer: guidance plus a code gate

Since 2026-11-05 a product rule: every word a person reads or hears goes through no-ai-slop. Decided 2026-10-26 as
advice only; **changed 2026-11-12 (owner)**: posts in production still read as AI (headline formulas, a closing
question, dashes), because the guidance never stopped a draft. The plain stock patterns are now refused in code; the
rest stays judgment.

| Layer | What |
|---|---|
| Skill | `lib/cmo/skills/no-ai-slop.md` (MIT notice in `LICENSE.md` and `THIRD_PARTY_NOTICES.md`): editing principles and patterns to watch, without its chat questions or output format; embedded as `NO_AI_SLOP` in every writing prompt (posts, captions, briefs, slides, plans, replies, scripts, on-screen text) |
| Check on prompts | `lib/cmo/skills/no-ai-slop.check.ts` fails when a prompt that writes for a reader does not carry the guide; a new writing prompt is added there |
| Code gate | `lib/cmo/slop.ts` (`slopIssues`): binary contrast, faux insight, throat-clearing, colon reveal, rhetorical setup, recap ending, em dash, dash between clauses, headline formulas, hype words, a closing question. Run by `checkPost` (posts, threads, the MCP precheck), `checkCaption`, `checkSlides`, `checkYoutube` and `checkVideoBrief` (spoken lines). A hit goes to the fix round; a version still showing one is dropped; another kind fails the run with the reasons. Cases: `lib/cmo/slop.check.ts` |
| Checker | reads the same guide; fails a draft that reads as AI for what the code cannot catch (a generic line, a moral, three versions of one shape, an ad); its note alone never drops a version |
| Founder's voice wins | a pattern found in the founder's rules or in drafts they edited passes the gate for them (`founderPatterns`, `allowSlop`); drafts approved as written do not count |
| Measure | approve-as-is rate and edit modes (`cmo:eval`, production) |

The other code checks are facts and product rules: length, the strategy's words to avoid, numbers that must be in the
documents, no links, hashtags per platform profile.

**One `post` skill** (`lib/cmo/skills/post.md`, 2026-11-12) replaces `x-writing.md` for X, Threads and LinkedIn: one
true thing in the founder's voice, a plain first line, the calendar item read as a topic and not a headline, no hook
formulas, no closing question. What differs per platform is data in `platforms.json` (§7). A platform gets its own
section only when its approve and edit rates (`cmo_draft_outcomes`) show it needs one.

## 6. Voice: learned into memory, not fixed

Decided 2026-10-26: no fixed "write like you" profile and no samples at onboarding. A founder's style changes; the
brain keeps learning it from what the founder approves and how they edit, and newer notes outweigh older ones.

- Feeds: edits before approval (final text + edit mode such as `WRONG_VOICE`, `TOO_SALESY`); skip reasons. Posts
  approved as is (similarity ≥ 0.95) are still stored as notes but the writer no longer reads them (2026-11-12): they
  are the writer's own words and taught it its AI voice back.
- Samples are optional: a founder never has to give one, and their edits and ratings teach the voice.
- Kept as short voice notes in `cmo_memories` (topic `post`, with importance) and the Sunday `post` lesson
  (`cmo_lessons`), both built; notes expire or lose weight so a new style replaces an old one within weeks; a repeated
  change becomes a correction card (brain tier 0); no fine-tuning, no fixed sample set.

## 7. Platform profiles

`packages/contracts/platforms.json`, read by Writer's prompts, the code checks, Schedule, the cards and SQL's
`platform_profile()`.

**Decided 2026-10-26: no links in any post; no hashtags in posts.** Hashtags go only on video captions.

| Profile | Kind | Limit | Visible before "more" | Hashtags |
|---|---|---|---|---|
| `x` | post | 280 | all | 0 |
| `threads` | post | 500 | all | 0 |
| `linkedin` | post | 3,000 | 140 | 0 |
| `instagram_caption` | caption | 2,200 | 125 | up to 5 |
| `tiktok_caption` | caption | 2,200 | 100 | up to 5 |
| `youtube` | title + description | title 100, description 5,000 | title | up to 3 |

## 8. What Writer makes

| Kind | For | Job kind | State |
|---|---|---|---|
| post | X, Threads, LinkedIn from the same idea | `post_draft` | ✅ |
| X thread | when the founder asks for one | `post_draft` (thread) | ✅ |
| caption | a video, short or slideshow, one per platform | `write_caption` | ✅ |
| YouTube title + description | a long video | `write_caption` (YouTube profile) | ✅ |
| video brief | Studio's Director (angle, 3 hooks, key points, CTA) | `write_video_brief` | ✅ |
| slide text | removed 2026-11-13 (F2); `cmo_enqueue` refuses `write_slides` | — | ❌ |
| article | a long post or article copied out | — | ❌ later |

## 9. Evals

Approved as is per platform and kind (`cmo_draft_outcomes`) · edit mode mix (fewer WRONG_VOICE and TOO_SALESY as voice
notes grow) · code-check pass rate per platform · eval cases per platform in `lib/cmo/jobs/eval` · views per post per
platform and hook type (`post_metrics`).

## 10. Build phases

All built: **W0** no-ai-slop and post rules · **W1** platform profiles, Threads and LinkedIn posts · **W2** voice
notes and corrections · **W3** words for Studio (captions, YouTube text, video brief, slide text) · **W4** X threads.
Articles are left for later.

Done in the CMO review 2 plan: the first week's plan is queued as soon as the website is read, and today's draft once
the plan is written (S2.2), and the week plan orders no AI video (S2.5). Articles stay for later.

## 11. Decisions for the owner

| # | Question | Decision |
|---|---|---|
| 1 | Voice | **decided 2026-10-26**: no fixed voice profile; learned from the founder's edits and skip reasons, newer wins (approved-as-written drafts no longer count, 2026-11-12) |
| 2 | Writing samples at onboarding | **decided**: never required (owner, 2026-11-12: optional at most; edits and ratings teach the voice) |
| 3 | Links in posts | **decided**: never |
| 4 | Hashtags | **decided**: none in posts; only on video captions |
| 5 | no-ai-slop | **decided**: guidance in every writing prompt, plus a code gate on the plain stock patterns (2026-11-12) |
| 6 | Who writes the video script? | **decided 2026-10-27**: Studio's Director; Writer writes the brief before and the captions after |
| 7 | Articles | **decided**: later (owner, 2026-11-08: after the loop works for posts, slides and clips) |

## Sources

Code: `apps/web/lib/cmo/jobs/` (`draft-post.ts`, `check-post.ts`, `steps.ts`, `edit-taxonomy.ts`, `classify-edits.ts`,
`eval`), `apps/web/lib/cmo/skills/` (`post.md`, `short-video.md`), `apps/web/lib/cmo/agents/registry.ts`,
`apps/web/lib/cmo/documents.ts`; the attached `no-ai-slop` repo (`SKILL.md`, `eval.md`, MIT).

Outside:
- https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing
- https://boingboing.net/2025/08/20/wikipedia-publishes-list-of-ai-writing-tells.html
- https://writer.com/brand/
- https://appsource.microsoft.com/en-us/product/office/WA200001548?src=office
- https://superx.so/typefully-alternatives, https://superx.so/tweet-hunter-alternatives, https://superx.so/hypefury-alternatives
- https://wordcount.com/guides/character-limits-social-media
- https://publer.com/help/en/article/what-is-the-character-limit-for-all-social-networks-1a3utwz/
- https://techcrunch.com/2026/04/22/x-makes-it-more-expensive-to-post-links-through-its-api/

Tool comparisons are vendor-written; platform limits come from third-party roundups and change often.
