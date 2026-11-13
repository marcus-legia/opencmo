# First real posts: a checklist for the owner

Three flows were built from Zernio's documents only. This checklist is for trying each one once on your own accounts
before a paying founder does. It takes about 30 minutes plus waiting for the posts' times.

**Before you start**

- Use your own accounts: X (a free one, not Premium), Threads, LinkedIn and TikTok. Each post is real and public
  unless you pick otherwise; delete them afterwards if you like.
- Open **Calendar**, then the **posting plan** (the icon next to Refresh on the Feed leads there too). Press
  **Connect** on X, Threads, LinkedIn and TikTok and finish each sign-in. Each row should then say it is connected.
- Keep a note open. For anything that differs from "What you should see", write down: the flow (1, 2 or 3), the card's
  exact words (copy them, or a screenshot), the time you saw it, and the platform.

What the code was checked against is in [Zernio's documents, as read](#zernios-documents-as-read) at the end.

---

## Flow 1: one post of about 900 characters to X (free), Threads and LinkedIn

**Do**

1. In the posting plan, give X, Threads and LinkedIn one post on the same day. Save.
2. In the CMO chat, ask for a post of about 900 characters (for example: "Write a 900-character post about why I
   started this"). Or edit the day's draft until the counter shows about 900.
3. On the Feed, open the post. It should list three chips: X, Threads, LinkedIn. Press **Approve**.
4. Three schedule cards appear (one per platform), each with its time. Approve each one.

**What you should see**

| Platform | Expected |
|---|---|
| Threads | Posted at its time **as a chain**: 2 posts, the second a reply to the first, every word in order, no word cut in half, links whole. |
| LinkedIn | Posted at its time as one post. If LinkedIn is not connected, the card offers copy-and-open instead. |
| X (free) | **Refused** at its time (a free account takes 280 characters). The card says: "Your X account takes 280 characters per post. Post it as a thread, or turn on X Premium." with a **Post as a thread** button. Nothing was posted on X. |
| The post | The calendar counts it as posted as soon as the first platform posts (decision F1, Task 2 of this plan). |

**Send back if**

- X posted the whole 900 characters (then your account takes long posts: say whether it has Premium).
- X's refusal shows other words than the sentence above (copy them exactly: the words are how we know it is about
  length).
- Threads posted one cut-off post, or the chain is out of order, or a link has a space in it.
- A card says "The posting service did not answer" or anything else.

## Flow 2: "Post as a thread" on X

**Do**

1. On the X card refused in Flow 1, press **Post as a thread**.
2. Approve the card it gives back (it may propose a new time if the first one passed).

**What you should see**

- At its time, X shows a thread: about 4 posts for 900 characters, each a reply to the one before, every word in order.
- No post is over 280 by X's count. X counts **an emoji as 2** and **a link as 23**, whatever its length; a post full
  of emojis makes more parts than its letters suggest. This is the one place we changed the code after reading the
  documents (see below).
- The card turns to posted, with the first post's link.

**Send back if**

- X refuses one of the parts (copy the words, and the part's text if the card shows it).
- Only the first post went out.
- The thread's posts are not replies to each other.

To try the emoji rule: a second post with 100 emojis and a link, same steps. Expect 2 parts, none refused.

## Flow 3: four photos to TikTok (Photo Mode)

**Do**

1. Calendar → **Photo post** → **Add photos**: four JPEG or PNG photos (not WebP; see the note below).
2. Under **Post it on**, pick TikTok (and Instagram and Threads if you want to try the carousels too).
3. Type a caption with two hashtags, or press **Write the caption**. Press **Schedule**.
4. On the TikTok schedule card: pick the most private option TikTok offers (Self only) for a test. Leave the AI label off. Approve.

**What you should see**

| Platform | Expected |
|---|---|
| TikTok | A photo post (swipe through four photos, cover = the first), your full caption with hashtags under it. TikTok may add music on its own. |
| Instagram | A carousel of the four photos, in order, with the caption. |
| Threads | A carousel of the four photos, in order, with the caption. |

**Send back if**

- TikTok refuses it. Copy the words. Two refusals we expect could happen, and need your word before we change code:
  "You have created too many posts in the last 24 hours via the API" (TikTok's own daily cap) and "TikTok direct
  posting is at capacity right now…" (the app's shared cap; Zernio's documents suggest sending to drafts instead).
- The caption is cut, or the hashtags are missing.
- TikTok shows a title above the caption that is cut mid-word (Zernio turns our text into a 90-character title).

**To confirm on a real account (not changed in code)**

- *The AI label on a TikTok photo post.* Zernio's documents say a TikTok account connected through TikTok's Business
  app refuses `video_made_with_ai: true` on a photo post. Try one more photo post with the AI label **on**. If it is
  refused, send the words: the fix is either sending it to TikTok drafts or hiding the label for photos.
- *WebP photos.* Our photo post accepts WebP; Zernio's Threads page says "WebP may fail; use JPEG or PNG." Try one WebP
  photo to Threads and send back what happens.
- *Instagram crops.* "All items share the aspect ratio of the first item": mix one portrait and one landscape photo
  and look whether Instagram crops the second.

---

## Zernio's documents, as read

Read on 2026-11-13. These are the words the code is built on.

**Threads chain** — [docs.zernio.com/platforms/threads/posts](https://docs.zernio.com/platforms/threads/posts):
"`threadItems` publishes a chain of connected posts. The first item is the root post, and each later item is a reply
to the one before it, in order." and "With `threadItems` set, the top-level `content` is stored for display and search
only and is not published. The first post must be `threadItems[0]`." Limit: "Threads accepts text-only posts of up to
500 characters". **Matches the code.**

**X thread** — [docs.zernio.com/platforms/twitter/posts](https://docs.zernio.com/platforms/twitter/posts): "Put the
whole sequence in `platformSpecificData.threadItems`. The first item is the root post, and each later item replies to
the one before it." **Matches the code.**

**X's refusal of a long post** — [docs.zernio.com/platforms/twitter/reference](https://docs.zernio.com/platforms/twitter/reference):
"Tweet text is too long (312 characters). Twitter's limit is 280 characters. Note: URLs count as 23 characters." and
the fix column: "URLs count as 23 characters and emojis as 2." Our length check finds "too long" in it (matches). **The
code counted an emoji as 1 and a link by its letters**: a thread part could be refused. Fixed: `xLength` in
`apps/web/lib/departments/publish/split.ts`, used for X's thread parts and for the "too long" check.

A refused post comes back as "`207` with `post.status: \"failed\"` and the message in `platforms[].errorMessage`"
([error handling](https://docs.zernio.com/guides/error-handling): "207 is a 2xx"). **Matches the code** (`postResult`
reads the platform's status and `errorMessage`).

**Instagram carousel** — [docs.zernio.com/platforms/instagram/posts](https://docs.zernio.com/platforms/instagram/posts):
"Up to 20 items, images and videos mixed. All items share the aspect ratio of the first item". **Threads carousel**:
"Up to 20 images in one swipeable post". Both are `mediaItems` alone. **Matches the code.**

**TikTok Photo Mode** — [docs.zernio.com/platforms/tiktok/posts](https://docs.zernio.com/platforms/tiktok/posts):
"`content` becomes the photo title (90 characters, hashtags and URLs stripped). Put the full caption in
`description`, which takes up to 4,000 characters." and "Photos and videos cannot be mixed in one post, and
`allow_duet` and `allow_stitch` do not apply". [Fields](https://docs.zernio.com/platforms/tiktok/fields): settings go
in a top-level `tiktokSettings`, "`camelCase` is accepted too"; `media_type: "photo"`, `photo_cover_index`,
`description`. **Matches the code, except** that it also sent `allowDuet` / `allowStitch` on a photo post. Fixed: a
photo post sends neither (`zernio.ts`, checked in `zernio.check.ts`).
