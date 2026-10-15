# Spec: Editor và Assistant của OpenCMO (bối cảnh cho session mới)

Đọc file này trước, rồi đến:
- `CLAUDE.md`: luật của repo;
- `docs/pr45-viec-con-lai.md`: việc còn lại của PR 45;
- `docs/ke-hoach-pr-sau.md`: kế hoạch PR tiếp theo.

Mọi tên hàm và đường dẫn dưới đây đều có trong code ở nhánh `user-scenarios`.

---

## 1. Mục tiêu

**Editor của OpenCMO** phải làm được bốn việc trong một chỗ:
1. **Sinh video AI** từ một câu mô tả (`/video`).
2. **Sửa video của chính người dùng**: cắt theo lời nói, phụ đề, khung hình, màu, nền mới.
3. **B-roll** trộn video thật (thư viện) với video và ảnh AI.
4. **Animation**: chữ, sơ đồ, biểu đồ, icon, Lottie, cảnh 3D.

**Assistant** là chat trong editor, làm các việc đó bằng tool. Luật sản phẩm (CLAUDE.md) ràng buộc nó:
- **Hỗ trợ, không tự hành động:** thứ gì tốn credit đều hiện thẻ giá để người dùng duyệt trước.
- **Video phải của chính người dùng.**
- **AI ảnh và video chỉ đi qua kiểm duyệt:** cấm người thật nhận diện được, cấm logo hãng khác, giọng chỉ dùng loại có sẵn.
- **Không quảng cáo tên model như tính năng.**

**Ngân sách cứng:** < 2 GB RAM mỗi job; video 45 phút → 5 clip trong < 3 phút.

## 2. Bản đồ hệ thống

```
apps/web (Next.js, Vercel)
  components/editor/            editor trong trình duyệt (canvas, timeline, thư viện OPFS, panel Assistant)
  components/editor/generate/   useGenerations: chạy các khai báo AI, ghi kết quả vào thư viện
  lib/agent/                    Assistant: vòng lặp, tool, prompt, guide, team, eval
  lib/generate/                 catalog model, spec hash, tạo generation, kiểm duyệt prompt
  app/api/v1/                   API: đọc dưới RLS, ghi qua RPC
supabase/                       Postgres: RPC có kiểm chủ sở hữu, credit hold/settle, pgTAP
packages/engine                 worker Modal (Python): generate, render_document, captions, sweep 1 phút
packages/editor-core            op chỉnh sửa: đường ghi DUY NHẤT (nút bấm, API, Assistant)
packages/clip-doc               schema document (zod), validate
packages/clip-render            renderer Canvas 2D (trình duyệt + Node), lưới 30 fps
packages/clip-export            document → MP4 (ffmpeg streaming), chạy trên worker
```

**Document** là cây JSON (stage → scene → các node). Mọi thay đổi đi qua op của editor-core (`applyOps`). Server luôn `validate()` trước khi lưu.

## 3. Một lượt Assistant chạy thế nào

**Tệp chính:**
- `apps/web/lib/agent/session.ts`: bắt đầu và nối tiếp lượt;
- `loop.ts`: vòng lặp;
- `scope.ts`: tool, lập kế hoạch và quyết định cho từng loại phiên;
- `providers/anthropic.ts`: gọi Claude (mặc định); `providers/gemini.ts`: gọi Gemini. Kiểm duyệt hỏi Claude trước ở mỗi lần; chỉ khi chính lần gọi đó Claude không trả lời được mới hỏi Gemini cùng policy. Tool search, context editing và strict tool chỉ có ở Claude.

1. **Bắt đầu:** `startTurn` dựng scope **một lần** cho request. Tin nhắn đầu gồm câu lệnh, `<clip_context>` (kịch bản clip theo giây) và `<project_state>` (tóm tắt và `<check>`).
2. **Mỗi bước trong `runTurn`:**
   - kiểm trạng thái lượt (Stop) và cổng credit. Tổng credit lấy từ kết quả `agent_record_usage` của bước trước; chỉ đọc lại toàn bộ khi bước trước có tool trong `SLOW_PLANS`;
   - kiểm giới hạn thời gian của request;
   - gọi model. Lịch sử nằm trong bộ nhớ của request; ảnh cũ được cắt theo đợt, xem `imagesOver`.
