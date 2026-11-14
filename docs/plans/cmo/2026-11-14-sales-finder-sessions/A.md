# Session A — data and finders

Plan: [`../2026-11-14-sales-finder-plan.md`](../2026-11-14-sales-finder-plan.md). Branch `claude/sales-finder`.
Commit and push after every task. Read the plan's Global constraints first.

**Owns:** `supabase/migrations/20270125010000_sales_finder_platforms.sql`, `supabase/tests/317_sales_finder_platforms.test.sql`,
`supabase/schema/current.sql`, `apps/web/lib/cmo/social/conversations.ts` (+ `.check.ts`), `facebook.ts`,
`threads-search.ts` (+ `.check.ts` each), `apps/web/lib/cmo/social/fixtures/{facebook,threads}-*.json`,
`apps/web/scripts/sales-finder-fixtures.mts`, `googleSearch` in `apps/web/lib/cmo/social/research.ts` (the `datePosted`
option only), `apps/web/lib/cmo/jobs/types.ts` (only the blocks named below),
`apps/web/lib/cmo/jobs/store.ts` and `memory-store.ts` (`salesSettings` only).

## Tasks

### - [x] A1. The shared building block (push this first: B and C wait on it)

**Files:** create `apps/web/lib/cmo/social/conversations.ts`, `conversations.check.ts`; modify `apps/web/lib/cmo/jobs/types.ts`
(`Opportunity.platform`, `ReplyOutcomeDue.platform`, `SalesSettings`), `store.ts` and `memory-store.ts` (`salesSettings`).

**Produces:** exactly the block in the plan's "The shared building block", plus
`SalesSettings = { excluded: string[]; pairs: [string, string][]; platforms: SalesPlatform[] }`,
`Opportunity.platform?: SalesPlatform`, `ReplyOutcomeDue.platform: SalesPlatform`.

- [ ] Write `conversations.check.ts` (assert-style like `social/hn.check.ts`):
  - `normalizeConversationUrl("https://www.threads.net/@a/post/XYZ?xmt=1#c")` → `"https://www.threads.com/@a/post/XYZ"`
  - `normalizeConversationUrl("http://reddit.com/r/x/comments/1/t/")` → `null` (not https)
  - `normalizeConversationUrl("https://evil.example/r/x")` → `null`
  - `normalizeConversationUrl("https://WWW.Facebook.com/groups/123/posts/456/?__cft__=x")` → `"https://www.facebook.com/groups/123/posts/456/"`
  - `parsePlatforms(["threads", "x", "reddit", "reddit"])` → `["reddit", "threads"]`; `parsePlatforms("reddit")` → `[]`
- [ ] Run `cd apps/web && npx tsx lib/cmo/social/conversations.check.ts`: fails (module missing).
- [ ] Implement `conversations.ts`. Host allowlist: `reddit.com`, `www.reddit.com`, `old.reddit.com`, `news.ycombinator.com`,
  `www.facebook.com`, `facebook.com`, `m.facebook.com` (→ `www.facebook.com`), `www.threads.com`, `threads.com`,
  `www.threads.net`, `threads.net` (→ `www.threads.com`). Keep the path as is (trailing slash included).
- [ ] Types: widen the three blocks above. `store.salesSettings` and the memory store return
  `platforms: [...SALES_PLATFORMS]` for now (the column comes in A2).
- [ ] `npx tsx lib/cmo/social/conversations.check.ts` passes; `npm run typecheck` passes.
- [ ] Commit `Sales finder A1: one conversation shape and the platform list` and push.

### - [x] A2. SQL: the new platforms, and the founder's platform switches

**Files:** create `supabase/migrations/20270125010000_sales_finder_platforms.sql`, `supabase/tests/317_sales_finder_platforms.test.sql`;
modify `supabase/schema/current.sql` (dump), `store.ts` / `memory-store.ts` (read the column).
Load the `supabase-migrations` skill before writing SQL.

