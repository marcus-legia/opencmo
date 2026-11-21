# Product rules

`CLAUDE.md` keeps the one-line version of each. Each rule is an owner decision; do not change one without the owner.

- **Assist, never act.** Anything that goes out (a reply, a DM, an email, a post) runs only after the founder approves
  it, on their own account. Never add automatic liking, following, commenting, several accounts or fake engagement.
  Sales has no send button: the founder opens the conversation and sends the draft themselves.
- **Autopilot is the one exception, and it is narrow** (2026-11-12). A founder may turn it on per platform (X,
  Threads, LinkedIn) for single posts on an account they connected: the card says when it goes out, they can edit or
  skip it until then (6, 12 or 24 hours), and an untouched card is approved for them. Off by default, paid plans only.
  It never covers a reply, a DM, an email, a thread, a video, a brief the founder wrote in the chat, or anything that
  spends credits beyond the draft; three skips in a row turn it off. The top bar's switch turns it off whole
  (`set_autopilot_paused`). The approval runs through the founder's own `approval_decide` (`approval_auto_decide`),
  never a second path. Do not widen it.
- **Posts** (2026-11-12). The founder's week plan decides the platforms and counts; Ferreto writes what it asks,
  nothing more. **One core post serves every platform of its slot**; a rewrite for one platform is an optional paid
  button, never the default. X takes long posts (X Premium) and autopilot may post them; a Threads chain is a thread
  and stays out of autopilot. A post can carry the founder's own photos. Facebook posts go to a **Page**; a personal
  profile gets copy-and-open, since Meta's API cannot post there.
- **Video must be the founder's own.** Upload is the only way in. No link import and no clipping tool that pulls
  outside video (removed 2026-10-20: payment providers forbid clipping tools and content downloaders). Short clips are
  cut only from a video already finished in the founder's editor. The founder makes the videos; Ferreto never builds
  one on its own.
- **Moderation is Creem's** (2026-11-05). Every image and video prompt is screened by Creem's Moderation API (`flag`
  blocks like `deny`) before credits are held. No prompt check or content policy of our own; the one LLM step reviews
  the finished image or frames (Haiku vision and fal NSFW) against Creem's rules quoted as they are
  (`packages/contracts/creem-policy.json`). Creem forbids NSFW and suggestive content, face-swap, deepfake and
  face-manipulation tools, and "uncensored / no filter" marketing: premade voices only, no cloning, dubbing or
  lip-sync.
- **Charge before running, then run in one go** (2026-11-05). A paid job shows its plan and one credit estimate that
  covers everything it will spend (media, renders, the agents' tokens). The founder confirms once, the credits are
  held, and the job runs to the end without another approval. No paid step runs before that confirmation; credits come
  back only for what failed or was blocked.
- **One model provider: Claude** (2026-11-05). Sonnet for every agent that writes or plans (Sales drafts, Post, the
  chat, the editor Assistant); Haiku for small tasks (checks, picks, translation, moderation review). No other LLM
  vendor without the owner (`.claude/skills/llm-provider-keys`).
- **Every word a person reads or hears goes through no-ai-slop** (2026-11-05): replies, DMs, emails, posts, captions,
  titles, plans, on-screen text. A new prompt that writes for a reader embeds `NO_AI_SLOP` and is added to
  `lib/cmo/skills/no-ai-slop.check.ts`.
- **Copy describes software, not a service**: "drafts you approve and send", not "we grow your audience". No "AI CMO",
  "in your voice" or "marketing team"; no model names (Claude, Veo, ElevenLabs…) as features.
- **Don't ship "coming soon"**: anything on the landing page must work.
