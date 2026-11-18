# Session C — UI, copy, e2e

Plan: [`../2026-11-19-wave2-plan.md`](../2026-11-19-wave2-plan.md). Branch `claude/launch`. Match the canvas
boards (https://claude.ai/artifact/H7VT5UZAqnxDbVSrqEBFHZ): top bar, Settings · Plan and billing, Settings ·
Notifications: emails sent, the chat part. Production runs UI v2.

**Owns:** `components/today/TopBar.tsx`, `components/shell-v2/*`, price labels in `components/today/AgentSales.tsx`,
`components/screens/settings/*`, `components/billing/*`, `app/app/billing/*`, the FAQ in `components/landing/data.ts`,
e2e specs, the PR description.

## Tasks

### - [x] C4. Chat folds (start now)
On every view but Feed the chat column starts folded to a 56px "Ask" rail; opening keeps its draft and session (the
chat stays mounted). Feed keeps the open column. Update `e2e/ui-v2-shell.spec.ts` (the chat-column assertions).
Commit `Wave 2 C4: the chat folds away off the Feed` and push.

### - [x] C5. FAQ (start now)
`faqs()` in `components/landing/data.ts`: drop the video/slideshow answer, make "What does the plan include?" say fair
use, keep the free-scan answer session C of #233 wrote. Check landing at 1440 and 390. Commit and push.

### - [x] C1. Usage chip and Billing bar (after A2)
Top bar: the credits pill becomes `Pro · N% used` (free: `Free · see plans`), linking to Plan and billing. Billing
page: plan, price, renewal, the bar with the reset date, "Switch to annual" when monthly, invoices link (Creem
portal), cancel. Paused: the Sales screen shows the canvas banner "You used this month's allowance".
Commit `Wave 2 C1: one usage bar` and push.

### - [x] C2. Hide included prices (after A2, A3)
"Scan now · 5 credits" → "Scan now"; "Write the replies · 1 credit" → "Write the replies"; the scan confirm card
drops its credit line. "Make an image" keeps its price. Grep for other `credits` labels on included work.
Commit `Wave 2 C2: no per-click prices on included work` and push.

### - [ ] C3. Notifications settings and the log (after A4, B2)
Settings › Notifications: morning email schedule select, the strong-match push toggle as today, and the log table
(when, what, subject, Sent / Skipped / Failed) with a preview of the summary. Commit and push.

### - [ ] C6. e2e, look, review
Run the e2e specs touched by the branch (shell, dashboard, activation, context, post-photos, settings, billing, free
scan). Screenshots at 1440 and 390 into the PR. Review the whole branch against the plan. Do not merge.

## Requests

(none yet)
