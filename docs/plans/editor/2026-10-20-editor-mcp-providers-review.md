# Review: editor over MCP + provider layer (PR #88, 2026-10-20)

Review of PR #88 (it now also carries the former #87), feature by feature. For each feature it records what was
tested in the cloud session, what happens when the feature breaks, how it holds up on security, whether it works,
and what is left to test on the owner's machine. The plan is
[`2026-10-20-editor-mcp-providers-plan.md`](2026-10-20-editor-mcp-providers-plan.md).

**What the cloud could run:**
- Ran: every unit, contract and check suite; the engine; the MCP server checks; and calls to the **production** MCP
  server.
- Could not run: the local Supabase stack. Docker was up, but the `supabase/postgres` image would not download
  (ECR "Data limit exceeded", Docker Hub 429). pgTAP still runs on the PR in CI's `database` job, which is green.
  The Playwright e2e suite needs that stack, so it moves to the local list.

## Results at a glance

| # | Feature | Works? | Security | Left for local |
|---|---|---|---|---|
| 1 | Look and listen (`capture_frame`, `inspect_color`, `media_grab`, `media_waveform`) | Yes, at unit level | OK | Deploy, real MCP client, peak RAM |
| 2 | `list_versions` / `restore_version` | Yes, at unit level | OK (RLS) | A real database |
| 3 | `save_frame` | Manifest step only | OK | The whole chain on a real database |
| 4 | Deploy check | Yes | OK (hashes only) | `modal run check_deploy_env.py` |
| 5 | Provider registry and failover | Yes | OK | Live Groq |
| 6 | `structured()` on OpenAI-compatible APIs | Yes, against a fake endpoint | OK | Live Groq |
| 7 | Web moderation | Yes, against a fake endpoint; the production failure is reproduced | OK, fails closed | Live Groq verdicts |
| 8 | Worker moderation (Groq vision, fal optional) | Yes, with fakes | OK, fails closed | Live verdict accuracy |
| 9 | Brain mode | Yes | n/a | Once the Groq key is in |
| 10 | Editor with no AI key | Smoke-tested in production over MCP; UI gaps filled | n/a | The e2e suite |

## 1. Look and listen over MCP → worker `look`

**Tested here:**
- `clip-export` `look.test.ts`: 5 passed, using real ffmpeg. The frames a capture draws are the export's own frames.
- `tests/test_worker_look.py`: passed.
- `server.check.ts`: "not set up" gives a clear error, at most 12 frames are drawn, and the hourly cap answers
  before anything is posted.
- Code read: `lib/mcp/look.ts` and `opencmo/worker/look.py`.

**If it breaks:**
- No URL or token configured: "Looking at frames is not set up" plus the editor link. This is what production
  answers today.
- Worker down: a 120 s timeout and "Could not draw the frames".
- Endpoint answers 401: logged, and the same error is returned.
- Nothing hangs and nothing is charged. The cost is our Modal time, capped at 60 calls per user per hour by the
  `rate_limit_hit` RPC.

**Security:**
- The MCP container holds its own `OPENCMO_LOOK_TOKEN`, never the worker token (checked by the deploy check).
- The worker checks clip ownership again with the service role before it downloads anything.
- Every source goes through the export's `_Sources`:
  - media assets must match the clip's `user_id` and `job_id`;
  - brand logos must sit under `<user>/`;
  - captures must belong to the same user.
- So a document that names another user's file cannot read it.
- Untrusted media is read through `USER_INPUT`.

**Works:** yes at unit level. **Local:**
1. Deploy `modal_app.py`.
2. Set `OPENCMO_LOOK_TOKEN` (the same value in `opencmo` and `opencmo-mcp`) and `OPENCMO_LOOK_URL`.
3. Call `capture_frame` from claude.ai.
4. Measure peak RAM with `/usr/bin/time -v` on 12 frames of a 1080p clip.

## 2. `list_versions` / `restore_version`

**Tested here:** `versions.check.ts` passes (it runs inside `check:contracts`). Code read.

**If it breaks:**
- A version id that is gone gives "That version is no longer available".
- A save that races the editor fails the optimistic lock (`save_editor_document`), and nothing is overwritten.

**Security:**
- Every read runs under the user's RLS, so another user's clip or version reads as not found.
- The restore writes through `save_editor_document`.
- A checkpoint is taken first, so a restore can itself be undone.

