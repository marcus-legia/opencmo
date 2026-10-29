# Session C: post and caption cards, Writer and Library live

Plan: [`../2026-10-28-p3-writer-plan.md`](../2026-10-28-p3-writer-plan.md) · rules: [`README.md`](README.md).

## You own

- `apps/web/components/cards/` (post per platform, caption editor, correction)
- `apps/web/components/screens/writer/`, `apps/web/components/screens/library/`
- `apps/web/e2e/ui-v2-writer.spec.ts` (new), the e2e list in `apps/web/package.json`

## Order

Read the frames while A0 lands → C0 → C2 (after A1) → C1 (after A3) → C3.

## Todo

- [x] **C0 Card bodies on A0's types** with fixtures: Threads and LinkedIn post cards (limit counter, the
      visible-before-"more" marker on LinkedIn, copy + open: Threads web intent, LinkedIn copy then open), caption
      editor per platform inside the shorts batch and finished video cards (hashtag count per profile). Axe clean at
      1440 and 390.
      Done: `components/cards/captions.tsx` (limit and hashtag counters per profile, save refused over either),
      `decide.ts` `editCaption()` (not a decision: the card keeps its id and takes the new hash) and `POST_TARGET`
      (Threads intent with the text; LinkedIn copied then its composer; the tab opens inside the click and goes to the
      platform only once the approval went through), the "more" marker at a word boundary. `e2e/ui-v2-writer.spec.ts`
      7/7 with axe at 1440 and 390; screenshots in `docs/plans/cmo/2026-10-28-p3-acceptance/c/`. Live caption edits
      wait on the SQL requested in A.md (`[from C → A] Captions on the Studio cards`).
- [x] **C2 Correction card**: the repeated edit with two before/after examples, approve or dismiss; decided through
      `POST /api/v1/approvals/[id]` with the card's `contentHash`.
      Done: the card names the repeated edit and how often ("You rewrote the first line in 3 posts these two weeks"),
      two examples labelled Draft / You wrote, Keep as a rule · Edit · Dismiss (`reject`). e2e on live rows (A1's
      trigger raises it from three edited outcomes): a stale hash is refused, Dismiss → `rejected`, Keep → `active`;
      axe at 1440 and 390.
- [ ] **C1 Writer and Library live**: Writer drafts per platform (filter), Library → Voice (notes with weight and
      source, delete with confirm) and Skills (read-only list: what each is for, which agent reads it).
- [ ] **C3 e2e** on live rows: approve a Threads draft (copy + open), delete a voice note, edit a caption on a shorts
      card (stale hash refused).

## Requests

(Others append `[from → C] what, why`; answer here with the commit.)
