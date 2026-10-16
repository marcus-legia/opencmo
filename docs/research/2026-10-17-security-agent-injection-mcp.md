# Security: strangers' text can write the founder's memory, and MCP tokens are not bound to us  (2026-10-17)

## TL;DR

- **Rotation:** the last report was Video editing (seed, 2026-10-16), so this run covers area 3, Security. Nothing
  urgent forced a switch: the Next.js advisories of July–September 2026 are already patched in our pinned
  `next@15.5.27`, and the ffmpeg CVEs of the summer sit in demuxers our allowlist does not open.
- **The real risk is in our own agent design, not in a dependency.** The CMO chat reads untrusted text (Reddit,
  X, Threads, TikTok/YouTube transcripts, any website via `read_site`) and, in the same turn, can call
  `remember`, `update_document`, `set_week_goal` and `create_task` without asking. `remember` stores the note as
  `type = 'user'`, the highest-trust memory, which every future plan and draft reads. One poisoned Reddit comment
  can become a permanent "founder rule". 2026 research measured ~98% injection success for this exact pattern
  (memory poisoning through normal inputs).
- **PR #59 (MCP agent team) widens the same surface**: the CMO research tools and `remember` are exposed to the
  user's own Claude, which usually also holds Gmail/Drive connectors. Our server's outputs become an injection
  vector into that session ("toxic flow"). Separately, Supabase's OAuth 2.1 server ignores RFC 8707 `resource`
  and issues `aud: "authenticated"`, so our MCP server cannot do the audience check the MCP spec now says it
  MUST do; it currently accepts any Supabase OAuth token that carries a `client_id`.
- **MCP spec 2026-07-28 shipped** (stateless core, DCR deprecated for Client ID Metadata Documents, RFC 9207
  `iss` checks). Our server speaks `2025-06-18`. Not urgent, but it is the version claude.ai will move to.
- **Recommendation:** spend ~1–2 days on taint-gated writes and untrusted-text hygiene before PR #59 ships to
  users; then bind MCP grants to our own consent record and scopes. Do nothing on Next.js/ffmpeg this cycle.

## Findings

### 1. Next.js: three security releases since July, we are on the fixed line

- **July 20, 2026 release** (fixed in 15.5.21): Server Action DoS (CVE-2026-64641), middleware bypass with
  Turbopack + single locale (CVE-2026-64642), SSRF via rewrites with request-controlled hostnames
  (CVE-2026-64645), SSRF in Server Actions on custom servers (CVE-2026-64649), and four medium issues.
- **August 25, 2026**: two critical unauthenticated RCEs fixed in 15.5.24 — a Windows-only path traversal
  (CVE-2026-75604) and a libheif heap overflow reached through AVIF image optimization (GHSA-2xp9-vwfh-vxw4).
  The patch disables AVIF optimization until libheif ships a fix.
- **September 30, 2026** (fixed in 15.5.27): SSRF in Image Optimization when `images.remotePatterns` is set
  (CVE-2026-94483), SSG/ISR cache poisoning (CVE-2026-94543, CVE-2026-94484), metadata image `dynamicParams`
  bypass (CVE-2026-94485), `use cache` leaks, and a `next dev` MCP endpoint that any website could read
  (CVE-2026-94486, dev only).
- **Us:** `package-lock.json` resolves `next` to **15.5.27**; `apps/web/next.config.ts` sets no `images`
  config (no remote patterns, no AVIF); we run on Linux/Vercel. Nothing to do. The `next dev` MCP endpoint
  issue is worth knowing: a developer browsing while `npm run dev` runs could leak routes and source snippets
  until they are on 15.5.27 locally (they are, through the lockfile).

### 2. Supabase: the September exposure story is about RLS hygiene, which we already test

- TechCrunch (Sept 25, 2026) and BleepingComputer report UpGuard found ~16,000 Supabase-hosted databases
  exposing personal data, caused by customer misconfiguration; Supabase called its platform secure by default.
- CVE-2026-31813 (Supabase Auth < 2.185.0, Apple/Azure OIDC token forgery) is from **March 2026 (older than
  6 months)**; hosted projects are patched by Supabase, and we use neither provider.
