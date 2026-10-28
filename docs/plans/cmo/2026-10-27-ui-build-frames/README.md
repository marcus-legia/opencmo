# UI build look check (U9)

Screenshots of the built v2 screens, to compare side by side with their frames in
[`../2026-10-27-app-redesign-frames/`](../2026-10-27-app-redesign-frames/static/index.html).

`apps/web/e2e/ui-v2-look.spec.ts` writes `<screen>-1440.png` and `<screen>-390.png` here (`npm run test:e2e:v2`).
The current ones come from that run on 2026-10-28: the production build with `NEXT_PUBLIC_OPENCMO_UI=v2` against
a fresh local Supabase, signed in as the e2e founder, every screen on its fixture (`?sample=1`), with reduced motion
and after loading ends. The same run passed axe (no serious violation) on every screen at both widths. Times show in
the test machine's zone (UTC), not the frames' `Asia/Ho_Chi_Minh`.

| File | Screen | Frame |
|---|---|---|
| `dashboard-1440.png`, `dashboard-390.png` | S1 shell + S2 Dashboard | `Main.dc.html`, `DashboardPhone.dc.html` |
| `kit-1440.png`, `kit-390.png` | S3 every card kind and state | `Cards.dc.html` |
| `inbox-sample-reply-390.png` | `/app/inbox/[id]` | `Cards.dc.html` |
| `design-1440.png`, `design-390.png` | `/app/design` primitives | `Tokens.dc.html` |

`kit-*.png`, `inbox-sample-reply-390.png` and the `*-vs-frame.png` pairs were made earlier from a local preview
inside B's `ShellV2`, each page on its
fixture (`/api/v1/screens/[name]` answered with `compose(name, {}, { sample: true })`), browser time zone
`Asia/Ho_Chi_Minh` like the frames. Two preview artifacts: the rail highlights Dashboard on every page (the preview
route has no `/app/<page>` segment), and the round "N" at the bottom left is the Next.js dev badge. Studio's uploads
use three mocked projects.

| File | Screen | Frame |
|---|---|---|
| `analytics-*.png` | S4 Analytics | `Analytics.dc.html` |
| `brain-*.png` | S5 Brain | `Brain.dc.html` |
| `library-*.png` | S6 Library (Business tab; documents mocked) | `Library.dc.html` |
| `research-*.png` | S7 Research | `Research.dc.html` |
| `writer-*.png` | S8 Writer | `Writer.dc.html` |
| `studio-*.png` | S9 Studio | `Studio.dc.html` |
| `sales-*.png` | S10 Sales | `Sales.dc.html` |
| `schedule-*.png` | S11 Schedule (week) | `Schedule.dc.html` |
| `settings-*.png` | S12 Settings | `Settings.dc.html` |
| `setup-*.png` | S13 Setup (documents step) | `Setup.dc.html` |

`<screen>-vs-frame.png` puts the frame (left) and the built page (right) side by side at half size, for the M2 review.
