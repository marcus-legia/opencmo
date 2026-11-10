# Session C: the prompter (I2)

> **Phase 2, not started.** Kept from the first draft of the plan (2026-11-09). It starts after phase 1 is reviewed, and
> the reviewer re-checks it against `main` first. Links to the plan point to its §8. I2 (the prompter) is already on `main`.

Plan: [`../../2026-11-09-cmo-review-3-plan.md`](../../2026-11-09-cmo-review-3-plan.md) §8.

**Owns:**
- `apps/web/app/app/script/**` (new);
- `apps/web/components/screens/script/**` (new);
- the "Read on your phone" button in `apps/web/components/screens/writer/WriterScreen.tsx`.

**Waits on:**
- A1 (`scriptForOrder`);
- the owner's decision on prompter access (plan §5.1; the plan's default is login + QR).

## Todo, in order

- [ ] **C1 The prompter page `/app/script/[order]/prompter`.**
  - Read-only, under login and RLS, made for a phone held upright.
  - One beat at a time: the shot label and the "show" line small at the top, the words large.
  - Tap or swipe to move to the next or previous beat. A progress line ("Beat 2 of 5").
  - Auto-scroll is optional, at the beat's pace (its words over its seconds), with a pause button.
  - Keep the screen on with the Screen Wake Lock API where the browser supports it.
  - An order of another user returns 404.
- [ ] **C2 "Read on your phone".**
  - The button opens a QR code of the prompter URL (a small MIT or Apache-2.0 QR library, with a notice in
    `THIRD_PARTY_NOTICES.md`).
  - It goes on the Writer screen's approved script. In the editor's Script tab it goes through a request in
    `B-editor.md`.
- [ ] **C3 e2e at 390×844.**
  - Next and previous beat;
  - auto-scroll on and off;
  - another user's order returns 404;
  - the QR code holds the page's URL.

## Research note

(Write before C1: teleprompter apps (BIGVU, Teleprompter Premium, Captions' prompter) on what makes a script
readable while filming: text size, pace, mirror mode, and whether one beat at a time beats a full scroll.)

## Requests

(Other sessions write their requests here.)