**Works:** yes. **Local:** a real restore on a clip with several versions, then the editor's Version history shows
the "MCP: before restoring…" checkpoint.

## 3. `save_frame`

**Tested here:** `save-frame.check.ts` covers the manifest record. Code read:
- the upload reservation (`reserve_upload`);
- Storage, with the user's own token;
- `register_media_asset` (asset and probe in one transaction);
- the manifest save.

Also checked:
- The `media` bucket accepts `image/jpeg` (`20260929090000_generations.sql`).
- `probe_media` accepts JPEG.

**If it breaks:**
- A frame cannot be drawn: the look error.
- The upload fails: "could not be saved".
- **Weak spot (minor, not fixed):** if the manifest save loses the optimistic lock to a concurrent edit, the asset
  is already registered but missing from the library: an unreferenced file, not a broken clip. The fix (a retry of the manifest save) is noted for later.

**Security:** the object name is `<user>/<job>/<uuid>.jpg` and is built on the server, and Storage RLS refuses an
object without its reservation.

**Works:** only partly tested. **Local:** the whole chain on a real database, then use the frame as `start_image`.

## 4. Deploy check

**Tested here:** `test_check_deploy_env.py`, 15 passed. It covers:
- the look token and URL;
- optional keys that are set in one place must be set everywhere;
- one moderation key is needed per place;
- the report never contains a secret.

**Security:** only fingerprints (`sha256:…`) leave the containers, except for the plain URLs and flags.

**Local:** `modal run check_deploy_env.py` once the new secrets are in.

## 5. Provider registry and failover order

**Tested here:** `registry.check.ts` covers:
- the default order `openai,anthropic,gemini`;
- `CMO_LLM_PROVIDERS`;
- the `groq` alias;
- each agent's own `BASE_URL`, and that failover never uses another agent's endpoint;
- that a judge prefers a provider other than the one that drafted.

`model.check`, `brain.check`, `llm-health.check` and `judge.check` pass.

**If it breaks:**
- An unknown provider name is logged, and the order is used instead.
- No key at all gives "The AI CMO is not set up on this server yet" (English).
- A provider out of credit is skipped for 10 minutes, but only when it failed on the shared key.
- A timeout never moves anyone off a provider.

**Security:** the base URL comes only from server env, and no user input reaches it, so there is no SSRF path.

**Works:** yes.

## 6. `structured()` on OpenAI-compatible endpoints

**Tested here:** `openai-compat.check.ts`, against a local fake endpoint:
- Request shape: Bearer key and `json_schema`.
- An endpoint that rejects `json_schema` gets one more try in JSON mode.
- Errors: 401 and 404 are account problems; 429 is busy (or quota when the limit is per day); 5xx and an
  unreachable endpoint are busy.
- A malformed answer, a cut-off answer and our own timeout are **not** outages.
- A `checker` agent's call lands on Groq's check-tier model, and an answer outside the schema is refused.

**Security:** the key travels only in the `Authorization` header. Logs carry the status and the provider's message,
never the key or the prompt.

**Works:** yes against the fake. **Local:** set `GROQ_API_KEY`, then `GET /openai/v1/models`, set
`OPENAI_COMPAT_MODEL` and `OPENAI_COMPAT_CHECK_MODEL` if the defaults are gone, and run one W2 draft.

## 7. Web moderation on any provider

**Tested in production first:** over MCP, the price step of `generate_media` for a voice answered *"Could not check
this request. Please try again."* Moderation still calls Anthropic, which has no credit. This PR fixes that once
`GROQ_API_KEY` is set.

**Tested here:** `moderation.check.ts`:
- Groq answers first and Claude is not asked.
- A block is final.
- 401 or 429 moves to the next provider.
- An unreadable verdict, or a 400, is refused with no fallback.
- The `</prompt>` escape still holds.
- The shared health memory cannot move this check.
- With no key in production: 503.

**Security:** fails closed; the prompt goes in as escaped data, so a `</prompt>` or fake instruction stays inside
the data block.

**Works:** yes. **Local:** one clean prompt and one blocked prompt (a celebrity, a brand logo) on real Groq.

## 8. Worker moderation (Groq vision, fal optional)

**Tested here:** `test_ai_moderation.py`, 31 passed:
- Groq runs first and its verdict is final.
- Groq 401/404/429/503 hands over to Claude.
- An endpoint without JSON schema gets JSON mode.
- Groq alone is enough (no fal, no Claude).
- The order follows `CMO_LLM_PROVIDERS`.
- Busy is retried in place; an unreadable verdict blocks and the credits are refunded.

