# Implementation plans — Billing

Payments, credits and plans. Money only moves through `credit_hold` / `credit_settle` / `credit_refund` /
`credit_held` (see `CLAUDE.md`, web rule 5).

Newest first.

| Date | Plan | Source | PR |
|---|---|---|---|
| 2026-11-04 | [Move payments from Polar to Creem](2026-11-04-polar-to-creem-plan.md) | Owner decision; `docs/creem-llm.txt`; `docs/research/security/2026-10-17-security-credits-billing-polar.md` | branch `creem-payment` |