- [ ] Write pgTAP `317` (plan count as you write it):
  - a Facebook and a Threads item saved through `cmo_save_opportunities` land with that `platform`;
  - `platform = 'x'` and `'linkedin'` are refused by `cmo_save_opportunities` (its own message) and by the table check;
  - a new `sales_settings` row has `platforms = '{reddit,hn,facebook,threads}'`;
  - `sales_settings_save(p_excluded, p_pairs)` (old two-argument call, named) still works and keeps `platforms`;
  - `sales_settings_save(..., p_platforms => '{threads,reddit}')` stores `{reddit,threads}` (sorted, de-duplicated);
  - `p_platforms => '{}'` raises `Keep at least one place for Sales to look.`; `'{x}'` raises `Sales can look on Reddit, Hacker News, Facebook groups and Threads.`;
  - another user cannot change this user's row (RLS / `require_user`).
- [ ] Run `npm run db:reset && npm run db:test`: 317 fails.
- [ ] Migration:
  - `opportunities_platform_check` → `platform in ('reddit','hn','facebook','threads')`.
  - `cmo_save_opportunities`: `create or replace` from its body in `current.sql`, changing only the platform check line
    to the same four values.
  - `sales_settings.platforms text[] not null default '{reddit,hn,facebook,threads}'`, check
    `cardinality(platforms) between 1 and 4 and platforms <@ array['reddit','hn','facebook','threads']`.
  - `drop function sales_settings_save(text[], jsonb)`; create `sales_settings_save(p_excluded text[], p_pairs jsonb, p_platforms text[] default null)`:
    same body, plus: null keeps the row's platforms; otherwise normalise (lower, distinct, sorted) and raise the two
    messages above. Same `revoke`/`grant` as the old function (copy them from `current.sql`).
- [ ] `npm run db:reset && npm run db:test` all pass; `scripts/dump-schema.sh`.
- [ ] `store.salesSettings` selects `platforms` (fallback `[...SALES_PLATFORMS]` when there is no row); same in the memory store.
- [ ] `npm run typecheck`. Commit `Sales finder A2: Facebook and Threads conversations, platform switches in Sales settings`, push.

### - [x] A3. Finders: Facebook groups and Threads

**Files:** create `apps/web/lib/cmo/social/facebook.ts`, `threads-search.ts`, `facebook.check.ts`, `threads-search.check.ts`,
`apps/web/scripts/sales-finder-fixtures.mts`, fixtures `apps/web/lib/cmo/social/fixtures/{google-facebook-groups,facebook-post,facebook-post-comments,google-threads,threads-post}.json`.

**Consumes:** `scGet`, `ScBudget`, `SocialReadError`, `scFakeAllowed`, `googleSearch` (extend it with an optional
`opts: { datePosted?: "last-week" | "last-month" }` that becomes `date_posted`), `ConversationThread`, `normalizeConversationUrl`.

**Produces:**
```ts
// facebook.ts
export async function searchFacebookGroups(query: string, budget: ScBudget, opts?: { readPosts?: number }): Promise<ConversationThread[]>;
// threads-search.ts
export async function searchThreadsConversations(query: string, budget: ScBudget, opts?: { readPosts?: number }): Promise<ConversationThread[]>;
```

Behaviour (both): one Google call (`site:facebook.com/groups <query>` or `site:threads.com <query>`, `date_posted: last-month`);
keep only post URLs (`/groups/<id>/posts/<id>` or `/groups/<id>/permalink/<id>`; `/@<user>/post/<code>`), normalised,
de-duplicated; then read up to `readPosts` (default 4) of them in order through `/v1/facebook/post` or `/v1/threads/post`
with `cache_max_age: "7d"` (Threads also `trim: "true"`). `text` = post text plus up to 5 comments as
`\n— <author>: <text>` lines, cut to 2,000 chars; `comments` = the post's comment/reply count; `community` = the group's
name from the Google title (text before " | Facebook") or `"Facebook group"`, and `"Threads"`; `title` = the first
120 chars of the post text, or the Google title. A read that fails or returns no text keeps the Google title +
description as `text` (Review focus 2). Posts older than 30 days (when the time is known) are dropped.

