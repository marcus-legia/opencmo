# Photos on a text post; the slideshow page on its own

**Owner, 2026-11-13:** "Upload image for a post must be in the post text. Slideshow and carousel are on their own page,
because earlier sessions misread 'slideshow' and made it a video, not uploaded photos. A slideshow is a page that makes
images plus a caption." Recorded in `CLAUDE.md` (Daily core drafts, D7).

**Branch and PR:** `claude/stoic-planck-zlphv6`, PR #207 (it carries D7's photo posts). One session.

## What the founder meets today

| | Today | Wanted |
|---|---|---|
| A photo on a text post | Only the CMO's generated post image; the founder cannot add their own | Add up to 4 of their own photos on the post's card |
| Slideshow / carousel | A panel inside the Calendar page | Its own page: photos, order, caption, platforms |

## Decisions

| # | Decision |
|---|---|
| P1 | A text post takes **up to 4 photos** (X's limit; Threads, LinkedIn and Facebook all take 4). One number for every platform of the slot, as one core post serves them all (D3). |
| P2 | Photos are added on the post's card, before or after approval, until the post is published. The founder's photos **replace** the CMO's generated post image for that post. |
| P3 | The photos are part of what is approved: they are in the post card's snapshot and in each schedule card's hash. A change after approval sends the schedule cards back to the founder, as a new post image already does. |
| P4 | Photos go to the `photos` bucket under `<user>/<post>/`, with a reservation (web rule 3). Supabase Storage for now; uploads move to DigitalOcean storage later this week (`TODO(storage)`). A photo dropped from the list is queued for deletion. |
| P5 | The slideshow page is `/app/photos` ("Photos" in the top bar). The Calendar keeps a link to it, not the panel. |

## Tasks

- [x] **A. The page.** `app/app/photos/page.tsx` renders `PhotoPostPanel` with the accounts it needs; the top bar gets
  "Photos"; the Calendar drops the panel and links to the page. Playwright: the page opens and the panel is there.
- [x] **B1. SQL** `20270121040000_post_photos` + pgTAP `313_post_photos`: `content_items.photos` (≤ 4);
  `reserve_upload` takes a post the founder owns that is in review or approved; `post_photos_save(item, photos)` checks
  owner, status, count, folder, existence and the deletion queue, releases dropped photos, raises the post card again
  (in review) or the schedule cards (approved); the post card's snapshot and `schedule_content` carry `photos`.
- [x] **B2. API** `POST /api/v1/cmo/items/[id]/photos/uploads` (reservation) and `PUT /api/v1/cmo/items/[id]/photos` (save,
  answers the post card that now waits with the photos).
- [x] **B3. Card**: the post body shows the photos (signed links), "Add photos", remove; the schedule card shows them.
- [x] **B4. Publish**: nothing new: a slot whose snapshot has `photos` already posts them (`publish-post.ts`), on the
  first part of a chain or thread. Checked: the Playwright spec reads each slot's `schedule_content` (the photos, in
  order, on X, Threads and LinkedIn); `publish-post.check.ts` already covers posting a snapshot's photos.
- [x] **Verify**: pgTAP, `check:contracts`, `tsc`, Playwright on the local stack, a screenshot of the card with photos.

## Not in this plan

- Moving uploads to DigitalOcean (the owner, this week).
- Photos on a Reddit reply, a video caption or a thread the Writer drafts.

## What was run (2026-11-13)

On a full local Supabase stack: `supabase test db` 206 files PASS (`313_post_photos` 18/18); `npm run check:contracts`
green; `tsc --noEmit` clean; `npx tsx e2e/run.ts ui-v2-post-photos ui-v2-core-drafts` 5/5. Screenshots in
[`2026-11-13-post-photos-shots/`](2026-11-13-post-photos-shots/): the post card with a photo, the Threads schedule card
carrying it, and the Photos page.

## Whole-PR review before the merge (2026-11-13)

`/code-review` (high) of PR #207 against #204, ten findings, all fixed:

1. Unsaved uploads and a skipped post's photos were never deleted: `post_photos_sweep` (the cleanup cron, a week on).
2. A dropped photo could still be listed by a slot that was posting or waiting on Retry: no change while a slot is
   posting, and a failed slot's Retry card is raised again with the new photos.
3. `xLength` took closing punctuation into a link; X does not.
4. `xLength` counted `Next.js` or `README.md` as links: bare domains only with a known ending, or a path.
5. A missing photo told a text post's founder to open a photo post: the message now names the post's card.
6. Threads and LinkedIn do not take WebP: a text post takes JPEG or PNG.
7. A card older than the post could overwrite its photos: the save carries the list the card showed.
8. Two copies of the upload route and loop: one server helper (`photo-uploads.ts`), one client helper.
9. A second `approval_raise` the `approvals_sync` trigger already does: removed.
10. The Photos page loaded the whole calendar for a form: it reads the workspace's accounts.

Also fixed for CI, both from #204: `301` depended on the time of day; `test_platforms.py` still expected X at 25,000.
