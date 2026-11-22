# Strategy (owner decisions)

The source is the internal repo: `opencmo-internal/research/0_writing/Strategy_opencmo/12 Ket luan du an.md` (customer,
product, price, marketing) wins when this page disagrees; landing copy comes from `13 Landing page content.md`. Open
work is in `opencmo-internal/docs/cmo/2026-11-20-viec-truoc-launch.md`. Launch: 2026-11-30.

## Sales leads, for one customer (2026-11-17/18)

**Sales is the spearhead.** Rank work by one question: does a new founder find and reach the people asking?

- **One ICP:** solo founders (or teams of 2–3) selling B2B or prosumer SaaS to people who work online, English
  market, product and landing live, 0–$10k MRR, looking for their first 10–100 customers. The test: do their
  customers write their problem down on Reddit, HN, Threads or Facebook groups? Not for: B2C or iOS apps, coaches,
  offline trades, founders without a product, enterprise sales.
- **The core loop:** understand the business → find people (many sources) → reach out (a public reply, a DM or an
  email draft, always sent by the founder) → follow up and track each person (contacted → replied → call → customer)
  → learn (their pains feed the posts) → a weekly report on that funnel. Measure people and conversations, not posts
  and views.
- **Free tier = one real scan:** a few cards with the thread's own words as proof; reply drafts after a plan. The
  paywall sits where the value is seen, never before it.
- **Price:** one plan, **$69/month**, with a cheaper annual plan; credits for the AI work, read from
  `billing_catalog`. No per-lead pricing, no lifetime deal. A price test is a new Creem product.
- **Category:** software (SaaS) to Creem; "signal-based customer finding" in the market; "a customer-finding tool for
  founders" in copy. Not "AI CMO", not "Reddit monitoring", not a video tool.
- **Never:** sending anything automatically (replies, DMs, emails), several accounts, scraping Product Hunt or
  anyone's email list, bulk email infrastructure, UGC or AI avatars, autopilot for replies.
- **Copy:** no "in your voice" (say "built from your business plan" or "using what it knows about your product");
  never "every day" for scans (they run on the founder's cadence or on request); name only the platforms the scan
  really reads.
- **B2B channels only:** posts go to X, LinkedIn and Threads. TikTok, Instagram, slideshows, carousels, the photo-post
  page and the CMO's video scripts were deleted in wave 4b: do not bring them back. Photos attach to a post on the
  Post tab. The editor stays for videos the founder makes on their own.

## The app

- **Layout:** top tabs Feed · Sales · Post · Analytics · Editor ↗ (design: https://claude.ai/artifact/H7VT5UZAqnxDbVSrqEBFHZ).
  Every Sales scan saves what people said to the Library; Post writes only from it, citing a summary of each source
  conversation. Research shows competitors; finding new ones happens when the founder asks in Research's chat.
- **Domains:** the app at `ferreto.io/app`; a tool that opens on its own gets a subdomain: the blog at
  `blog.ferreto.io` (`lib/site.ts` `blogUrl`); the editor moves to `editor.ferreto.io` (today `/app/studio`, opened
  in a new tab). Moving one needs the Supabase session cookie on `.ferreto.io` and the subdomain in Supabase's
  redirect URLs. `opencmo.io` is no longer served (removed 2026-11-22).
