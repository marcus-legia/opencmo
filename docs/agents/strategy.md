# Strategy (owner decisions)

Moved verbatim from `CLAUDE.md` on 2026-11-20; `CLAUDE.md` keeps the summary. The 2026-11-17/18 section is current; the 2026-11-08 section is the history it narrows.

## Strategy: Sales leads, for one customer (owner decisions, 2026-11-17/18)

This narrows the 2026-11-08 section below: the CMO loop stays, but **Sales is the spearhead** and work is ranked by
whether a new founder finds and reaches the people asking. Research and reasoning live in the internal repo
(`opencmo-internal/research/0_writing/Strategy_opencmo/12 Ket luan du an.md`, landing copy in `13 Landing page
content.md`); the gap between that and the code is `opencmo-internal/docs/cmo/2026-11-18-ra-soat-tinh-nang.md`.

- **One ICP:** solo founders (or teams of 2–3) selling B2B or prosumer SaaS to people who work online, English
  market, product and landing live, 0–$10k MRR, looking for their first 10–100 customers. The test: do their
  customers write their problem down on Reddit, HN, Threads or Facebook groups? Not for: B2C or iOS apps, coaches,
  offline trades, founders without a product, enterprise sales.
- **The core loop to build toward:** understand the business → find people (many sources) → reach out (a public
  reply now; DM and email drafts later, always sent by the founder) → follow up and track each person (contacted →
  replied back → call → customer) → learn (their pains feed the posts) → a weekly report on that funnel. Measure
  people and conversations, not posts and views.
- **Free tier = one real scan:** a few cards with the thread's own words as proof; reply drafts after a plan. The
  paywall sits where the value is seen, never before it. Plan: `docs/plans/cmo/2026-11-18-free-scan-plan.md`.
- **Price:** one plan, **$69/month** with a cheaper annual plan; credits for the AI work, read from
  `billing_catalog`. No per-lead pricing, no lifetime deal. Test another price as a new Creem product.
- **Category:** software (SaaS) to Creem; "signal-based customer finding" in the market; "a customer-finding tool for
  founders" in copy. Not "AI CMO autopilot", not "Reddit monitoring", not a video tool.
- **Never:** sending anything automatically (replies, DMs, emails), several accounts, scraping Product Hunt or
  anyone's email list, bulk email infrastructure, UGC or AI avatars, autopilot for replies.
- **Copy:** no "in your voice" (say "built from your business plan" or "using what it knows about your product");
  never "every day" for scans (they run when the week plan asks or on request); name only the platforms the scan
  really reads.
- **B2B channels only** (owner, 2026-11-18): posts go to X, LinkedIn and Threads. TikTok and Instagram, slideshows
  and carousels, the photo-post page (`/app/photos`) and the CMO's video scripts (`write_video_brief`, the script item,
  `/app/script`) are for a different customer and are being removed: do not build on them. The editor stays, opened
  from the top bar, for videos the founder makes on their own. Photos attach to a post on the Post tab.
- **App layout** (owner, 2026-11-18; design: https://claude.ai/artifact/H7VT5UZAqnxDbVSrqEBFHZ): top tabs Feed · Sales ·
  Post · Calendar · Analytics · Editor ↗. No Agents block (Planner lives in the documents, Publisher in Calendar,
  Studio becomes "make an image" in Post, low priority because it costs credits). Every Sales scan saves what people
  said to the Library; Post writes only from it, citing a summary of each source conversation. Research only shows
  competitors; finding new ones happens when the founder asks in Research's chat (Lurk, like Sales).
- **Subdomains** (owner, 2026-11-18; the blog moved in PR #246): the app lives at `ferreto.io/app`; tools that open on their own go on a
  subdomain of ferreto.io: the editor at `editor.ferreto.io` (opened in a new tab from the app's top bar), the blog
  at `blog.ferreto.io`. A new standalone surface gets `<name>.ferreto.io`, not a path. Moving one needs the Supabase
  session cookie shared across subdomains (cookie domain `.ferreto.io`) and the subdomain in Supabase's redirect URLs.
- **Next, from the review** (done by 2026-11-20; open work is in `../opencmo-internal/docs/cmo/2026-11-20-viec-truoc-launch.md`): free scan (group A, in progress) → the week plan and Today around Sales, a scan cadence
  of its own → the digest email leads with people asking → clean what Creem's reviewer clicks (landing links that
  404, "not available yet") → measure scan quality on real products before marketing.

## Strategy: the AI CMO first, the editor last (owner decision, 2026-11-08)

> History. Narrowed by the section above; slideshows, post images and video scripts named here were deleted in wave 4b.

This replaces "the editor is the spearhead" (2026-10-19). After testing, the owner found the editor too complex and
too expensive to lead. The AI CMO makes value at a small cost, so it leads.

- **The product follows the CMO loop, in this order:** business information (the website, the four documents) →
  Writer (week plan, posts, video scripts with captions and storyboards) → approval → Video (slideshow, post image, short
  clips from a finished edit, with the Brand Kit) → approval → Post (schedule and publish, captions and hashtags).
  Words are written before anything is built from them. The editor is the last step, where the founder fine-tunes
  by hand; it is not the entry point.
- **The founder makes the videos** (owner, 2026-11-09). For a video the CMO writes the script and the storyboard and
  waits for the founder's OK; the founder then makes the video in the editor. The CMO never builds a video on its own
  (no `build_video` from the week plan, an event rule or the CMO chat). Slideshows, post images and posts are the CMO's.
- **Rank work by one question first:** does it make that loop work for a paying founder, end to end? Editor work comes
  after, unless the owner says otherwise.
- **`/video` is hidden for now.** The full AI video (`/video`, `create_video`) is hidden from the web app, the landing
  page and the week plan; the code, the MCP tool and the evals stay. The editor and every other slash command
  (`apps/web/lib/agent/slash.ts`: `/animate`, `/broll`, `/edit`, `/background`…) stay as they are.
- The plan is [`docs/plans/cmo/2026-11-08-cmo-review-2-plan.md`](docs/plans/cmo/2026-11-08-cmo-review-2-plan.md) §2.
  The old editor roadmap ([`docs/plans/editor/2026-10-19-editor-spearhead-roadmap.md`](docs/plans/editor/2026-10-19-editor-spearhead-roadmap.md))
  is a record, not the order of work. Each item still gets its own research and plan before it is built.
