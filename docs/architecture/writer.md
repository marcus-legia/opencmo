# Writer: the words department

Status: **proposed** (2026-10-26), research before build. Markdown twin of [`writer.html`](writer.html), written for
agents; the two must say the same thing. Parent pages: [`ai-cmo.md`](ai-cmo.md), [`brain.md`](brain.md),
[`studio.md`](studio.md).

Writer writes every word that goes out: posts, captions, video titles and descriptions, the brief a video starts from,
the text on slides; in the founder's voice, from the founder's documents, through code checks and a second model
before a card.

## 1. Verdict

**A strong core, only for X:** three versions with different hooks → code checks → a checker on the provider that did
not draft → one fix → a card (`draft-post.ts`); code checks (280 characters, words to avoid, numbers of 10 or more must
be in the documents, at most two hashtags; `check-post.ts`); a learning loop (version chosen, similarity, edit mode;
`edit-taxonomy.ts`, `classify-edits.ts`); evals with a cascade judge (`lib/cmo/jobs/eval`).

**Add, in order:** No AI Slop as writing guidance (a skill, not a code rule) and the fix to `x-writing.md`; platform
profiles as data (one idea → X, Threads, LinkedIn); voice learned into memory from recent posts and edits (it follows
the founder when their style changes); captions and video words for Studio.

## 2. Writer today (`main`, `eb858ca`)

| Part | Where | What it does | State |
|---|---|---|---|
| Agents | `lib/cmo/agents/registry.ts` | `x_writer` (X posts), `writer` (intro words), `director` (long-take script), `checker` | built |
| X draft job | `jobs/draft-post.ts` | 3 versions with an angle each and a rationale; checker on the other provider; one fix; card with alternates | built |
| Code checks | `jobs/check-post.ts` | length, words to avoid, unknown numbers, hashtags | built (X only) |
| Skills | `lib/cmo/skills/` | `x-writing`, `content-calendar`, `short-video` (captions per platform) + 39 library playbooks for the CMO chat | built |
| Voice | `documents.ts` (strategy) | a voice sentence and words to avoid; no samples of the founder's writing | partial |
| Learning | `cmo_draft_outcomes`, `edit-taxonomy.ts` | version chosen, similarity, 8 edit modes; skip reasons → memory | built |
| Other platforms, captions, YouTube text, video brief, slide text, No AI Slop | none | — | missing |

**Two conflicts to fix in the same PR as No AI Slop:** `x-writing.md` lines 13, 16, 23 teach "The real reason
[outcome] happens isn't what you think", "[Common advice] is wrong. Here's why:" and "the last post sums up" (binary
contrast, colon reveal, recap ending). The fake drafts in `draft-post.ts` (checks, e2e) open with "Most founders skip
this:" (faux-insight setup); change them too.

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
  strategy with voice and words to avoid, competitors); voice memory (new); corrections (tier 0 memory, new); platform
  profile (data, new).
- **Chain:** Writer (LLM; `x_writer` today; one agent per platform profile; 3 versions) → code checks (length, words
  to avoid, numbers; no links and no hashtags in posts) → checker (other provider; facts and voice; No AI Slop as
  advice, not a gate) → a failed check goes back to the writer once → card (versions side by side; approve, edit, skip).
- **Learning loop** (built for X, extend to every kind): approved as is → a voice note in memory; edited → similarity + edit
  mode; skipped → memory; repeated edit modes → a correction card on Sunday → tier 0 memory read first next time.
- Per-platform and per-founder differences are data; the prompt stays stable (prompt cache).
- **Who writes the video script:** Writer owns words that go out as text; Studio's Director owns long-take beats. For a
  video, Writer hands Studio a **video brief** (angle, three hook options, key points, call to action) and later writes
  captions, title and description from the finished video. The Slideshow squad's writer step calls Writer's
  `write_slides` capability.
- **Over MCP** the founder's Claude can write instead (`checkRubric()` in `steps.ts`); code checks stay the last gate.

## 5. No AI Slop in Writer: guidance, not a rule

Decided 2026-10-26: style changes, and a founder's own voice may use a phrase the list warns against. No AI Slop is
advice the writer reads, never a code check and never a gate that drops a draft.

| Layer | What |
|---|---|
| Skill | `lib/cmo/skills/no-ai-slop.md` (MIT notice in `LICENSE.md` and `THIRD_PARTY_NOTICES.md`): editing principles and patterns to watch, without its chat questions or output format; loaded by `x_writer`, `sales`, CMO chat; ~1,700 words, cached |
| Checker | reads the same skill as advice; may suggest a fix in its one round; a pattern alone never drops a version |
| Founder's voice wins | when voice memory shows the founder writes a certain way, that beats the skill |
| Measure | approve-as-is rate and edit modes before and after (`cmo:eval`, production) |

