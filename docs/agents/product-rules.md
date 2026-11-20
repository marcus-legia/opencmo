# Product rules

Moved verbatim from `CLAUDE.md` on 2026-11-20; `CLAUDE.md` keeps the one-line version of each.

## Product rules

- **Assist, never act.** Anything that goes out (posts, replies) runs only after the user
  approves it, on their own account. Never add automatic liking, following, commenting,
  multiple accounts or fake engagement. Sales has no post button.
- **Autopilot is the one exception, and it is narrow** (owner, 2026-11-12). A founder may turn it on per platform
  (X, Threads, LinkedIn) for single posts on an account they connected: the post's card says when it goes out, they
  can edit or skip it until then (6, 12 or 24 hours), and an untouched card is approved for them. Off by default,
  paid plans only. It never covers Reddit or any other reply, threads, videos, a brief the founder wrote in the chat,
  or anything that spends credits beyond the draft; three skips in a row turn it off. The top bar's switch turns it
  off whole (`set_autopilot_paused`, 2026-11-13): every countdown stops, the platforms are kept for the way back. The approval runs through the
  founder's own `approval_decide` (`approval_auto_decide`), never a second path. Do not widen it without the owner.
- **Video must be the user's own.** Upload is the only way in. There is no link import and no
  clipping tool that pulls from outside video (removed 2026-10-20: payment providers forbid
  clipping tools and content downloaders); do not bring either back.
- **Clips are cut from finished edits** (owner, 2026-10-22). A clip is a short video cut from a
  video already edited or generated in the OpenCMO editor, then scheduled by Post. The source is
  always a finished edit in the user's project, never a link, a raw third-party video or another
  creator's content. Market it as "cut short clips from your finished video", not as a clipping
  tool.
- **Moderation is Creem's** (owner, 2026-11-05). Every image and video prompt is screened by Creem's Moderation
  API (`flag` blocks like `deny`) before credits are held. We run no LLM prompt check and write no content policy
  of our own; the one LLM step is a review of the finished image or frames before the user gets it (Haiku vision
  and fal NSFW), against Creem's rules quoted as they are (`packages/contracts/creem-policy.json`). Creem forbids NSFW and sexually suggestive content,
  face-swap, deepfake and face-manipulation tools, and "uncensored / no filter" marketing, so: premade voices
  only, no cloning, dubbing or lip-sync. Spec: `docs/plans/cmo/2026-11-05-agent-team-models-moderation-spec.md`.
- **Daily core drafts** (owner, 2026-11-12; plan `docs/plans/cmo/2026-11-12-daily-core-drafts-plan.md`). The founder's
  planner decides the platforms and counts; the CMO writes what it asks, nothing more (D2). The core is a text post of
  real quality, and for video a script and its caption the founder records from (D1). **One core post serves every
  platform of its slot**; a rewrite for one platform is an optional paid button, never the default (D3). X takes long
  posts (X Premium) and autopilot may post them; a Threads chain is a thread and stays out of autopilot (D6). A
  carousel or slideshow is photos the founder uploads (TikTok Photo Mode, Instagram carousel), **never a video**, made
  on its own page (photos + caption); the CMO writes only its caption (D7). **The founder's own video goes out one
  card per platform** (owner, 2026-11-13): no card for the video itself; each platform's schedule card shows the video,
  its caption (editable) and its time, and approving it approves both. With no connected account the card gives the
  video to download and the caption to copy. **A text post takes the founder's own photos
  on its card** (owner, 2026-11-13): that is part of the post, not of the slideshow page. Facebook posts to a **Page**; a
  personal profile gets copy-and-open, since Meta's API cannot post there (D9).
- **Charge before running, then run in one go** (owner, 2026-11-05). A paid job shows its storyboard (or plan)
  and one credit estimate that covers everything it will spend: media, voice, music, renders and the agents'
  tokens. The user confirms once, the credits are held, and the job runs to the end without stopping for another
  approval. No paid step (keyframes, explainer previews, model calls) runs before that confirmation; credits come
  back only for what failed or was blocked.
- **One model provider: Claude** (owner, 2026-11-05). Sonnet for the CMO chat, the Editor Assistant and every
  agent that writes or plans; Haiku for small tasks (checker, translation, picks, moderation). No Gemini, Groq or
  other LLM vendor without the owner (`.claude/skills/llm-provider-keys`).
- **Every word a person reads or hears goes through no-ai-slop** (owner, 2026-11-05): scripts, voice-overs,
  storyboards, on-screen text, posts, captions, titles, plans, replies. A new prompt that writes for a reader
  embeds `NO_AI_SLOP` and is added to `lib/cmo/skills/no-ai-slop.check.ts`.
- **Copy describes software, not a service**: "drafts you approve and publish", not "we grow
  your audience". Don't market model names (Gemini, Veo, ElevenLabs…) as features.
- **Don't ship "coming soon"**: anything on the landing page must work.
