# Editor & motion: CapCut Web — zoom, snap, luật thả clip, beat, phát một đoạn, vẽ timeline  (2026-11-15)

Session B của plan [`docs/plans/editor/2026-11-15-capcut-bundle-study-plan.md`](../../plans/editor/2026-11-15-capcut-bundle-study-plan.md)
(bước B0). Phần quay, xuất một đoạn, ảnh bìa và công cụ clip là của session A
([`2026-11-15-capcut-media.md`](2026-11-15-capcut-media.md)).

Nguồn: báo cáo `opencmo-internal/docs/specs/2026-11-09-hoc-capcut-timeline.md` và bundle JS của `capcut.com/editor`
lấy ngày 2026-11-09 (`opencmo-internal/research/bundles/capcut/pretty/`). Đọc **tĩnh**, số dòng theo các file
`pretty/`. Code của CapCut không có licence cho mình: **chỉ học hành vi, không chép code, chuỗi, schema hay tên hàm.**

## TL;DR

- **Đo của mình trước** (harness mới `apps/web/components/editor/timeline/bench/`, Chromium headless, edit 30 phút: 400
  đoạn cắt, 40 b-roll, nhạc, phụ đề 4.500 chữ): lúc Fit timeline có 990 node DOM; zoom gần thì **10.868 node** (4.513
  vạch thước + 4.500 ô chữ phụ đề) và **mỗi bước zoom mất 120–250 ms**. Cuộn thì mượt (16,7 ms/khung) vì DOM đã dựng
  sẵn. Và **Fit không vừa được video 30 phút**: nội dung rộng 1.894 px trong khung 1.440 px, vì mức zoom xa nhất là
  hằng số. Nên B4 (chỉ vẽ phần đang thấy) đáng làm, nhưng phần cần làm là thước và ô chữ, chưa phải canvas.
- **Zoom của CapCut luôn neo theo playhead** (nút, phím, thanh trượt): vị trí của playhead trên màn hình giữ nguyên.
  Mức zoom xa nhất tính từ độ dài draft (cả draft chiếm 1/4 khung, ít nhất 200 px). Mức zoom nhớ theo user + draft.
- **Snap 6 px, playhead xét trước**: trúng playhead thì đường gióng ẩn và chính playhead sáng lên.
- **Thả clip lên track đã có clip ở đó: CapCut không bao giờ ghi đè** trên track phụ. Nó tìm track cùng loại đầu tiên
  còn trống đúng khoảng giờ đó, không có thì tạo track mới. Mình thì clip thả xuống thắng, clip cũ bị cắt hoặc bị xoá.
- **Beat**: bật/tắt theo từng đoạn nhạc, 5 mức "Frequency", thêm/bỏ beat tay tại playhead. **Phát một đoạn**: phát
  từ A tới B một lần, tới B thì dừng và đứng ở B (dùng để xem lại một transition), không lặp.

## Phát hiện

### 1. Zoom (`pretty/widget-2.*.js` ~3855–4260)

- **Neo theo playhead**: trước khi đổi zoom, ghi khoảng cách từ mép trái khung tới playhead; đổi xong, đặt lại
  `scrollLeft` để khoảng đó như cũ (~3860–3935). Cả ba lối zoom (nút −/+, phím, thanh trượt) đi qua cùng đường này
  (~4180–4240). Playhead đang ra ngoài khung thì dùng lại khoảng đã ghi lần trước; cả draft đã vừa khung (1,25×) thì
  không neo gì. Zoom đang phát thì tự dừng phát.
- **Bước zoom**: 1% của thang log mỗi lần, debounce 20 ms.
- **Mức xa nhất**: độ dài draft vừa 1/4 chiều rộng khung, khung tính tối thiểu 200 px (~3855, 3978). Mức gần nhất cố
  định: 1 frame = 200 px.
- **Mở draft**: lấy mức đã nhớ nếu còn nằm trong khoảng cho phép; không thì vừa khung với lề (độ dài / (rộng / 1,25)).
  Nhớ trong "local note" khoá theo user + draft, ghi lại sau mỗi lần zoom (~4040–4085).

### 2. Snap (`pretty/widget-db03a274.*.js` ~15570–15805)

