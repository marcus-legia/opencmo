# Editor & motion

Sản phẩm và tính năng editor, caption, animation, 3D, motion graphic, AI editor, và đối thủ.

Báo cáo của mảng này có thêm mục **Gắn vào OpenCMO** (đặt sau "Repo đáng học"): với mỗi thứ học được, ghi nguồn (repo, file), file của mình sẽ sửa, sửa ra sao, licence cho copy hay chỉ học, chi phí S/M/L và cách kiểm (test, hard budgets, xem frame thật).

Mới nhất ở trên. Mỗi lượt thêm một dòng và kiểm danh sách này để không lặp lại chủ đề hay nguồn. Định dạng báo cáo: [`../README.md`](../README.md).

| Ngày | Chủ đề | Báo cáo | Nguồn chính |
|---|---|---|---|
| 2026-10-18 | Reframe theo người đang nói, tự chia đôi khung podcast 2 người | [2026-10-18-active-speaker-reframe.md](2026-10-18-active-speaker-reframe.md) — diarize của Scribe + `jawOpen` để cắt theo lượt nói, luật split của clip-forge, chỉ số `speaker_coverage` | Vizard Speaker Identification (15/07), Joyspace; clip-forge, ClippyMe, LR-ASD, ClipsAI, FluxClip, AutoFlip |
| 2026-10-17 | Chữ động theo ký tự/từ/dòng, lower third | [2026-10-17-text-animator-lower-thirds.md](2026-10-17-text-animator-lower-thirds.md) — text animator kiểu range selector, sửa tách grapheme, visual `add_title` gắn vào câu nói | OpusClip Animated Lower Thirds (28/09), Descript captions (17/09); Skottie, anime.js, motion-canvas, HyperFrames registry, iart-ai lower-thirds/kinetic-typography, AIEV |
| 2026-10-16 | Reel tham khảo | (seed) xem reel tham khảo, dẫn tới `docs/style-skills-build.md` | Instagram reel "5 Plugins To Code Like A Senior Dev" |

## Repo đã đọc

Mỗi lượt thêm các repo đã đọc code vào đây và ưu tiên repo chưa có trong bảng; chỉ đọc lại khi repo có thay đổi lớn (ghi lý do).

| Repo | Licence | Đọc ngày | File đã đọc | Báo cáo |
|---|---|---|---|---|
| [google/skia](https://github.com/google/skia) (Skottie) | BSD-3-Clause | 2026-10-17 | `modules/skottie/src/text/RangeSelector.cpp`, `TextAnimator.cpp`, `TextAdapter.cpp` | [2026-10-17](2026-10-17-text-animator-lower-thirds.md) |
| [juliangarnier/anime](https://github.com/juliangarnier/anime) | MIT | 2026-10-17 | `src/utils/stagger.js`, `src/text/split.js` | [2026-10-17](2026-10-17-text-animator-lower-thirds.md) |
| [motion-canvas/motion-canvas](https://github.com/motion-canvas/motion-canvas) | MIT | 2026-10-17 | `packages/2d/src/lib/components/Txt.ts`, `TxtLeaf.ts` | [2026-10-17](2026-10-17-text-animator-lower-thirds.md) |
| [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes) | Apache-2.0 | 2026-10-17 | `registry/blocks/lt-kicker-name/*`, `registry/components/bottom-up-letters/*`, `registry/components/caption-editorial-emphasis/*.html` (lần trước chỉ dùng guide explainer) | [2026-10-17](2026-10-17-text-animator-lower-thirds.md) |
| [iart-ai/lower-thirds-skills](https://github.com/iart-ai/lower-thirds-skills) | MIT | 2026-10-17 | `skills/lower-thirds/SKILL.md`, `templates/lower-third.html` | [2026-10-17](2026-10-17-text-animator-lower-thirds.md) |
| [iart-ai/kinetic-typography-skills](https://github.com/iart-ai/kinetic-typography-skills) | MIT | 2026-10-17 | `skills/kinetic-typography/SKILL.md` | [2026-10-17](2026-10-17-text-animator-lower-thirds.md) |
| [notivn/AIEV](https://github.com/notivn/AIEV) | MIT | 2026-10-17 | `engines/remotion/src/components/HighlightTrack.tsx`, `vietnameseFont.ts` | [2026-10-17](2026-10-17-text-animator-lower-thirds.md) |
| [airbnb/lottie-web](https://github.com/airbnb/lottie-web) | MIT | 2026-10-17 | `player/js/utils/text/TextSelectorProperty.js` (đối chiếu) | [2026-10-17](2026-10-17-text-animator-lower-thirds.md) |
| [JeremySNR/clip-forge](https://github.com/JeremySNR/clip-forge) | MIT | 2026-10-18 | `src/main/pipeline/speaker.ts`, `speakerSplit.ts`, `asd.ts` (phần đầu), `clipLayout.ts` | [2026-10-18](2026-10-18-active-speaker-reframe.md) |
| [fralapo/clippyme](https://github.com/fralapo/clippyme) | MIT | 2026-10-18 | `src/clippyme/pipeline/reframe/reframe_track.py`, `reframe_detect.py`, `reframe_ops.py`, `reframe.py` (`analyze_scenes_strategy`), `transcription/diarization.py` | [2026-10-18](2026-10-18-active-speaker-reframe.md) |
| [Junhua-Liao/LR-ASD](https://github.com/Junhua-Liao/LR-ASD) | MIT (code; weights chưa rõ) | 2026-10-18 | `Columbia_test.py`, `model/Model.py` | [2026-10-18](2026-10-18-active-speaker-reframe.md) |
| [ClipsAI/clipsai](https://github.com/ClipsAI/clipsai) | MIT | 2026-10-18 | `clipsai/resize/resizer.py` | [2026-10-18](2026-10-18-active-speaker-reframe.md) |
| [shahid2866/fluxclip](https://github.com/shahid2866/fluxclip) | MIT | 2026-10-18 | `fluxclip/reframe.py` | [2026-10-18](2026-10-18-active-speaker-reframe.md) |
| [google/mediapipe](https://github.com/google/mediapipe) (AutoFlip) | Apache-2.0 | 2026-10-18 | `mediapipe/examples/desktop/autoflip/quality/kinematic_path_solver.cc`, `scene_camera_motion_analyzer.cc`, `cropping.proto` | [2026-10-18](2026-10-18-active-speaker-reframe.md) |
