# CMO review 3: the script goes where the founder works

Source: the owner's conversation of 2026-11-09 after #181 merged. The questions were "where should the script
live, and the storyboard?" and "the AI CMO must be able to step in". The plan builds on C1 of the
[close-the-loop plan](2026-11-09-script-item-plan.md) (script item, `7377f50c`).

Branch: **`cmo-review-3`**, one PR to `main`. Sessions: [`2026-11-09-cmo-review-3-sessions/`](2026-11-09-cmo-review-3-sessions/).

## 1. Why

After #181 the CMO writes a script and storyboard for a video the founder makes. The script reaches the founder in
three places:

1. **The `script` card** in Approvals. The founder approves it or edits a beat
   (`supabase/migrations/20270112010000_script_item.sql`, `approval_script_beat`).
2. **The Writer screen.** An approved script sits under "Scheduled" with "Open in editor →"
   (`components/screens/writer/WriterScreen.tsx`).
3. **The editor.** One timeline marker per beat (`lib/cmo/script-markers.ts`). The words and the shot live only in
   each marker's comment, so the founder clicks markers one by one to read the script.

So the script is there when it is approved, and missing when the founder uses it: while recording on a phone and
while editing. It also has gaps around the CMO:

- **The CMO chat cannot order a script.** `create_task` with agent `video` (`lib/agent/cmo-tools.ts:74`) only adds a
  calendar item with an "Upload video" button. Only the Sunday plan writes scripts.
- **No CMO eval covers a week with a script.** C1 lists this under "Not done".

## 2. Decisions this plan takes (owner, 2026-11-09)

- **The script has one home: the Writer's order.** `work_orders.brief.storyboard` of the `write_video_brief` order
  is the source of truth. The card, the Writer screen, the editor tab and the prompter all read it. An edit made
  anywhere writes to it. The card's approval snapshot stays as the record of what was approved.
- **The storyboard is the script seen beat by beat, not a second object.** It gets no AI keyframes or images: they
  cost credits for something the founder films, and they work against "the founder makes the videos". A `screen`
  beat may show a page capture the founder already has (`page_captures`, free).
- **Upload stays the only way in.** The prompter only shows words. Nothing records in the app.

## 3. Items

Ranked by the CMO loop: the CMO orders it (I0), the founder uses it while editing (I1) and recording (I2), and the
editor checks the take against it (I3).

### I0 The CMO chat orders a script (small)

- `create_task` agent `video` becomes "write a script and storyboard". It takes the same order as the week plan's
  video item: `write_video_brief` with its item, 1 credit, and a `script` card. When the founder asks for one in the
  chat, the CMO orders it and says where the card lands. The old "Upload video" calendar item stays only for "I
  already have a video, remind me to post it".
