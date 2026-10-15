# Editing your own video: build plan (3 parallel sessions)

One branch (`own-video-editing`, cut from `explainer`), one draft PR, three Claude sessions working in parallel.

## Context: why this PR exists

The founder records talking-head videos and wants the Assistant to edit them: cut the "um"s, the dead air, the
false starts and the retakes, keep the best take, then caption. Today the Assistant cannot, and only adds text,
which a human does faster by hand. Investigation (2026-10-15) found three causes, all in our code:

1. **A video uploaded into the editor is never transcribed on its own.**
   - Only the clip pipeline (link or upload → clips, `packages/engine/opencmo/pipeline.py:222-290`) transcribes
     automatically.
   - A file added to the editor library gets a transcript only when someone clicks "Generate captions"
     (1 credit/min, `request_media_captions`, r6 credit migration) or the Assistant runs the paid
     `add_captions` (`apps/web/lib/agent/captions-tool.ts`).
   - A finished transcript of the same file is never reused: asking again charges again.
2. **Every cut-by-text tool works only on the master video.**
   - `get_transcript`, `search_transcript`, `find_filler_words`, `find_silences`, and the ops `remove_words`,
     `remove_ranges`, `remove_silence`, `restore_*`, `edit_words`… all go through `readCaptionState` →
     `locate()` (`packages/editor-core/src/captions.ts:118-163`).
   - `locate()` picks the first sequence with a `text-cut` mark, else the first video whose `src` is
     `assets/master.mp4`.
   - Any other video (a second upload, a talk from the library) cannot be cut by words.
3. **On a blank "New edit" the cutting tools are removed** (`OWN_VIDEO_TOOLS`, `apps/web/lib/agent/tools.ts:496`,
   applied in `scope.ts:132-138`). A user who opens New edit and drops their recording in gets an Assistant with
   no way to cut it.

