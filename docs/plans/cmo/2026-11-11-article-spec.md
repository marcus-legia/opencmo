# Articles: a proposal for the Writer's long draft (spec, not scheduled)

**Status: proposal.** The owner is still choosing the approach. Nothing here is scheduled, and no session works from
it until the owner answers §8. It replaces nothing on the roadmap. Articles stay after the CMO loop for posts,
slides and scripts works for a paying founder (owner, 2026-11-08; `CLAUDE.md` "Strategy").

Source: the research report [`docs/research/growth/2026-11-11-article-writer.md`](../../research/growth/2026-11-11-article-writer.md)
(Okara, Google's spam policies, where an article can be published, Typefully/Taplio), the architecture page
`docs/architecture/writer.md` (articles "❌ later"), `2026-11-04-cmo-review-plan.md` B5.9 ("Writer W4: `write_article`
(long draft). Last."), and `2026-11-09-cmo-review-3-plan.md` ("articles (research first)").

## 1. Why

- **Competitors list it.** Okara, the closest competitor, sells an Articles Writer next to SEO and GEO agents on its
  paid plan. A founder comparing the two sees an empty row on our side.
- **One deep idea feeds the week.** The week plan today writes many short pieces from short ideas. An article the
  founder approved is a better source for that week's posts, slides and script: one idea worked out once, then cut
  into pieces.
- **Long form is where the founder's own knowledge shows.** Search engines and AI answers reward pages that add
  something new. The founder's documents, numbers and stories are that something, and the Writer already has them.

What it must not become: a content farm. Google's "scaled content abuse" policy (2024-03; since 2026-05 also applied
to AI Overviews and AI Mode) treats many pages made to rank without adding value as spam, whether a model or a person
wrote them. Okara's "30+ articles/month" tier is what we will not build.

## 2. What the founder gets (proposal)

1. **One article a week, by default.** The week plan can order an "article" item, at most one per week unless the
   founder raises it (cap: 2). The founder can also ask for one: in the Writer's "Ask" box (a fourth choice,
   "Article"), or in the CMO chat (`create_task` with agent `writer`, kind `article`).
