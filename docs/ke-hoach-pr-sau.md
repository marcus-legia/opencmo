# Kế hoạch triển khai cho PR sau (sau PR 45)

PR 45 (`user-scenarios`) dừng ở `7b82628`, CI xanh. Việc kiểm thử và deploy của chính PR 45 nằm ở `docs/pr45-viec-con-lai.md`. File này là kế hoạch cho **PR tiếp theo**.

**Thứ tự đề xuất:** 0 → 1 → 2. Việc 3 và 4 chỉ làm khi số đo ở bước 0 cho thấy cần.

**Quy tắc chung** (CLAUDE.md):
- code, comment và commit bằng tiếng Anh;
- mỗi migration có pgTAP và chạy lại `scripts/dump-schema.sh`;
- sau khi đụng render/reframe/export phải trích frame từ file full-size để xem;
- đo RAM bằng `/usr/bin/time -v` (giới hạn < 2 GB mỗi job).

---

## 0. Trước khi code: đo Assistant với Claude thật (½ ngày)

Mục tiêu: có số liệu thật để quyết các cờ và biết chỗ nào còn chậm.

1. Chạy eval ba lần như mục 1 của `docs/pr45-viec-con-lai.md`: `3bfa858`, `user-scenarios`, và `user-scenarios` có bật `OPENCMO_AGENT_TOOL_SEARCH=1 OPENCMO_AGENT_CONTEXT_EDITING=1`.
2. Ghi vào bảng: số bài qua, `totals.steps`, `totals.calls`, `totals.input` / `cached` / `output`, `cost`, `seconds`.
3. Đọc `.agent-eval/<task>.json` của các bài trượt (`calls`, `reply`) và phân loại lỗi:
   - **chọn sai tool** → sửa mô tả tool hoặc bảng định tuyến trong `apps/web/lib/agent/prompt.ts`;
   - **không tìm thấy tool** (khi bật tool search) → thêm tên đó vào `ALWAYS_LOADED` trong `apps/web/lib/agent/providers/anthropic.ts`;
   - **gọi lặp** → xem lại guide tương ứng trong `guides.ts`.
4. Chạy kịch bản người dùng 4–15 (`npm run test:scenarios`) và **xem frame xuất ra**.
5. Quyết:
   - bật hai cờ ở production nếu lần 3 tốt hơn lần 2;
   - các mục sản phẩm ở mục 4 của `docs/pr45-viec-con-lai.md`.

**Xong khi:** có bảng số liệu trước/sau trong mô tả PR mới.

---

## 1. Export 24/25/50/60 fps đúng khung (2–3 ngày)

**Hiện trạng:**
- Document chạy trên lưới 30 fps: `FPS = 30` và `toFrames()` ở `packages/clip-render/src/tree.ts:27-30`.
- Exporter (`packages/clip-export/src/segment.ts:207-209`, `sceneFrame`) đã tính khung scene lẻ `start + j·30/fps` cho mỗi khung xuất. Nhưng renderer làm tròn về khung nguyên, nên 60 fps chỉ lặp mỗi khung hai lần; thời lượng vẫn đúng.
- Tiếng vẫn tính trên lưới 30 (`clip-export/src/export.ts:104-110`), không sao vì tiếng đi theo giây.

**Cách làm:**
1. **Viết test fail trước** trong `packages/clip-export/test`:
   - xuất một document có một hình chữ nhật trượt `x` tuyến tính trong 1 giây, ở 60 fps;
   - đọc khung 1 và 2 bằng ffmpeg: hai khung phải **khác nhau**. Hiện chúng giống nhau, test phải đỏ.
2. **Lần theo khung scene lẻ trong `clip-render`:**
   - hàm vẽ một khung (`index.ts`, `tree.ts`) nhận `frame: number` không làm tròn;
   - đánh giá keyframe (nội suy theo `time` giây: `frame / FPS`) dùng số lẻ;
   - animation vào/ra (`animations`, `phase`), `perWord` của phụ đề, transition giữa các đoạn;
   - các chỗ `Math.round(frame)` / `toFrames()` khi tra **thời gian**, không phải khi đặt mốc;
   - chọn khung video nguồn: `clip-export/src/decode.ts:177` đã dùng `round(seconds · fps nguồn)`, chỉ cần truyền giây lẻ;
   - Lottie (`segment.ts:152`, `lottieTime`) và cảnh 3D (`clip-three`: có `FPS = 30` riêng ở `spec.ts:111`, xem có cần nội suy không).