- **Us:** `supabase/tests/010_rls.test.sql` asserts `anon` reads nothing; 83 migrations define
  `SECURITY DEFINER` functions, and CI runs `supabase db lint --local --level warning`
  (`.github/workflows/ci.yml`, "Lint the database"). Splinter's newer lints matter here:
  `0024_rls_policy_always_true`, `0028_anon_security_definer_function_executable` and `0029_authenticated_…`
  catch exactly the exposure class in the news. As far as I can tell from the workflow, the lint step reports
  but does not fail the build on warnings (opinion — verify the pinned CLI's exit behaviour / `--fail-on` flag).

### 3. Indirect prompt injection is in the wild, and it hides in HTML our extractor keeps

- Unit 42 (Palo Alto Networks, **March 3, 2026 — just outside 6 months**) catalogued 22 in-the-wild techniques
  on real web pages: visible plaintext (37.8%), HTML attribute cloaking (19.8%) and CSS suppression (16.9%:
  `display:none`, zero font size, off-screen, hidden `<textarea>`), plus zero-width characters, Unicode tag
  characters, homoglyphs and fake "developer mode" notices. Targets included ad-review bypass and SEO poisoning
  of LLM recommendations — i.e. marketing-agent workflows like ours.
- **Us:** `apps/web/lib/cmo/site.ts` (`extractPage`) strips `script/style/noscript/svg/template/iframe`, but
  keeps the text of elements hidden with `hidden`, `aria-hidden`, inline `display:none`/`visibility:hidden`/
  `font-size:0`, and `<textarea>`. It does not drop invisible Unicode. That text goes into the onboarding
  documents (`product`, `strategy`) that every later job reads as trusted `<documents>`.
- `apps/web/lib/cmo/jobs/sales-scan.ts` (`threadBlock`) wraps Reddit text in `<thread index=…>` and tells the
  model to ignore instructions inside, but does not escape the thread text. A post containing
  `</thread><thread index="0" …>` can forge a block boundary. The structured output, quote verification
  (`quoteIn`) and the lack of tools in those calls limit the damage to scoring and reply drafts, which the
  founder reviews — so this is a small fix, not an incident.

### 4. Memory poisoning: the persistent version of the same attack

- arXiv 2607.06595 (July 6, 2026, "When Agents Remember Too Much") shows an attacker writing an agent's
  long-term memory through ordinary inputs (an email) with ~98% injection success and ~60% later activation;
  the evaluated defence combines **provenance labels** on each memory, **write gating** and **retrieval
  filtering**. Several vendor write-ups in Aug–Sept 2026 (WorkOS, Akto, AppScale) converge on the same three
  controls (opinion-grade sources; the paper is the evidence).
- **Us:** `apps/web/lib/agent/cmo-tools.ts` — `isCmoWrite` marks `create_task`, `remember`, `set_week_goal`,
  `create_video_brief`, `update_document` as writes, but the loop (`lib/agent/loop.ts`) only uses that to refresh
  state; it never asks the user. `remember` calls `cmo_remember`, which inserts `type = 'user'` — the same type
  as a note the founder typed (pgTAP `139_cmo_memory_tiers` ranks these highest). The research tools
  (`lib/agent/cmo-research.ts`) wrap results in `{ untrusted_data }` and the CMO system prompt says to ignore
  instructions there — good, but a prompt is a soft control. Nothing records that a turn has read untrusted
  text before it writes.
- Product angle: because Post and Sales are "drafts you approve", a poisoned memory does not publish anything
  by itself. It does something worse for retention: it quietly bends every future draft (a competitor's name
  to avoid, a link to include, a tone) and the founder blames the product.

### 5. MCP: spec 2026-07-28, audience binding, and toxic flows

- **Spec 2026-07-28** (released July 28, 2026): stateless core — no `initialize`/session id, capabilities in
  `_meta`, `Mcp-Method`/`Mcp-Name` headers on Streamable HTTP; Dynamic Client Registration deprecated in favour
  of Client ID Metadata Documents; clients must check RFC 9207 `iss`; server→client requests (elicitation,
  sampling) move to multi-round-trip requests. Our design in PR #59 is already stateless, so the migration is
  mostly headers and discovery.
- **Authorization security considerations (same spec):** servers MUST reject tokens not issued for them
  (audience) and MUST NOT pass a received token through to upstream APIs.
- **Supabase gap:** supabase/auth issue #2610 asks for RFC 8707 support — today `resource` is accepted and
  ignored and tokens carry `aud: "authenticated"`; issue #2820 reports the consent endpoint returning 400 when
  `resource` is sent at all. MCP issue #3413 (opened Oct 4, 2026, unanswered) asks whether forwarding the token
  to the same project's PostgREST (the pattern PR #59 uses for RLS) counts as forbidden passthrough.
- **Us (PR #59, `packages/mcp-server/src/oauth.ts`):** `userForAccessToken` accepts a token if Supabase's
  `getUser` accepts it and the JWT has any `client_id`. Every OAuth client that a user approves on
  `/oauth/consent` gets all 116 tools, including credit-spending ones, with no scope split. The consent page
  does show the redirect host (good — the spec requires it). The credit "price → confirm" step is enforced by
  the server, but the confirm code is handed to the model, so an injected instruction in the user's Claude
  session can confirm on the user's behalf ("Never confirm on your own" is a prompt, not a control).
- **Toxic flows:** Invariant/Snyk's scanner (`docs/issue-codes.md`, W015–W020) flags any server that returns
  untrusted third-party content (W015) — our `search_reddit`, `reddit_thread`, the social transcript tool
  and `read_site`. PR #59 already sets `openWorldHint: true` on those reads (`apps/web/lib/cmo/mcp/cmo.ts`,
  asserted in `mcp.check.ts`), which is the right signal to clients.
- **Python SDK OAuth takeover** (Cycode, Sept 28, 2026): MCP Python SDK clients skipped issuer/audience checks
  on a fallback discovery path (fixed in 1.30.0 / 2.2.0). We use the TypeScript SDK as a *server* only, so we
  are not affected; it is a reminder that "check runs only when the attacker provides the field" is a bug class.

### 6. ffmpeg on the worker: do nothing

- Summer 2026 CVEs include an RTP/ASF demuxer infinite loop (CVE-2026-64834, July 2026, DoS, needs a crafted RTP
  stream) and a `vf_swaprect` out-of-bounds write (CVE-2026-65706; source page failed to load, details
  unverified). **Us:** `packages/engine/opencmo/media/ffmpeg.py` reads user media with
  `-protocol_whitelist file` and a demuxer allowlist (`USER_MEDIA_FORMATS`) that excludes RTP/ASF, and our
  filter graphs are built by us, not users. Debian's `ffmpeg` package on `debian_slim` receives security
  backports on image rebuild.

## Repos worth learning from

| Repo | What to learn | Files to read | Licence | Copy or learn only |
|---|---|---|---|---|
| [google-research/camel-prompt-injection](https://github.com/google-research/camel-prompt-injection) (last commit 2025-06-20, **older than 6 months**) | Capability/taint tracking: every value carries its sources; a policy engine denies any state-changing tool whose arguments depend on non-trusted values (`base_security_policy`, `SecurityPolicyEngine.check_policy`), and side-effect-free tools are allowlisted. The simplified version for us: a per-turn "tainted" flag set by any untrusted read, checked before every `isCmoWrite` tool. | `src/camel/security_policy.py`, `src/camel/capabilities/sources.py`, `src/camel/capabilities/capabilities.py` | Apache-2.0 | Learn only (full interpreter is far beyond our needs; our version is ~30 lines of our own) |
| [meta-llama/PurpleLlama — LlamaFirewall](https://github.com/meta-llama/PurpleLlama/tree/main/LlamaFirewall) (2026-10-12) | `AlignmentCheckScanner`: a second model reads the user's original message plus the agent's selected action and returns `{observation, thought, conclusion}`; a positive result maps to `HUMAN_IN_THE_LOOP_REQUIRED`, and errors fail closed. `HiddenASCIIScanner`: detects/decodes Unicode tag characters U+E0000–E007F used to smuggle invisible instructions. | `src/llamafirewall/scanners/experimental/alignmentcheck_scanner.py`, `src/llamafirewall/scanners/hidden_ascii_scanner.py`, `scanners/custom_check_scanner.py` | MIT (LlamaFirewall subfolder; the repo root is the Llama licence) | Copy allowed for LlamaFirewall code with notice; we only need the idea (a cheap "checker" call on write tools after a tainted read) |
| [protectai/llm-guard](https://github.com/protectai/llm-guard) (2026-07-09) | `InvisibleText` scanner: removes characters in Unicode categories `Cf` (format), `Co` (private use), `Cn` (unassigned). Caveat for us: `Cf` includes ZWJ (U+200D), which emoji sequences need — keep ZWJ between emoji. | `llm_guard/input_scanners/invisible_text.py`, `ban_substrings.py` | MIT | Learn only — the TS equivalent is one regex over `\p{Cf}\p{Co}\p{Cn}` that we write ourselves |
| [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) (2026-10-13) | `verifyBearerToken` with `expectedResource`: the verifier must fill `AuthInfo.resource` (from `aud`), it is compared after stripping fragment/trailing slash, tokens without `expiresAt` are refused, `requiredScopes` → `403 insufficient_scope` with a challenge built by `buildWwwAuthenticateHeader` (escapes quotes and non-printable characters). Shows the shape our verifier should return even while Supabase cannot fill `resource`. | `packages/server/src/server/middleware/bearerAuth.ts`, `examples/bearer-auth/server.ts`, `packages/server-legacy/src/auth/middleware/bearerAuth.ts` (the v1 line PR #59 pins at 1.31.0) | MIT → Apache-2.0 transition (mixed) | Learn only (use the SDK as a dependency; don't vendor) |
| [invariantlabs-ai/mcp-scan](https://github.com/invariantlabs-ai/mcp-scan) (now "Snyk Agent Scan", 2026-10-15) | Risk model a security-minded user will run against our server: `McpServerRiskIndexes` scores `prompt_injection_tool_desc`, `untrusted_content`, `private_data`, `destructive_capabilities`; issue codes W015–W020 describe each. Analysis is done by Snyk's API (needs `SNYK_TOKEN`; tool descriptions leave the machine). | `src/agent_scan/models/api/v20260710.py`, `docs/issue-codes.md` (Toxic Flows), `src/agent_scan/verify_api.py` | Apache-2.0 | Learn only; optionally run it once against a staging MCP URL (on a dev machine, not in CI) |
| [supabase/splinter](https://github.com/supabase/splinter) (2026-09-29) | The SQL behind `supabase db lint`: `0024` normalises policy expressions to catch `USING (true)` on UPDATE/DELETE/ALL and missing `WITH CHECK` on INSERT; `0028`/`0029` list `SECURITY DEFINER` functions executable by `anon`/`authenticated` through `/rest/v1/rpc`. | `lints/0024_rls_policy_always_true.sql`, `lints/0028_anon_security_definer_function_executable.sql`, `lints/0029_…`, `lints/0013_rls_disabled_in_public.sql` | No licence file in the repo (README badge links to a missing LICENSE) | Learn only — use it through the Supabase CLI we already run |

## Recommendations

Ranked by risk removed per day of work. None of these adds a user-visible feature, so none touches the landing
page.

1. **Taint-gate the CMO's write tools (do before PR #59 reaches users).** Cost **S–M** (1 day). Improves:
   **risk, retention** (drafts stop drifting for reasons the founder never gave).
   - In `apps/web/lib/agent/scope.ts` / `loop.ts`, set a per-turn `tainted` flag when any tool in
     `RESEARCH_TOOLS` or `read_site` returns (also `get_run_result` for research runs). This is CaMeL's policy
     reduced to one bit.
   - When tainted, `remember`, `update_document` and `set_week_goal` do not write directly: they create an
     Approvals card ("Your CMO wants to remember: …") the founder accepts — the same assist-never-act pattern as
     posts. `create_task` can stay direct (it only queues our own jobs) but its `brief` should be shown on the
     card it already produces.
   - Store agent-written memories with a distinct type (e.g. `agent`) instead of `user`, so
     `139_cmo_memory_tiers` ranks them below founder-typed notes and the memory UI can show their origin. New
     migration + pgTAP test.
   - Apply the same gate in `apps/web/lib/cmo/mcp/cmo.ts` so the MCP path cannot bypass it.
   - Belongs to: the CMO track (`docs/cmo-architecture-implementation.md`) and a follow-up to PR #59.

2. **Untrusted-text hygiene in one shared helper.** Cost **S** (half a day). Improves: **risk**, and onboarding
   quality (**activation**: hidden SEO text no longer pollutes the product document).
   - New `apps/web/lib/cmo/untrusted.ts` (our own code): strip Unicode tag characters U+E0000–E007F, bidi
     overrides (U+202A–202E, U+2066–2069), zero-width characters except ZWJ inside emoji sequences, and
     private-use/unassigned code points (idea from llm-guard and LlamaFirewall); and an `escapeForTag()` that
     neutralises `<`/`>` inside wrapped text.
   - Use it in `site.ts` `extractPage` and in `social/reddit.ts` / `social/scrapecreators.ts` normalisers, and in
     `sales-scan.ts` `threadBlock`.
   - In `extractPage`, drop elements with `hidden`, `aria-hidden="true"`, inline `display:none`,
     `visibility:hidden`, `font-size:0`/`opacity:0`, and `<textarea>` before taking text (regex-level, like the
     current code; no DOM library needed).
   - Optional: per-call random suffix on wrapper tags (`<thread_3f9a …>`) so forged boundaries cannot match.
   - Add cases to the existing `*.check.ts` tests with a page and a thread carrying each trick.

3. **Bind MCP grants to our own consent record and split scopes.** Cost **M** (2–3 days, inside PR #59's
   Session A area). Improves: **risk**, and **revenue** indirectly — a reviewable permission model is likely to
   matter for connector-directory listings and team buyers (opinion).
   - Because Supabase ignores `resource` (auth issues #2610/#2820), keep our own `mcp_grants` table written by
     `/api/v1/oauth/consent` (user, `client_id`, scopes, created/revoked) and make
     `packages/mcp-server/src/oauth.ts` reject tokens whose `client_id` has no live grant. Settings → Connected
     apps already exists to revoke.
   - Offer three scopes on the consent screen: read, edit, spend credits. Enforce them per tool via the existing
     annotations (`readOnlyHint`) plus a "costs credits" marker; answer `403 insufficient_scope` with the SDK's
     challenge format.
   - For credit spends, prefer MCP elicitation (the user confirms in the client UI, not the model) where the
     client supports it; keep the signed confirm code as the fallback. Check claude.ai's elicitation support
     before building (unverified).
   - Record the passthrough decision (forwarding the user's Supabase token to PostgREST for RLS) in
     `docs/mcp-on-modal-plan.md` and follow MCP issue #3413.

4. **Make the database lint fail CI on security warnings.** Cost **S** (an hour). Improves: **risk**.
   Confirm the pinned CLI's exit code for `supabase db lint --level warning` and add the fail-on option if it
   only reports; triage any existing `0028/0029` hits (most of our RPCs are meant to be callable by
   `authenticated`, so expect an allowlist in the workflow rather than code changes). Belongs to: CI.

5. **Plan the MCP 2026-07-28 migration, don't do it yet.** Cost **M**, schedule after PR #59 merges. Add a
   short section to `docs/mcp-on-modal-plan.md`: `Mcp-Method`/`Mcp-Name` headers, `server/discover`,
   capabilities in `_meta`, CIMD instead of DCR (depends on Supabase support), and bump `PROTOCOL_VERSION` in
   `apps/web/lib/mcp/server.ts` (`2025-06-18`). Improves: **risk** of breaking when clients drop old versions.

6. **Run Snyk Agent Scan once against staging MCP** before announcing the connector. Cost **S**. Expect W015
   (untrusted content) on the research tools; the answer is rec. 1–2 plus clear tool descriptions, not removing
   the tools. Note that the scanner sends tool metadata to Snyk.

7. **Next.js, Supabase Auth CVE, ffmpeg: do nothing this cycle.** Keep Dependabot (PR #60) flowing; re-check if
   we ever add `images.remotePatterns`, AVIF, or a Windows host.

Out of scope, noted for the owner: `packages/mcp-server/package.json` in PR #59 declares
`"license": "AGPL-3.0-only"` while the repository is closed source since 2026-10-16; probably should be
`UNLICENSED`/private.

## Sources

All read 2026-10-17 (Asia/Ho_Chi_Minh).

- Next.js, July 2026 Security Release (published 2026-07-20): https://nextjs.org/blog/july-2026-security-release
- Next.js, September 2026 Security Release (published 2026-09-30): https://nextjs.org/blog/september-2026-security-release
- The Hacker News, Next.js patches critical AVIF and Windows flaws (2026-08-27): https://thehackernews.com/2026/08/nextjs-patches-critical-avif-and.html
- TechCrunch, Supabase customers exposing data (2026-09-25): https://techcrunch.com/2026/09/25/some-supabase-customers-are-publicly-exposing-reams-of-peoples-data-to-the-web/
- BleepingComputer, 16,000+ Supabase databases exposed (Sept 2026): https://www.bleepingcomputer.com/news/security/misconfigured-supabase-apps-expose-data-in-over-16-000-databases/
- SentinelOne, CVE-2026-31813 Supabase Auth (2026-03-13, older than 6 months): https://www.sentinelone.com/vulnerability-database/cve-2026-31813/
- Unit 42, Web-based indirect prompt injection observed in the wild (2026-03-03, older than 6 months): https://unit42.paloaltonetworks.com/ai-agent-prompt-injection/
- arXiv 2607.06595, When Agents Remember Too Much: Memory Poisoning Attacks on LLM Agents (2026-07-06): https://arxiv.org/html/2607.06595v1
- WorkOS, Memory and context poisoning (2026, opinion-grade): https://workos.com/blog/ai-agent-memory-poisoning
- MCP blog, The 2026-07-28 Specification (2026-07-28): https://blog.modelcontextprotocol.io/posts/2026-07-28/
- MCP spec 2026-07-28, Authorization security considerations: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations
- supabase/auth issue #2610, RFC 8707 resource indicators: https://github.com/supabase/auth/issues/2610
- supabase/auth issue #2820, consent 400 when `resource` is sent: https://github.com/supabase/auth/issues/2820
- modelcontextprotocol issue #3413, token passthrough to same-project API (opened 2026-10-04): https://github.com/modelcontextprotocol/modelcontextprotocol/issues/3413
- Cycode, MCP Python SDK OAuth account takeover (2026-09-28): https://cycode.com/blog/mcp-python-sdk-oauth-account-takeover/
- AgentMelt, MCP security in 2026: attacks and defenses (2026-07-15, updated 2026-09-17; incidents are 2025, older than 6 months): https://agentmelt.com/blog/mcp-security-2026-attacks-and-defenses/
- CraftedSignal, ffmpeg DoS CVE-2026-64834 (2026-07-22): https://feed.craftedsignal.io/briefs/2026-07-ffmpeg-dos-cve-2026-64834/
- Vulert, ffmpeg vf_swaprect CVE-2026-65706 (page failed to load; listed from search result only): https://vulert.com/vuln-db/ffmpeg-versions-3-0-through-8-1-2-contain-an-out-of-bounds-write-vulnerability-in-the-vf-swaprect-vi---
- Repos (code read at the commits of 2026-10-17 clones): https://github.com/google-research/camel-prompt-injection · https://github.com/meta-llama/PurpleLlama · https://github.com/protectai/llm-guard · https://github.com/modelcontextprotocol/typescript-sdk · https://github.com/invariantlabs-ai/mcp-scan · https://github.com/supabase/splinter
