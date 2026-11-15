# Editor & motion: CapCut Web — quay trong trình duyệt, xuất một đoạn, ảnh bìa, freeze / reverse / tốc độ cong  (2026-11-15)

Session A của plan [`docs/plans/editor/2026-11-15-capcut-bundle-study-plan.md`](../../plans/editor/2026-11-15-capcut-bundle-study-plan.md)
(bước A0). Phần timeline (zoom, snap, luật thả clip, vẽ timeline) là của session B, báo cáo riêng.

Nguồn: bundle JS của `capcut.com/editor` lấy ngày 2026-11-09, ở `opencmo-internal/research/bundles/capcut/pretty/`.
Đây là đọc **tĩnh** (code đã minify, không source map); số dòng tính theo các file `pretty/`. Code của CapCut không có
licence cho mình: **chỉ học hành vi, không chép code, chuỗi, schema hay tên hàm.**

## TL;DR

- CapCut có **recorder kèm teleprompter**: ô chữ tới 12.000 ký tự, cỡ chữ 16–32, kéo đi được, đổi kích thước được,
  đếm ngược 3 giây. Đây đúng là thứ founder cần để quay theo script CMO viết: script nằm ngay cạnh camera.
- Recorder cắt bản ghi **mỗi 3 giây một mẩu**, vừa lưu IndexedDB vừa upload dần; bấm dừng là mẩu cuối lên ngay, nên
  file gần như có sẵn trên server lúc người dùng dừng. Mỗi lần bấm quay → dừng là **một đoạn** đặt vào timeline đúng chỗ
  bắt đầu quay; pause không tạo đoạn mới.
- **Xuất một đoạn** có hai kiểu: (1) chỉ các clip đang chọn, (2) mọi thứ nằm trong khoảng thời gian của các clip đang
  chọn. Phía mình, `clip-render` **đã** xuất theo `workarea`, nên kiểu (2) gần như chỉ là UI.
- **Ảnh bìa**: lấy 15 khung rải đều trên video, một model trên server chọn 5 khung đẹp nhất, người dùng chọn một.
- **Freeze** = chụp khung tại playhead thành ảnh, chèn thành một đoạn ảnh (cắt clip tại đó). **Reverse** là task chạy
  trên server. **Tốc độ cong** = danh sách điểm `(x, y)` có tên preset.

## Phát hiện

### 1. Recorder (`pretty/audio-recorder.*.js`, 4.185 dòng)

- **Bốn kiểu quay**: màn hình, webcam, chỉ tiếng, kết hợp (màn hình + webcam) (~dòng 2975).
- **Mẩu 3 giây**: recorder khởi tạo với khoảng dữ liệu 3.000 ms (~3512). Mỗi mẩu được ghi vào IndexedDB (một DB riêng
  cho recorder) theo `(đoạn, thứ tự)`, rồi gửi lên một upload dạng luồng có số thứ tự và cờ "mẩu cuối" (~290–305). Lỗi
  upload một mẩu không dừng việc quay; bản IndexedDB là bản dự phòng để ghép lại thành file (`Blob` theo thứ tự) khi cần
  (~330–345).
- **Đoạn (segment)**: mỗi lần bắt đầu quay tạo một đoạn với `startTime` tính từ mốc đầu phiên trừ thời gian pause;
  dừng thì chốt `duration` và tăng chỉ số đoạn (~3165–3205). Pause/resume chỉ cộng dồn thời gian pause.
- **File**: video ghi WebM ở trình duyệt; server trả về MP4/HLS và một ảnh bìa (~3030–3070).
- **Gương (mirror)**: cờ mirror của webcam đi kèm upload, server lật khi xử lý (~284), không lật trên trình duyệt.
- **Quay tiếng đè lên video có sẵn**: trước khi quay, player lùi 3 giây trước playhead rồi phát, đếm ngược 3 giây, để
  người nói vào đúng nhịp hình (~2297–2313).
- **Teleprompter** (~920–1080): ô chữ tối đa 12.000 ký tự, cỡ chữ 16–32 bước 4, line-height 1,4, kéo đi được,
  đổi kích thước được, placeholder mời dán chữ vào.