2. **It starts from the founder, not a keyword list.** Each article has a reader question ("How do I…?"). That
   question comes from the content plan, from Research (a competitor's outlier or a recurring Reddit question), or
   from the founder. The founder's documents, numbers and stories are its material. A number that is not in the
   documents is not written (the post check already does this).
3. **A price card, then one run.** "Article · N credits" with the question, the angle and the outline length. After
   one confirmation the job writes the outline, the draft, runs the checker and makes one fix, with no second
   approval (charge before running, `CLAUDE.md`).
4. **An article card, then a reading view.** The card shows the title, the summary, the reading time and the checks.
   "Open" goes to a reading view where the founder edits the text in place. Approve, Edit, or Skip with a reason, as
   for posts. Edits teach the voice, as for posts (`cmo_draft_outcomes`, edit taxonomy).
5. **Out the door, the founder's way.** v1 offers Copy (Markdown or rich text), Download (`.md`, `.html`), and "Copy
   for LinkedIn" (plain text with headings kept). The founder pastes it into their blog, LinkedIn or Substack.
   Nothing is posted by us in v1.
6. **The week reuses it.** An approved article becomes the source of that week's posts, slides and script: the week
   plan cites it, and each item links back to it.

## 3. Options the owner is choosing between

| | A. Draft and copy out (recommended v1) | B. A + publish to a blog | C. Okara-style SEO engine |
|---|---|---|---|
| What | §2 as written | A, then "Publish" to WordPress (through Zernio's Blogs API) or Ghost, after approval | keyword research, many articles a month, published to the CMS |
| Reach | every founder (copy works anywhere) | founders on WordPress or Ghost | founders who want SEO volume |
| Cost to build | M | A + M | L |
| Risk | low | Zernio's WordPress docs still show Shopify on the create-article page: verify first | breaks "Assist, never act" and no-ai-slop; Google's scaled-content policy |
| Fits the product rules | yes | yes, approve then publish | no |

**Recommendation: A first. Then B with WordPress through Zernio, if founders ask for it.** Zernio is already our
publishing provider, so B adds an account type, not a vendor. Ghost only on demand. X Articles (official API since
2026-06-11, X Premium reported to be needed) only if Zernio supports it. A second X OAuth integration is not worth
it. LinkedIn has no API for native articles or newsletters, Medium issues no new API tokens, and Substack has no
public API we could find, so those stay copy-out.

## 4. Design (option A)

### 4.1 Data

A new table, because `content_items` cannot hold an article: `final_text` ≤ 4000 characters and `body` ≤ 16 KB
(`supabase/schema/current.sql`), while an article of 1,200–2,000 words is 8–14 k characters before its outline,
versions and checks.

`articles`: `id`, `user_id`, `order_id` (the `write_article` work order), `item_id` (the week-plan `content_items`
row, nullable for one asked in the chat or Writer), `question`, `title`, `summary` (≤ 300), `outline` (jsonb),
`body_md` (≤ 40,000 characters), `status` (`drafting` | `in_review` | `approved` | `skipped`), `checks` (jsonb),
`gen` (model, prompt version), `version`, `decided_at`, timestamps.

- RLS: the owner reads. Writes go only through RPCs (`article_save` for the worker; `article_edit` and
  `article_decide` for the founder, version-checked like `cmo_script_edit_beat`).
- Grants in the same migration, a pgTAP test, and the schema dump (`.claude/skills/supabase-migrations`).
- Old versions: keep the last 3 in `article_versions` (or a capped jsonb array). This is decision D5.

### 4.2 Job

`write_article` in `packages/contracts/capabilities.json` (department `writer`, effect `spend`, approval `founder`,
callers `brain`, `assistant`, `mcp`, `ui`), and a new `CmoJobKind`. Price from `cmo_job_price('write_article')` (data,
not code). Measure it on the eval before setting it. A first guess is 3–5 credits against 1 for a post, because the
draft is about 10× a post's output tokens.

Steps, in one run (`lib/cmo/writer/jobs.ts`, a new `writeArticle`):

1. **Material:** the documents, the voice notes and corrections, the week plan's item, and the Research insight it
   came from, if any. The same `recall` and `voiceBlock` the posts use.
2. **Outline:** title, the reader question, the answer in two sentences (answer first, for readers and for AI
   answers), 4–7 sections with the founder's material named for each.
3. **Draft:** Sonnet (`article_writer`, a new registry agent), `NO_AI_SLOP` embedded, and added to
   `no-ai-slop.check.ts`.
4. **Checks (code):** length (800–2,200 words), numbers only from the documents (`lib/cmo/writer/checks.ts`), words
   to avoid, headings present. Links: only to the founder's site and to sources the documents or Research cite (the
   posts' "no links" rule does not apply here; `hasLink` is reused to list them for the card).
5. **Checker (Haiku, own context):** slop, claims without a source, does it answer the question. One fix pass, as for
   posts.
6. **Save and card:** `article_save`, then an approval card of a new kind, `article`. This needs `approvals_kind_check`
   widened in a new migration, and the card snapshot from `approval_snapshot`.

No Creem moderation call: Creem screens image and video prompts, and an article is text (`CLAUDE.md` "Moderation is
Creem's"). If v2 adds a header image, it goes through the existing image flow and its moderation.

### 4.3 Screens

- **Writer** (`components/today/AgentWriter.tsx`): an "Article" choice in Ask; article rows in This week and All
  drafts (kind `article`, a reading-time meta).
- **Article card** (`components/cards/`): title, summary, reading time, checks, and Approve / Edit / Skip. "Open"
  goes to the reading view.
- **Reading view** (`/app/article/[id]`, in the Today frame): the text, edited in place (Markdown with a small
  toolbar, no rich-text dependency in v1), autosave through `article_edit` with the version, and Copy / Download /
  "Copy for LinkedIn".
- **Calendar:** an approved article is not a slot, because nothing is scheduled. It shows in the week's side list
  with its day.

### 4.4 The week plan

- `plan_week` may add one `article` item per week (a cap in the plan's rules and in SQL), with its reader question.
- Once the article is approved, the week's other items take it as their source (`brief.article_id`). The post,
  slide and script prompts get its outline as material.
- A week without an approved article runs exactly as today.

## 5. Phases

| Phase | Scope | Size | Waits on |
|---|---|---|---|
| **A0** | Owner answers §8; verify the price on the eval with 10 article cases (`lib/cmo/jobs/eval/cases/`) | S | owner |
| **A1** | Table and RPCs, `write_article` job, article card, reading view, Copy/Download, the Writer's Ask, the CMO chat | M | A0 |
| **A2** | Week plan: the article item and the week's pieces citing it | S–M | A1 |
| **B1** | Publish to WordPress through Zernio (verify `docs.zernio.com` Blogs API for WordPress first), approve-then-publish, published URL back on the article | M | A1 + founders asking |
| **B2** | Ghost Admin API, or X Articles if Zernio supports it | M | B1 |

Each phase gets its own implementation plan with session files before code (`CLAUDE.md` "Working style").

## 6. Done when (A1 + A2)

- A founder asks for an article in the Writer, sees one price card, confirms, and within a few minutes gets an
  article card. They open it, edit a paragraph, approve it, and copy it as Markdown.
- The next week plan cites that article, and at least one post and the script take it as their source.
- No article states a number missing from the documents, and the no-ai-slop check covers the new prompt.
- `npm run typecheck`, `check:contracts`, the CMO eval with the article cases, and pgTAP are green.

## 7. Not in this spec

Keyword research tools, backlinks or "link broker", many articles a month, auto-publishing without approval,
Medium, header images (v2 at the earliest), translations.

## 8. Decisions for the owner

| # | Question | Proposal |
|---|---|---|
| D1 | Option A, B or C (§3)? | A now, B on demand, never C |
| D2 | How many a week by default, and the cap? | 1 by default, cap 2 |
| D3 | Who picks the question: the week plan, Research, the founder, or all three? | all three; the founder can change it on the price card |
| D4 | Price per article | measured on the eval in A0; first guess 3–5 credits |
| D5 | How many old versions to keep | the last 3 |
| D6 | Length range | 800–2,200 words, default ~1,200 |
| D7 | Does the week plan reuse the article (§4.4) in v1? | yes (A2) |
| D8 | Which blog first in B: WordPress via Zernio, or Ghost? | WordPress via Zernio, after the docs check |
| D9 | Free plan: can a founder draft an article before paying? | no; copy-out is free once drafted, drafting costs credits like a post |
