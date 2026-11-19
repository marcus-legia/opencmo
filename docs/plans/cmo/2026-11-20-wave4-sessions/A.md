# Session A — data and SQL

Plan: [`../2026-11-20-wave4-plan.md`](../2026-11-20-wave4-plan.md). Branch `claude/launch`. Load the
`supabase-migrations` skill before SQL. Migrations from `20270202010000`, pgTAP from `347_`. **4a migrations add only**
(they run with the code in production before the merge).

**Owns:** new migrations and pgTAP, `supabase/schema/current.sql`, store / memory-store methods for what you add,
`supabase/tests/182_authenticated_function_allowlist.test.sql`.

## 4a

### - [x] A1. Usage state (push first)
A read the screens can use: `my_usage_state()` (founder) returns the plan, the share used this period (0–100), whether
included work is stopped (`blocked`), what still works when blocked (reading, editing, copying drafts), and when the
period resets. Built on the existing usage / credit functions, no new money path. pgTAP: free, paid under, paid at
100%, annual. Tell C under **Requests** in C.md.

### - [x] A2. Delete my account (after the owner's decision 2; default: build it)
`account_delete(p_email text)` (founder): the typed email must match, then the existing purge path for the user's rows
and storage (reuse it, do not write a second one), a row in the purge log, and the auth user removed through the same
mechanism the purge uses. Refuses while a paid subscription is active ("Cancel your plan first" with the Billing
link), so no charge runs on a deleted account. pgTAP: wrong email, active plan, success leaves no row of the user.

## 4b (only after "4b go")

### - [ ] A3. Drop the hidden tables and functions
With B4 and C6: list every table, function, trigger, policy and enum value used only by TikTok, Instagram, slideshows,
video scripts, Photos and Studio orders (grep the code after B4/C6 remove callers). Migrations drop them, one area per
migration; a table with founder rows that could matter is archived to a `legacy_*` table first. pgTAP files of the
dropped functions are removed with them; 182 updated; `current.sql` dumped.

### - [ ] A4. Quote card data
A post may carry `quote_card` in its body: `{ entryId, quote, community, platform }` taken from a Library entry of the
founder (checked in SQL like `post_sources_clean`: the entry is theirs, the quote is one of its quotes, ≤ 280 chars).
RPC `post_set_quote_card(p_item uuid, p_entry uuid, p_quote text)` and clearing it. pgTAP.

## Requests

(none yet)
