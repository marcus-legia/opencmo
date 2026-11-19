# Session C — UI and e2e

Plan: [`../2026-11-20-wave4-plan.md`](../2026-11-20-wave4-plan.md). Branch `claude/launch`. Match the canvas boards
(https://claude.ai/artifact/H7VT5UZAqnxDbVSrqEBFHZ). Production runs UI v2.

**Owns:** `components/today/*`, `components/billing/*`, `components/screens/settings/*`, routes under `app/api/v1/`
these screens need, `app/app/*` pages, e2e specs, `e2e/ui-v2-look.spec.ts`, styles.

## 4a

### - [ ] C1. Phone layout for Sales and Feed
Canvas "Sales on a phone": one column; the list, then the open person full width; reach tabs as a segmented control;
"Copy and open" sticky at the bottom; the Context column becomes a sheet opened from the top bar; Feed cards full
width, actions in one row. Check at 390 and 360: no sideways scroll, 44 px targets. Keep `/app/sales` inside its JS
budget.

### - [ ] C2. Missing states (after A1, B3)
- 100% used (from `my_usage_state`): a banner on Sales, Post and Feed saying what stopped, what still works, the reset
  date and "See plans"; Billing's bar at 100%.
- A free account after its free scan, on Post and Feed: one locked card each with the reason and the plan.
- The Feed's Sales card shows the reach level and its reason (B3).

### - [ ] C3. Delete my account (after A2)
Settings › Account: "Delete my account", type your email, the RPC, sign out, landing with one line. "Cancel your plan
first" links to Billing. Export: one line with the support email. e2e for the refusal and the delete.

### - [ ] C4. Copy pass
Every wave 3 and wave 4 screen read once with `no-ai-slop` beside the canvas: Sales, reach out, Following up,
Library, Your business, Research and its chat, the funnel, Settings › Sales scans and Tracking, the emails' templates.
Fix only words.

### - [ ] C5. e2e, look, the 4a PR
Specs for C1–C3; `ui-v2-look` screenshots at 1440, 390 and 360 for Sales, Feed, Billing, Settings with seeded data
(no "Loading…" in a screenshot). Review 4a against the plan. Open the PR "Launch 30/11 · wave 4a" from
`claude/launch`; list the migrations and say they add only. Do not merge.

## 4b (only after "4b go")

### - [ ] C6. Delete the hidden pages and UI
`app/app/photos`, `studio`, `script`, `video` (if only hidden flows use it), their components, cards, fixtures, CSS,
e2e, nav entries and redirects (old URLs redirect to `/app`). Keep the editor. One commit per area. Tell A and B
under their Requests what you removed.

### - [ ] C7. Quote card and email buttons (after A4, B5, B6)
Post: "Make a quote card" beside "Make an image", pick a quote from the post's sources, preview, remove. Email tab:
"Open in Gmail", "Open in your mail app", Copy.

### - [ ] C8. e2e, look, the 4b PR
Specs for C7; the deleted specs gone; look screenshots; a grep that shows no TikTok / Instagram / slideshow / script
code outside the editor and history docs. Open "Wave 4b: delete and extend". Do not merge.

## Requests

- **From B (B3 done, for C2):** a Feed reply card's body now has `reach?: { level: "reply_first" | "dm_ready" |
  "email_ready"; reason: string }` (`lib/screens/approval-card.ts`, `ReplyBody`). It is filled when the queue loads
  (`waitingCards` in `lib/screens/load.ts`), absent when the opportunity could not be read: show nothing then. Labels
  for the level: `REACH_LEVEL_LABEL` in `lib/cmo/reach.ts` (same words as `SalesReach.tsx`). `reason` is one line, at
  most 200 characters.