3. **Chạy tool:**
   - các tool chỉ-đọc liền nhau chạy song song (`PARALLEL_SAFE`, `readGroup`); tool ghi chạy tuần tự;
   - mỗi call được `scope.plan()` phân loại: `run` | `browser` | `approval` | `input` | `invalid`.
4. **Tạm dừng:** request kết thúc và tab gọi tiếp khi lượt cần một trong các thứ sau:
   - trình duyệt chạy tool (`capture`, `save_frame`…), trạng thái `awaiting_browser`;
   - người dùng duyệt thẻ giá, `awaiting_approval`;
   - người dùng trả lời câu hỏi, `awaiting_input`;
   - request hết thời gian (`time`) hoặc lượt hết credit giữ (`budget`), cả hai là `awaiting_continue`.
5. **Sau mỗi bước có ghi:** model thấy `<project_state>` và `<check>` mới.
6. **Cổng kiểm tra:** model định kết thúc mà bản kiểm tra còn lỗi **do nó gây ra trong request này** (so với `checkErrorKeys` lúc trước lần ghi đầu) → loop nhắc một lần (`VERIFY_GATE`, `failingCheck`). Lỗi có sẵn từ trước không tính.
7. **Kết thúc:** settle credit (trừ theo mức dùng thật, trả lại phần giữ thừa). Nút Undo đưa clip về checkpoint chụp trước lần ghi đầu của lượt.

**Hai phiên khác dùng chung vòng lặp:** trang project (`PROJECT_SYSTEM_PROMPT`, `apply_to_clips`) và CMO chat (`CMO_SYSTEM_PROMPT`).

## 4. Bộ tool

**Định tuyến** (system prompt ở `lib/agent/prompt.ts`): từ ý định của người dùng tới tool **cấp cao nhất**:

| Người dùng muốn | Tool |
|---|---|
| Video mới hoàn toàn (New edit trống) | `create_video` |
| Đổi diện mạo video của mình một đoạn | `edit_video`; nền mới: `replace_background` |
| Intro / title card | `plan_video` |
| B-roll từ thư viện | `place_broll` (nhiều cảnh, một lệnh, một undo) |
| Media AI mới | `generate_media`, rồi `wait_for_media` |
| Giải thích ý | `add_diagram`, `add_chart`, `add_graph`, `add_shape`, `add_icon`, `add_lottie`, `set_layout` |
| 3D | `add_3d_scene` (đọc guide "3d") |
| Narrated animated explainer (`/explain`) | `preview_explainer` → `add_explainer` (guide "explainer") |
| Gọn lời nói | `remove_silence`, `find_filler_words` + `remove_words`, `remove_ranges` |
| Rough cut of a self-recorded talk (`/roughcut`) | `find_retakes` + `find_filler_words` → `remove_words`, then `remove_silence` (guide "roughcut") |
| Giọng mới | `add_voiceover` |
| File để tải | `request_export` |

**Tool tốn credit** (luôn qua thẻ giá): `generate_media`, `create_video`, `edit_video`, `replace_background`, `add_voiceover`, `add_3d_scene`, `add_explainer`, `add_captions`.

**Tool cấp cao do PR 45 thêm:**
- `place_broll` (`tools.ts`):
  - mỗi cảnh hiện đúng lúc người nói nói câu được trích;
  - phủ khung hoặc picture-in-picture, tắt tiếng khi đè lên người nói, có fade;
  - một cảnh sai thì không đặt cảnh nào.
- `wait_for_media` (`wait-tool.ts`): chờ tối đa 60 giây các bản ghi `generations` của clip; trả về xong / lỗi (đã hoàn credit) / còn đang sinh.

**Explainers** (`explainer-tool.ts`, plan `docs/explainer-build.md`):
- `preview_explainer` is a server tool (not a tab tool): `previewMotion` renders 4–6 stills of the Remotion scene code and a layout report; the stills go to the model as images and to the panel over SSE (not stored with the call). It is in `SLOW_PLANS`.
- `add_explainer` refuses code that was not previewed in the same turn, saves the code to `scene_codes`, prices a `motion-explainer` spec (seconds + voice characters) and shows a card with one line per beat. Moderation reads the script and every string in the code. On Approve, op `add_explainer` places one video layer `Explainer: <title>` (one Undo step; it sets the frame on a blank New edit).
- The fake provider scripts `/explain` → script → "go" → `preview_explainer` → `add_explainer` with Track A's showcase.