Code checks stay only for facts and product rules: length, the strategy's words to avoid, numbers that must be in the
documents, no links and no hashtags in posts.

## 6. Voice: learned into memory, not fixed

Decided 2026-10-26: no fixed "write like you" profile and no samples at onboarding. A founder's style changes; the
brain keeps learning it from what the founder approves and how they edit, and newer notes outweigh older ones.

- Feeds: posts approved as is (similarity ≥ 0.95); edits before approval (final text + edit mode such as
  `WRONG_VOICE`, `TOO_SALESY`); skip reasons.
- Kept as short voice notes in `cmo_memories` (topic `post`, with importance) and the Sunday `post` lesson
  (`cmo_lessons`), both built; notes expire or lose weight so a new style replaces an old one within weeks; a repeated
  change becomes a correction card (brain tier 0); no fine-tuning, no fixed sample set.

## 7. Platform profiles

One data file (for example `packages/contracts/platforms.json`) read by Writer's prompt, the code checks, Schedule and
the cards; numbers carry headroom.

**Decided 2026-10-26: no links in any post; no hashtags in posts.** Hashtags go only on videos (captions for a video,
short or slideshow on TikTok, Instagram, YouTube).

| Platform | Limit | Visible before "more" | Tone |
|---|---|---|---|
| X | 280 | all | one idea, a clear first line |
| Threads | 500 | all | conversational |
| LinkedIn | 3,000 | ≈210 desktop, ≈140 phone | longer, short paragraphs, hook before the cut |
| Instagram caption (video) | 2,200 | ≈125 | hook in the first line |
| TikTok caption (video) | 2,200 (safe through APIs) | short | short, matches the video's hook |
| YouTube | title 100, description 5,000 | title | searchable title; chapters later |

## 8. What Writer makes

| Kind | For | Order kind | State |
|---|---|---|---|
| post | X, then Threads and LinkedIn from the same idea | `post_draft` | X built |
| caption | a video, short or slideshow, one per platform | `write_caption` | new |
| YouTube title + description | a long video | `write_caption` (YouTube profile) | new |
| video brief | Studio's Director (angle, 3 hooks, key points, CTA) | `write_video_brief` | new |
| slide text | Studio's Slideshow squad | `write_slides` | new |
| X thread, long draft | X threads; a long post or article copied out | `post_draft` (thread), `write_article` | later |

## 9. Evals

Approved as is per platform and kind (`cmo_draft_outcomes`, extended) · edit mode mix (fewer WRONG_VOICE and
TOO_SALESY as voice memory grows) · code-check pass rate per platform · eval cases per platform in
`lib/cmo/jobs/eval` (Threads, LinkedIn, captions) · views per post per platform and hook
type (`post_metrics`).

## 10. Build phases

- **W0** No AI Slop as guidance + post rules: the skill, `x-writing.md` and fake-draft fixes, no links and no hashtags
  in posts as code checks, evals before and after. Small, no migration.
- **W1** Platform profiles + Threads and LinkedIn posts: the data file; per-platform versions; checks per profile.
- **W2** Voice memory: voice notes from approvals and edits in `cmo_memories`, newer wins; the Sunday lesson;
  corrections from repeated edits.
- **W3** Words for Studio: captions per platform, YouTube title and description, video brief, slide text.
- **W4** Threads on X and long drafts, when founders ask.

## 11. Decisions for the owner

| # | Question | Decision |
|---|---|---|
| 1 | Voice | **decided 2026-10-26**: no fixed voice profile; learned into memory from recent approvals and edits, newer wins |
| 2 | Writing samples at onboarding | **decided**: no |
| 3 | Links in posts | **decided**: never |
| 4 | Hashtags | **decided**: none in posts; only on video captions |
| 5 | No AI Slop | **decided**: guidance in a skill, not code and not a gate |
| 6 | Who writes the video script? | **decided 2026-10-27**: Studio's Director; Writer writes the brief before and the captions after |
| 7 | Articles | **decided**: later (W4) |

## Sources

Code: `apps/web/lib/cmo/jobs/` (`draft-post.ts`, `check-post.ts`, `steps.ts`, `edit-taxonomy.ts`, `classify-edits.ts`,
`eval`), `apps/web/lib/cmo/skills/` (`x-writing.md`, `short-video.md`), `apps/web/lib/cmo/agents/registry.ts`,
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
