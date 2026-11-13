# Database review, 2026-11-13

A review of the whole Supabase schema for operations and safety: all 213 migrations applied to the pinned Postgres
(17.6.1.167), then the catalog queried directly (RLS, grants, indexes, security definer functions, triggers), plus a
high-effort code review of the latest schema changes (autopilot, banned API keys, planned-item expiry).

**Merge order: after #204.** #204 redefines `cmo_save_draft` and `approvals_autopilot`, and its migrations used the
same versions (`20270120010000`, `20270120020000`) and test numbers (299, 300) this branch first had. This branch is
merged on top of #204, its migrations renumbered to `20270121…` and its function bodies built on #204's (targets, slot,
Threads chains kept). Merged the other way round, #204's later `create or replace` would undo the autopilot fixes.

## What was already right

- RLS is on for all 84 tables, and no table has a write policy: every write is a security definer RPC (web rule 1).
- All 395 security definer functions pin `search_path`. Every one a signed-in founder can call checks the caller
  (`auth.uid()` / `require_user`), except three that are safe by design (`cmo_chat_save_document` delegates the check,
  `provider_spend_report` checks the app owner, `email_unsubscribe` takes an unguessable token).
- Money: `credit_ledger` is append-only (a trigger rejects UPDATE and DELETE), the balance is kept by trigger under a
  per-user lock, and webhook grants are idempotent through the unique `external_id`.
- anon and authenticated have statement timeouts (3 s and 8 s; Supabase defaults, seen in the pinned image).

## Fixed

`20270121010000_db_hardening.sql` (test `309_db_hardening`):

1. **40 foreign keys had no index.** Every delete of a parent scanned the whole child table: `purge_expired_jobs`
   (jobs → tasks, worker_operations, upload_reservations), deleting an unpaid account (auth.users → agent_sessions,
   media_transcripts, deliverables…) and deleting a CMO run (set null on six tables). That cost grows with the data,
   until the daily cleanup or a founder's delete hits its timeout. 39 indexes added (`generations.model` left out on
   purpose).
2. **Two duplicate indexes** (`cmo_goals_user_idx`, `editor_revisions_clip_number_idx`) dropped: same columns as a unique
   constraint, so every write paid for both.
3. **The API roles had privileges they never used.** anon and authenticated had INSERT/UPDATE/DELETE on 25 tables and
   TRUNCATE/TRIGGER/REFERENCES on all of them, plus UPDATE on every sequence (`setval`). RLS refused the writes, but
   TRUNCATE is not covered by RLS at all. anon also had SELECT on 41 tables, which let GraphQL introspection list their
   columns. Now anon reads only `billing_catalog`, authenticated keeps SELECT only, and the default privileges stop
   new tables from getting more. service_role is unchanged.
4. **Guards for the future.** `309_db_hardening` checks the whole schema on every CI run: RLS on every table, an index
   on every foreign key, no duplicate indexes, no direct writes by the API roles, anon reads only the price list, every
   security definer function pins `search_path` and checks its caller.

`20270121020000_autopilot_safety.sql` (test `310_autopilot_safety`): three ways a post went out without the founder's
Approve when CLAUDE.md says they must see it first.

1. **A founder's own brief lost its marker.** `cmo_save_draft` replaced the whole body, so `source = 'cmo_chat'` was gone
   before the card was raised; a "write it now" brief never had one. Autopilot then published the founder's own words
   without asking.
2. **A held card counted down while hidden.** `auto_at` was set at insert, even for a card held by the daily budget. On
   release the next morning it had passed, and the same cron call approved it. The countdown now starts when the card
   becomes visible.
3. **A banned or deleted account kept its autopilot.** The sweep now checks `auth.users`, as `api_key_owner` does.

`20270121030000_post_settle.sql` (test `311_post_settle`, and a two-connection test in
`packages/engine/tests/test_web_sql_concurrency.py`): two holes from #204's review of its own fan-out.

1. **A race left a core post `approved` for good.** X, Threads and Facebook post at the same minute by default. Two
   results committing together each read the other slot as still 'publishing', so neither marked the post. A post is
   now settled at commit, by one helper (`post_settle`) under a per-post advisory lock, so the second settle reads the
   first's committed slot. An advisory lock rather than the deliverable row: other flows lock deliverables before slots.
