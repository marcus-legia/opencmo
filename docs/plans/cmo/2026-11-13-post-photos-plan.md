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

- [ ] **A. The page.** `app/app/photos/page.tsx` renders `PhotoPostPanel` with the accounts it needs; the top bar gets
  "Photos"; the Calendar drops the panel and links to the page. Playwright: the page opens and the panel is there.
- [ ] **B1. SQL** `20270121040000_post_photos` + pgTAP `313_post_photos`: `content_items.photos` (≤ 4);
  `reserve_upload` takes a post the founder owns that is in review or approved; `post_photos_save(item, photos)` checks
  owner, status, count, folder, existence and the deletion queue, releases dropped photos, raises the post card again
  (in review) or the schedule cards (approved); the post card's snapshot and `schedule_content` carry `photos`.
- [ ] **B2. API** `POST /api/v1/posts/[id]/photos/uploads` (reservation) and `PUT /api/v1/posts/[id]/photos` (save).
- [ ] **B3. Card**: the post body shows the photos (signed links), "Add photos", remove; the schedule card shows them.
- [ ] **B4. Publish**: nothing new: a slot whose snapshot has `photos` already posts them (`publish-post.ts`), on the
  first part of a chain or thread. Check it with a publish check.
- [ ] **Verify**: pgTAP, `check:contracts`, `tsc`, Playwright on the local stack, a screenshot of the card with photos.

## Not in this plan

- Moving uploads to DigitalOcean (the owner, this week).
- Photos on a Reddit reply, a video caption or a thread the Writer drafts.
