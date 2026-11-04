# Move payments from Polar to Creem (2026-11-04)

- **Decision:** owner, 2026-11-04. New purchases go through Creem; Polar stops selling.
- **Source:** Creem docs snapshot in [`docs/creem-llm.txt`](../../creem-llm.txt) (line numbers below point into it), and
  today's Polar integration (`apps/web/lib/polar.ts`, `apps/web/app/api/webhooks/polar/route.ts`,
  `process_polar_event` in `supabase/schema/current.sql`).
- **Branch / PR:** `claude/withorb-payment-support-xzq6al`. One branch, one PR per phase below (each phase ships green on
  its own).
- **Status:** plan only. Nothing is built yet.

## What Creem is, and what changes

Creem is a merchant of record like Polar: it collects the money, handles VAT/sales tax and refunds, and pays out to us.
Vietnam is a supported payout country (`creem-llm.txt` L24119). Fee: 3.9% + 40¢ per transaction, no monthly fee
(L19086). That is about what Polar charges, so this move is not about fees. What we gain: a `dispute.created` event
(Polar has none, so today we only learn about a chargeback through a refund), transaction ids on every renewal and
refund, and a customer portal link we can open from the billing page.

What it costs us, beyond the code:

1. **The Creem Moderation API is mandatory for us.** Any product that turns a user prompt into an image or video must
   screen every prompt with `POST /v1/moderation/prompt` before generating. Without it, Creem can suspend the account
   and hold funds (L15378-15420, L23424-23500). `/video`, `/broll` and `/animate` are exactly this case.
2. **The AI wrapper review.** Our branding must be independent of model names (already a product rule), and we need a
   visible Acceptable Use Policy (we have `app/(legal)/acceptable-use`). The review team tests outputs at any time.
3. **Chargebacks cost $25 each** (L23990), and too many can get the store suspended.
4. **Active subscriptions cannot be moved.** Creem only imports a product catalogue (from LemonSqueezy, not Polar). An
   existing Polar subscriber stays on Polar until they cancel (L19420).

## Polar → Creem, piece by piece

| Concern | Polar today | Creem |
|---|---|---|
| Checkout | Static link per plan (`POLAR_CHECKOUT_*`) with `customer_external_id` and `customer_email` query params | Server-created session: `POST /v1/checkouts` with `product_id`, `request_id`, `metadata`, `customer.email`, `success_url` → `checkout_url` (L12409-12690). Needs a secret API key on the server |
| Who bought it | `customer.external_id` = `profiles.id` | `metadata.user_id` = `profiles.id`. `checkout.completed` carries it in `object.metadata`, and it is copied to `subscription.metadata` (L9897-10030), so later subscription events carry it too |
| Webhook signature | Standard Webhooks: `webhook-id`, `webhook-timestamp`, `webhook-signature` (base64 HMAC over `id.timestamp.body`) | One header, `creem-signature`: **hex** HMAC-SHA256 of the raw body with the secret as key (L9846-9895). No timestamp in the signature, so no built-in replay window |
| Event envelope | `{ type, timestamp, data }` | `{ id: "evt_…", eventType, created_at: <epoch ms>, object }` |
| Money in | `order.paid` (one per order) | `checkout.completed` (first purchase) and `subscription.paid` (every successful charge, carrying `last_transaction_id` and `current_period_end_date`, L10085-10145) |
| Refund | `order.refunded` with `refunded_amount` | `refund.created` with `refund_amount` and the `transaction.id` it reverses (L10440-10535) |
| Chargeback | No event | `dispute.created` with `transaction.id` (L10539) |
| Lifecycle | `subscription.active / canceled / revoked / past_due` | `subscription.active / trialing / paused / past_due / unpaid / scheduled_cancel / canceled / expired / update` |
| Self-serve cancel | Polar portal | Customer portal link from `POST /v1/customers/billing` (L14825-14900). Note: cancelling from the portal is **immediate** |
| Retries | Polar retries | 5 attempts over about 6 hours, none after 24 hours (L9700). Manual resend from the dashboard |
| Local testing | Sandbox plus a tunnel | `creem listen --forward-to http://127.0.0.1:3000/api/webhooks/creem` (L2234), test API at `https://test-api.creem.io` |

## Design decisions

### D1. New `creem_*` tables and `process_creem_event`, Polar's stay read-only