**Rough cut** (`retakes.ts`, plan `docs/own-video-editing-build.md` Track C):
- `find_retakes` is a read tool (parallel-safe, always loaded): sentences from the transcript lines (a line end or . ? ! ends one, cut words skipped, fillers ignored), compared within 60 s by word-gram Dice (4 words, fewer for short sentences), by words in order (5+ words, so one changed word still matches) and by a false start's opening words. Above 0.7 the takes form a group; it suggests keeping the last take and returns the earlier ones as `drop` ranges and `drop_word_ids` for one `remove_words`. Suggestions only: the model reads the lines first.
- Guide `roughcut` and `/roughcut`: look (transcript, fillers, silences, retakes, a contact sheet) → propose in 4–8 sentences and wait for "go" → retakes, then fillers (`balanced`), then `remove_silence {min_pause: 0.6, padding: 0.15}` → re-read the transcript and capture cut edges → report before/after. Rules adapted from MIT/Apache editing skills (`THIRD_PARTY_NOTICES.md`).
- The fake provider scripts `/roughcut` → plan → "go" (or "just do it") → `find_retakes` + `find_filler_words` → `remove_words` → `remove_silence` → reply; eval task `roughcut` uses `ROUGHCUT_TRANSCRIPT` (a false start, a sentence said twice, fillers, a 2 s pause).

**Bộ tool theo loại clip:** New edit trống không có các tool cắt theo lời (`OWN_VIDEO_TOOLS`), vì không có video gốc để cắt.

**Không đưa cho model** (`NOT_OFFERED`): `update_element`, `paste_nodes`, `insert_scene`, `activate_scene`, `move_part`, `move_keyframe`.
- Op vẫn còn cho UI và cho lịch sử chat cũ.
- `set_props` thay `update_element`, và mang cùng quy tắc chặn (`guardProps`).

**Guide** (`guides.ts`, đọc bằng `read_guide`): workflow, script, broll, pacing, hooks, captions, motion, visuals, layout, reframe, jlcut, roughcut, voiceover, video, blank, brand, 3d, explainer, document…

**Hai cờ, tắt mặc định:**
- `OPENCMO_AGENT_TOOL_SEARCH=1`: chỉ ~44 tool trong `ALWAYS_LOADED` (`providers/anthropic.ts`) luôn nạp; phần còn lại nạp khi model tìm (BM25 tool search).
- `OPENCMO_AGENT_CONTEXT_EDITING=1`: khi request vượt 80k token đầu vào, server xoá các kết quả tool cũ; giữ 6 kết quả gần nhất cùng guide, skill và plan.

## 5. Agent team (sub-agent)

Tất cả đi qua `structured()` (`lib/cmo/jobs/llm.ts`):
- một lần gọi có schema zod;
- system prompt được cache;
- model chọn qua `resolveAgent` (`lib/cmo/agents/registry.ts`, tier `draft` = Sonnet, `check` = Haiku).

**Hai team:**
- **Video director** (`create-video.ts`, tool `create_video`):
  - viết kịch bản lời đọc và danh sách cảnh; code tự kiểm (độ dài, độ dài cảnh theo model, chuỗi cảnh nối tiếp), sửa tối đa một vòng;
  - sau khi duyệt, mọi cảnh, giọng và nhạc sinh song song.
- **Intro team** (`video-team.ts`, tool `plan_video`):
  - Writer (tier `check`) viết tiêu đề; Motion director lên các nhịp;
  - reviewer là code (`reviewIntro`), sửa tối đa một vòng.

**Not a team: explainers.** The Assistant writes the explainer code and is its own visual critic: it looks at the `preview_explainer` stills and fixes the code, at most 3 rounds. There is no director sub-agent in v1.