- Ngưỡng **6 px**, đo bằng pixel; danh sách điểm đổi sang pixel lại mỗi lần zoom.
- Thứ tự: **playhead trước**, rồi các điểm khác; điểm khác lấy **cái đầu tiên** trong ngưỡng (duyệt từ đầu hay từ
  cuối tuỳ con trỏ ở nửa nào), không phải cái gần nhất.
- Kéo một clip: thử mép đầu, rồi mép cuối; nhiều clip: thử thêm mép trái/phải của cả nhóm.
- Trúng playhead thì **không vẽ đường gióng**, playhead sáng lên (event highlight). Trúng điểm khác thì vẽ đường gióng.
- Tắt khi: công tắc snap tắt, kéo nhiều clip về main track, hoặc một số loại đoạn.

### 3. Luật thả clip (`pretty/editor.js` ~113850, 120399–120470; `pretty/widget-db03a274.*.js` ~15860–15940)

- Tìm track đích: duyệt các track **cùng loại**, từ track con trỏ đang chỉ trở đi, bỏ track bị khoá; track đầu tiên
  mà khoảng giờ của đoạn **không chồng** lên đoạn nào (trừ chính các đoạn đang dời) là đích. Không có thì đích là
  một **track mới**.
- Giữa hai track có "khe" (trước / sau một track): thả vào khe là chèn track mới tại đó; khe hiện ngay khi đoạn không
  đặt được vào track gần con trỏ.
- Main track (track video chính) là track "nam châm": thả vào đó là chèn và đẩy các đoạn sau (không có trong chunk
  đọc được chi tiết; suy ra từ `findTargetIndexToInsert`).
- Toàn bộ một lần thả là một bước undo (đã có trong báo cáo 11/09 §5).

### 4. Beat (`pretty/ai-beat.*.js`)

- Chỉ hiện khi chọn đúng **một** đoạn nhạc. Hai nút: "beat tự động" (bật/tắt theo đoạn, kèm thanh **Frequency** 5 mức,
  hiện 1–5) và "thêm/bỏ beat" tay tại playhead (trúng beat trong ±1 frame thì nút thành "bỏ").
- Beat lưu trên đoạn nhạc của draft (cờ bật + mức), tính trên server; mức nghĩa là gì không có trong bundle.

### 5. Phát một đoạn (`pretty/widget-db03a274.*.js` ~3640–3700, `pretty/widget-2.*.js` ~6956)

- `rangePlay(a, b)`: tua tới a, phát; mỗi khung xem đã tới b chưa, tới thì dừng và tua đúng b. **Không lặp.** Dùng
  sau khi thêm transition để phát lại đúng đoạn đó.

### 6. Vẽ timeline (`pretty/widget-3.*.js` ~3490, `pretty/widget-4.*.js` ~7650–7720, ~8160)

- Thước và marker vẽ trên **một canvas rộng bằng khung**, từ `viewportStart`: chỉ phần đang thấy, retina 2×.
- Thumbnail (filmstrip) lấy từ engine render (WASM) theo từng khoảng pts, đổi sang `ImageBitmap` qua
  `OffscreenCanvas` và cache theo asset + khoảng. Việc khởi tạo nặng đẩy sang `requestIdleCallback`.

## Phía mình hôm nay (đã kiểm trong code)

| Việc | Hiện trạng | File |
|---|---|---|
| Neo khi zoom | Cuộn chuột: quanh con trỏ. Nút và thanh trượt: **giữa khung**, không theo playhead. Không có phím zoom timeline (⌘= / ⌘− là zoom canvas). | `timeline/Timeline.tsx` `zoomTo` |
| Mức zoom | `ZOOM = { min: 0.03, max: 120 }` px/frame, hằng số. 30 phút ở 0,03 px/frame = 1.620 px: **Fit không vừa** khung dưới ~1.700 px. | `timeline/Timeline.tsx` |
| Nhớ zoom | Không: mỗi lần mở là Fit. | — |
| Snap | 10 px, lấy điểm **gần nhất** trong mọi mép; playhead là một điểm như mọi điểm; đường gióng luôn vẽ. | `timeline/snap.ts`, `Timeline.tsx` |
| Thả sang hàng khác | `move_to_row`: clip tới thắng, anh em trong hàng bị cắt/tách/xoá (`settle`). | `editor-core/src/ops/rows.ts`, `ops/timeline.ts` |
| Kéo ngang trong hàng | `move_elements` + `settle`: ghi đè như NLE. | `ops/timeline.ts` |
| Beat | Một lưới beat đều mỗi nguồn nhạc (`detectBeats`), vẽ lên sóng âm và làm điểm dính; không chỉnh mật độ. | `editor-core/src/beats.ts`, `timeline/peaks.ts` |
| Phát một đoạn | Không. Phát luôn chạy hết scene. | `playback.ts` |
| Vẽ | DOM: mỗi vạch thước, mỗi chữ phụ đề, mỗi clip là một phần tử, **kể cả phần ngoài khung**. Sóng âm: một canvas mỗi clip, rộng tối đa 8.192 px (zoom gần thì bị kéo giãn). Không có filmstrip. | `timeline/Timeline.tsx`, `peaks.ts` |

