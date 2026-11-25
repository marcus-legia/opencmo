# Composer: write your own post, checked line by line against the rules

Owner, 2026-11-25. Approach A agreed in conversation.

## Why

The owner wrote a post in r/SaaS by hand ("I don't think a helpful reply can bring us customers…") and it was
"removed by Reddit's filters" a minute later. Reddit is strict, and a post written by AI reads as AI. The owner wants
Ferreto to **not write Reddit posts**: the founder writes, Ferreto guides and checks every sentence against that
subreddit's own rules and against the no-AI-slop rules, and says what to avoid and which words to use. The same
Composer also serves X, Threads and LinkedIn, **alongside** the daily AI drafts (not replacing them).

"Removed by Reddit's filters" is usually Reddit's site-wide spam filter or the sub's automod acting on the **account**
(low karma, new account, no history in the sub, links), not on the words. So the Composer also checks whether the
account is ready for that sub before the founder spends time writing.

## Goals

- A Composer page where the founder writes a post (title + body for Reddit; body for X / Threads / LinkedIn).
- Before writing (Reddit): the sub's rules, numbered, in plain words; what kind of post the sub accepts; what to avoid
  and words to use; whether the founder's account is ready for this sub.
- While writing: instant checks in code (no credits) on every change.
- On demand: "Check against r/<sub> rules": one AI pass that flags exact sentences, names the rule, and suggests a
  rewrite. About 1 credit, held and refunded on failure like every job.
- X / Threads / LinkedIn: the same Composer with the platform's rules (length, tone, 80/20 share vs CTA, no AI slop);
  a daily AI draft can be opened in it.

## Non-goals

- Ferreto never writes the Reddit post and never posts anything. Copy and open, as everywhere.
- No Reddit account connection (OAuth) and no reading other people's profiles.
- No guarantee a post survives: the page says so.

## Anti-goals (would make this a failure even if it works)

- Suggestions that rewrite the founder's post into AI prose. Suggestions are short, per sentence, and the founder
  accepts or ignores each one.
- An AI call on every keystroke (cost, lag, jumping advice).
- A green light that reads as "safe to post" while the account is clearly not ready.

## Constraints (found 2026-11-25)

- **Rules:** ScrapeCreators and Lurk `GET /v1/reddit/subreddit/details?subreddit=X` return `rules` as numbered plain
  text ("1 Submission Guidelines …\n\n2 Posting SaaS Relevant Content Only …") and `submit_text` (the sub's posting
  guidance). Today `subreddit_rules` keeps only a verdict, a 200-char summary and a few needs; the full text is not
  stored.
- **Account:** neither API has a Reddit user endpoint (no karma, no account age, no comment history), and reddit.com
  answers 403 to server requests. `GET /v1/reddit/search?query=author:<username>&sort=new` **does** return the user's
  posts with their subreddit and dates. So: posts in the sub come from that search; karma and account age the founder
  types once from their Reddit profile (owner agreed to enter the username).
- Product copy rules: English UI; never "AI CMO", "in your voice", "marketing team".
- A stranger's text never reaches the chat; the founder's own post is not a stranger's text.

## Approaches

- **A. Code checks live + AI check on a button (picked).** Code runs on every change: links, product name mentions,
  words the sub bans, AI-slop patterns (the same code checks the writer uses), length, title. "Check" sends one AI
  pass with the full rules and the no-ai-slop skill, which flags sentences with the rule and a rewrite. Cheap, fast,
  no jumping advice; subtle problems (e.g. "generic business, no SaaS angle") show only on Check.
- B. AI checks after every pause. Fullest feedback, but credits per keystroke, 2–5 s lag, advice that jumps.
- C. One review before posting. Simplest, but no guidance while writing.

The owner picked A (2026-11-25).

## Decisions

- Parallel with the AI drafts: the plan still drafts X/Threads/LinkedIn daily; Composer is where the founder writes or
  reworks one.
- Reddit: Composer only; no AI-written Reddit posts.
- Username: the founder enters their Reddit username (Settings, and inline on the Composer). Karma and account age:
  typed once, optional, with "as on your Reddit profile" (our call, forced by the APIs).
- Check costs about 1 credit (`compose_check`, a priced job like `repurpose_post`).
- Rules are read once and cached 7 days per sub (as today); the "avoid / use" guide is made from the rules when they
  are read (cheap model, cached with them).

## What the founder sees (sketch)

```
Composer   [Reddit ▾]  r/[SaaS        ]  u/[my_handle]
┌ Before you write ───────────────────────────────────────────┐
│ Account: 120 karma · 8 months · 0 posts in r/SaaS            │
│ ⚠ New in r/SaaS: comment for a week before your first post.   │
│ Rules: 1 Submission guidelines · 2 SaaS content only ·        │
│        3 Promotion max once / 60 days, disclose first …       │
│ Avoid: "my tool", links, "DM me", generic business advice     │
│ Use:   a concrete SaaS problem, numbers you have, a question  │
└─────────────────────────────────────────────────────────────┘
Title [ How do you turn a helpful reply into a customer?      ]
Body  [ I've been on r/SaaS for 3 days …  ~~my saas~~ …        ]
       ⚠ "my saas revenue is stay still" · Rule 3 · reads as
         promotion without disclosure · try: "…"
[ Check against r/SaaS rules · 1 credit ]   [ Copy and open r/SaaS ]
```

## What is left to the builder

Exact layout and copy, the code-check patterns beyond those listed, how suggestions are shown inline (underline +
side list is the intent), and where the Composer is linked from (Post page, Sales, a draft card).
