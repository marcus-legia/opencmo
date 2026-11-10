# Session B: editor (I1 the Script tab, I3 the take against the script)

> **Phase 2, not started.** Kept from the first draft of the plan (2026-11-09). It starts after phase 1 is reviewed, and
> the reviewer re-checks it against `main` first. Links to the plan point to its §8. I2 (the prompter) is already on `main`.

Plan: [`../../2026-11-09-cmo-review-3-plan.md`](../../2026-11-09-cmo-review-3-plan.md) §8.

**Owns:**
- `apps/web/components/editor/script/**` (new);
- in `apps/web/components/editor/EditorShell.tsx`, only the tab list and the Script panel's mount;
- `apps/web/lib/cmo/script-markers.ts`;
- `packages/editor-core/src/script-take.ts` (new) and its tests;
- the editor e2e for the script (`ui-v2-script` and new specs).

**Waits on:** A1 (`lib/cmo/script.ts`). Until it is pushed, build the tab on a fixture.

## Todo, in order

- [ ] **B1 I1: the Script tab.**
  - Show a fourth left tab, "Script", only when `scriptForClip` returns a script.
  - Top of the tab: the hooks. Below them, one row per beat: number, shot label (from `script-markers.ts`), seconds,
    say and show.
  - Clicking a row seeks to the marker. The row under the playhead is highlighted.
- [ ] **B2 I1: edit a beat.**
  - Edit say or show inline and save with `editBeat`.
  - Then update the beat's marker comment with one `set_marker` op, so the change is one Undo step.
  - On a stale version, reload the script and say so.
  - e2e: open the script → 3 rows → edit beat 2 → the marker and the order hold the new words → a reload keeps
    them.
- [ ] **B3 I3: match the take (pure function).**
  - Write `script-take.ts`: `matchTake(beats, words)` returns, for each beat, `said`, `partly` or `missing`, with
    its range. It uses `findQuote` (`script.ts:103`, `QUOTE_MATCH`) on `clipWords`.
  - Write `unscriptedRanges(beats, words)`: the stretches of speech that match no beat.
  - Unit tests:
    - a clean take;
    - a retake of beat 2;
    - a skipped beat;
    - beats said out of order;
    - an aside between beats.
- [ ] **B4 I3: the tab shows it.**
  - Once the clip has a transcript, each row shows said, partly said or missing. A said row jumps to where it was
    said.
  - "Keep only the script" lists the ranges it would remove. The founder confirms, and one text-cut op removes them
    (one Undo step). Nothing is cut without the confirmation.
  - Check: unit tests, then a real 30 s phone take with a retake. Upload it, keep only the script, export, then look
    at a frame of the full-size export and listen to it (CLAUDE.md "Verify by looking").

## Research note

(Write before B1. Look at how Descript's scenes and script view, and Captions' script, tie words to the timeline.
Note what we take and what we skip.)

## Requests

(Other sessions write their requests here. C will ask for its "Read on your phone" button in the Script tab.)