Add `creem_customers`, `creem_transactions`, `creem_subscriptions` and `creem_webhook_receipts`, plus
`process_creem_event(...)`, written on the same proven pattern as `process_polar_event`. That pattern is: an advisory
lock per event, customer and subscription; a receipt row for idempotency; match by the id our checkout set, then fall
back to email; one transaction.

The Polar tables and RPC stay untouched, so old orders, refunds and any remaining Polar subscribers keep working.

*Rejected:* moving both providers into neutral `billing_*` tables now. It rewrites a working money path and its pgTAP
tests in the same PR as a new provider, and the second provider is the only reason to do it. Revisit if a third
provider ever comes.

### D2. One function decides the plan, across both providers

Today `process_polar_event` ends by computing `profiles.plan` from `polar_subscriptions` alone. If a Creem subscription
is active, a late Polar `subscription.revoked` would set the user back to `free`. Extract `recompute_plan(p_user)`. It
takes the best non-terminal plan from **both** subscription tables, and both RPCs call it. `account_is_paid()` also
ORs in `creem_transactions` and `creem_subscriptions`.

### D3. Credits are granted per transaction, on `subscription.paid` only

The first purchase fires both `checkout.completed` and `subscription.paid`. Granting on both would double the credits.
So:

- `checkout.completed` links the Creem customer to the user (through `metadata.user_id`) and records the order. It
  grants nothing.
- `subscription.paid` grants the plan's credits, keyed `credit_ledger.external_id = 'creem:' || last_transaction_id`.
  The unique `external_id` makes a redelivery a no-op.

**Must verify in test mode first (V1):** that `subscription.paid` fires for the first charge as well as renewals, and
that it can arrive before `checkout.completed`. If it can arrive first, the `metadata.user_id` on the subscription
object does the matching, so the order of events must not matter. pgTAP tests both orders.

### D4. Status mapping: Creem's `canceled` is not Polar's `canceled`

| Creem status | Entitled? | Why |
|---|---|---|
| `active`, `trialing`, `scheduled_cancel` | Yes | `scheduled_cancel` stays active until `current_period_end_date` (L10208) |
| `past_due` | Yes (grace, as today) | Creem retries the card; on success it goes back to `active` |
| `unpaid`, `paused`, `expired`, `canceled` | No | `canceled` is terminal in Creem (portal cancel is immediate). Polar's `canceled` meant "at period end", which is why today's code only drops on `revoked`. Copying that rule would keep cancelled users paid forever |

The version order uses `object.updated_at` with the same status-priority tiebreak as Polar.

### D5. Refunds and disputes take the credits back

This closes finding 3 of [`docs/research/security/2026-10-17-security-credits-billing-polar.md`](../../research/security/2026-10-17-security-credits-billing-polar.md)
for Creem purchases:

- `refund.created` (full or partial) and `dispute.created` look up the grant by `transaction.id`. They write one
  negative ledger row keyed `creem:refund:<tran>` (or `creem:dispute:<tran>`) for the credits that transaction granted,
  capped at the user's current balance so the balance never goes negative. A partial refund takes back credits in
  proportion to the amount refunded.
- `dispute.created` also logs a warning with the masked email, for manual review. No automatic ban: Creem refunds the
  dispute itself.

### D6. Replay guard

The signature has no timestamp. A captured body could therefore be replayed once its receipt is cleaned up (receipts
are deleted after 90 days, `cleanup` at `current.sql` L8707). The route refuses events whose envelope `created_at` is
older than 30 days, which is well past Creem's 24-hour retry window.

**Must verify (V2):** whether a manual dashboard resend keeps the original `created_at`. If it does, a resend after 30
days needs this cap raised by hand. That is acceptable, and the route logs it.

### D7. Checkout through our own API route

Add `POST /api/v1/billing/checkout { plan }` (through `withApi`, signed-in user, rate limited). It calls Creem with:

- `product_id` from `CREEM_PRODUCT_*`
- `request_id = <user id>:<random>`
- `metadata = { user_id }`
- `customer.email`
- `success_url = /app/billing?paid=1`

It returns `checkout_url`, and the billing page's Upgrade button posts to it. Use plain `fetch` with no SDK (the same
reasoning as `lib/polar.ts`: the money path stays readable).

The success redirect is only for UX. Credits come from the webhook, never from the redirect's query params.

### D8. Creem moderation sits in front of every generation prompt

`lib/generate/moderation.ts` gets a `screenWithCreem(prompt, externalId)` step that runs **before** our own LLM
check, and therefore before credits are held (product rule).

