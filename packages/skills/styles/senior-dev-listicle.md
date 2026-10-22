---
name: senior-dev-listicle
kind: style
description: Talking head with on-screen proof, one accent colour and listicle chapters. For a founder or developer counting through tools, tips or repos ("5 things…", "3 mistakes…").
requires: [caption.emphasis, title.hook, speaker.punchIn, proof.card, proof.capture, transition.whip]
preset:
  captions: { preset: spotlight, maxWords: 2, reveal: fade, emphasis: { fontFamily: Fraunces, fontStyle: italic, color: accent } }
  hookTitle: { accentLine: 2, accentBox: true, accentFontFamily: Fraunces, accentFontStyle: italic, seconds: 3 }
  speaker: { punchIn: { scales: [1.0, 1.15], minShot: 1.2 } }
  chapters: { transition: whip }
  proof: { zoom: 1.8, mark: marker }
  palette: { accent: brand, paper: '#FFFFFF', ink: '#111111' }
---
# Senior dev listicle

A calm, credible talking head. The speaker counts through a short list; every claim that can be
checked is checked on screen. One accent colour, two fonts, nothing that competes with the face.
The preset already sets the captions, the punch-in rhythm, the transitions and the colours. Your job
is the judgment below, written as one Edit Plan for `apply_style`.

Every quote in the plan is copied word for word from <clip_context>. Never write seconds. If you
cannot find the exact words for a beat, leave the beat out: a missing beat is better than a wrong one.

## The hook (plan.hook)

- Two lines, 3 to 8 words each. Built from the speaker's own strongest phrase in the first
  sentences, tightened, never invented: no promise the speaker does not make.
- Line 1 sets the topic ("3 tools I open every morning"). Line 2 is the promise or payoff, the part a
  viewer stays for ("and why they beat the paid ones"). Line 2 sits on the accent box.
- No emoji, no clickbait words the speaker did not say ("insane", "secret"), no question marks
  unless the speaker asks the question.
- One line is fine when the topic already carries the promise.

## What to emphasize (plan.emphasis)

Emphasis is the accent colour in an italic serif on a single word or a short phrase. It works only
when it is rare.

- Emphasize **numbers** ("120", "5x", "$10k", "two weeks"), **names** (a product, a repo, a tool,
  a person) and **promises** (the payoff word: "free", "faster", "half", "never").
- At most one emphasized phrase per 2 seconds of speech, and usually fewer. Count before you write
  the plan; drop the weakest when two sit close together.
- One to three words per quote. Quote exactly the words to colour, not the sentence around them.
- Never emphasize filler or glue words ("really", "just", "so", "the", "and"), or a word only
  because it is loud.
- The number in a chapter ("number one", "first") is a good emphasis; the word "number" is not.

## Chapters (plan.chapters)

- A listicle has a chapter per item. A chapter starts where the speaker introduces the item:
  "number one", "the first one", "next", "second", "and finally", or the item's name when it opens
  a new idea.
- The quote is the opening words of that chapter, 2 to 6 words. The title is the item's name, at
  most 40 characters.
- No chapter for the intro or the outro. Fewer than two items means no chapters at all.
- The style puts its transition on the cut nearest each chapter start; a chapter far from any cut
  is reported as skipped, which is fine.

## The list (plan.list), only for a split frame

- Use a list only when the speaker names all the items up front ("here are five…") or when the clip
  is a recap. Otherwise the chapters carry the structure.
- Labels are the item names, at most 40 characters; meta is a short fact such as a star count
  ("12.4k") taken from what the speaker says or from a captured page. Never invent a number.
- Blur an item only when the speaker is teasing it and reveals it later.
- One reveal quote per item, in order, at the words where the speaker reaches that item.

## Proof (plan.proofs)

A claim earns a proof card when it can be checked on a public page:

- a number ("120 rules", "40k stars", "2x faster"),
- a repo or a product the viewer will want to look up,
- a person's title or a quote attributed to someone.

How:

1. Capture the page first (`capture_page` with the URL the speaker names or clearly means; the
   repo's README for a GitHub project). Wait until `capture_status` says ready. Use only captures
   that are ready.
2. `focus` is text that is actually on the captured page, as short as possible, containing the
   number or the name ("120 built-in rules"). Never paraphrase it.
3. `quote` is the speaker's words when the card should show: the sentence with the claim.
4. One proof per claim, at most one per chapter, at most six per clip. A clip with no checkable
   claim gets no proof; say so in your reply.

## After apply_style

- Run `check` and fix anything new it reports.
- Capture a frame at the hook and one at each proof. Look at them: the hook must not cover the face
  or the captions, and the marked words must be readable.
- Tell the user, in a few lines, what was applied and everything in the receipt's `skipped` and
  `unavailable`, in plain words: what was left out and why.
