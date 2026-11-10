# Today frame: work in place, readable type, one bar, smaller bundle (2026-11-10)

Branch `claude/today-inline-edit`, cut from #188 (which carries #189's Today frame). One PR.

## 1. What the owner asked (2026-11-10)

- **Fewer jumps between pages, first of all.** Reading a business document and pressing Edit sent the founder to
  Library. Editing should happen where the founder already is, on the feed. The routes the AI CMO links to change with
  it.
- **Type is too small** in the app (local dev): hard to read.
- **The three columns** (Context, feed, CMO chat) cannot be resized.
- **The header and navigation** differ between Feed, Calendar and Analytics: make them one.
- **Measure the bundle and cut it.**

## 2. Decisions

- A document is read **and edited** in the Context drawer (`?doc=<kind>`, `?doc=<kind>&edit=1` opens the form). Save
  writes a new version through the same route Library uses (`PUT /api/v1/cmo/documents/[kind]`). The Brand Kit's own
  editor opens in the drawer, loaded only then.
- Every link that sent the founder to Library for the business documents or the Brand Kit opens the drawer instead.
  Library stays for Voice and Skills, which have no place on the feed yet.
- Type: +1 px for every size under 17 px, nothing under 12 px. The rule lives in `scripts/port-today-css.py`
  (`bump_type`), so `styles/today.css` stays generated from the artboards.
- Columns: the old shell's `Sash` (drag, arrows, Home/End, Enter resets). Widths are CSS variables set before the first
  frame and kept in `localStorage` (`opencmo.today.columns`); under 900 px the columns stack and the sashes go.
- One bar for Feed, Calendar and Analytics: business and accounts left, the three views as links in the middle, credits,
  Logs and Chat right (no Chat button on the feed, where the chat is a column).

## 3. Todo

### 3.1 In place, not another page
- [x] Context drawer: Edit opens the document's form in the drawer; Save, Cancel, Escape leaves the form first.
- [x] Brand Kit editor inside the drawer (dynamic import).
- [x] `?doc=<kind>&edit=1` opens the form; "+" writes the first missing document; "Add a competitor" opens its form.
- [x] Today's "Ready to read: your marketing strategy" → `/app?doc=strategy` (was Library).
- [x] Research "Add a competitor" and its banner, Settings' Brand Kit link → the drawer.
- [ ] Brain (`/app/brain`) and Library (`/app/library`) still render in the old v2 look inside the frame (screenshots of
  2026-11-10). Bring their headers and type to the artboards' tokens, or move what the founder needs from them (what
  the CMO learned, Voice) into drawers on the feed. Ask the owner which.
- [ ] Look for other links from the CMO chat and cards that leave the feed for something a drawer could show.

### 3.2 Readable type
- [x] `bump_type` in `port-today-css.py`; `today.css` regenerated.
- [x] Same scale on the components' inline sizes and `today-app.css`.
- [ ] Screenshots of Feed, Calendar, Analytics, Sales, Writer, Settings at 1440 and 390, light and dark, in the PR.

### 3.3 Resizable columns
- [x] `components/today/columns.ts` (+ `columns-boot.ts`), sashes in `Feed` and `ShellV2`.
- [x] e2e: drag and keyboard resize, the width survives a reload, Enter resets (`ui-v2-shell`).

### 3.4 One header for Feed, Calendar, Analytics
- [x] `TopBar`: `home` and `views` draw one bar; the views are links (`aria-current="page"`).
- [x] The feed's own Feed / Calendar / Analytics row removed.
- [x] e2e `ui-v2-shell`: views by link in the banner, `aria-current` on the open one.
- [x] Phone: the feed first, then Context, then the chat; the bar drops the Connect pills (Settings connects accounts).

### 3.5 Bundle
- [x] Sentry: `bundleSizeOptimizations` (no tracing, no debug logger). First Load JS shared by all 171 → 141 kB,
  `/app` 434 → 406 kB, `/login` → 219 kB.
- [x] The two ~80 kB gz chunks on `/app`: `3727-*` is Next's own runtime; `3040-*` was all of `editor-core`, pulled in
  by the approval cards for one constant (`SLIDE_TEXT_MAX`). It now has its own subpath
  (`@opencmo/editor-core/slide-limits`). `/app` 406 → 320 kB; Calendar, Analytics, Writer 286 → ~200 kB.
- [ ] `marked` (18 kB gz) and zod (28 kB gz) in the feed's client bundle: load them only where used.
- [ ] ~~`ShellV2` imports the classic `WebShell` statically~~: 11 kB gz, and the server layout imports it for the v1
  shell too, so a split moves the account context for little gain. Left as is.
- [x] Before / after (First Load JS, `next build`):

  | Route | before | after |
  |---|---|---|
  | shared by all | 171 kB | 141 kB |
  | `/app` | 434 kB | 320 kB |
  | `/app/schedule` | 316 kB | 199 kB |
  | `/app/analytics` | 316 kB | 200 kB |
  | `/app/writer` | 318 kB | 201 kB |
  | `/app/sales` | 184 kB | 153 kB |
  | `/app/editor/[clipId]` | 554 kB | 524 kB |
  | `/login` | ~250 kB | 219 kB |

### 3.6 Checks
- [x] `tsc --noEmit`, `next build`.
- [x] `check:contracts`.
- [x] v2 e2e for the touched screens: shell, context (new), dashboard, today, theme, look: 28/28, then shell, dashboard,
  look again after the phone CSS: 23/23. CI does not run e2e.
- [x] Looked at Feed and Calendar at 1440 and the feed at 390 (e2e screenshots).