- `allow` → continue to our check.
- `flag` or `deny` → block with the existing `BLOCKED_MESSAGE` (Creem recommends blocking `flag` too).
- Creem unreachable → fail closed for image and video generation, with a retryable error. Text and audio jobs are out
  of scope for Creem (L23470) and skip this step.

**Must verify (V3):** the moderation call's price per unit and latency, in test mode.

## Environment

| Variable | Secret | Replaces |
|---|---|---|
| `CREEM_API_KEY` | Yes (server only) | (none) |
| `CREEM_WEBHOOK_SECRET` | Yes | `POLAR_WEBHOOK_SECRET` |
| `CREEM_PRODUCT_STARTER`, `CREEM_PRODUCT_CREATOR` | No | `POLAR_PRODUCT_*` |
| `CREEM_API_BASE` | No | (none). `https://test-api.creem.io` locally and in preview, `https://api.creem.io` in production |

`POLAR_CHECKOUT_*` goes away in phase 4. `POLAR_WEBHOOK_SECRET` and `POLAR_PRODUCT_*` stay until phase 5.

## Phases

Each phase is its own PR and ships green on its own. Order matters.

### Phase 0: account and catalogue (owner, no code)

- [ ] Create the Creem store and pass KYC. Use the same support email as `lib/site.ts` (`SUPPORT_EMAIL`).
- [ ] Create two products in **test mode**:
  - Monthly: $80, every month.
  - Annual: $720, every year.
  - Tax category `saas`, prices tax-exclusive (as today on Polar; confirm).
- [ ] Register the webhook endpoint `https://<domain>/api/webhooks/creem` for the events listed in phase 2. Store the
  secret.
- [ ] Count active Polar subscribers (`select count(*) from polar_subscriptions where status in ('active','past_due')`).
  The answer picks the cut-over path in phase 5.

### Phase 1: SQL (`supabase/migrations/2026110x_creem_billing.sql` + `supabase/tests/1xx_creem_billing.test.sql`)

Use the `supabase-migrations` skill. Never edit an applied migration.

- [ ] Create the tables `creem_customers`, `creem_transactions` (with `granted_credits` and `refunded_amount`),
  `creem_subscriptions` and `creem_webhook_receipts`, plus `profiles.creem_customer_id` (unique, partial). Enable RLS
  with no client policies, and add explicit grants (security follow-up 2026-10-21).
- [ ] Add `recompute_plan(p_user)` (D2). `process_polar_event` calls it instead of its inline query. That is a
  `create or replace` in the new migration, and its behaviour is unchanged for Polar-only users.
- [ ] Add `process_creem_event(p_event_id, p_event_type, p_event_at, p_object, p_plan, p_credits)`, following D3, D4
  and D5. Errors must be English strings (`raise exception 'Invalid billing event.'`).
- [ ] Update `account_is_paid()` to include the Creem tables. Add the receipt cleanup to the existing cleanup function.
- [ ] pgTAP tests:
  - First purchase in both event orders.
  - A redelivered event.
  - Two renewals, which give two grants.
  - `scheduled_cancel` still paid, then `canceled` makes it free.
  - Full and partial refund claw back credits, capped at the balance.
  - A dispute.
  - Email fallback when `metadata.user_id` is missing.
  - A non-uuid `metadata.user_id` does not raise.
  - Polar active + Creem canceled stays paid, and the reverse.
- [ ] Regenerate `supabase/schema/current.sql` with `scripts/dump-schema.sh`. Run `npm run db:reset && npm run db:test`.

### Phase 2: webhook (`apps/web/lib/creem.ts`, `apps/web/app/api/webhooks/creem/route.ts`)

- [ ] `lib/creem.ts` holds `verifySignature(body, header, secret)`, with a hex HMAC over the raw body and
  `timingSafeEqual`, and `parseEvent`.
- [ ] `lib/creem-signature.check.ts`, added to `check:contracts`. It is signed with the sample payload and secret from
  a real test-mode delivery, not with our own code, which is the lesson from Polar finding 1.
- [ ] The route copies the Polar route's guards: a 64 KB body cap measured in bytes, verify before parse, masked email
  in logs, 5xx on an unmapped product for money events, one RPC call. Add the 30-day `created_at` cap (D6).
- [ ] Handle `checkout.completed`, `subscription.paid`, `subscription.active`, `subscription.trialing`,
  `subscription.update`, `subscription.past_due`, `subscription.unpaid`, `subscription.paused`,
  `subscription.scheduled_cancel`, `subscription.canceled`, `subscription.expired`, `refund.created` and
  `dispute.created`. Anything else gets 200 and is ignored.
