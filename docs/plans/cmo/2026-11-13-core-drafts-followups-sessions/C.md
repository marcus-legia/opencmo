# Session C: no slideshow to write; ready for real accounts

Plan: [`../2026-11-13-core-drafts-followups-plan.md`](../2026-11-13-core-drafts-followups-plan.md) Tasks 4 and 5.
Rules: [`README.md`](README.md).

**Owns:** the Writer and agent files Task 4 lists, `packages/contracts/capabilities.json`,
`supabase/migrations/20270121030000_drop_write_slides.sql`, `supabase/tests/311_*`,
`apps/web/lib/departments/publish/zernio.ts`, `split.ts` and their checks,
`docs/plans/cmo/2026-11-13-real-account-checklist.md` (new).

- [x] Task 4: remove "Write a slideshow" and the `write_slides` job (decision F2). Keep everything that opens or posts
  a slideshow already made.
- [x] Task 5: Zernio's documents read and quoted, code fixed where it differs, the owner's checklist written.

Task 4 touches a refund: a queued `write_slides` run gets its hold back exactly once (`credit_refund`, only where the
run is `queued` or `running`). Task 5 changes code only on evidence from the documents; a guess goes in the checklist
as "to confirm on a real account", not into `zernio.ts`.

## What I ran, what I could not

Task 4:
- No Docker in this container, so no Supabase stack. I ran Postgres 16 (from the OS) with stub roles, `auth.users`,
  `auth.uid()`, a minimal `storage` schema and tiny stand-ins for pgTAP's `plan/is/ok/throws_ok/finish`, loaded
  `supabase/schema/current.sql` into it, then applied `20270121030000_drop_write_slides.sql`.
- `311_drop_write_slides`: run before the migration (fails: `cmo_drop_write_slides()` does not exist) and after it
  (13/13 ok). The real pgTAP run is CI's `database (Supabase)` job.
- `current.sql`: a `pg_dump` diff of that database before and after the migration, applied to the file (not a full
  `scripts/dump-schema.sh` run against every migration).
- `npx tsc --noEmit -p apps/web`: clean. `npm run check:contracts` (apps/web): green, with `writer.check`,
  `registry.check`, `no-ai-slop.check`, `capabilities.check`, `jobs.check`, `mcp.check` and the eval coverage in it.
- Not run: Playwright (no stack). No e2e test used the Slideshow chip.


Task 5:
- `docs.zernio.com` and `zernio.com` were blocked by the session's network; a personal environment `opencmo` allowing
  only those two hosts was created (owner approved) and this session moved onto it.
- Failing checks first: `split.check.ts` (X's count; a link or a number in a long post kept whole) and
  `zernio.check.ts` (no duet or stitch on a TikTok photo post), then the fixes. `tsc --noEmit`, `split.check`,
  `zernio.check`, `publish-post.check`, `draft-thread.check`: green.

## Zernio's documents (URL, date read, the words)

All read on 2026-11-13; quoted in full in [`../2026-11-13-real-account-checklist.md`](../2026-11-13-real-account-checklist.md).

- `threadItems` on Threads and X (`/platforms/threads/posts`, `/platforms/twitter/posts`): root first, each a reply to
  the one before, top-level `content` not published. Matches.
- X's refusal (`/platforms/twitter/reference`): "Tweet text is too long (312 characters). Twitter's limit is 280
  characters. Note: URLs count as 23 characters." and "URLs count as 23 characters and emojis as 2." **Differed**: we
  counted code points. Fixed with `xLength` (`split.ts`), used by `chainFor("x", …)` and `xTooLong` (`publish-post.ts`,
  one line; it decides whether the "Post as a thread" button is offered).
- Carousels (`/platforms/instagram/posts`, `/platforms/threads/posts`): images in `mediaItems`, up to 20. Matches.
- TikTok Photo Mode (`/platforms/tiktok/posts`, `/platforms/tiktok/fields`): top-level `tiktokSettings`, camelCase
  accepted, `media_type: "photo"`, `description` up to 4,000; "`allow_duet` and `allow_stitch` do not apply".
  **Differed**: we sent both. Fixed in `zernio.ts`.
- Left for the real account (checklist, not code): `video_made_with_ai: true` refused on Business-app photo posts;
  WebP on Threads; Instagram's crop to the first photo's ratio; the 90-character TikTok title made from `content`.

## Seen, not mine

- **The sentence splitter broke links** (found while testing X's count, fixed in `split.ts` since it is mine): a stop
  inside a word (`example.com`, `3.5`) was taken as a sentence end and the parts were joined back with a space, so a
  Threads chain could post `example. com`. Now a sentence ends only at a stop followed by a space or the end.
- `components/today/PhotoPostPanel.tsx` accepts WebP; Zernio's Threads page says "WebP may fail; use JPEG or PNG."
  Left to the real-account check before changing the panel.
- `components/cards/bodies.tsx` shows the X thread's parts from `chainFor` (now X's count), but any character counter
  on the card for X still counts code points; a post of emojis can read under 280 there and be refused.
