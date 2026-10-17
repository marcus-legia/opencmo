# Writing an OpenCMO blog post

This is the contract for anyone writing a post, including the scheduled Claude run. Each post is
**one file**, `content/blog/<slug>.html`. The blog is static: a post goes live when it lands on
`main` and Vercel deploys.

`npm run check:blog` enforces every rule below (it also runs in CI). Red means no merge.

## Topic: teach marketing, don't advertise

The blog is a school of marketing and selling for **solo founders, creators and small teams**,
not a feature page. A reader must learn how to do the thing even if they never use OpenCMO.

- **Write about:** education content marketing (teaching as marketing), building a personal or
  company brand, video and short-form video, writing on X, content calendars and repurposing,
  selling online courses and digital products, community and newsletters, positioning, ICP,
  landing pages, pricing pages, launches, measurement, joining Reddit the right way.
- **Don't write:** a post about an OpenCMO feature (clipping, editor, captions…), a "best tools"
  comparison, a post that attacks a competitor.
- Mention OpenCMO at most once, lightly, only when it is truly relevant. The page adds the CTA
  box at the end.

## Language and voice

- Posts are in **English**: the customers are global.
- Scheduled posts are written by `"author": "opencmo"` (OpenCMO Team) in a **teacher's voice**:
  clear, warm, concrete, one idea at a time, an example for every principle, and a step the
  reader can try today. Never invent a first-person story ("when I launched…").

## File structure

```html
<!--meta
{
  "title": "How to Write Your First Positioning Statement",
  "description": "One 120–160 character sentence: what this post helps the reader do.",
  "category": "how-to",
  "date": "2026-10-01",
  "updated": "2026-10-01",
  "author": "opencmo",
  "answer": "A 30–80 word answer to the post's main question.",
  "faq": [{ "q": "A real question people ask?", "a": "A 1–3 sentence answer." }],
  "keywords": ["main keyword", "variant"],
  "draft": false
}
-->
<p>Opening paragraph…</p>
<h2 id="what-is-x">What is X?</h2>
<p>…</p>
<!--block {"type": "callout", "tone": "tip", "title": "…", "text": "…"} -->
```

- `category` is the **kind of post**: `how-to` (step by step for one task), `tips` (short tips
  to use today), `playbooks` (a repeatable plan to get customers), `basics` (explains a core
  idea). The list lives in `categories.ts`.
- `author` is a key in `authors.ts`.
- An empty `updated` means the same as `date`. When you edit an old post, change `updated`,
  never `date`.
- `draft: true` only shows under `next dev`.

## Slug: SEO / AEO / GEO

- The slug is the file name: 2–6 lowercase English words joined by `-`, at most 60 characters.
- **Main keyword first.** `write-positioning-statement`, not `how-i-finally-figured-out-positioning`.
- **No year or date.** Posts get updated, so the URL must stay true.
- Don't start or end with a filler word (`the`, `a`, `of`, `for`…).
- Flat URL: `/blog/<slug>`. The category is NOT in the URL.
- **Slugs never change.** If one must, add `"old-slug": "new-slug"` to `redirects.json`
  (Next answers with a 308 and keeps rankings and links).

## Post skeleton (AEO: so AI answers and featured snippets can quote it)

1. **`answer`**: answers the main question in 30–80 words. Shown as "Short answer" at the top
   and placed in the JSON-LD.
2. **Opening**, 1–2 paragraphs: what the problem is and why the reader should care.
3. **H2s phrased as questions** people really type: "How do you…?", "What makes…?".
4. **The first sentence under each H2 answers it**; details come after. AI quotes that sentence.
5. At least **one table or list**.
6. **3–6 FAQ** entries in meta. The page renders the FAQ and `FAQPage` JSON-LD, so do NOT repeat
   the FAQ in the body.