- The SQL path is C1's. Today the tool calls `cmo_add_item` (`lib/agent/cmo-tools.ts:378`), which only adds the
  calendar item. A new RPC (`cmo_order_script`) creates the calendar item and the brief order in one transaction, with
  the credit held as `work_orders_plan_week` does. No second card. The price
  shows before it runs (the chat's price card, as the Sales scan does since S3.5).
- CMO eval cases:
  - a strategy that calls for a demo video: the week plan holds one script item with a storyboard (C1's open item);
  - "write me a script for a 30 s demo" in the chat: one `create_task` with agent `video`, and no `build_video`.

### I1 A Script tab in the editor

- A fourth left tab, **Script**, next to Media, Transcript and Upload (`components/editor/EditorShell.tsx:1449`). It
  shows only when the edit came from a script, that is when a `write_video_brief` order holds this clip in
  `brief.clip_id` (set by `cmo_script_open`).
- It shows the hooks, then one row per beat: number, shot (To camera / Screen / You film), seconds, what to say and
  what to show. Clicking a row seeks to its marker. The row under the playhead is highlighted.
- Editing a beat's say or show writes to the order through a new RPC (`cmo_script_edit_beat`, owner-checked, with a
  version check like the markers' write). The tab then updates that beat's marker comment through the existing
  `set_marker` op, so it is one Undo step.
- The edit's captions and the finished video's caption card (C2) read the order, so they see the edited words.
- Check: e2e on the C1 path (`ui-v2-script`): open the script → Script tab with 3 rows → edit beat 2 → the marker
  comment and the order both hold the new words → reload keeps them.

### I2 The prompter: the script on the founder's phone

- A read-only page, **`/app/script/[order]/prompter`**, made for a phone held upright: large text, one beat at a
  time, a tap or swipe for the next beat, and an optional auto-scroll at the beat's pace (its words over its
  seconds). It shows "To camera / Screen / You film" and the "show" line above the words.
- From the Script tab and the Writer screen, "Read on your phone" shows a QR code of that URL. The page is under the
  normal login and RLS; the founder signs in on the phone once. **No share token, no public link**, so there is no
  new secret to leak (§5 lists the alternative for the owner).
- Screen wake lock while it is open, where the browser supports it. Nothing records; the founder films with the
  phone's camera app and uploads as today.
- Check: e2e at a phone viewport (390×844): next and previous beat, auto-scroll on and off, an order of another user
  returns 404.

### I3 The take against the script

- After an upload is transcribed (Scribe), the Script tab marks each beat **said**, **partly said** or **not said**.
  It uses `findQuote` (`packages/editor-core/src/script.ts:103`, match ≥ `QUOTE_MATCH` 0.8) on the clip's words
  (`clipWords`). It runs in code, with no model call, so it is free.
- Clicking a said beat jumps to where it was said. A beat not said is flagged ("Beat 3 is missing").
- **"Keep only the script"**: it proposes removing the stretches of speech that match no beat (false starts,
  retakes, asides) with the existing text-cut op, as one Undo step. The founder sees the ranges first and confirms.
  It never cuts on its own.
- The whole check is new code in `editor-core` (a pure function with unit tests: a take with a retake, a skipped
  beat, words out of order) and the tab's UI.
- Check: unit tests in `editor-core`. Then a real take: record one 30 s script on a phone with a retake, upload it,
  "Keep only the script", and **look at a frame of the export and listen to it** (CLAUDE.md "Verify by looking").

## 4. Sessions

One branch, `cmo-review-3`, and one PR. The plan PR creates the branch, so no session waits for it.

| Session | Items | Owns | Waits on |
|---|---|---|---|
| **A Backend** | I0; the RPCs for I1 (`cmo_script_for_clip`, `cmo_script_edit_beat`) and I2 (read by order) | `supabase/migrations/*` (all, from `20270113010000`), `supabase/tests/*`, `supabase/schema/current.sql`, `lib/agent/cmo-tools.ts`, `lib/cmo/jobs/eval/**`, `lib/cmo/script.ts` (new: the shared read and edit helpers and types) | nothing |
| **B Editor** | I1, I3 | `components/editor/script/**` (new), the Script tab's lines in `components/editor/EditorShell.tsx`, `packages/editor-core/src/script-take.ts` (new) and its tests, `lib/cmo/script-markers.ts` | A's `lib/cmo/script.ts` (A pushes it first) |
| **C Prompter** | I2 | `app/app/script/**` (new), `components/screens/script/**` (new), the "Read on your phone" button in `components/screens/writer/WriterScreen.tsx` | A's `lib/cmo/script.ts` |

- **Building block built once:** `lib/cmo/script.ts` (types, `scriptForClip`, `scriptForOrder`, `editBeat`). A writes
  it first with the RPCs and pushes before anything else. B and C import it and never write their own.
- **Shared file:** `EditorShell.tsx`. B owns only the tab list and the Script panel's mount. C puts its QR button
  inside B's `components/editor/script/` through a request in B's file.

## 5. Owner decisions before it is built

1. **Prompter access.** The plan's choice: log in on the phone, with a QR code of the normal URL. The alternative is a
   share link signed for 24 h with no login, which is faster to open but is a new public surface. Recommended: login.
2. **I0's price.** 1 credit, like a post draft? The week plan's script costs the same.
3. **I3's cut.** Proposed and confirmed, never automatic (the plan's choice). Say so if you want it applied at once
   with Undo.

## 6. Done when

- In the CMO chat a founder says "write me a script for a demo". A script card arrives with its price shown first,
  and the founder approves it.
- They open it in the editor and see the Script tab, scan the QR code, and read the beats on their phone while they
  film.
- They upload the take. The tab shows which beats were said, "Keep only the script" removes the retakes, and a frame
  and the sound of the export were checked.
- CI is green: pgTAP, typecheck, `check:contracts`, editor-core tests, and the new e2e.

## 7. Not in this plan

- **The UI and UX of the whole user flow:** the owner reviews it next, after this plan.
- **Articles:** they get their own research note first (where they publish: LinkedIn, X Articles or the founder's
  blog).
- Fewer cards a week (C4, waits on the owner).
- Recording in the app.
- AI images for the storyboard.