- [ ] Map plans by product id with `planByProductId`, which is provider-neutral once `pricing.ts` reads
  `CREEM_PRODUCT_*`. Keep the Polar ids in a separate `polarPlanByProductId` for the Polar route until phase 5.
- [ ] End-to-end: `creem listen --forward-to http://127.0.0.1:3000/api/webhooks/creem`, then buy each plan in test
  mode. Confirm the ledger row, `profiles.plan` and the receipt. Refund one in the dashboard and confirm the clawback.

### Phase 3: moderation gate (`apps/web/lib/generate/moderation.ts`)

This must be live in production **before** requesting Creem's review.

- [ ] Add `screenWithCreem` (D8), with a check file that uses a fake fetch for `allow`, `flag`, `deny` and timeout.
- [ ] Confirm every image or video path goes through `moderateText`: the generate route, the slash commands
  `/video`, `/broll` and `/animate`, and the MCP `generate_media` and `animate_video` tools.

### Phase 4: checkout, billing page, legal copy

- [ ] `POST /api/v1/billing/checkout` (D7). Add `POST /api/v1/billing/portal`, which returns a Creem portal link for a
  user with `creem_customer_id`.
- [ ] `lib/pricing.ts`:
  - Drop `checkoutUrl` and `checkoutUrlFor`. Plans carry `productId` from `CREEM_PRODUCT_*`.
  - `isPaidPlan` is unchanged.
  - Translate the Vietnamese comments you touch.
- [ ] `app/app/billing/page.tsx`:
  - The Upgrade button posts to the checkout route.
  - Add a "Manage subscription" button for Creem customers.
  - Show a `?paid=1` banner: "Payment received. Credits arrive within a minute."
  - Remove the "Coming soon" branch: if the product id is missing, the plan is hidden (product rule: don't ship
    "coming soon").
- [ ] Legal pages (`terms`, `privacy`, `refund`): replace "currently Polar" with "currently Creem". Footers keep the
  four legal links.
- [ ] `.env.example`, `apps/web/README.md` and `ARCHITECTURE.md`: replace the Polar setup with Creem. Edit
  `docs/architecture/*` only where it names Polar, and update the `.html` and `.md` twins together.

### Phase 5: cut over and retire Polar

- [ ] Request the Creem review. Switch production env to the live key and products, and smoke-test one real $80
  purchase (refund it afterwards and confirm the clawback).
- [ ] Remove `POLAR_CHECKOUT_*` from production so no new Polar sale is possible.
- [ ] **If phase 0 counted zero active Polar subscribers:** remove the Polar webhook route, `lib/polar*.ts` and
  `check:polar` after 60 days. That is Creem's and Polar's refund window, so any late `order.refunded` is still
  recorded. Keep the Polar tables, as history for `account_is_paid`.
- [ ] **If there are active Polar subscribers:** leave them on Polar. Do not cancel them for them, because a forced
  re-checkout loses some of them. The Polar webhook stays until the last one ends, then the same removal as above.
  Revisit at 90 days.

## Out of scope (noted, not in these PRs)

- **Annual plan credits.** `pricing.ts` says the annual plan gets 400 credits for the whole year. Creem's
  `subscription.paid` also fires once a year, so switching providers does not fix this. It needs a monthly grant job:
  one ledger row per month of an active annual period, keyed `creem:<sub>:<period-month>`. This is a **blocker for
  selling the annual plan**, so it should be its own plan right after phase 2.
- **Usage-based overage** (roadmap ES.1). Creem has meters and customer credits (L14343, L18558). We keep our own
  credit ledger as the source of truth and do not mirror it into Creem.
- **Creem affiliates and referral program** (L12046, L16151). Growth work. It comes after the editor sells (Strategy
  in `CLAUDE.md`).

## Verification list (do these in test mode before writing phase 1)

| # | Question | Why it matters |
|---|---|---|
| V1 | Does `subscription.paid` fire on the first charge, and can it arrive before `checkout.completed`? | D3, whether the grant can double or be missed |
| V2 | Does a dashboard resend keep the original `created_at`? | D6, the replay cap |
| V3 | What do moderation calls cost and how slow are they? | D8, the cost per generation, and timeout tuning |
| V4 | Does `metadata` from the checkout appear on **every** later subscription event (`update`, `canceled`, `expired`)? | D1, matching without email |
| V5 | Is the webhook secret used as a raw UTF-8 key? Check against a real delivery | Polar finding 1, which must not happen twice |