### Số đo (harness `timeline/bench/run.mts`, 1440×900, Chromium headless trong cloud)

Edit 30 phút: một hàng 400 đoạn cắt từ master, một hàng 40 b-roll, nhạc 30 phút, phụ đề 4.500 chữ. Không có bytes media
(sóng âm rỗng: trường hợp rẻ nhất).

| Đo | Kết quả |
|---|---|
| Fit: node DOM trong timeline | 990 (442 clip, 31 vạch thước) |
| Fit: bề rộng nội dung / khung | 1.894 px / 1.440 px (không vừa) |
| 12 lần bấm "+": thời gian tới khi vẽ xong | 50 ms ×5, rồi 117–252 ms mỗi lần |
| Zoom gần: node DOM | 10.868 (4.513 vạch, 4.500 chữ, 442 clip) |
| Cuộn ở zoom gần, 60 khung | trung vị 16,7 ms, p95 17,7 ms |
| Kéo một b-roll ở Fit, 40 khung | trung vị 19,2 ms, p95 31,2 ms, tệ nhất 42,5 ms |

*Đo lại sau khi sửa harness (B3: các đoạn cắt nằm nối nhau, vùng hàng có chiều cao thật): cùng số node; bước zoom gần
100–270 ms; kéo ở Fit trung vị 19–21 ms, p95 33–40 ms.*

Đây chưa phải số trên laptop thật với upload thật (cần stack local + worker); máy cloud nhanh hơn laptop trung bình,
nên số thật sẽ tệ hơn, không tốt hơn. Owner có thể chạy lại cùng lệnh trên máy mình.

## Gắn vào OpenCMO

Học hành vi, viết lại theo kiến trúc của mình; không chép gì của CapCut.

### B1 — Zoom và snap (S)

- **Neo**: nút −/+, thanh trượt và phím mới **`=` / `-`** (không mod; ⌘= vẫn là zoom canvas) neo theo **playhead nếu
  playhead đang trong khung**, không thì giữa khung như cũ. Cuộn chuột vẫn neo theo con trỏ (CapCut không có, nhưng
  con trỏ là thứ người dùng đang nhìn khi cuộn).
- **Mức xa nhất theo độ dài**: `minPpf = max(200, rộng khung / 4) / số frame`, trần 0,1 px/frame (một video 2 giây vẫn
  zoom xa được tới đó), sàn 1e-4. Fit luôn vừa.
- **Nhớ zoom** theo scene (mỗi tab timeline một mức): `localStorage` khoá `opencmo.timeline.zoom.<scene id>`, bọc
  try/catch; mở lại thì dùng mức đã nhớ nếu còn trong khoảng, không thì Fit. Fit vẫn chạy như cũ.
- **Snap**: ngưỡng **6 px**; **playhead thắng** nếu nằm trong ngưỡng, kể cả khi có điểm khác gần hơn (đặt clip đúng
  playhead là việc làm nhiều nhất); còn lại vẫn lấy điểm gần nhất (tốt hơn "cái đầu tiên" của CapCut). Trúng playhead
  thì không vẽ đường gióng, playhead sáng lên (`is-snapped`).

### B2 — Luật thả (S)

- **Đổi**: kéo clip **sang hàng khác** (`move_to_row`) mà hàng đích đang có clip ở đúng khoảng giờ đó: **không cắt gì**,
  clip vào một **hàng mới cùng loại ngay trên** hàng đích (CapCut: track trống kế tiếp, không có thì track mới; mình
  chưa có "track trống kế tiếp" nên chọn hàng mới, đoán được hơn). Hàng đích trống chỗ đó thì vào như cũ. Lý do: kéo
  lên/xuống là "để nó ở hàng kia", không ai kéo dọc để xoá một b-roll; hiện nay b-roll cũ bị cắt mất mà không báo.