**Hai team chạy trong `scope.plan()`**, trước khi hiện thẻ duyệt: người dùng duyệt đúng thứ sẽ được áp. Chi phí của team ghi vào lượt. Vì một lần lên kế hoạch có thể mất tới ~3 phút, các tool trong `SLOW_PLANS` không được bắt đầu sau 110 giây của request.

## 6. Đường đi của media AI

1. **Khai báo:** op đặt một khai báo `{generate: "video" | "image" | "voice" | "audio", prompt, model, seed, …}` làm `src` của phần tử.
2. **Spec hash:** server tính bằng JCS + sha256 (`specHash`, `lib/generate/models.ts`). Trình duyệt tính được y hệt (`chain.ts`, kiểm bằng `chain.check.ts`).
3. **`create_generation` (RPC):**
   - giữ credit;
   - dùng lại generation đang chạy hoặc đã xong có file; hash của generation đã xong mà mất file thì bị loại;
   - cảnh nối tiếp (`after` = hash cảnh trước) chờ cảnh trước xong.
4. **Worker Modal:** gọi provider (fal, ElevenLabs), đọc output như media không tin cậy (`USER_INPUT`), kiểm duyệt ảnh và khung video (`opencmo/ai/moderation.py`), upload. Lỗi thì hoàn credit.
5. **Trình duyệt** (`useGenerations`): tải file về thư viện OPFS. Export vẫn tìm được generation đã xong kể cả khi tab đã đóng (`render_document_task.py`).
6. **Regenerate** một cảnh mà các cảnh sau nối tiếp nó: các cảnh sau được trỏ lại vào hash mới (`continuationsOf`), menu ghi rõ và tính đủ giá.

## 7. Quyết định thiết kế và lý do

- **System prompt và danh sách tool cố định từng byte, thứ tự xác định:** đó là đầu của prompt cache. Tool mới thêm vào **cuối**.
- **Tối đa 20 tool strict:** giới hạn của API. Tool tốn tiền được ưu tiên strict (`strictTools`); `generate_media` không dùng eager streaming để API tự kiểm JSON.
- **Model giả không bao giờ chạy ở production:** `isProduction()` = `VERCEL_ENV=production` hoặc `OPENCMO_ENV=production`. Thiếu key kiểm duyệt ở production thì từ chối media AI thay vì bỏ qua kiểm duyệt.
- **Cổng kiểm tra chỉ tính lỗi mới:** nếu không, model sẽ đi "sửa" cảnh AI đang sinh, hoặc khoảng đen vốn có của New edit trống.
- **Lịch sử chỉ được nối thêm, không bao giờ sửa:** thinking block bị ràng buộc với lịch sử (beta `thinking-binding-controls`, `drop_block`).
- **Hai cờ tắt mặc định** cho tới khi eval với model thật cho thấy có lợi.
- **Kiểm ba lớp:** zod → giới hạn trong RPC → worker parse lại. Ghi luôn qua RPC kiểm chủ sở hữu; giữ credit và tạo việc nằm trong một transaction.

## 8. Biến môi trường liên quan

| Biến | Ý nghĩa |
|---|---|
| `OPENCMO_ENV=production` | Production tự host: tắt model giả, kiểm duyệt bắt buộc. Đặt ở cả web lẫn worker |
| `OPENCMO_AGENT_FAKE=1` | Assistant giả có kịch bản (`providers/fake.ts`), cho check và E2E |
| `OPENCMO_AI_FAKE=1` | Catalog media giả (ffmpeg, không tốn tiền), đặt ở cả web lẫn worker |
| `OPENCMO_AGENT_TOOL_SEARCH=1` | Nạp tool chuyên biệt khi cần |
| `OPENCMO_AGENT_CONTEXT_EDITING=1` | Xoá kết quả tool cũ trong chat dài |
| `ANTHROPIC_API_KEY`, `FAL_KEY` | Model thật; kiểm duyệt cần cả hai |
| `GEMINI_API_KEY` | Có thì panel cho chọn thêm Gemini; team con dùng được Gemini |
| `OPENCMO_AGENT_PROVIDER=anthropic\|gemini` | Model mặc định của chat mới (không đặt: Claude nếu có key) |
| `CMO_LLM_PROVIDER=anthropic\|gemini` | Provider của mọi agent CMO và team con (`structured()`); `CMO_AGENT_<ID>_PROVIDER` cho từng agent |