3. **Giữ nguyên hành vi 30 fps:**
   - `fps === 30` phải ra từng byte như cũ: chạy golden parity (`clip-render` vs DS, job `parity` trên CI) và `editor-parity`;
   - nếu golden đổi ở 30 fps là có lỗi.
4. **Đo bộ nhớ:** 60 fps vẽ gấp đôi số khung; đo `/usr/bin/time -v` trên fixture 18 cảnh (lần trước: 1005 MB ở 30 fps). Nếu vượt ngân sách thì giảm `parallelFor` theo fps.
5. **Xem tận mắt:** xuất 60 fps một clip có zoom và phụ đề pop, trích khung 30 và 31, xem chuyển động mượt.

**Xong khi:** test ở bước 1 xanh, golden 30 fps không đổi, RAM < 2 GB, đã xem frame.

---

## 2. Chống file project phình to khi cắt nhiều lần (2–3 ngày, cần thiết kế cẩn thận)

**Hiện trạng:**
- **Hai bản copy của track bám mặt:**
  - mark `reframe` của scene giữ track gốc: `mark.track` là các cặp `[giây nguồn, focus]` (`packages/editor-core/src/reframe.ts`);
  - từng đoạn cắt giữ track `x` suy ra từ nó. `segment()` ở `editor-core/src/captions.ts:169` chép **toàn bộ** track của video mẫu vào mỗi đoạn.
- **Hệ quả:** N đoạn cắt = N bản track. Với clip dài (kind `full`, 54 phút) cắt bởi `remove_silence` thành vài trăm đoạn, document có thể chạm giới hạn kích thước (`storedBytes` trong `clip-doc/src/validate.ts`).
- **Vì sao không cắt bớt đơn giản được:**
  - `writeCaptionState` dựng đoạn mới từ đoạn cũ phủ nhiều nhất (`templateFor`, `captions.ts:350`);
  - nếu track của đoạn đã bị cắt bớt thì khôi phục chữ (mở rộng đoạn) sẽ mất keyframe ở phần mở rộng, khung bám mặt bị trôi.

**Thiết kế đề xuất: mark `reframe` của scene là nguồn duy nhất của track `x` bám mặt.**
1. **Đo trước:** viết script tạo một clip 10 phút có track bám mặt, rồi `remove_silence` 3 lần; in `storedBytes` trước/sau. Nếu < 30% giới hạn với clip 54 phút thì **dừng, không làm** (ghi số vào issue).
2. **Trong `segment()`:**
   - với track `x`, khi scene có `reframe.track` và chế độ khung trượt theo mặt, **dựng lại** keyframe của đoạn từ `mark.track`, chỉ lấy các mốc trong `[sourceIn, sourceOut]` cộng một mốc ngay trước và một mốc ngay sau;
   - dùng `xForFocus` với bề rộng hộp hiện tại, như `reframe.ts:249-260` đang làm;
   - các track khác (`scale`, `volume`, keyframe tay của người dùng) giữ nguyên như bây giờ.
3. **Keyframe `x` người dùng tự sửa:** nếu track `x` của đoạn mẫu có keyframe **không trùng thời điểm** với `mark.track` (người dùng tự thêm), giữ các keyframe đó thay vì dựng lại. Viết hàm thuần `faceXTrack(mark, range, box, userKeys)` và test riêng.
4. **Đổi khung (`setFrame` / reframe):**
   - hiện code tra focus theo thời điểm keyframe (`reframe.ts:236-241`);
   - kiểm tra lại với track đã cắt bớt: mốc theo thời gian vẫn khớp; bỏ nhánh dự phòng tra theo **chỉ số** (`mark.track[index]`), vì nó sai khi track đã cắt bớt.