- [ ] Capture fixtures with the owner's key (about 12 ScrapeCreators credits; ask with `request_credential` if the
  key is not in this container): `npx tsx scripts/sales-finder-fixtures.mts "need help with invoicing"` runs the five
  calls above once and writes the raw JSON (only the fields the parsers read, plus `success`) into the fixtures. Write in
  the session file whether `/v1/facebook/post` accepted a group URL.
- [ ] Checks against the fixtures (stub `scGet` the way `social/fixtures.check.ts` does):
  - Google results that are a group home page, `/groups/<id>/about`, a profile, `login.php` or `/@user` (no `/post/`) are dropped (Review focus 1);
  - a Facebook post read that throws `SocialReadError` keeps the Google text and the scan's thread is still returned;
  - `readPosts: 0` makes exactly one call; `readPosts: 4` at most five;
  - the same post as `threads.net` and `threads.com` comes back once;
  - a budget of 1 returns the Google-only threads and does not throw.
- [ ] Fake mode (`scFakeAllowed()`): each finder returns two fixed `ConversationThread`s, as `fakePosts` does in `research.ts`.
- [ ] `npx tsx` both checks, `npm run typecheck`. Commit `Sales finder A3: Facebook group and Threads finders`, push.

### - [x] A4. Review (plan §Code review after each session)

## Review

`/code-review high` on A1–A3 (`0b3e2114`, `124e57c1`, `44a74c1b`) and `security-review-checklist` (clean: the key only
goes to ScrapeCreators, the migration is new, the new column inherits the table grants, budget and cap are checked
before each lookup). Fixed in `A: review fixes`:

1. **Threads posts always had 0 comments**: `scGet` asks for the trimmed answer, which has no reply count. Fixed: the
   replies it carries are the count (`threads-search.check.ts`).
2. **`normalizeConversationUrl` let non-posts through** (a Threads profile, a group's home, an HN link with another
   query), which `opportunities_url_check` refuses and would fail a whole save. Fixed: it returns only a post's own page
   per platform, else null (`conversations.check.ts`).
3. **One Facebook post under several URLs** (slash, `permalink`/`posts`, case of the group name). Fixed: one form,
   `/groups/<name lower-cased>/posts/<id>`. A group's numeric id and vanity name still differ (needs a lookup): kept.
4. **Paid reads spent on posts the founder had seen.** Fixed: the finders take `skip(url)` and spend their reads on the
   rest (Request to B below to pass it).
5. **Out of credits and the daily cap were swallowed per post.** Fixed: `setup`, `credits` and `cap` stop the step.
6. **The group name was always "Facebook group"**: Google's titles end in " - Facebook" and name no group. Fixed: a
   vanity group name from the link; a numeric id still reads "Facebook group" (no source of the real name).
7. **Post reads ran one after another.** Fixed: in parallel (`Promise.allSettled`).
8. **The two finders were copies.** Fixed: `google-posts.ts` (`findPostsViaGoogle`, `postCandidates`). The chat's
   older `threadsSearch` in `research.ts` is left as it is (out of this plan).
9. **The reply card treats every non-HN platform as Reddit** (`lib/screens/cards.ts:141`, `approval-card.ts:118`):
   Request to C below.
10. **`PLATFORM_LABEL` shares a name with `lib/screens/common.ts`**: kept. B already imports it, and it is typed
    `Record<SalesPlatform, string>`, so a wrong auto-import fails the typecheck.

B's request (outcome check fills with Facebook/Threads replies) is done in the same migration (unmerged, so edited in
place): `cmo_reply_outcomes_due` returns Reddit and Hacker News only; pgTAP 317 has the case. `jobs.check.ts` line 428
now expects the Facebook URL without its trailing slash (the new one form).

## Requests

- **From B (B3 review): filter reply outcomes by platform in SQL.** `cmo_reply_outcomes_due` returns the newest 10 due
  outcomes of every platform; `checkReplies` (`reply-outcomes.ts`) then drops Facebook and Threads ones, which are
  never marked checked. Ten such replies take every slot from then on, and Reddit/HN replies are never checked. In a
  new migration, add `and p.platform in ('reddit', 'hn')` to its `where` (pgTAP: ten due Facebook outcomes and one
  Reddit outcome → the Reddit one is returned). B keeps its filter as a second guard.
