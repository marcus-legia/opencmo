# Editor & motion: reframe theo người đang nói và tự chia đôi khung cho podcast 2 người — học clip-forge, ClippyMe, LR-ASD  (2026-10-18)

## TL;DR

- **Vì sao chọn chủ đề này tuần này:** 14 ngày qua không có đối thủ lớn nào ra mắt thứ buộc phải đổi chủ đề (OpusClip
  30/09 chỉ thêm nhập audio, 28/09 lower third — đã phủ ở báo cáo 17/10). Nên lượt này đi vào mảng "pacing, cuts và
  reframe" mà track chưa phủ, chọn đúng chỗ đau nhất của tệp khách dạng **podcast/phỏng vấn**: Vizard ra "Speaker
  Identification" ngày 15/07/2026, OpusClip/Joyspace/Choppity đều quảng cáo "active speaker" và "split screen". Đây là
  bảng so sánh mà founder làm podcast nhìn vào đầu tiên.
- **Lỗi của mình hôm nay, nói thẳng:** clip tải về được cắt bằng **một tâm cố định cho cả clip**
  (`steps/render.py` → `plan_crop` → `frame_filters(x_center=…)`). Với 2 người ngồi xa nhau, `_choose_center` chọn
  cửa sổ giữ nhiều diện tích mặt nhất — tức là **luôn một người**, kể cả khi người kia đang nói (test
  `test_hai_nguoi_phong_van_khong_roi_vao_khoang_trong` khoá đúng hành vi này). Editor có keyframe nhảy khi mặt nhảy
  (`focus_points`), nhưng đó là "mặt nào ở đâu", không phải "ai đang nói". Chưa chỗ nào trong repo biết ai đang nói.
- **Tín hiệu rẻ nhất đã có sẵn trong tầm tay:** ElevenLabs Scribe (thứ mình đang gọi) nhận `diarize=true` và trả
  `speaker_id` cho từng từ; trang API không ghi phụ phí cho diarize (chỉ `detect_speaker_roles` +10%). Ghép lượt nói
  với mặt bằng **độ mở miệng** (`jawOpen` blendshape của MediaPipe Face Landmarker — cùng Tasks API mình đang dùng)
  là đủ cho podcast 2–3 người, không cần model audio-visual nặng.