5. **Migration document cũ:** không cần. Document cũ vẫn đúng; lần cắt kế tiếp tự gọn lại.
6. **Test** (`editor-core`):
   - cắt 50 đoạn: tổng số keyframe `x` ≈ độ dài track gốc + 2 × số đoạn;
   - khôi phục một đoạn đã cắt: phần mở rộng có đủ keyframe;
   - đổi 9:16 → 1:1 → 9:16 sau khi cắt: `x` khớp với trước;
   - keyframe tay vẫn còn sau khi cắt lại;
   - golden `ops.test.ts` và `golden.test.ts` không đổi ở clip chưa cắt.
7. **Xem tận mắt:** xuất clip đã cắt nhiều lần, trích frame ở 5 chỗ cắt: mặt vẫn ở giữa.

**Xong khi:** đo ở bước 1 giảm rõ rệt, mọi test xanh, đã xem frame.

---

## 3. `capture` chạy trên worker thay vì vòng qua tab (chỉ khi bước 0 cho thấy cần)

**Vì sao cân nhắc:**
- Mỗi lần `capture`, request hiện tại kết thúc (`awaiting_browser`), tab vẽ ảnh, rồi POST lên request mới.
- Request mới phải nạp lại session, catalog, scope và lịch sử (`apps/web/lib/agent/loop.ts`, `resumeTurn`).
- Assistant chụp sau gần như mọi lần sửa, nên đây có thể là chỗ trễ lớn nhất.

**Đo trước (bước 0):** từ log thời gian của eval với model thật và kịch bản người dùng, tính phần trăm thời gian một lượt dành cho vòng `capture`. Nếu < 20% thì không làm.

**Cách làm nếu đáng:**
1. **Loại task mới:** `render_frames`, kèm migration và pgTAP; theo mẫu `render_document`.
2. **Phía worker:**
   - `packages/engine` gọi `clip-export` (Node, đã chạy trên Modal) để vẽ đúng các khung yêu cầu;
   - giải mã nguồn bằng `-ss` trước `-i` và `USER_INPUT`, theo luật CLAUDE.md số 4 và 7;
   - trả JPEG lên storage.
3. **Phía server:** `scope.ts` cho `capture` chạy kiểu `run` thay vì `browser` khi cờ `OPENCMO_AGENT_SERVER_CAPTURE=1`: tạo task, chờ tối đa ~20 s, trả ảnh.
4. **Dự phòng:** quá thời gian thì quay về đường tab như cũ.
5. **So sánh:** đo thời gian một lượt có 3 lần capture theo cả hai đường. Chỉ giữ đường worker nếu nhanh hơn ở **cả** lúc worker đang ấm lẫn lúc khởi động lạnh.

---

## 4. Quyền gọi trực tiếp `save_editor_document` / `agent_record_tool` (thấp)

**Hiện trạng:**
- **Grant:** cả hai hàm được grant cho `authenticated`; xem `supabase/migrations/20261003100000_editor_drop_source.sql:366` và `20260927090000_agent_providers_browser_tools.sql:370`.
- **Ai gọi:** route handler (`apps/web/lib/editor/document.ts`, `lib/editor/apply.ts`) gọi với quyền người dùng, nên thu hồi grant sẽ hỏng autosave.
- **Mức lộ:** người dùng chỉ ghi được document của chính mình, nhưng có thể bỏ qua lớp kiểm zod / `validate()` của web.

**Cách làm:**
1. Ghi một issue và chấp nhận rủi ro **hoặc** đưa phần kiểm cốt lõi xuống SQL:
   - kích thước (đã có);
   - `jsonb_typeof` của các trường bắt buộc;
   - id không trùng (có thể làm bằng hàm SQL đệ quy).
2. Không dùng service role ở route handler cho việc này: CLAUDE.md chỉ cho dùng admin ở webhook, cron, CMO runner và MCP.

---

## Ngoài kế hoạch (đã có trong `docs/pr45-viec-con-lai.md`)

- Model video mặc định (Seedance / Veo).
- Ảnh nền bị kiểm duyệt chặn nhầm là logo.
- Phụ đề AI đè lên phụ đề in sẵn.
- Layout chia đôi trống ô trên: xem sau bước 0.
