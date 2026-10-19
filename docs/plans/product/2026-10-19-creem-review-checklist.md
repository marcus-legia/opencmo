# Checklist: before submitting the Creem account review (2026-10-19)

Track: product · Source: `docs/creem-llm.txt` (Account Reviews, AI Wrapper Compliance, Moderation API)

The owner chose Creem as the payment provider. Creem reviews only a product that is live and complete, and the
reviewer may make a test purchase and use the product at any time after submission. A **Rejected** outcome is final
for the store (no re-review), so every line below must be true **before** pressing **Balance → Payout Account → Set up
Payout Account**, not after.

Owner decision: finish and test the product first (PR #84), then switch the link path off, then submit.

## Product

- [ ] **YouTube link import hidden in production.** Upload is the main path. Creem prohibits "third-party content
  downloaders and rippers that violate platform Terms of Service"; the "Is this your YouTube video?" checkbox is
  self-attestation, and a reviewer who pastes someone else's link and gets clips would reject the store. Keep the code
  behind a flag; turn it back on only after Creem support confirms in writing (with OAuth channel-ownership check).
- [ ] Upload screen tells users how to get their own file: "Download it from YouTube Studio, then drop it here".
- [ ] Every feature on the landing page works end to end (no "coming soon"; Beta badges are fine).
- [ ] Users can cancel their subscription inside the app (Cancel Subscription API or the Creem Customer Portal).

## Website

- [ ] Privacy Policy, Terms of Service and Acceptable Use Policy (`app/(legal)/`) load without signing in.
- [ ] AUP and ToS explicitly prohibit NSFW, sexually suggestive and harmful content generation, deepfakes, face-swap
  and real-person likeness.
- [ ] Pricing is visible and easy to find.
- [ ] No testimonials, reviews or user counts that are not real.
- [ ] Copy never says "clip any video", "clip any YouTube video", "any podcast", "uncensored", "no filter", "NSFW".
- [ ] Copy describes software for the user's own videos; AI B-roll is a secondary feature. No model names (Veo,
  Gemini, ElevenLabs…) as features; if a model is named anywhere, add a "not affiliated with" line.
- [ ] No gallery or showcase content that is suggestive or borderline.
- [ ] Site is reachable by the reviewer: no password, maintenance mode or bot wall.

## Creem settings

- [ ] Support email in **Settings → Business Details** is exactly `SUPPORT_EMAIL` (`apps/web/lib/site.ts`,
  `support@opencmo.io`), and the same address is on the website, inside the dashboard and on receipts.
- [ ] One store per website (opencmo.io only).
- [ ] Products recreated in live mode (test mode products do not carry over).
- [ ] Business description: video editing software for the user's own videos, with optional AI-generated B-roll that
  is moderated; no real people, no face-swap, no voice cloning.

## AI generation (only if image/video generation is enabled in production)

- [ ] Every image/video prompt is screened with Creem `POST /v1/moderation/prompt` **in production**, before credits
  are held. Block on `deny` and on `flag`; fail closed if the call errors. Keep our own moderation layers as well.
- [ ] Generated images and video frames still go through `opencmo/ai/moderation.py` before upload.

## After submission

- Answer customer requests within 3 business days, or Creem may refund on our behalf.
- On **Changes requested**: fix, then **Request re-review** on Balance → Payout Account. Keep the Store ID (`sto_…`)
  handy for support.