- **Giữ**: kéo ngang trong cùng hàng vẫn ghi đè (`move_elements`, luật NLE; file đó không thuộc session B).
- `make_room`: đúng như CapCut làm với main track; chỉ thêm ca test.

### B3 — Beat và phát một đoạn (S)

- **Mật độ beat** cho cả timeline: mọi beat / beat thứ 2 / beat thứ 4 (nút "Beats ×1/×2/×4" trên đầu timeline), nhớ
  theo scene trong `localStorage`. Áp vào vạch vẽ và điểm dính. Tính trong `beats.ts` (`thinBeats`), giữ beat đầu của
  lưới làm phách 1.
- Không làm (cần trường mới trên document, là schema của session A): bật/tắt beat theo từng đoạn nhạc, thêm/bỏ beat tay.
  Ghi lại để sau.
- **Phát một đoạn**: nút "Loop" + phím **`/`**: lặp khoảng của các clip đang chọn; không chọn gì thì lặp vùng làm việc;
  không có vùng làm việc thì nút tắt. Dừng bằng Esc, Space, K, hay bấm Loop lần nữa. Khác CapCut (phát một lần): lặp
  là để chỉnh một đoạn trong lúc nó chạy, như NLE. `Playback` có thêm `loop`.

### B4 — Vẽ (M), cỡ do số đo trên quyết định

- **Chỉ vẽ phần đang thấy**, cộng lề một khung mỗi bên: vạch thước, ô chữ phụ đề, thanh clip. Cửa sổ cập nhật theo cuộn
  (rAF). Mục tiêu: node DOM ở zoom gần không còn tỉ lệ với độ dài video; bước zoom dưới 50 ms.
- **Sóng âm** vẽ phần đang thấy thay vì cả clip kéo giãn từ 8.192 px.
- **Filmstrip**: ảnh nhỏ trên thanh video, lấy từ file preview bằng một `<video>` ẩn, chụp lúc rảnh
  (`requestIdleCallback`), cache theo nguồn + bậc zoom. Chỉ trên clip đang thấy.
- Đo lại bằng cùng harness, ghi số trước/sau vào đây.

## Kết quả B4 (đo lại, cùng harness, 2026-11-15)

| Đo | Trước | Sau |
|---|---|---|
| Fit: bề rộng nội dung / khung | 1.894 / 1.440 px | 1.431 / 1.424 px (vừa; 7 px là nhãn vạch cuối) |
| Zoom gần: node DOM | 10.870 | 260 |
| 12 lần bấm "+" | 50 ms ×5, rồi 100–270 ms | 28–56 ms mỗi lần |
| Cuộn ở zoom gần (60 khung) | trung vị 16,7, p95 17,7 ms | trung vị 16,7, p95 16,9 ms |
| Kéo b-roll ở Fit (40 khung) | trung vị 19–21, p95 31–40 ms | trung vị ~20, p95 ~34 ms |
| Playhead lệch sau một lần zoom bằng nút | — (neo giữa khung) | 0,2 px |

Filmstrip (video thử VP9 2 phút trong harness): ô vuông cắt giữa (video dọc 9:16 ép vào 19 px thành sọc), chỉ trên
phần đang thấy và thanh rộng từ 48 px. Bản đầu vẽ cho mọi thanh trong cửa sổ có lề: hàng trăm canvas khi các đoạn cắt
vừa đủ rộng, mỗi bước zoom 100–230 ms; giới hạn trên đưa về như không có filmstrip. Ảnh hiện dần, khoảng một màn hình
trong 3 giây ở harness (mỗi ô một lần tua). Trên upload thật cần owner xem lại: tốc độ tua của file trên Storage.

## Còn chưa biết (cần chạy CapCut)

- Mức "Frequency" 1–5 của beat tự động nghĩa là gì (mọi beat / mỗi 2 / …?) và beat tính bằng model gì.
- Luật của main track khi thả chồng (chèn đẩy hay ghi đè) và validator khi dời (`e1.ar` trong báo cáo 09/11).
- `refTimes` của đoạn (beat? marker?) trong danh sách điểm snap.