- **Khuyến nghị:** (1) đo trước: chỉ số `speaker_coverage` — S; (2) "theo người nói": cắt theo lượt nói, đổi khung
  bằng cú cắt (không lia), có trễ/cooldown kiểu clip-forge — M; (3) tự chia đôi khung (người trái trên, người phải
  dưới) khi hai người đối đáp nhanh, theo luật `speakerSplit.ts` của clip-forge — M; (4) cho người dùng chọn "bám ai"
  trong editor — M. **Để sau:** model LR-ASD (MIT, 3,4 MB) — tốt nhất nhưng cần 25 fps crop miệng (đụng luật "không
  nạp frame vào Python") và licence của weights chưa rõ.

## Phát hiện

### 1. Đối thủ: "ai đang nói thì người đó lên khung" đã là mặc định

- **Vizard, 15/07/2026 — Speaker Identification:** phát hiện ai đang nói, đưa người đó vào giữa, đổi khung theo lượt
  nói; bỏ người không nói khỏi khung chính. Bài viết nói rõ trước đó clip nhiều người bị giữ một bố cục cố định
  "khiến người đang nói chỉ chiếm một phần nhỏ khung" — đúng lỗi của mình hôm nay.
- **Joyspace (bài 01/12/2025 — cũ hơn 6 tháng), Choppity, ClipSpeed:** ba bước "audio → mặt → crop động", và ba bố
  cục theo ngữ cảnh: **split** (host trên, khách dưới) cho phỏng vấn/tranh luận, **full** cho độc thoại, **grid** cho
  3–4 người (người nói ~60% khung). Không ai công bố thời gian giữ khung tối thiểu.
- **OpusClip changelog** 20/09–17/10: không có gì về reframe (audio import 30/09, lower third 28/09, đăng
  Pinterest/Threads/Bluesky 28/09).
- **Ý nghĩa với mình (ý kiến):** người dùng upload video của chính họ; với founder, dạng phổ biến thứ hai sau talking
  head là phỏng vấn/podcast 2 người. Clip đầu tiên mà khung đứng yên vào người đang im lặng là lý do rời đi ngay ở
  bước activation.

### 2. clip-forge (`JeremySNR/clip-forge`, MIT, commit 13/10/2026): bộ luật chọn người nói và chia đôi khung

Đọc `src/main/pipeline/speaker.ts`, `speakerSplit.ts`, `asd.ts` (phần đầu), `clipLayout.ts`:

- **`chooseSpeakerByScores`** (máy trạng thái, thuần, có test):
  - focus nằm trên người model nói đang nói (logit > 0);
  - đối thủ phải **đang nói liên tục 0,4 s** (`SWITCH_SEC`) mới được cắt sang; nếu người hiện tại cũng đang nói thì
    đối thủ phải hơn điểm `OVERLAP_MARGIN = 1.0` — hai người nói chồng không làm khung giật qua lại;
  - sau mỗi lần cắt, **cooldown 1 s** (`COOLDOWN_SEC`);
  - khi không ai nói, focus **đứng yên** chứ không trôi;
  - khởi đầu lạnh (chưa ai nói): lấy mặt lớn nhất, nhưng nhường rất nhanh (0,12 s) khi có người nói thật;
  - mất track do detect chập chờn: chọn mặt **gần chỗ cũ nhất**, không nhảy sang mặt to nhất;
  - mọi trạng thái reset ở cắt cảnh.
- **`mouthActivity`** (đường dự phòng khi không có model): chênh lệch pixel vùng miệng (38% dưới hộp mặt) **trừ đi**
  chênh lệch vùng mắt/trán — người nghe gật đầu thì hai vùng cùng động, ra ~0; người nói thì miệng động hơn hẳn.
- **`planSpeakerSplits`** — khi nào chia đôi:
  - trong **một shot**, hai người nói nhiều nhất đều có ≥ 0,6 s lời trong cửa sổ ±2,5 s → đoạn "đối đáp";
  - đoạn chia ≥ 3 s (`MIN_SPLIT_SEC`), khe < 1,5 s giữa hai đoạn được nối (`BRIDGE_SEC`), mỗi mặt có mặt ≥ 90% số frame;
  - **người bên trái lên trên** (thứ tự đọc); panel 1080×960; mặt cao ~1/3 panel (`FACE_TO_PANEL = 3`), tâm mặt ở
    42% chiều cao panel (chừa khoảng trên đầu); không phóng nguồn quá 2,5× (tối đa cứng 3,2×) — vượt thì không chia;
  - mỗi panel dừng trước mặt người kia để **không ai xuất hiện hai lần**.
- **`lowDetailShotRanges`**: shot mà mặt quá nhỏ (diện tích < 0,0025 ảnh detect) ở > 70% frame thì không tin điểm
  "đang nói" — đánh dấu cần review thay vì đoán.
- `asd.ts`: dùng **LR-ASD** qua ONNX; lấy mẫu 25 fps, detect mặt mỗi 5 frame rồi nội suy, crop vuông 0,7 × cạnh hộp
  dịch xuống 0,2 (tâm vào miệng), 112×112 xám, MFCC 13 chiều; backend chạy ensemble cửa sổ 1–6 s.

### 3. ClippyMe (`fralapo/clippyme`, MIT, commit 13/10/2026): heuristic MAR + nhóm hai người + khoá shot tĩnh

Đọc `pipeline/reframe/reframe_track.py` (`SpeakerTracker`), `reframe_detect.py` (`compute_mouth_aspect_ratio`),
`reframe_ops.py` (`stationary_lock`, `centroid_span`), `reframe.py` (`analyze_scenes_strategy`),
`transcription/diarization.py`:

- **Mouth aspect ratio** = độ mở dọc / bề ngang miệng từ 4 landmark FaceMesh (13, 14, 78, 308). Điều quan trọng
  không phải giá trị mà là **phương sai theo thời gian** (cửa sổ 25 mẫu): miệng im thì phương sai ~0.
- Điểm người nói = 0,30 × diện tích mặt + 1,0 × chuyển động miệng, làm mượt EMA (0,72/0,28); đối thủ phải hơn
  **1,25×** sau cooldown; mặt khuất thì điểm giảm dần (×0,82/frame), sau 60 frame thì quên.
- **Nhóm đối thoại:** hai mặt điểm sát nhau (tỉ lệ ≥ 0,88) và cách nhau ≥ 28% bề ngang → khung bao cả hai thay vì cắt
  qua lại. Trên 9:16 từ nguồn 16:9 thì hai người xa nhau không vừa một khung — đây chính là lý do split tồn tại.
- `analyze_scenes_strategy`: mỗi cảnh lấy 7 frame → TRACK (1 người, đứng yên), WIDE (≥ 2 người hoặc 1 người di chuyển
  > 12% khung), GENERAL (không mặt). `stationary_lock` (ghi rõ là port ý từ AutoFlip): mục tiêu dao động < 15% khung
  → khoá vào trung vị; lệch tâm < 10% → kéo về chính giữa.
- `assign_speakers_to_words`: gán lượt nói của diarization (pyannote) vào từ của Whisper theo **độ chồng lớn nhất**,
  đi hai con trỏ O(n+m).
- **Không đem được nguyên cách làm:** ClippyMe đọc từng frame bằng `cv2.VideoCapture` và chạy FaceMesh trên từng frame
  trong Python — vi phạm thẳng hard budget 1–2 của mình. Chỉ học luật và con số.

### 4. LR-ASD / Light-ASD (`Junhua-Liao`, MIT, IJCV 2025 / CVPR 2023): model audio-visual nhỏ

- Đọc `Columbia_test.py` (`crop_video`, `evaluate_network`), `model/Model.py`. Weights `finetuning_TalkSet.model`
  **3,4 MB**; mAP 94,45% trên AVA-ActiveSpeaker (theo README). Đầu vào: crop mặt xám 112×112 ở 25 fps + MFCC 13 chiều
  ở 100 Hz (4 mẫu audio/frame); ensemble nhiều độ dài cửa sổ `{1,1,1,2,2,2,3,3,4,5,6}` s.
- Code tham chiếu đọc frame bằng OpenCV vào numpy và chạy `.cuda()` — chỉ là code nghiên cứu.
- **Rủi ro licence (chưa xác minh, ý kiến):** licence MIT phủ code; README không nói weights được phép dùng thương mại.
  Weights được train trên AVA (video YouTube) và TalkSet (dựng từ VoxCeleb2/LRS3, vốn có điều khoản nghiên cứu). Phải
  hỏi tác giả hoặc tự kiểm trước khi dùng trong sản phẩm trả tiền.

### 5. ClipsAI (`ClipsAI/clipsai`, MIT, commit 17/01/2024 — **cũ hơn 6 tháng**) và FluxClip (`shahid2866/fluxclip`, MIT, 11/10/2026)

- ClipsAI `resize/resizer.py`: lượt nói của pyannote **gộp với cắt cảnh** (`_merge_scene_change_and_speaker_segments`
  — cắt cảnh sát mép lượt nói thì nhập vào), rồi mỗi đoạn lấy vài frame, chọn mặt bằng MAR và cho **một khung tĩnh
  mỗi đoạn**. Đây là kiến trúc gần với mình nhất: mình đã có transcript và sample mặt thưa.
- FluxClip `reframe.py` (`_pick_speaker`, `compute_track`): miệng − 0,6 × mắt; chỉ đổi khi người thắng > 1,5 điểm và
  > 1,4× người nhì, không thì **ở lại người hiện tại**; camera có vùng chết 8% khung, cắt cứng khi lệch > 45% và
  **nhìn trước 1 s** (xử lý offline nên cắt đúng lúc thay vì trễ).

### 6. AutoFlip (`google/mediapipe`, Apache-2.0): khi nào camera nên đứng yên

- Đọc `examples/desktop/autoflip/quality/kinematic_path_solver.cc` (`IsMotionTooSmall`, `min_motion_to_reframe`,
  `reframe_window`), `scene_camera_motion_analyzer.cc` (`DecideCameraMotionType`), `cropping.proto`.
- Mỗi cảnh chọn **steady** (đứng yên) hay **sweeping/tracking**; mặc định khoá khi mục tiêu dao động < 30%
  (`motion_stabilization_threshold_percent = 0.30`) và kéo về tâm nếu lệch < 8% (`snap_center_max_distance_percent`).
  Camera chỉ bắt đầu di chuyển khi lệch vượt `min_motion_to_reframe` (vùng chết). Cảnh không có gì nổi bật thì giữ vị
  trí cảnh trước một lúc (`duration_before_centering_us`) rồi mới về giữa.

### 7. Mình đang có gì (đã kiểm trong code)

- `packages/engine/opencmo/steps/transcribe.py` `_post`: gửi `model_id`, `timestamps_granularity=word`,
  `tag_audio_events=false` — **không** có `diarize`; `_words` bỏ mọi trường trừ `start/end/text`;
  `models.py` `Word` chỉ có `start, end, text`. Audio dài được cắt thành phần 600 s chạy song song (`CHUNK_SECONDS`,
  `merge_parts`) — `speaker_id` của Scribe chỉ có nghĩa **trong một phần**.
- Đường link YouTube dùng phụ đề có sẵn trước (không gọi Scribe) → không có diarization; phải có đường dự phòng chỉ
  dùng hình.
- `steps/reframe.py`: MediaPipe `FaceDetector` (BlazeFace short range) trên JPEG 320 px, 4 fps
  (`cfg.face_sample_fps`); `Face` có `frame, x, w, area` — không có landmark, không có định danh người.
  `_choose_center` = cửa sổ giữ nhiều diện tích mặt nhất; `focus_points` ra keyframe 2 s/lần, tối đa 40, nhảy cứng
  khi tâm đổi > nửa cửa sổ.
- `steps/render.py` `render_clip` → `plan_crop` (một `x_center`) → `media/frame.py` `frame_filters` →
  `crop={w}:{h}:{x}:{y}` cố định.
- `packages/clip-doc/src/schema.ts`: `ReframeMarkSchema { focus, track: [giây, tâm][], mode }`;
  `LayoutRangeSchema.mode` có `split-top/split-bottom/visual-only/pip/side-by-side/cell` — tất cả là "người nói + một
  thứ khác", **không có mode hai người cùng từ một master**.
- `grep -rn "speaker_id\|diariz\|blendshape\|jawOpen" packages apps/web/lib` không ra kết quả.

## Repo đáng học

| Repo | Học được gì | File nên đọc | Licence | Copy hay chỉ học |
|---|---|---|---|---|
| [JeremySNR/clip-forge](https://github.com/JeremySNR/clip-forge), ★3, commit 13/10/2026 | Máy trạng thái chọn người nói (0,4 s / cooldown 1 s / overlap margin / cold start / giữ gần chỗ cũ); luật tự chia đôi khung; mouth − upper face; shot mặt nhỏ → review | `src/main/pipeline/speaker.ts` (`chooseSpeakerByScores`, `mouthActivity`, `lowDetailShotRanges`), `speakerSplit.ts` (`planSpeakerSplits`, `speakerPanelSource`), `asd.ts` | MIT | Học ý, viết lại bằng Python (logic nhỏ); nếu port sát `planSpeakerSplits` thì thêm notice MIT |
| [fralapo/clippyme](https://github.com/fralapo/clippyme), ★40, commit 13/10/2026 | MAR + phương sai; điểm người nói có EMA + margin 1,25×; nhóm hai người; khoá shot tĩnh; gán diarization vào từ | `pipeline/reframe/reframe_track.py` (`SpeakerTracker`), `reframe_detect.py`, `reframe_ops.py` (`stationary_lock`), `transcription/diarization.py` (`assign_speakers_to_words`) | MIT | Học ý (code đọc frame trong Python, trái hard budget) |
| [Junhua-Liao/LR-ASD](https://github.com/Junhua-Liao/LR-ASD) (+ [Light-ASD](https://github.com/Junhua-Liao/Light-ASD)), ★139, commit 23/03/2025 (**cũ hơn 6 tháng**) | Model audio-visual 3,4 MB; tiền xử lý crop miệng + MFCC; ensemble cửa sổ | `Columbia_test.py` (`crop_video`, `evaluate_network`), `model/Model.py` | MIT (code); weights chưa rõ | Để sau; cần kiểm licence weights |
| [ClipsAI/clipsai](https://github.com/ClipsAI/clipsai), ★545, commit 17/01/2024 (**cũ hơn 6 tháng**) | Gộp lượt nói với cắt cảnh, một khung tĩnh mỗi lượt | `clipsai/resize/resizer.py` (`_merge_scene_change_and_speaker_segments`, `_add_x_y_coords_to_each_segment_batch`) | MIT | Học ý |
| [shahid2866/fluxclip](https://github.com/shahid2866/fluxclip), ★0, commit 11/10/2026 | Ở lại người hiện tại khi không chắc; vùng chết 8%; cắt cứng có nhìn trước 1 s | `fluxclip/reframe.py` (`_pick_speaker`, `compute_track`) | MIT | Học ý |
| [google/mediapipe](https://github.com/google/mediapipe) (AutoFlip) | Steady vs tracking theo cảnh; ngưỡng 30% / 8%; vùng chết trước khi di chuyển | `examples/desktop/autoflip/quality/kinematic_path_solver.cc`, `scene_camera_motion_analyzer.cc`, `cropping.proto` | Apache-2.0 | Học ý (C++, gắn với graph MediaPipe) |

Không đọc: [mozzie49/clips-studio](https://github.com/mozzie49/clips-studio) (AGPL-3.0 — repo mình đóng mã, không
nên để code AGPL ảnh hưởng thiết kế), [TaoRuijie/TalkNet-ASD](https://github.com/TaoRuijie/TalkNet-ASD) (MIT, 2023,
đã được LR-ASD vượt; chỉ clone, không đọc).

## Gắn vào OpenCMO

Xếp theo giá trị cho activation / retention / doanh thu. G1–G3 có thể là một PR engine nếu muốn, nhưng khuyên tách
để đo được từng bước.

### G1. "Theo người nói": cắt khung theo lượt nói cho clip tải về và cho editor

- **Nguồn:** ElevenLabs Scribe `diarize` (`speaker_id` mỗi từ); ClippyMe `assign_speakers_to_words`; ClipsAI
  `_merge_scene_change_and_speaker_segments` (một khung mỗi lượt); clip-forge `chooseSpeakerByScores` (0,4 s, cooldown
  1 s, overlap margin, giữ khi không ai nói); FluxClip `_pick_speaker` (không chắc thì ở lại); AutoFlip/ClippyMe
  `stationary_lock` (trong một lượt thì đứng yên).
- **Đích:**
  - `packages/engine/opencmo/steps/transcribe.py` (`_post`, `_words`, `merge_parts`), `packages/engine/opencmo/models.py`
    (`Word`);
  - `packages/engine/opencmo/steps/reframe.py` (hàm mới; `_detect_faces`, `focus_points`, `editor_focus`);
  - `packages/engine/opencmo/steps/render.py` (`render_clip`), `packages/engine/opencmo/media/frame.py` (`frame_filters`);
  - `packages/engine/opencmo/worker/job_editor.py` (chỗ gọi `editor_focus`, dòng ~214).
- **Thay đổi cụ thể:**
  1. Scribe: thêm `diarize=true` vào `_post`; `Word.speaker: str | None = None`; `_words` đọc `speaker_id`;
     `merge_parts` gắn tiền tố phần (`"p2:speaker_1"`) vì nhãn chỉ đúng trong một phần 600 s. Không đổi giá credit.
  2. `speaker_turns(words, start, end) -> list[Turn(start, end, label)]`: gộp từ liền nhau cùng nhãn; bỏ lượt < 0,6 s
     (tiếng "ừ", "yeah" — số của clip-forge `EXCHANGE_SPEECH_SEC`), nối khe < 0,4 s; mép lượt bám mép từ.
  3. `assign_faces(track, turns)`: gom mặt thành người theo vị trí `x` (podcast ngồi yên; dùng lại cụm của
     `_choose_center`), rồi gán nhãn → người bằng bằng chứng miệng của G2; không có bằng chứng thì lấy người có tâm
     gần nhất ở lượt trước (FluxClip/clip-forge "ở lại").
  4. `turn_focus(...)`: mỗi lượt một tâm (khoá tĩnh, như ClipsAI/AutoFlip), chỉ đổi khi lượt mới ≥ 1,2 s **và** đã qua
     cooldown 1 s từ lần cắt trước; khi hai người đều đang nói trong ±0,4 s thì giữ người cũ. Ra cùng định dạng
     `[[giây, tâm], …]` mà `focus_points` đang ra, nên editor, `ReframeMarkSchema`, `face-track.ts` không phải đổi.
  5. Clip tải về: `frame_filters` nhận `x_track` và viết `crop=w:h:'if(lt(t,3.20),X0,if(lt(t,7.85),X1,X2))':y` —
     biểu thức `x` của filter `crop` được tính mỗi frame theo `t`, vẫn là một tiến trình ffmpeg streaming, không
     thêm RAM. Giới hạn ~20 lượt/clip (gộp lượt ngắn trước khi viết biểu thức).
  6. Không có `speaker` (đường phụ đề YouTube, video một người): giữ nguyên hành vi cũ, byte-identical.
- **Copy/adapt/skip:** adapt — các repo trên đều MIT nhưng code của họ hoặc là TS/Electron, hoặc đọc frame trong
  Python; mình viết lại bằng logic thuần trên track đã có. Nếu bê sát máy trạng thái của clip-forge thì thêm một dòng
  MIT vào `THIRD_PARTY_NOTICES.md`.
- **Chi phí:** M (~3 ngày: Scribe + turns + gán mặt + biểu thức crop + test).
- **Cách kiểm:**
  - `tests/test_scribe_transcribe.py`: payload có `diarize`; `speaker_id` được đọc; hai phần cùng `speaker_1` ra hai
    nhãn khác nhau.
  - `tests/test_reframe.py`: lượt < 0,6 s bị bỏ; hai lượt cách nhau 0,5 s không gây hai cú cắt (cooldown); không có
    nhãn → kết quả giống hệt `focus_points` cũ; sửa
    `test_hai_nguoi_phong_van_khong_roi_vao_khoang_trong` để có thêm một ca "người B nói → khung sang B".
  - `media/frame.py`: test chuỗi filter với 1 lượt (giống hệt cũ) và 3 lượt.
  - **Hard budgets:** chạy lại `/usr/bin/time -v` trên interview 54 phút (mốc 155,5 s, 849 MB); diarize có thể làm
    Scribe chậm hơn — đo riêng thời gian từng phần.
  - **Xem bằng mắt:** podcast 2 người (video của chính mình hoặc của owner), trích từ file đầy đủ (không phải
    `*.preview.mp4`) một frame ở **giữa mỗi lượt** và một frame **0,2 s sau mỗi cú cắt**: người đang nói nằm trọn
    trong khung, không có frame nào là khoảng trống giữa hai người.
- **Thuộc:** track Editor & motion (mảng reframe); PR engine riêng.

### G2. Bằng chứng miệng: `jawOpen` của MediaPipe Face Landmarker trên chính các JPEG đang trích

- **Nguồn:** ClippyMe `compute_mouth_aspect_ratio` + phương sai cửa sổ 25 mẫu; clip-forge/FluxClip "miệng trừ mắt"
  (khử chuyển động đầu).
- **Đích:** `packages/engine/opencmo/steps/reframe.py` (`_detect_faces`, `Face`, `face_model_path`); Dockerfile/image
  của worker (biến `OPENCMO_FACE_MODEL` đã có cho model detect — thêm một biến cho model landmarker).
- **Thay đổi cụ thể:** chỉ ở frame có ≥ 2 mặt, chạy `FaceLandmarker` (Tasks API, `num_faces=4`,
  `output_face_blendshapes=True`) trên **cùng file JPEG 320 px** đã có — không trích thêm frame, không đọc video vào
  Python. Lưu `mouth = jawOpen` vào `Face`. Với mỗi cặp (nhãn diarization, người): điểm = phương sai `mouth` của người
  đó trong các lượt của nhãn − phương sai ngoài các lượt; gán tham lam (≤ 4 người). Không có diarization thì dùng chính
  điểm này + máy trạng thái của G1 (EMA, margin 1,25×, cooldown) làm đường dự phòng.
  Lưu ý: 4 fps lấy mẫu miệng thưa; phương sai trên cả lượt nói (vài giây) vẫn đủ phân biệt — phải đo, không đoán.
- **Copy/adapt/skip:** adapt (ý tưởng; API là của MediaPipe, Apache-2.0, mình đã dùng).
- **Chi phí:** S–M (~1–2 ngày, cộng đo).
- **Cách kiểm:** test thuần với `Face` giả (người A miệng dao động trong lượt `speaker_0` → A = `speaker_0`; người
  nghe gật đầu không thắng). Đo thời gian: 5 clip × 60 s × 4 fps × 2 mặt ≈ 2 400 lần chạy landmarker — đo bằng
  `/usr/bin/time -v`, chặn bằng `cfg.max_parallel`, và phải giữ "45 phút → 5 clip < 3 phút". RAM model landmarker
  nhỏ (~4 MB file) nhưng vẫn ghi peak RSS.
- **Thuộc:** đi cùng G1 (G1 vô dụng nếu gán nhãn sai người).

### G3. Tự chia đôi khung (stack trên/dưới) khi hai người đối đáp nhanh

- **Nguồn:** clip-forge `planSpeakerSplits`, `speakerPanelSource`; Joyspace (host trên, khách dưới).
- **Đích:** `packages/clip-doc/src/schema.ts` (`LayoutRangeSchema`), `packages/editor-core/src/layout.ts`
  (`rebuildLayout`, `speakerBandAt`), `packages/editor-core/src/layouts.ts`, `apps/web/lib/editor/generate-project.ts`
  (đọc manifest), `packages/engine/opencmo/steps/reframe.py` + `worker/job_editor.py` (viết khoảng chia vào manifest),
  `media/frame.py` (đường ffmpeg).
- **Thay đổi cụ thể:**
  - Schema: thêm `mode: 'speakers'` vào `LayoutRangeSchema` với `sources: [[x, y, w, h], [x, y, w, h]]` (vùng nguồn
    0–1 của từng người). Thêm migration rỗng trong `clip-doc` nếu cần cho document cũ (trường mới tuỳ chọn).
  - editor-core: `rebuildLayout` dựng **hai** rect Speaker cùng paint video master, mỗi rect một `objectPosition`/scale
    theo `sources` — cùng cách `split-top` đang dựng rect Speaker + mask, nên vẫn vẽ qua `clip-render` (một runtime).
  - Engine: `plan_speaker_splits(turns, track)` theo đúng luật: hai người đều có ≥ 0,6 s lời trong ±2,5 s; đoạn ≥ 3 s;
    nối khe < 1,5 s; mỗi mặt có mặt ≥ 90% mẫu; người trái lên trên; mặt ~1/3 panel, tâm ở 42%; không phóng > 2,5×
    (nguồn 720p thường không đạt → không chia, giữ G1). Không bao giờ chia qua cắt cảnh.
  - Clip tải về: filtergraph `split=2` → hai `crop` → `vstack` (vẫn streaming), bật trong khoảng bằng `overlay` có
    `enable='between(t,a,b)'` lên khung G1. Caption phải dời khỏi đường nối giữa hai panel (dùng `speakerBandAt`).
- **Copy/adapt/skip:** adapt; con số lấy từ clip-forge (MIT) — ghi nguồn trong docstring; thêm notice nếu port sát.
- **Chi phí:** M (~3 ngày; phần schema + editor-core + ffmpeg).
- **Cách kiểm:** test editor-core (`layouts.test.ts`: range `speakers` dựng đúng 2 rect, không rect nào chứa mặt người
  kia); golden frame mới trong `packages/editor-core/src/golden`; test engine (đối đáp 5 s → một đoạn chia; một người
  nói dài → không chia; nguồn 720p → không chia). **Xem bằng mắt:** trích frame giữa đoạn chia từ file đầy đủ — hai
  mặt trọn, không ai hiện hai lần, caption không đè đường nối. Đo lại hard budgets (thêm một nhánh crop).
- **Thuộc:** track Editor & motion; sau G1+G2. Liên quan `layout.split` trong `docs/style-skills-build.md` (đó là
  "người nói + visual", khác mode này).

### G4. Chỉ số `speaker_coverage`: đo trước khi sửa

- **Nguồn:** clip-forge `lowDetailShotRanges` (không tin khi mặt quá nhỏ) + chính `CropPlan.coverage` của mình.
- **Đích:** `packages/engine/opencmo/steps/reframe.py` (`CropPlan`), log của `render_clip`, `opencmo doctor` /
  `cli.py clip` (in ra khi đo).
- **Thay đổi cụ thể:** `speaker_coverage` = tỉ lệ thời gian có lời nói mà người được gán cho lượt đó nằm trọn trong
  khung cuối cùng (dùng `_inside`). Hôm nay (một tâm) chỉ số này trên podcast 2 người sẽ ra ~50% — đó là con số để
  chứng minh G1 có tác dụng. Đánh dấu `low_detail` khi mặt < 0,0025 diện tích ở > 70% mẫu.
- **Copy/adapt/skip:** adapt. **Chi phí:** S (nửa ngày).
- **Cách kiểm:** test thuần với track giả; chạy trên 2–3 podcast thật trước và sau G1, ghi số vào PR.
- **Thuộc:** làm đầu tiên, cùng PR với G1 hoặc ngay trước.

### G5. Editor: "Bám theo: người đang nói / người A / người B / cả hai (chia đôi)"

- **Nguồn:** Vizard (đổi theo lượt), Joyspace (chọn bố cục theo ngữ cảnh); máy trạng thái G1.
- **Đích:** `packages/clip-doc/src/schema.ts` (`ReframeMarkSchema`), `packages/editor-core/src/reframe.ts` +
  `ops/` (op mới), `apps/web/lib/agent/tools.ts` (tool tự sinh từ op), top bar đổi khung của editor.
- **Thay đổi cụ thể:** mark `reframe` lưu thêm tuỳ chọn `people: [{ id, x }]` và `turns: [[giây, id]]` (dữ liệu G1
  ghi sẵn). Op `set_reframe_subject { subject: 'speaker' | 'person' | 'both', person?: id }` tính lại `track` từ
  `turns` trong editor-core (thuần TS, không gọi worker) rồi ghi keyframe `x` như hiện nay; `both` = range `speakers`
  của G3. Một op = một bước undo. Agent: "giữ khung ở khách mời" → `set_reframe_subject`.
- **Copy/adapt/skip:** adapt. **Chi phí:** M (~2 ngày).
- **Cách kiểm:** `ops.test.ts` (đổi subject rồi undo → document như cũ; `remove_silence` sau đó vẫn giữ keyframe
  theo `face-track.ts`); eval agent hiện có với câu "keep the camera on my guest". Xem frame như G1.
- **Thuộc:** sau G1; tăng retention (người dùng sửa được khi máy đoán sai thay vì bỏ clip).

### Bỏ qua (và vì sao)

- **LR-ASD/TalkNet trên worker ngay bây giờ:** chính xác nhất, nhưng cần crop miệng 25 fps cho từng mặt (gấp ~6 lần
  số frame đang trích, và phải đưa pixel vào Python/onnxruntime — đụng hard budget 1), cộng thêm onnxruntime và một
  bộ MFCC. Licence weights chưa rõ. Xét lại khi G4 cho thấy diarization + `jawOpen` dưới ~85% `speaker_coverage`.
- **pyannote chạy local:** torch + > 1 GB RAM, chậm trên CPU; Scribe đã trả diarization trong cùng cuộc gọi.
- **YOLO phát hiện người (ClippyMe `detect_person_yolo`):** thêm model lớn để xử lý ca người quay lưng; giá trị thấp
  với podcast ngồi yên.
- **Camera lia mượt (Kalman, One-Euro, L2 path của ClippyMe; kinematic solver của AutoFlip):** người xem short quen cú
  cắt giữa người nói hơn cú lia; mình đã chọn cắt cứng trong `focus_points`. Chỉ lấy vùng chết/khoá tĩnh.
- **Grid 3–4 người:** chưa có số liệu khách mình cần; để sau G3.

## Khuyến nghị

1. **G4 + G1 + G2 — "theo người nói" cho clip tải về và editor, có chỉ số đo** · M (~1 tuần tổng) · **activation**
   (clip podcast đầu tiên đúng người ngay), **doanh thu** (khớp tính năng mà Vizard/OpusClip quảng cáo, tệp podcast
   trả tiền nhiều phút), chi phí ≈ 0 (diarize không phụ phí theo trang API — cần xác nhận trên trang giá) · PR engine
   riêng, track Editor & motion. Thứ tự: G4 → G1 → G2, mỗi bước kèm số `speaker_coverage` trước/sau.
2. **G3 — tự chia đôi khung khi đối đáp** · M · activation + retention (đoạn tranh luận/phản ứng là đoạn viral nhất
   của podcast — ý kiến) · sau mục 1; cần đổi schema `clip-doc` nên tách PR.
3. **G5 — chọn "bám ai" trong editor + tool cho agent** · M · retention, giảm rủi ro "máy đoán sai là bỏ clip" · sau
   mục 1.
4. **Không làm bây giờ:** LR-ASD/pyannote/YOLO/camera lia mượt — lý do ở trên. Hỏi tác giả LR-ASD về weights nếu
   muốn giữ đường này mở.

Không đụng DB, không đổi credit. Thay đổi lớn nhất về rủi ro là thời gian của landmarker (G2) và độ trễ thêm của
Scribe khi diarize (G1) — cả hai phải đo với `/usr/bin/time -v` trước khi merge.

## Nguồn

Đọc ngày 2026-10-18 (giờ Việt Nam).

- OpusClip changelog — https://opusclip.canny.io/changelog
- Vizard, "vizard now automatically centers the active speaker" (15/07/2026) — https://vizard.ai/blog/vizard-now-automatically-centers-the-active-speaker
- Joyspace, "How to Auto-Crop Multi-Person Podcasts with AI Speaker Detection" (01/12/2025) — https://joyspace.ai/speaker-highlight-method-automated-framing
- Choppity, automated tracking — https://www.choppity.com/features/automated-tracking/
- ClipSpeed, speaker tracking — https://clipspeed.ai/blog/speaker-tracking-ai-video.html
- ElevenLabs Speech-to-Text API (`diarize`, `num_speakers`, `speaker_id`) — https://elevenlabs.io/docs/api-reference/speech-to-text/convert
- MediaPipe Face Landmarker (Python, blendshapes) — https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker/python?authuser=7
- JeremySNR/clip-forge — https://github.com/JeremySNR/clip-forge
- fralapo/clippyme — https://github.com/fralapo/clippyme
- Junhua-Liao/LR-ASD — https://github.com/Junhua-Liao/LR-ASD
- Junhua-Liao/Light-ASD — https://github.com/Junhua-Liao/Light-ASD
- ClipsAI/clipsai — https://github.com/ClipsAI/clipsai
- shahid2866/fluxclip — https://github.com/shahid2866/fluxclip
- google/mediapipe, AutoFlip — https://github.com/google/mediapipe/tree/master/mediapipe/examples/desktop/autoflip
- mozzie49/clips-studio (không đọc code, AGPL) — https://github.com/mozzie49/clips-studio
- TaoRuijie/TalkNet-ASD (chỉ clone) — https://github.com/TaoRuijie/TalkNet-ASD
- Danh sách repo "Opus Clip alternative" dùng để tìm ứng viên — https://github.com/topics/shorts?l=python&o=desc&s=forks