**Security:** only three frames at most 512 px wide leave the worker.

**Risk to check:** with no fal key, the NSFW classifier is gone, and sexual content is caught only by the policy
prompt on Llama 4 Scout. **Local:** run a set of known safe and unsafe images through it before turning fal off in
production.

## 9. Brain mode

`providersUp` now counts every provider with a key that has not failed on account. With only `GROQ_API_KEY`, the
CMO jobs run on Groq; with every provider down, the mode is `claude` and work goes to the inbox. Production answers
`brain: "opencmo"` today, with Anthropic out of credit, so scheduled jobs fail and refund until the Groq key is in.

## 10. The editor with no AI key: what was missing from the UI

**Production smoke over MCP** on a New edit ("Review smoke test 2026-10-20", safe to delete):
- `new_edit`, `add_text`, `set_caption_style` and `check` all work.
- `check` correctly reports a black gap and the unsafe text zone.

Small things seen:
- `get_project_state` answers `duration: null` on a blank edit that `check` measures at 3 s.
- `set_caption_style` on a clip with no captions answers `ok` with `changed: false`, and says nothing.
- Neither is fixed here; both are noted for the editor backlog.

**UI gaps filled in this PR.** Each new control runs the same op through `editor-core`, the editor's only write
path:

| Op | Where it is now |
|---|---|
| `emphasize_words` | Transcript selection: **Emphasize** / **Plain**, by word id. The op gained `word_ids`; quoting picked the first match, so a repeated word ("the") was coloured in the wrong place. Test added. |
| `add_hook_title` | Visuals → **Hook** (one or two lines) |
| `add_list` | Visuals → **List** (one item per line, `label \| fact`) |
| `punch_in` | Frame bar → **Punch in** |
| `copy_settings` | Right-click → **Copy style** / **Paste style** |
| `stagger` | Right-click with 2 or more selected → **Animate one by one** (fade, slide up, pop, grow) |
| Captions / Translate | The Inspector says "not set up on this server yet" up front (`GET /api/v1/editor/features`), instead of failing after the click |

**Not given a manual control, on purpose:**
- `create_video`, `add_explainer` and `apply_style` need a model to write the plan. They stay behind `/video`,
  `/explain` and MCP.
- `add_proof` needs `capture_page`.
- `apply_color` already has manual wheels, curves and LUTs in Adjust.
- `make_room`, `remove_ranges` and `add_text` already have manual routes (timeline drag, transcript cut, the Text
  tool).

## Editor UI handed to Claude Design

The editor's UI is laid out for a redesign on a Claude Design canvas: https://claude.ai/artifact/6StfkiCRKsb6RgVtZmatoo
(private until shared from its Share menu). It holds six artboards: the shell, a feature inventory (manual vs AI),
and the Script, Visuals, Inspector and Timeline/context-menu components. The direction: a dark studio surface,
the lapis accent, a left rail for "add", the Inspector for "change", the timeline for "when", and AI as a layer on
top. These are design input for a later PR, not code. Some of their controls are proposals that are not built yet:
"Hook from words", "B-roll here", Look presets, a Safe-area toggle.

## Local-machine list

1. **Editor e2e with real Chrome** (`npm run test:e2e`; Playwright's Chromium cannot decode H.264): `editor-blank`,
   `editor-text`, `editor-captions`, `editor-generate`, `editor-explainer`, `editor-adjust`, `clip-flow`, `mcp`,
   `isolation`. Then click the new controls from §10 and look at the result.
2. **Groq:**
   - set `GROQ_API_KEY` on Vercel, `opencmo` and `opencmo-mcp`;
   - list the models and set the three model ids if they changed;
   - run a clean and a blocked prompt;
   - run a clean and an unsafe image (§8);
   - run one CMO job.
3. **Modal:**
   - deploy `modal_app.py` and `mcp_app.py` (after `npm run build --workspace @opencmo/mcp-server`);
   - set `OPENCMO_LOOK_TOKEN` and `OPENCMO_LOOK_URL`;
   - run `modal run check_deploy_env.py`;
   - call `capture_frame` and `save_frame` from claude.ai.
4. **Budgets:** `/usr/bin/time -v` on `look` with 12 frames (target: under 2 GB).
5. **Privacy page:** `/privacy` already names "AI model providers" in general, so Groq needs no text change.