- Chọn thiết bị mic/camera, bật/tắt từng cái, quay lại từ đầu, huỷ (tên method: `setMicDeviceId`, `setCameraDeviceId`,
  `toggleMic`, `toggleCamera`, `restartRecord`, `cancelRecord`).

### 2. Xuất một đoạn (`pretty/partial-export.*.js`)

- Nút cạnh Export, tắt khi chưa chọn gì. Hai lựa chọn có video minh hoạ (~55–170):
  1. **Chỉ các clip đang chọn** (bỏ các lớp khác);
  2. **Mọi nội dung trong khoảng thời gian của các clip đang chọn** (mọi track, từ đầu tới cuối vùng chọn).
- Hiện khoảng `mm:ss:ff – mm:ss:ff` (tính ở 30 fps) trước khi xuất (~215).

### 3. Ảnh bìa (`pretty/cover-entrance.*.js`, `pretty/src-editor-5.*.js` ~17026–17200)

- Ô ảnh bìa ở đầu timeline: thêm, sửa, xoá (có hỏi lại trước khi xoá).
- Gợi ý: lấy **15 khung** rải đều theo độ dài, gửi lên một API phân tích trả **top 5**, người dùng chọn một. Kết quả bị
  bỏ nếu draft đã đổi trong lúc chờ (so thời điểm sửa draft).
- Bìa lưu trên draft (`draft.setCover` / `clearCover` trong Data SDK).

### 4. Công cụ clip (`pretty/basic-actions.*.js`, `pretty/widget-2.*.js` ~7188–7285, `pretty/editor.js`)

- Thanh công cụ: split, smart split, freeze, reverse, flip, crop, smart crop, tốc độ cong (có bật/tắt trục xem trước),
  xoá, bật/tắt "attach" (snap).
- **Freeze**: dừng player, chụp khung tại playhead, đưa khung đó thành một media ảnh, chèn thành một đoạn ảnh tại
  playhead với độ dài mặc định (hằng số này không có trong chunk đã lấy; CapCut desktop dùng 3 giây, *chưa xác minh*).
- **Reverse**: tạo một task trên server (`createReverseTask`), đoạn được thay bằng file đã đảo khi task xong.
- **Tốc độ cong**: `curve_speed` có `name` (preset) và `speed_points` gồm các điểm `{x, y}` (~84910–84950); ngoài ra
  còn tốc độ hằng (`setSpeed`).
- Smart split, ổn định hình, tách nền, theo dõi vật thể… đều là task server (`create*Task` trong `src-editor-5`).

## Phía mình hôm nay (đã kiểm trong code)

| Việc | Hiện trạng | File |
|---|---|---|
| Quay trong trình duyệt | **Chưa có.** Không có `getUserMedia` / `MediaRecorder` trong `apps/web`. | — |
| Video mới từ một bản ghi WebM | **Đã chạy được**: upload tính tiền theo độ dài master khi header không có độ dài. | `packages/engine/opencmo/worker/process_job.py:182` |
| Media thư viện là WebM của trình duyệt | **Sẽ hỏng**: `probe_media` loại file có độ dài ≤ 0 (WebM của `MediaRecorder` không ghi độ dài). | `packages/engine/opencmo/worker/probe_media.py:111` |
| Thư viện: bytes trên máy + upload | OPFS/IndexedDB trên máy; `POST /uploads` → TUS → `POST /projects/[id]/media`. | `components/editor/library/local.ts`, `store.ts` |
| Xuất theo vùng làm việc | **Đã có**: export bắt đầu và dừng theo `scene.workarea`. | `packages/clip-render/src/index.ts:125` |
| Xuất "chỉ clip đang chọn" | Chưa có. | — |
| Ảnh bìa | Chưa có trên document. | `packages/clip-doc/src/schema.ts` |
| Tốc độ hằng | Có (`playbackRate`). | `packages/clip-doc/src/timing.ts` |
| Flip | `scaleX` âm có thể dùng; chưa có nút. Kiểm thêm ở A3. | `packages/clip-render` |
| Freeze, reverse, tốc độ cong | Chưa có. | — |

## Gắn vào OpenCMO

Học hành vi, viết lại theo kiến trúc của mình; không chép gì của CapCut.

### A1 — Quay trong trình duyệt (L)

Hai lối vào, làm theo thứ tự:

1. **"Quay video" từ script của CMO** (lối chính). Panel recorder mở với script của edit làm teleprompter (cỡ chữ,
   kéo đi được, đếm ngược 3 giây, chọn mic/camera, xem trước có gương nhưng file không lật). Dừng quay → file WebM →
   **đường upload video mới đang có** (`process_job.py`): master, transcript, khung mặt, tính tiền theo độ dài. Không
   cần sửa worker.
2. **"Quay vào edit này"** (một take hoặc lời đọc đè tại playhead): file đi đường thư viện. Phải sửa `probe_media` để
   remux bản ghi WebM thành MP4 trước khi probe (stream copy, `-ss` không cần, đo RAM), để có độ dài và tua được. Đoạn
   mới đặt tại playhead; quay tiếng đè thì lùi 3 giây và phát như CapCut.

Chống mất bản ghi: mỗi mẩu `MediaRecorder` (timeslice ~3 giây) ghi ngay vào bộ nhớ trên máy của thư viện (OPFS/IDB,
khoá riêng của recorder). Mở lại editor mà còn bản ghi dở thì hỏi "Khôi phục / Bỏ". Upload sau khi dừng bằng TUS (có
resume) là đủ cho bản đầu; upload song song lúc đang quay để sau, chỉ làm nếu đo thấy chờ lâu.

Trình duyệt: chọn mime bằng `MediaRecorder.isTypeSupported` (WebM VP8/VP9+Opus trên Chrome/Firefox, MP4 trên Safari).
Worker vẫn coi là media không tin cậy (`USER_MEDIA_FORMATS` đã có `webm`, `matroska`, `mp4`).

Kiểm: bản ghi 10 phút, đo RAM worker (`/usr/bin/time -v`) < 2 GB; trích một khung và tiếng từ master full-size.

### A2 — Xuất một đoạn và ảnh bìa (M)

- Menu Export: "Export all", "Export selection: everything in the span" (đặt range = khoảng của các clip đang chọn,
  dùng cơ chế `workarea` đã có, không đổi `workarea` đã lưu của người dùng), "Export selection: selected clips only"
  (ẩn mọi node không thuộc vùng chọn khi render). Hiện khoảng thời gian trước khi xuất.
- Ảnh bìa: trường `cover` trên scene (thời điểm, hoặc một media ảnh), lưu qua một op; export ghi `cover.jpg` cạnh MP4;
  card lịch đăng video của founder lấy ảnh đó.
- Gợi ý bìa: rút 15 khung trên trình duyệt (miễn phí); nhờ Haiku chọn 5 là một lượt gọi model, nên theo luật "báo giá
  trước khi chạy": để sau, bản đầu chỉ cho chọn tay (playhead hoặc một trong 15 khung).

### A3 — Công cụ clip (L)

- **Freeze**: op cắt clip tại playhead và chèn một đoạn "giữ khung" dài N giây (mặc định 3 giây; *CapCut không xác
  minh được*). Mình không cần ảnh tạm: biểu diễn là một đoạn video có `sourceIn = sourceOut` (giữ một khung), để
  `clip-render` và `clip-export` vẽ cùng một khung (thêm ca `editor-parity`).
- **Tốc độ cong**: thêm điểm `(t, tốc độ)` vào clip; `timing.ts` tích phân để ra độ dài trên timeline; `clip-export`
  dùng cùng hàm ánh xạ thời gian (ffmpeg `setpts` theo đoạn hoặc render từng khung). Vài preset có tên.
- **Reverse**: task worker tạo file đảo bằng ffmpeg streaming (chia đoạn rồi `reverse` từng đoạn để không giữ cả video
  trong RAM; đo RAM), rồi thay `src` của clip.
- **Flip / crop**: kiểm `scaleX < 0` và `set_frame` chạy đúng tới export; chỉ thêm nút trong inspector.

## Còn chưa biết

- Độ dài freeze mặc định, ý nghĩa đơn vị của `speed_points` (x có phải 0…1 theo độ dài clip không) — cần chạy CapCut.
- Model phân tích "highlight" của ảnh bìa (server, không có trong bundle).
- Upload luồng lúc đang quay có giúp thật không với file 10 phút — đo sau khi A1 bản đầu chạy.
