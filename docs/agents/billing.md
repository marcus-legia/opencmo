# Billing

Moved verbatim from `CLAUDE.md` on 2026-11-20.

## Billing (owner, 2026-11-04)

The plan is [`docs/plans/billing/2026-11-04-polar-to-creem-plan.md`](docs/plans/billing/2026-11-04-polar-to-creem-plan.md),
and Creem's docs are in `docs/creem-llm.txt`.

- **Creem is the only payment provider (merchant of record).** Polar was removed on 2026-11-05: code, tables and env. Do
  not bring it back.
- **Payment model: a subscription plus one-time credit packs.** No usage-based (pay-as-you-go) billing, and no Creem
  meters, credit wallets or auto-refill. Our credit ledger is the only balance. Creem only collects money and reports
  that it was paid.
- **Packs are sold only to paid users,** and a pack's credit costs more than a plan's.
- **Prices are tested in production.**
  - Price and credits per product live in the billing catalogue (data), not in code or copy.
  - Pages read displayed prices from the catalogue. Never hardcode a price on the landing page or in docs.
  - A price test adds a new Creem product. It never deletes a product id someone still holds, because their renewals
    would stop getting credits.
- **Credits are granted once per payment.** Subscriptions grant on `subscription.paid`, keyed by transaction. Packs
  grant on `checkout.completed`, keyed by order. A refund or dispute takes back the credits of that payment.
- **Every image or video generation prompt goes through the Creem Moderation API**, and only through it (no check of
  our own on prompts, D8). This is a Creem requirement for AI generation products: without it the account can be
  suspended.
- **Creem's account review decides what we may sell** (`docs/creem-llm.txt`, "Account Reviews" and "AI Wrapper
  Compliance"; read 2026-11-16). A **Rejected** store is final, with no re-review; only "Changes requested" can be
  fixed and resubmitted. So check a feature or a landing claim against these lists before building or writing it:
  - **Prohibited:** "Online traffic and engagement services" (why we never auto-like, follow, comment, reply or run
    several accounts), "Third-party content downloaders", "Face-swap, deepfake, and face-manipulation tools".
  - **Restricted** (needs a previous processor's history, chargeback rate and "an established and proven track record"):
    "Services of any kind, including … marketing", and "Generative AI products … text-to-image and text-to-video". A new
    store has no track record, so the landing page sells the software (drafts, approvals, scheduling, the editor), not
    a done-for-you service, and AI image/video generation is never the headline feature.
  - **Review checklist:** the product is live, no fake reviews or inflated user counts, pricing visible, Terms and
    Privacy reachable, the support email on the site matches the one in Creem, AI generation has the Moderation API
    and an Acceptable Use Policy. Creem may make a test purchase with a 100% discount code, so sign-up → pay → use
    must work for real; the site must be reachable during review (no Cloudflare bot challenge, password or
    maintenance page).
  - Creem reviews **our** product, not our customers' niches: a customer in health or finance is a content-moderation
    question, not a Creem one.
  - Creem has a built-in **Affiliate Program**; use it before adding an outside affiliate tool.