## 9. Cách kiểm

```bash
npm run typecheck
cd apps/web && npm run check:contracts      # gồm agent-design, video-usecases, chain, generations, providers…
npm run test:editor-core                    # ở thư mục gốc
cd apps/web && npm run agent:eval -- --provider fake                     # 36/36, miễn phí
cd apps/web && npm run agent:eval -- --provider anthropic --yes          # model thật, tốn tiền
cd apps/web && npm run test:scenarios       # UI thật + model thật, cần `npm run dev`
```

- **Eval với model giả** chỉ chứng minh tool chạy được từ đầu đến cuối, không chứng minh model thật chọn đúng tool. Số liệu thật lấy từ `--provider anthropic`: so `.agent-eval/report.json` (`totals.steps`, `calls`, `input`, `cached`, `output`, `cost`).
- **Thêm bài eval:** `lib/agent/eval/tasks.ts`, kèm kịch bản cho model giả trong `providers/fake.ts`.
- **CI:** web, engine, database (pgTAP), parity (`clip-render` so với DS), browsers.
- **Sau khi đụng render, reframe, phụ đề hay export:** trích frame từ file full-size và **nhìn tận mắt**.

## 10. Đang ở đâu (13/10/2026)

**PR #45** (`user-scenarios`):
- **Batch 1–9:** sửa lỗi cả editor (tiền và credit, export, cắt và b-roll, luồng agent, `/video`, regenerate chuỗi cảnh).
- **Phần "Assistant cấp cao":** runtime, tool mới, cổng kiểm tra, prompt định tuyến, hai cờ, eval 36/36.
- **Trạng thái:** CI xanh; chưa có review.

**Chưa làm:**
- đo với Claude thật;
- chạy kịch bản người dùng 4–15;
- deploy (3 migration 150–152, font Noto trên Modal).

Chi tiết ở `docs/pr45-viec-con-lai.md`.

**PR sau:** `docs/ke-hoach-pr-sau.md`. Thứ tự: đo trước → export 60 fps → file project phình to → `capture` trên worker (nếu cần) → quyền RPC.

**Giới hạn đã biết:**
- mỗi đoạn cắt là một node video (~440 byte): document chạm giới hạn 256 KB ở khoảng 590 đoạn cắt;
- `capture` phải vòng qua tab trình duyệt;
- `save_editor_document` / `agent_record_tool` được grant cho `authenticated`.

## 11. Mở những file này trước

| Mảng | File |
|---|---|
| Luật repo | `CLAUDE.md` |
| Vòng lặp | `apps/web/lib/agent/session.ts`, `loop.ts`, `scope.ts`, `limits.ts` |
| Model | `apps/web/lib/agent/providers/anthropic.ts`, `providers/types.ts`, `providers/fake.ts` |
| Tool | `apps/web/lib/agent/tools.ts`, `wait-tool.ts`, `generate-tool.ts`, `create-video.ts`, `edit-tool.ts`, `background-tool.ts`, `video-team.ts`, `turn-tools.ts`, `captions-tool.ts`, `export-tool.ts` |
| Prompt, guide | `apps/web/lib/agent/prompt.ts`, `guides.ts`, `slash.ts` |
| Eval, check | `apps/web/lib/agent/eval/run.ts`, `eval/tasks.ts`, `agent-design.check.ts`, `video-usecases.check.ts` |
| Sub-agent | `apps/web/lib/cmo/jobs/llm.ts`, `apps/web/lib/cmo/agents/registry.ts` |
| Media AI (web) | `apps/web/lib/generate/models.ts`, `create.ts`, `apps/web/components/editor/generate/useGenerations.ts`, `chain.ts` |
| Op chỉnh sửa | `packages/editor-core/src/ops/index.ts`, `captions.ts` (cắt), `reframe.ts` (khung), `check.ts` (lint) |
| Render, export | `packages/clip-render/src/tree.ts`, `packages/clip-export/src/export.ts`, `segment.ts`, `decode.ts` |
| Worker | `packages/engine/opencmo/ai/moderation.py`, các task generate, render_document, sweep |
| Database | `supabase/migrations/2026112*` (gần nhất), `supabase/schema/current.sql` |