**What others do.**
- **Palmier Pro** (`/home/user/palmier-pro`, GPL-3: read for design, never copy code):
  - transcribes every imported file in the background, on device, cached by path + mtime + size;
  - `get_transcript` walks every clip on the timeline, and `remove_words` works on any track (`clipId` / `trackIndex`);
  - `remove_silence` uses voice activity detection, so it needs no transcript;
  - padding is tight 60 ms / balanced 150 ms / loose 320 ms;
  - each tool call is one undo step;
  - its skill catalog [palmier-io/palmier-skills](https://github.com/palmier-io/palmier-skills) (Apache-2.0)
    carries `ugc-editing` and `multi-cam-editing`.
- **GitHub editing skills** (all MIT; their rules may be adapted with a `THIRD_PARTY_NOTICES.md` row):
  - [browser-use/video-use](https://github.com/browser-use/video-use) — 12 hard rules:
    - never cut inside a word;
    - pad cut edges 30–200 ms (ASR timestamps drift 50–100 ms);
    - 30 ms audio fades at every cut;
    - cache transcripts per source;
    - propose the plan in 4–8 sentences and wait for "yes" before cutting;
    - self-check every cut edge ±1.5 s before showing the user.
  - [Samin12/cut-video](https://github.com/Samin12/cut-video):
    - a silence table (< 0.25 s keep; 0.25–1 s trim to 0.1 / 0.3 / 0.5 s by mode);
    - fillers vs hedges, with hedges cut only before a restatement;
    - keep laughs and comedic pauses;
    - whole-line retakes found by fuzzy 4-gram match (> 0.7) inside a 60 s window.
  - [vincentventalon/claude-code-video-editing-skill](https://github.com/vincentventalon/claude-code-video-editing-skill):
    - keep the **last** take of a repeated sentence;
    - when in doubt, keep (a repeat left costs a second pass, a lost sentence costs the video).
  - [Abdalkaderdev/takecut](https://github.com/Abdalkaderdev/takecut):
    - fillers in 12 languages;
    - re-transcribe after the cut to prove no sentence was lost.

**Outcome wanted.** Upload your own recording into New edit (or any clip), and within about a minute it has a
transcript without a click. Type "rough cut this" (or `/roughcut`). The Assistant:
1. proposes a plan in plain words;
2. after "go", cuts silences, fillers, false starts and retakes on **that** video, keeping the last good take;
3. checks the cut edges by looking at frames;
4. reports what it removed.

Ctrl+Z undoes the whole cut in one step.

## Acceptance test ("done means it works when tested")

1. `npm run check:editor-core`, `npm run check:clip-doc`, `npm run typecheck` and
   `npm run check:contracts --workspace @opencmo/web` pass; engine `pytest` and `ruff` pass;
   `npm run db:reset && npm run db:test` passes.
2. **Auto transcript.**
   - Local stack: upload `apps/web/e2e/fixtures/<talk>.mp4` into a New edit library.
   - The library row goes `Transcribing…` → `Transcript ready` with no click and no credits charged.
   - The `media_transcripts` row exists.
   - Uploading the same file again (or using it in another clip) does not transcribe again.
3. **Cut any video.** On that New edit, with the video placed on the timeline, the Assistant's `get_transcript`
   returns its words. `remove_words` on filler ids cuts the video and its captions together; one Ctrl+Z restores
   them.
4. **Rough cut.** `apps/web/e2e/editor-roughcut.spec.ts` passes. It runs with the fake agent and the fake
   transcriber over a fixture with known fillers, a 2 s silence and a retake:
   1. `/roughcut`
   2. plan text shown
   3. "go"
   4. the clip is shorter by the expected amount, the retake's first take is gone, the last take stays
   5. Ctrl+Z restores the full length.
5. **Real check, done by a person** (the owner at home, or a session with a real ElevenLabs key): on a real
   3–5 minute self-recorded talk, `/roughcut` with the real Claude:
   - removes the fillers and the silences;
   - keeps every sentence (re-read the transcript);
   - no audible pops at the cuts.

   Time it against cutting by hand.

## Decisions

- **Free automatic transcription, capped.**
  - Every video or audio file uploaded into the editor that has an audio stream is transcribed automatically and
    for free, if:
    - the file is ≤ 30 min (`captions_max_seconds()`);
    - and the user's automatic minutes today stay under `auto_transcript_daily_seconds()` = 180 min.
  - Above that, the file is marked `skipped` and the existing paid "Generate captions" path still works.
  - Cost check: ElevenLabs Scribe is about $0.40 per audio hour, so 3 h/day/user is at most about $1.2.
  - **Owner: confirm or change the cap before merge** (it is one SQL function).
  - Money rules still hold: no credits move for automatic runs, and the paid path keeps
    `credit_hold` / `credit_settle` / `credit_refund`.
- **A transcript belongs to the stored file**, not to the clip. A new table `media_transcripts` (one row per
  `media_assets` row, whole file, file seconds) is reused by every clip that plays the file. The per-clip
  `editor_transcripts` stays the editable copy (edits, cuts, translations), created from the file transcript for
  the element's window.
- **"Speech source" replaces "master".** Any video element whose captions layer is linked to it (new captions prop
  `source` = the video element's id) can be cut by text. With no `element_id`, tools keep today's behaviour:
  1. the master or the cut sequence;
  2. else the only speech source;
  3. else an error asking which one.
- **Cuts are rendered with short audio fades.** If `clip-render` / `clip-export` do not already fade audio at
  segment joins, add a 30 ms fade (video-use rule 3). Track B checks it and owns the change.
- **The Assistant proposes before it cuts** more than 3 ranges (video-use rule 11). One coherent cut = one Undo
  step.
- **Out of scope** (note in the PR, do not build):
  - visual search over footage;
  - multicam (angle groups, sync by audio, `change_cam`);
  - beat-synced cutting beyond today's `media_waveform`;
  - speaker diarization;
  - voice-activity silence removal without a transcript (the guide uses `media_waveform` silences +
    `remove_ranges` for that).

---

## Contracts (fixed; change only through a Request)

### SQL (Track A)

```sql
-- One transcript per stored file. Body = the same JSON shape `check_transcript_body` accepts, in FILE seconds.
create table public.media_transcripts (
  asset_id uuid primary key references public.media_assets(id) on delete cascade,
  user_id uuid not null,
  hash text not null check (hash ~ '^[0-9a-f]{64}$'),
  body text not null check (octet_length(body) < 524288),
  seconds numeric not null,
  source text not null,              -- 'scribe' | 'fake' | 'import'
  created_at timestamptz not null default now()
);  -- RLS: owner can select; writes only through security-definer RPCs.

alter table public.media_assets
  add column has_audio boolean,      -- set by the probe
  add column transcript_status text not null default 'none'
    check (transcript_status in ('none','queued','running','ready','failed','skipped'));
```

- `complete_media_probe(..., p_has_audio boolean default null)`: when it marks the asset `ready` with
  `has_audio`, it enqueues a free `transcribe_media` task:
  - payload `{ "scope": "file", "auto": true, "credits": 0 }`;
  - set `transcript_status = 'queued'`;
  - or `'skipped'` when over a cap.
- `complete_media_transcript(p_task_id, p_attempt_id, p_body) returns text` (hash): worker-only. Writes
  `media_transcripts`, sets `transcript_status = 'ready'`, task done. On failure: `'failed'`, no money involved.
- `use_media_transcript(p_clip_id uuid, p_media_id uuid, p_source_in numeric, p_source_out numeric) returns jsonb`.
  Owner-checked; slices the file transcript to the window and stores it in `editor_transcripts` for the clip.
  Returns one of:
  - `{"status":"ready","src":"assets/transcripts/<hash>.json","hash":…}`
  - `{"status":"pending"}` (queued or running)
  - `{"status":"none"}` (no audio, skipped or failed: the caller may offer the paid path)
- `request_media_captions` (paid path): if the file already has a `media_transcripts` row, return
  `{task_id: null, credits: 0, src}` without charging.
- `auto_transcript_daily_seconds() returns numeric` = 10800 (180 min).

### Transcript slicing (Track A writes, Track B reuses)

Words whose start is inside `[source_in, source_out)`, with times **kept in file seconds**, the same convention as
today's library captions (`transcribe_media_task.py` shifts back to file seconds). Lines keep their words; empty
lines are dropped.

### Clip document and editor-core (Track B)

- `CaptionsNode.source?: string` — the id of the video element this captions layer transcribes (clip-doc schema +
  a migration that sets it on existing master captions; `npm run check:clip-doc` regenerates the JSON Schema).
- `speechSources(document): SpeechSource[]`, where:
  - `SpeechSource = { elementId, name, captionsId, transcript: string | null, window: Range | null, master: boolean }`;
  - each source is a video (or cut sequence) that has a linked captions layer or is the master.
- `readCaptionState(document, elementId?)`, and every cut op's input gains an optional `element_id`. The default
  follows "Speech source replaces master" above. Unknown id → `OpFailure('No video with id …')`. Several sources
  and no id → `OpFailure('This clip has several videos with speech: pass element_id (…names…).')`.
- New op `attach_transcript { op, element_id, src }`:
  - adds a captions layer linked to the element (`source = element_id`), timed like `add_captions` does today;
  - `hidden: true` unless the user asked for captions;
  - one Undo step;
  - `agent: false` (the editor runs it when a transcript becomes ready).
- Cuts on a non-master video use the same `text-cut` mark machinery, so video, linked audio and captions stay
  in sync.

### Assistant (Track C)

- Every transcript/cut tool takes optional `element_id`.
- `<clip_context>` lists the speech sources (name, id, duration, words or "transcribing…").
- `find_retakes { element_id? }` → `[{ keep: [firstId, lastId], drop: [[firstId, lastId], …], text, similarity }]`.
  - Repeated sentences, fuzzy 4-gram similarity > 0.7, inside a 60 s window, sentence openers also compared.
  - Suggests keeping the **last** take.
  - Read-only; the model decides.
- Guide `roughcut` and slash `/roughcut`.

---

## How the three sessions work together

1. **Branch.** Everyone works on `own-video-editing`. Before every task and every push:
   `git pull --rebase origin own-video-editing`. Never force-push.
2. **Ownership.** Edit only your own files (table). Need something in another track's file? Add a line under
   [Requests](#requests) and keep going.
3. **Contracts first.**
   - Track A's first push lands the migration with the table, columns and RPC signatures. Bodies may still
     return `{"status":"none"}`.
   - Track B's first push lands `CaptionsNode.source`, `speechSources` and the `element_id` inputs.
   - Until then, code against the contracts above.
4. **Small commits** (`own-video A2: auto-transcribe on probe`), English only, tick your box and add a Notes line
   in the same commit.
5. **Green before push:** `npm run typecheck` plus your track's checks.
6. **Verify by looking** (`CLAUDE.md`): extract frames and listen around cuts on full-size exports; say in Notes
   what you checked.
7. **Project rules:**
   - every write through ownership-checking RPCs;
   - money only through the `credit_*` functions;
   - every migration has a pgTAP test, then `scripts/dump-schema.sh`;
   - user-facing errors in English;
   - user media read with an explicit format (`USER_INPUT`);
   - peak RAM per job < 2 GB.

| Track | Owns |
|---|---|
| **A: Transcripts as data** | `supabase/**`, `packages/engine/**`, `apps/web/app/api/v1/editor/captions/**`, `apps/web/lib/editor/captions-run.ts`, `apps/web/lib/editor/captions-source.ts` |
| **B: Cut any video (document + editor)** | `packages/clip-doc/**`, `packages/editor-core/**`, `packages/clip-render/**`, `packages/clip-export/**`, `apps/web/components/editor/**`, `apps/web/lib/editor/**` except A's two files |
| **C: Assistant rough cut** | `apps/web/lib/agent/**`, `apps/web/e2e/**`, `THIRD_PARTY_NOTICES.md`, `docs/spec-editor-assistant.md` |

---

## Track A: Transcripts as data

Mirror the existing paid captions path: `request_media_captions` / `complete_media_captions` (r6 credit module),
`packages/engine/opencmo/worker/transcribe_media_task.py`, `steps/transcribe.py` (Scribe, parallel parts), and the
probe task (`complete_media_probe`).

- [ ] **A1. Migration + contract (push first).**
  - `media_transcripts`, `media_assets.has_audio` and `transcript_status`, `auto_transcript_daily_seconds()`.
  - The RPC signatures from Contracts.
  - RLS: owner select on `media_transcripts`.
  - pgTAP `supabase/tests/155_media_transcripts.test.sql` for:
    - RLS: another user cannot read;
    - `use_media_transcript` refuses a clip you do not own and a file of another job.
  - `scripts/dump-schema.sh`.
- [ ] **A2. Probe reports audio and enqueues.**
  - The probe step reports `has_audio` (ffprobe audio stream count; read with `USER_INPUT`).
  - `complete_media_probe` enqueues the free task, or marks `skipped`:
    - no audio;
    - longer than 30 min;
    - over today's cap, summing `media_transcripts.seconds` for files transcribed automatically today.
  - pgTAP: cap reached → `skipped`, no task; no audio → `none`; idempotent on a repeated probe completion.
- [ ] **A3. Worker: file transcripts.**
  - `transcribe_media` with `payload.scope = 'file'`:
    - extract the whole audio with a streaming ffmpeg subprocess (never into Python memory);
    - `transcribe_audio` (Scribe, existing parallel parts);
    - `complete_media_transcript`.
  - The e2e fake transcriber (the one `editor-captions.spec.ts` relies on) must work for this path too.
  - If the fake only covers one fixture, add a sidecar convention: `<file>.words.json` next to the fixture, read
    when `OPENCMO_AI_FAKE=1` and not in production.
  - Engine tests for both scopes. Measure a 30-minute file with `/usr/bin/time -v` (peak RSS < 2 GB) and write the
    numbers in Notes.
- [ ] **A4. Slicing and reuse.**
  - `use_media_transcript` slices to the window (contract) and stores it in `editor_transcripts`
    (content-addressed).
  - `request_media_captions` returns the existing transcript at 0 credits.
  - pgTAP for the slice (words at the edges, empty window) and for "no double charge".
- [ ] **A5. Web read path.**
  - `apps/web/lib/editor/captions-run.ts` gains `useMediaTranscript(supabase, { clipId, mediaId, sourceIn, sourceOut })`.
    It is shared by the editor (Track B) and the Assistant (Track C), so they cannot diverge.
  - The captions route answers a GET for a library file's `transcript_status`.
  - The inspector's "Generate captions" shows "Free — transcript ready" when one exists.
  - `npm run check:contracts`.
- [ ] **A6. Request to C:** document the free-transcript behaviour for the guide (what `pending` / `none` mean).

**Checks:** `npm run db:reset && npm run db:test`; engine `pytest -q` + `ruff check .`; `npm run typecheck`;
`npm run check:contracts --workspace @opencmo/web`; a local upload going `none → queued → ready`.

**Notes (A):**

---

## Track B: Cut any video (document + editor)

Start from `packages/editor-core/src/captions.ts` (`locate`, `readCaptionState`, `segment`, `cutMark`) and
`packages/editor-core/src/ops/captions.ts` (`loadCaptions`, the cut ops), and the library flow in
`apps/web/components/editor/library/useLibrary.ts`.

- [x] **B1. Document contract (push first).**
  - `CaptionsNode.source` in clip-doc, with a migration that sets `source` on existing master captions.
  - `speechSources()`, and `element_id` on every cut op's zod input.
  - The default still selects the master, so existing behaviour does not change.
  - `npm run check:clip-doc` regenerates the JSON Schema; `npm run documents:check`.
- [x] **B2. Locate by element.**
  - `locate(document, elementId?)` finds the element (video or cut sequence) and its linked captions layer
    (`source`), then falls back as in Contracts.
  - Cutting a non-master video turns it into a cut sequence exactly like the master today: `text-cut` mark,
    template, window, face track kept.
  - Tests:
    - two videos with speech, cut the second by words: the first is untouched;
    - restore;
    - one Undo step per op;
    - the "several sources, no id" error;
    - a master clip still behaves exactly as before (existing tests stay green unchanged).
- [x] **B3. `attach_transcript` op** (`agent: false`): inserts the hidden, linked captions layer (contract). Tests:
  - timing matches `add_captions`;
  - attaching twice is a no-op;
  - Undo removes it.
- [ ] **B4. Editor wiring.**
  - When a library file's `transcript_status` becomes `ready` and the file is on the timeline (or is placed
    later):
    - call A's `useMediaTranscript` for the element's window;
    - run `attach_transcript`;
    - this is one Undo step that does not merge with the user's edits (see the editor-stability `TransactOptions`).
  - Library row badge: `Transcribing…` / `Transcript ready` / nothing.
  - The Transcript panel shows the selected speech source and lets you cut it like the master (the panel already
    edits the master).
- [x] **B5. Audio fades at cuts.**
  - Check `clip-render` (preview) and `clip-export` (server) at segment joins of a cut sequence.
  - If audio is butt-joined, add a 30 ms fade-out / fade-in at each join, with the same rule in both.
  - Measure: export a cut talk, extract the audio around 3 joins, look at the waveform (or `astats`) and confirm
    no click.
  - Parity stays green.
- [ ] **B6. E2E support for C:** stable `data-testid`s on the library badge and the Transcript panel source picker
  (list them in Notes).

**Checks:** `npm run check:clip-doc`, `npm run check:editor-core`, `npm run test:editor-core`,
`npm run typecheck`, parity job locally if render or export changed, plus a manual cut of a second video in
`npm run dev`, described in Notes.

**Notes (B):**

- B1 (contract change, B-owned): `CaptionsNode.source` landed **without a document version bump or migration step**.
  An optional field is backward compatible (`migrate.ts` header rule). A version bump would have broken every stored
  v1 document, the engine (`process_job.py` writes v1) and the parity samples. The rule "video captions with no
  `source` belong to the master" gives old documents exactly today's behaviour.
- B1/B2: what landed:
  - `speechSources(document)` (master first);
  - `readCaptionState(document, elementId?, strict?)`, `cutPoints(document, elementId?)` and `speechOffset`;
  - `loadCaptions(document, ctx, elementId?)`;
  - `element_id` (zod `speechElement`) on `remove_words`, `restore_words`, `restore_all`, `remove_ranges`,
    `remove_silence`, `edit_words`, `split_line`, `merge_lines`, `nudge_word` and `set_audio_roll`.

  How it behaves:
  - A speech source is a `video`, or a library `rect` painted with a video, or its `text-cut` sequence, with a
    linked captions layer.
  - Passing a segment's id selects its cut.
  - A linked video keeps its id through cut, re-cut and restore, so `element_id` and `source` stay valid. The
    master keeps today's fresh ids; the golden tests pin that.
  - A library rect with no `sourceOut` gets its window from `start`/`end`.
  - Timeline follow:
    - in a master clip, cutting a second video leaves the rest of the timeline alone;
    - in an edit with no master, the cut video is the spine: what comes after it shifts by the change in length,
      and so does the workarea end;
    - after any spine cut, linked captions are re-timed to their video, or removed with it.
  - With several sources and no id, ops fail with "This clip has several videos with speech: pass element_id
    (name: id, …)"; readers (summary) get `null`.
- B3: `attach_transcript { element_id, src }` (`agent: false`, last in `REGISTRY`):
  - adds a hidden captions layer, `name` "Transcript · <video>", in the video's scene or group (not inside a row);
  - copies `start`/`end`/`sourceIn`/`sourceOut`/`playbackRate` from the video, like `captionsNode`;
  - is a no-op when a layer with that `source` already exists.
- Tests: `packages/editor-core/src/speech-sources.test.ts` (9). The existing 585 editor-core tests pass unchanged.
  `check:clip-doc`, `typecheck` and `check:contracts` are green.
- B5: before this, nothing faded at a cut. Preview stepped the gain per frame; export used butt-joined `-ss` inputs
  with stepped `volume`.
  - One rule now lives in clip-render `audioClips()`: the audible segments of a `text-cut` sequence are marked
    `fadeIn`/`fadeOut` at the joins only, never at the cut's outer edges. `SEAM_FADE` = 30 ms.
  - Export adds a sample-accurate `afade` per input at those edges.
  - Preview (`playback.ts`) ramps the WebAudio gain over the same 30 ms.
  - Measured on a real export: a 440 Hz sine cut with phase jumps, 3 segments, the largest sample-to-sample jump
    over ±20 ms around each join:
    - butt-joined: 0.074 / 0.154;
    - with fades: 0.0047 / 0.0049 (the sine's own slope).
  - Looked at the waveform around the 1.0 s join: the hard phase break became a clean 30 ms fade out and in. This
    is the test "a cut fades its joins" in `clip-export.test.ts`.
  - Parity (`--target node`): identical before and after, because parity compares frames only. In this container
    37 frames fail on the base commit too (environment); that is unchanged.
  - Preview limit: the ramp starts on the first or last rendered frame of a segment. If requestAnimationFrame skips
    that frame, there is no fade on that join in preview. Export is exact.

---

## Track C: Assistant rough cut

Start from `apps/web/lib/agent/tools.ts` (the transcript tools, `OWN_VIDEO_TOOLS`, `guard`),
`clip-context.ts`, `guides.ts` (`workflow`, `pacing`, `jlcut`) and `providers/fake.ts`.

- [x] **C1. Tools take `element_id`.**
  - `get_transcript`, `search_transcript`, `find_filler_words`, `find_silences` and the cut ops pass it through
    (B's contract).
  - Results name the source.
  - "No captions" becomes actionable:
    - transcript `pending` → "This video is still being transcribed (about a minute). Wait with wait_for_media or
      try again.";
    - `none` → "offer add_captions" (now free when a transcript exists).
- [x] **C2. Blank edits and context.**
  - Drop `OWN_VIDEO_TOOLS` gating when the clip has at least one speech source; keep it when there is none.
  - `<clip_context>` lists the speech sources (contract).
- [x] **C3. `find_retakes`** (read-only tool, `apps/web/lib/agent/retakes.ts`, pure, unit-tested):
  - sentence segmentation from the transcript lines;
  - 4-gram similarity > 0.7 within 60 s, plus sentence openers (first 3–5 words);
  - suggests keeping the last take.
  - Tests: a three-take sentence keeps the last; a deliberate repetition far apart is not flagged; another language
    still works on token level.
- [x] **C4. Guide `roughcut` + `/roughcut`.** Adapted from video-use, cut-video, the vincentventalon skill, takecut
  and Palmier `ugc-editing`, with rows in `THIRD_PARTY_NOTICES.md` (MIT / Apache-2.0):
  1. **Look:**
     - `get_transcript` (and `find_filler_words`, `find_silences`, `find_retakes`);
     - one `capture` contact sheet.
  2. **Propose in 4–8 sentences:** what goes (fillers, silences over ~0.6 s, false starts, earlier takes), what
     stays (laughs, dramatic pauses, the CTA), and the estimated new length. Wait for "go" unless the user already
     said "just do it".
  3. **Cut in this order, each as one call:**
     1. retakes and false starts (`remove_words`, keep the last take);
     2. fillers (`balanced`);
     3. silences (trim to about 0.3 s, never under 0.25 s, never cut inside a word).
  4. **Verify:**
     - re-read the transcript: every sentence still reads, nothing cut mid-word;
     - `capture` at 3–6 cut edges;
     - report before/after length and what was removed.
  5. **Captions last;** never caption before cutting is finished.
  6. Never cut more than about 1/5 without asking (keep the `pacing` rule); "when in doubt, keep".
  - `/roughcut` in `slash.ts`; route it in `prompt.ts`; starter "Rough cut my video" when the clip has a speech
    source.
- [x] **C5. Register everywhere tools are listed:**
  - `limits.ts`, `providers/anthropic.ts`, `providers.check.ts`, `agent-design.check.ts`;
  - `providers/fake.ts`, with a scripted `/roughcut`: plan → "go" → `find_retakes` → `remove_words` →
    `remove_silence` → reply;
  - `eval/tasks.ts`: 2 tasks, one rough cut and one "cut the second video only";
  - `docs/spec-editor-assistant.md`.
- [ ] **C6. E2E `apps/web/e2e/editor-roughcut.spec.ts`** (acceptance step 4).
  - Fixture: a short talk with a known transcript (sidecar for the fake transcriber, A3) containing "um", a 2 s
    pause and a sentence said twice.
  - Run it locally (`npm run test:e2e -- editor-roughcut`) and write the result in Notes.
  - It is not in CI (no e2e job exists); say so.

**Checks:** `npm run typecheck`, `npm run check:contracts --workspace @opencmo/web`, unit tests for `retakes.ts`,
the e2e spec locally.

**Notes (C):**

- 2026-10-15, first round (owner's call: C3–C5 now; C1, C2, C6 wait for A1/A5 and B1/B2/B4/B6, which have not
  landed). Nothing in C1/C2 is coded against the contract yet.
- C3: `retakes.ts` is pure. A sentence ends at a caption line end or . ? !; cut words are skipped and fillers
  ignored. Pairs within 60 s (start to start) are compared three ways, best score wins, > 0.7 groups them
  (union-find, so take 1 ~ 2 ~ 3 is one group):
  - Dice over word grams: 4 words, down to 2 for short sentences (one inserted word breaks every 4-gram of a
    6-word sentence);
  - words in order (LCS), sentences of 5+ words: "a day" → "every day" scores 0.63 on trigrams, 0.9 here;
  - a false start: same first 3 words and the shorter, earlier sentence mostly inside the later one.
  The result adds `drop_word_ids` to the contract's `{keep, drop, text, similarity}` (additive), so the model
  removes every dropped take in one `remove_words` without a second id lookup. `retakes.check.ts` (in
  `check:contracts`): three takes keep the last; a repeat 130 s later is not flagged; short replies and
  unrelated sentences are not; two sentences on one line split; a one-word change; Vietnamese; cut words.
- C4: guide `roughcut` (look → propose and wait → retakes, fillers `balanced`, `remove_silence` 0.6 s / 0.15 s →
  re-read and capture cut edges → report; captions last; when in doubt keep), `/roughcut` in `slash.ts`, routing
  line and guide name in `prompt.ts` (still < 6000 chars). `THIRD_PARTY_NOTICES.md` rows and
  `lib/agent/LICENSE-roughcut.md` (the four MIT texts with their copyright lines, Apache-2.0 for palmier-skills;
  rules rewritten, nothing copied). The starter is a Request to B (its file).
- C5 (all but the second-video eval task, which needs B's `element_id`): `find_retakes` in `READ_TOOLS`/`READS`
  (so parallel-safe), `OWN_VIDEO_TOOLS`, `ALWAYS_LOADED`, `providers.check.ts`, `agent-design.check.ts` §7a (runs
  the tool on the eval fixture, checks the slash directive and guide). The fake scripts `/roughcut` → plan →
  "go" (or "just do it") → `find_retakes` + `find_filler_words` → one `remove_words` → `remove_silence` → reply.
  Eval task `roughcut` with `ROUGHCUT_TRANSCRIPT` (false start, a sentence said twice, um/uh, 2 s pause);
  `EvalTask.transcript` lets a task bring its own words. `docs/spec-editor-assistant.md` updated.
  `limits.ts` needs nothing (the tool is fast and free).
- Checked: `npm run typecheck`; `npm run check:contracts` (exit 0); `npm run agent:eval -- --provider fake`
  38/39, with `roughcut` passing on the real editor-core cuts. The one failure, `explain-make`, fails the same
  way on the base commit (not this change).
- Outside C's files: one line in `apps/web/package.json` adds `retakes.check.ts` to `check:contracts`.
- 2026-10-15, second round, on B1–B3 (`b986c4c`):
  - C1: the five transcript read tools take `element_id` (B's `speechElement`) and pass it to
    `loadCaptions`; results carry `source {element_id, name, main?}` and summaries name the video when there
    are several. No transcript → `{captions: null, transcript: "pending" | "none", videos, next}` (`speech.ts`):
    pending when the file's `media_assets.transcript_status` is queued/running, read through the new optional
    `AgentWorkspace.transcriptStatus` (db: one RLS select; memory: a map). **Depends on A1's column:** until it
    lands the select fails and every such video reads as "none" (offer add_captions), never as an error.
    The pending text says "try again shortly" instead of "wait with wait_for_media": that tool waits for
    generations only, so naming it would send the model into a wait that returns at once.
  - Fix found on the way: B's `OpFailure` ("several videos with speech: pass element_id", "no video with id")
    thrown from a read tool reached the model as "This change could not be applied."; `toolFailure` now passes
    its message through.
  - C2: `clipScope` reads the document once per turn: a blank New edit keeps the cut tools as soon as it has a
    speech source (the tool list changes once per session, when the first transcript arrives); `eval/run.ts`
    gates the same way. `<clip_context>` gets `speech_sources` (name, id, main, duration, words or
    "transcribing…") when the clip has a video other than its own (a master-only clip is unchanged), and the
    script falls back to the first upload's words, shifted to where it starts on the timeline, so a New edit
    with a spoken upload no longer says "Nothing is spoken".
  - C5: eval task `second-video` (a library video linked to its own transcript next to the main one; the
    grader wants its fillers cut and the main video untouched). The fake picks the non-main speech source for
    "second video" and passes the result's `source.element_id` to `remove_words`.
  - Not done (not asked in C1): `guard()` still protects only the master's timing; a cut non-master video can
    be trimmed by hand like any rect.
  - Checked: `npm run typecheck`; `check:contracts` exit 0 (`agent-design.check.ts` §7b: read by id, default
    to main, named summaries, pending/none, a non-video id stays an error, `speech_sources`, upload script
    times); fake eval 39/40 (`second-video` and `roughcut` pass; `explain-make` fails on the base too).
- C6 waits for A3 (fake transcriber sidecar) and B4/B6 (editor wiring, test ids); see Requests.

---

## Requests

Cross-track asks. Format: `- [ ] (from X → owner Y) what and why`. The owner ticks it when done.

- [ ] (from C → owner B) Starter "Rough cut my video" in `components/editor/assistant/AssistantPanel.tsx`
  (`EXAMPLES`), shown when the clip has a speech source (`speechSources(document).length > 0`). It sends
  `/roughcut`; the slash command, guide and tool are in.
- [ ] (from C → owner A) A3's fake-transcriber sidecar must cover the C6 fixture: a short talk with "um", a 2 s
  pause and a sentence said twice. Please name the fixture path and the sidecar format in Notes (A).
- [ ] (from C → owner B) B6's `data-testid`s on the library badge and the Transcript source picker, for C6.
- [ ] (from B → owner A) Route shapes the editor (B4, `apps/web/lib/editor/media-transcript-client.ts`) calls; both
  under RLS, in `app/api/v1/editor/captions/**`:
  1. `GET /api/v1/editor/captions?media_ids=<uuid>,<uuid>…` (≤ 50 ids) →
     `{ "media": [{ "id": "<uuid>", "transcript_status": "none|queued|running|ready|failed|skipped" }] }`.
     Unknown or foreign ids are simply left out. The editor polls this every 5 s while a file is
     `queued`/`running`.
  2. `POST /api/v1/editor/captions/transcript` with body `{ clip_id, media_id, source_in, source_out }` → the
     `use_media_transcript` jsonb as is: `{status:"ready",src,hash}` | `{status:"pending"}` | `{status:"none"}`.
  Until these exist the editor treats 404 as "no automatic transcript" and does nothing.

---

## Out of scope for v1

See "Decisions". Also:
- reusing a transcript across two different uploads of the same bytes (a content hash at upload);
- languages other than what Scribe auto-detects;
- an owner-facing setting for the daily cap.
