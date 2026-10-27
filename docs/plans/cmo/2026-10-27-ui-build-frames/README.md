# UI build look check (U9)

Screenshots of the built v2 screens, to compare side by side with their frames in
[`../2026-10-27-app-redesign-frames/`](../2026-10-27-app-redesign-frames/static/index.html).

`apps/web/e2e/ui-v2-look.spec.ts` writes them here (`npm run test:e2e:v2`). The current files were taken on
2026-10-27 with a local preview of the same components on the Dashboard fixture, because that session had no local
Supabase stack. The e2e run replaces them.

| File | Screen | Frame |
|---|---|---|
| `dashboard-1440.png`, `dashboard-390.png` | S1 shell + S2 Dashboard | `Main.dc.html`, `DashboardPhone.dc.html` |
| `kit-1440.png`, `kit-390.png` | S3 every card kind and state | `Cards.dc.html` |
| `inbox-sample-reply-390.png` | `/app/inbox/[id]` | `Cards.dc.html` |
| `design-1440.png`, `design-390.png` | `/app/design` primitives | `Tokens.dc.html` |
