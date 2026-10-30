# Session C: schedule card, Accounts and Schedule live

Plan: [`../2026-10-28-p4-schedule-publish-plan.md`](../2026-10-28-p4-schedule-publish-plan.md) · rules: [`README.md`](README.md).

## You own

- `apps/web/components/cards/` (the schedule card, failed and missed states)
- `apps/web/components/screens/schedule/`, `apps/web/components/screens/settings/` (Accounts)
- the posting sentences in landing copy and card copy
- `apps/web/e2e/ui-v2-schedule.spec.ts` (new), the e2e list in `apps/web/package.json`

## Order

Read the frames while A0 lands → C0 → C3 → C1 (after B2 and A3) → C2 (after A3) → C4.

## Todo

- [x] **C0 Schedule card** (published link waits on request 4 to A; one account per platform, so the account
      picker is the connected account or "no account connected", no list) on A0's types with fixtures: content preview, platform, account picker (connected ones),
      time in the founder's timezone, TikTok fields (privacy from creator info, comment/duet/stitch, AI-generated
      label off by default with one line of help), change time, cancel; states: waiting, published (link), failed
      (reason, Retry), missed (new time). Axe clean at 1440 and 390.
- [ ] **C3 Copy** (landing line and the schedule card done; the post card's "Approve and open Threads" / "Post it on
      X when you are ready" change with A3, once an approved post raises a schedule card): landing and cards say "you approve when it posts"; the fallback card says "No account connected:
      copy and open" and links to Settings → Accounts.
- [x] **C1 Settings → Accounts live**: connect per platform (opens Zernio's link), handle and avatar, disconnect
      with confirm, error state.
- [ ] **C2 Schedule page live**: calendar with times in the founder's timezone, drag to move (change-time action,
      the new card appears in the queue), per-platform filter, published and failed markers.
- [ ] **C4 e2e** with the fake Zernio: approve a schedule card, drag a slot (old card superseded), retry a failed
      post, connect and disconnect an account.

## Requests

(Others append `[from → C] what, why`; answer here with the commit.)


Sent: requests C1–C7 to A, in `A.md` under Requests.

- [from B → C] B2's routes for C1 (Settings → Accounts): `POST /api/v1/accounts/connect` with `{ platform }` returns
  `{ url }`: send the browser there (`location.assign`). Zernio returns the founder through
  `/api/v1/accounts/callback`, which redirects to `/app/settings?tab=accounts&connected=<platform>` or
  `&connect_error=<sentence>`; show the sentence as is (it is ours, never Zernio's). Disconnect:
  `DELETE /api/v1/accounts/<social_accounts.id>` → `{ disconnected: true }`. Errors are `{ detail }` with 503 when
  posting is not set up (no live Zernio this week; run with `OPENCMO_PUBLISH_FAKE=1`).
  - Done in the C1 commit: `components/screens/settings/AccountsPanel.tsx` posts `{ platform }`, follows `url`, shows
    `connected` / `connect_error` once (then strips them from the address) and the `{ detail }` of a refused call.
