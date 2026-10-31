# Session C: email, push, phone queue, Analytics live

Plan: [`../2026-10-28-p6-quality-reach-plan.md`](../2026-10-28-p6-quality-reach-plan.md) · rules: [`README.md`](README.md).

## You own

- `apps/web/lib/notify/` (new: `email.ts`, `push.ts`, templates), the unsubscribe route, the service worker in `apps/web/public/`
- `apps/web/components/cards/` (phone layout, thread card, look note)
- `apps/web/components/shell-v2/Rail.tsx` and `ShellState.tsx` (the two status lines only)
- `apps/web/components/screens/analytics/`, the Brain measures panel in `apps/web/components/screens/brain/`
- `apps/web/e2e/ui-v2-reach.spec.ts` (new), the e2e list in `apps/web/package.json`

## Order

C2 at once → C0 (after A0; real Resend after the owner gate) → C1 → C3 (after A1, A4, B4) → C5 → C4.

## Todo

- [ ] **C2 Phone-first queue**: every card kind decides at 390 px in the shell's phone layout (`TabBar`, Chat first)
      and at 1024 with the chat as a drawer (previews by signed URL of the preview file), axe
      clean, a decide e2e per kind.
- [ ] **C0 Email**: Resend sender behind `lib/notify/email.ts` (Inbucket in dev), digest and expiring-card templates
      in English, links that open the card behind login, unsubscribe route, `support@opencmo.io` in the footer.
- [ ] **C1 Web push**: service worker, permission prompt with help text (iPhone needs a Home Screen web app),
      `push_subscriptions` through A's RPC, one push per new batch.
- [ ] **C3 Analytics and Brain live**: Analytics (accounts, KPIs, daily, by account, top posts), Brain measures panel,
      thread card body, look-check note on video cards.
- [ ] **C5 Rail status lines**: Schedule ("Next post 9:00", from the next waiting slot) and Analytics (connected
      accounts) in `shell-v2/Rail.tsx` `statusOf`, from A4's `ShellState` fields; no line when there is no number;
      they must not wrap at 184 px.
- [ ] **C4 e2e**: digest in Inbucket opens the card, a card decided at 390, Analytics on fake Zernio data.

## Requests

(Others append `[from → C] what, why`; answer here with the commit.)
