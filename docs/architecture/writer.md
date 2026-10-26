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

**Add, in order:** No AI Slop and the fix to `x-writing.md`; platform profiles as data (one idea → X, Threads,
LinkedIn); voice samples from the founder's own approved posts; captions and video words for Studio.

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
| No AI Slop (petergyang, MIT, attached repo) | edit and detect modes; preserve voice; minimum effective edit; 20+ named patterns; banned words; eval checklist | rules as Writer's skill; banned list as a code check; patterns as checker criteria | its chat questions and output format; scoring |
| Wikipedia "Signs of AI writing" | WikiProject AI Cleanup catalog: negative parallelism, rule of three, summarizing, vague analysis, heavy bolding…; no single sign proves AI | a second source for the pattern list; signs are things to fix, not a detector | an "AI score" |
| Writer.com | style guide enforced during generation: approved terms, restricted terms rewritten before review, a content score | words to avoid and approved terms as data, applied before the founder sees a draft | a content score number |
| SuperX, Postory, VoiceMoat | X tools that learn style from past posts | voice from the founder's own posts | training a model per user |
| Tweet Hunter | AI writing next to ~3 million high-performing tweets | inspiration from proof; our outlier research does it from the founder's niche | a generic viral library |
| Typefully, Hypefury | mostly scheduling; generic AI or templates and viral hooks | — | hook templates |
| Platform limits (2026 roundups) | LinkedIn 3,000 (≈210 visible), Instagram 2,200 (≈125 visible), TikTok 2,200 safe through APIs, YouTube title 100 / description 5,000, Threads 500 | platform profiles as data with headroom | — |

## 4. Design: one pipeline, many platforms and kinds

- **Inputs, all feeding the writer:** brief (work order: idea, angle, platforms, due day); documents (product,
  strategy with voice and words to avoid, competitors); voice samples (new); corrections (tier 0 memory, new); platform
  profile (data, new).
- **Chain:** Writer (LLM; `x_writer` today; one agent per platform profile; 3 versions) → code checks (length, banned
  words from strategy + No AI Slop, numbers, hashtags, links) → checker (other provider; binary criteria incl. slop
  patterns) → a failed check goes back to the writer once → card (versions side by side; approve, edit, skip).
- **Learning loop** (built for X, extend to every kind): approved as is → a voice sample; edited → similarity + edit
  mode; skipped → memory; repeated edit modes → a correction card on Sunday → tier 0 memory read first next time.
- Per-platform and per-founder differences are data; the prompt stays stable (prompt cache).
- **Who writes the video script:** Writer owns words that go out as text; Studio's Director owns long-take beats. For a
  video, Writer hands Studio a **video brief** (angle, three hook options, key points, call to action) and later writes
  captions, title and description from the finished video. The Slideshow squad's writer step calls Writer's
  `write_slides` capability.
- **Over MCP** the founder's Claude can write instead (`checkRubric()` in `steps.ts`); code checks stay the last gate.

## 5. No AI Slop in Writer

| Layer | What | Cost |
|---|---|---|
| Skill | `lib/cmo/skills/no-ai-slop.md` (MIT notice in `LICENSE.md` and `THIRD_PARTY_NOTICES.md`): editing principles, words to cut, patterns to cut; not its chat questions or output format; loaded by `x_writer`, `sales`, `checker`, CMO chat | ~1,700 words per prompt, cached |
| Code check | "banned outright" words and a few phrases ("Here's the thing", "What nobody tells you") next to the strategy's words to avoid, in `checkPost` and its platform versions | free |
| Checker criteria | binary: no binary contrast; no throat-clearing opener; no colon reveal; no fake-profound ending or recap; no invented authority | part of the checker call |
| Measure | approve-as-is rate and edit modes before and after (`cmo:eval`, production) | — |

## 6. Voice

Sources, best first: (1) approved as is (similarity ≥ 0.95); (2) edited then approved (the final text is the founder's
own; the edit mode says what was wrong); (3) pasted samples at onboarding (optional); (4) the strategy's voice
sentence and words to avoid (today).

Use: the 5–8 most recent samples for the target platform go into the prompt as voice examples, never as text to copy;
samples are data inside tags (`lib/cmo/untrusted.ts`); the founder sees and removes samples on the Brand page; no
fine-tuning.

## 7. Platform profiles

One data file (for example `packages/contracts/platforms.json`) read by Writer's prompt, the code checks, Schedule and
the cards; numbers carry headroom.

| Platform | Limit | Visible before "more" | Hashtags | Links | Tone |
|---|---|---|---|---|---|
| X | 280 | all | 0–2, usually none | avoid by default (API post with a link ~$0.20 vs ~$0.015) | one idea, a clear first line |
| Threads | 500 | all | none | allowed | conversational |
| LinkedIn | 3,000 | ≈210 desktop, ≈140 phone | 0–3 | allowed | longer, short paragraphs, hook before the cut |
| Instagram caption | 2,200 | ≈125 | 3–5 | not clickable | hook in the first line |
| TikTok caption | 2,200 (safe through APIs) | short | 3–5 | not clickable | short, matches the video's hook |
| YouTube | title 100, description 5,000 | title | a few in the description | in the description | searchable title; chapters later |

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
TOO_SALESY after voice samples and No AI Slop) · code-check pass rate per platform · eval cases per platform in
`lib/cmo/jobs/eval` (Threads, LinkedIn, captions; slop questions in the judge) · views per post per platform and hook
type (`post_metrics`).

## 10. Build phases

- **W0** No AI Slop: skill, banned list in code, checker criteria, `x-writing.md` and fake-draft fixes, evals before
  and after. Small, no migration.
- **W1** Platform profiles + Threads and LinkedIn posts: the data file; per-platform versions; checks per profile.
- **W2** Voice samples: from approved and edited posts; optional pasted samples; on the Brand page.
- **W3** Words for Studio: captions per platform, YouTube title and description, video brief, slide text.
- **W4** Threads on X and long drafts, when founders ask.

## 11. Decisions for the owner

| # | Question | Recommendation |
|---|---|---|
| 1 | Use approved posts as voice samples automatically? | yes; the founder can see and remove them |
| 2 | Ask for writing samples at onboarding? | optional, with a skip |
| 3 | Links in X posts | avoid by default (cost and reach); the founder can add one |
| 4 | Hashtags | per platform profile: X 0–2, Threads none, LinkedIn 0–3, Instagram and TikTok 3–5 |
| 5 | Who writes the video script? | Studio's Director; Writer writes the brief before and the captions after |
| 6 | Articles | later (W4) |

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
