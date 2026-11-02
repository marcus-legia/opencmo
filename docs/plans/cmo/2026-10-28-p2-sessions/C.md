# Session C: Studio cards live, Mark finished, Studio page live

Plan: [`../2026-10-28-p2-studio-brain-plan.md`](../2026-10-28-p2-studio-brain-plan.md) · rules: [`README.md`](README.md).

## You own

- `apps/web/components/cards/` (the four Studio card bodies and their actions)
- `apps/web/components/screens/studio/`, `apps/web/components/screens/brain/` (order steps)
- `apps/web/components/editor/TopBar.tsx` (the Mark finished button only)
- `apps/web/e2e/ui-v2-studio.spec.ts` (new), the e2e list in `apps/web/package.json`

## Order

Read the frames (`Cards.dc.html`, `Studio.dc.html`) while A0 lands → C0 → C1 (after A1) → C2 (after A3 and B5) → C3 (after
A5) → C4.

## Todo

- [ ] **C0 Card bodies on A0's types** with fixtures: `script` (beats, edit a beat), `price` (keyframes or shots,
      credits, wait, redo one keyframe, cancel), `finished_video` (player, length, approve = finished, open in editor,
      send back), `shorts_batch` (3 × 9:16 with hook and reason, approve the batch, send back). States: expired,
      decided elsewhere, needs credits, failed. Axe clean at 1440 and 390.
  - [x] Actions on the wave-1 bodies (cloud session, 2026-10-28): Edit a beat (one beat's words → `edit` with `beat`),
        Redo a keyframe (picker → `redo` with `index`), Cancel (`cancel`) on script and price, Send back
        (`send_back`) on finished video and shorts batch; a card that needs credits can still be cancelled. Checked
        on fixtures in a scratch page: axe clean at 1440 and 390, each action sends the right decision.
  - [x] Switched to A0's snapshot types: the contact sheet (thumbnails, "Text may be garbled"), the redo picker built
        from `keyframes` (no Redo on a price for shots only), beat motion, seconds and frame on the script, the render
        seeked to `frameAt`, each short's reason.
  - [ ] Look check inside the v2 shell on `/app/inbox/card-*` (needs the local stack; not possible in the cloud
        session: no Docker).
- [x] **C1 Decide live** through `POST /api/v1/approvals/[id]` with the card's `contentHash` and the new actions
      (`redo` with a keyframe index, `cancel`, `send_back`); a refusal puts the card back with the server's sentence.
      Done by A1's route and decidable set plus C0's actions; the Dashboard and the inbox page already put a refused
      card back, toast the server's sentence and reload. Toasts per Studio decision (`decidedMessage`).
- [x] **C2 Mark finished**: the button on the Studio item and in the editor's top bar (calls B5's
      `POST /api/v1/studio/[clipId]/finished`), the finished badge, "Cut shorts" on a finished edit; an edit after it shows the badge
      gone (A3 clears it). Top bar (v2 only): `MarkFinished` reads `editor_projects.finished_hash` under RLS and sends
      the session's `documentHash` (disabled while changes are unsaved); Finished badge + Cut shorts when the saved
      document is the finished one. Studio: Mark finished / Cut shorts on generated videos (A5's `clipId`,
      `documentHash`, `canCutShorts`) and per edit in an upload's drawer (`editStates`). `EditorShell` passes one prop
      (`finish`) to the top bar. Needs B5's routes on `cmo-p2` (they sit on B's branch until B cherry-picks them).
- [x] **C3 Studio page live**: generated videos, shorts batches and finished edits from A5, next to uploads; the
      Video team panel reads the order's steps; Brain shows the steps under a video order. Items and the team panel
      come live from A5; `TeamSteps` is shared by Studio's panel and Brain's order rows (compact).
- [ ] **C4 e2e** on live rows: decide cards 1–3 (stale hash refused), mark finished then edit (badge cleared), approve
      a shorts batch (three shorts appear in Studio).

## Requests

(Others append `[from → C] what, why`; answer here with the commit.)