7. **At least 2 internal links**: to `/` and/or `/blog/<slug>` of a post that exists.
8. End with a short summary. The page adds the CTA box.
9. **Length:** at least 500 words of prose. Posts dated 2026-10-17 or later: 500–800 words
   (blocks don't count).

## Visual blocks

Posts dated 2026-10-17 or later need **at least 3 blocks of at least 2 kinds**, including at least
one of `chart`, `stats`, `leaderboard` or `scene`, and must open with a paragraph. A block is one
line of JSON in a comment, placed between paragraphs:

```html
<!--block {"type": "stats", "illustrative": true, "items": [{"value": "4", "label": "posts cut from one lesson"}, {"value": "1", "label": "hour to write it"}]} -->
```

Blocks are data, not markup: the site's components draw them in the Lapis & Marble style, with
the colours, motion and phone layout already done. No HTML inside block text.

| type | what it shows | fields |
|---|---|---|
| `stats` | 2–4 big numbers | `title?`, `items[{value ≤12 chars, label}]`, evidence |
| `chart` | bar or line chart | `kind: bar\|line`, `title`, `unit?`, `data[{label ≤24, value}]` (2–10), `highlight?` (index), evidence |
| `leaderboard` | ranked list with bars, top 3 marked | `title`, `unit?`, `rows[{name, score, note?}]` (3–8), evidence |
| `storyboard` | numbered frames, left to right | `title?`, `frames[{title ≤40, text ≤160}]` (3–6) |
| `callout` | one highlighted idea | `tone: tip\|key\|warning\|exercise`, `title`, `text ≤320` |
| `compare` | before / after (or wrong / right) | `title?`, `before{label, items[]}`, `after{label, items[]}` (2–5 items each) |
| `scene` | animated 3D figure (three.js), at most one per post | `preset: funnel\|flywheel\|ladder\|orbit`, `title`, `labels[]` (3–6, ≤28 chars), `caption?` |

Scene presets: `funnel` = stages that narrow (label 1 at the top); `flywheel` = a loop where each
step feeds the next; `ladder` = steps that climb (a value ladder, a skill path); `orbit` = label 1
is the core, the rest circle it (one lesson → many channels).

**Evidence (required on `stats`, `chart`, `leaderboard`).** Either
`"source": {"label": "Who published it", "url": "https://…"}`, a page you actually opened that
states that number, or `"illustrative": true`, which prints "Illustrative example, not measured
data" under the block. Teaching examples ("ranking your topic ideas") are illustrative; never
dress an example up as a finding.

## Allowed HTML (outside blocks)

`p h2 h3 h4 ul ol li a strong em b i blockquote figure figcaption img table thead tbody tr th td
code pre hr br sup sub mark small`

- **No `<h1>`.** The title comes from `meta.title`.
- Every `h2`/`h3`/`h4` has a unique `id` in `lower-case-with-dashes`. `faq` is reserved.
- Every `<img>` has a descriptive `alt`.
- No `style`, `class`, `script`, `iframe`, `on*=`, `javascript:`. `styles/blog.css` owns the look.

## Facts

- **Never invent numbers, studies or quotes.** No source, no number. A made-up number that an AI
  quotes back is a real risk to the brand.
- About OpenCMO, only say what the product does today: an AI CMO with three departments (Video,
  Post, Sales) where the user approves everything that goes out — see "Product rules" in
  `CLAUDE.md`. Video today: **upload** a video the user owns (do NOT write "paste a YouTube
  link"), automatic or manual moment picking, 9:16 framing that follows the speaker, branded
  burned-in captions, editing a clip by asking, Brand Kit. Prices: `lib/pricing.ts`,
  `lib/usage.ts`. If a department isn't live, don't write as if it is.
- Avoid words payment providers flag: "lead generation", "leads", "outreach", "growth hack",
  "get rich", income figures.
- Don't name competitors to put them down.

## Scheduled run

1. Pick one question a founder or creator really searches for that no post answers yet; prefer
   the category with the fewest posts. Read this folder to avoid duplicates.
2. Name the slug by the rules above and write `content/blog/<slug>.html` with its blocks.
3. `npm run check:blog --workspace @opencmo/web` until green.
4. `npm run build --workspace @opencmo/web`.
5. Commit (English message), push `blog/<slug>`, open a PR titled `Blog: <title>`, and merge it
   only when both are green. If either stays red, don't merge: leave the PR open and say why.