2. **A last slot that failed for good never settled the post.** Only a cancellation did. The settle now also runs when
   a slot fails and when its Retry card is decided or expires. It runs at commit because a failure raises its card
   after the slot update in the same transaction.

## Before deploying (owner)

The index migration takes a short write lock on each table while it builds. It sets `lock_timeout = 5s`, so it fails
instead of queueing behind a long transaction; if it does, rerun it at a quiet hour (every statement is idempotent).
Check the sizes first, read-only:

```sql
select relname, pg_size_pretty(pg_total_relation_size(oid)) as size, reltuples::bigint as rows
from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r'
order by pg_total_relation_size(oid) desc limit 15;
```

Under a few million rows per table, the whole migration takes seconds.

After deploying, confirm nothing reads as anon that should not, and that the new defaults hold:

```sql
select table_name from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'anon';          -- billing_catalog only
select defaclacl from pg_default_acl
where defaclrole = 'postgres'::regrole and defaclnamespace = 'public'::regnamespace and defaclobjtype = 'r';
```

Deploy note: a direct table write as `authenticated` used to match no rows silently; it is now `42501 permission
denied`. Nothing in the app or the worker does one (all direct writes use the service role), and the tests that
asserted the old behaviour were updated.

## Owner decisions still open

1. **Backups and restore.** Confirm Point-in-Time Recovery is on for the production project (Supabase dashboard,
   Database → Backups); without it the only backup is the daily one, so a bad migration or a wrong `delete` can lose up
   to a day of credits and payments. Then do one restore drill into a branch project and write down how long it took.
   This is the biggest operational risk left, and it is a setting, not code.
2. **Retention.** These tables only grow; nothing deletes from them except a cascade when an account is deleted:
   `product_events`, `provider_usage`, `operation_log`, `zernio_receipts`, `work_order_events`, `cmo_voice_events`,
   `agent_messages`, `agent_tool_calls`, `editor_revisions`. Not urgent at today's size. Proposal: delete
   `zernio_receipts` after 30 days (replay protection only needs a short window) and keep the rest until the database
   passes ~5 GB, then decide per table (keep `provider_usage` and `product_events` for the spend and activation
   reports, cap `editor_revisions` per clip). Deleting data is the owner's call, so nothing was added.
3. **Default function privileges.** New functions in `public` are executable by `authenticated` by default, and many
   migrations rely on it. A worker-only function that forgets its `revoke` is callable by any founder, as the owner.
   The new test catches a security definer function with no caller check; the stronger fix is to flip the default
   and grant each user RPC explicitly. That is a convention change for every future migration, so it waits for you.

## Code review findings not fixed here (product logic)

From the high-effort review of #204, not verified one by one; each belongs to #204's sessions:

- The planner allows 3 posts a day per platform, but X and LinkedIn have one posting time a day: the extra posts pile up
  and, past the 14-day horizon, are skipped with no card.
- A script with a long storyboard and caption breaks the 8,192-byte brief cap; the error is swallowed and the founder
  paid a credit for a script card that never appears.
- Photo posts: photos of a replaced or abandoned draft are never queued for deletion but count toward the storage quota.
- "Rewrite for X" charges even when the X slot already went out.
- A queued `build_slideshow` order is still claimed after the branch that ran it was removed.
- Photo post panel: no way to start a second photo post without a reload; a failed caption run is never noticed.
- The posting-plan stepper sends unserialized saves, so the stored plan can differ from the one shown.

From the high-effort review of the autopilot change. Each needs a product decision, not a database one:

- The three-skips streak never resets: after turning autopilot back on, one skip turns it off again.
- `approval_auto_decide` runs from the hourly digest cron, but `auto_at` is capped at post time minus 15 minutes, so a
  card can be approved after its time and refused ("The time you approved has passed").
- `save_autopilot` changes the window but not the `auto_at` of cards already counting down.
- The schedule approval written during an autopilot decision records `decided_via = 'app'`, not `'auto'`.
- `cmo_expire_planned` deletes items a waiting week-plan card lists, so its content hash stops matching and Approve
  fails with "This card changed" every time.
- The eligibility rule is written twice (`post_autopilot_at`, `post_autopilot_still_on`) and the copies already differ.
- The skip-streak trigger scans all decided post cards of the founder with no supporting index.
