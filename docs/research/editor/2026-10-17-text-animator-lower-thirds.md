# Editor & motion: chữ động theo ký tự/từ/dòng và lower third — học Skottie, anime.js, HyperFrames  (2026-10-17)

## TL;DR

- **Vì sao chọn chủ đề này tuần này:** trong 14 ngày qua không có đối thủ lớn nào ra mắt thứ buộc phải đổi chủ đề
  (changelog Descript 12/10 chỉ có tìm kiếm Drive, recording request và voice clone ElevenLabs v4 — mấy thứ mình không
  làm theo luật "premade voices only"). Nhưng hai lần ra mắt sát mốc đều nói cùng một chuyện: **OpusClip "Animated
  Lower Thirds"** (28/09, 12 preset động, tạo từ chữ chọn trong transcript) và **Descript 18 preset caption + 10 text
  animation** (17/09). Chữ động có template đang là thứ khách so sánh giữa các tool. Báo cáo seed (16/10) đã phủ
  hook title, nhấn từ khoá trong caption, whip, punch-in (`docs/style-skills-build.md`), nên lượt này đi vào **lớp
  bên dưới**: động cơ chữ động và template lower third.
- **Mình đang thiếu một mô hình chung, không thiếu preset.** `clip-doc` có 18 loại animation (`ANIMATION_TYPES`, kể cả `gain` cho âm thanh), mỗi loại code riêng
  (`frame.ts` `applyAnimation`, `text.ts` `wordTweaks`); chỉ `wordSlide`/`highlightPop` chạy theo từng từ, không loại
  nào chạy theo **ký tự** hay **dòng**, không có thứ tự từ giữa/từ cuối/ngẫu nhiên, không có reveal có mặt nạ theo
  dòng (kiểu reveal "chuẩn ngành" của title). After Effects/Lottie giải bài này bằng **text animator + range
  selector**; Skottie (thứ mình đã dùng để vẽ Lottie) có bản cài đặt gọn, BSD-3, đọc được trong 1 giờ.
- **Có một lỗi thật cần sửa ngay (S):** `revealChars`, `typewriter` và `scramble` cắt chuỗi theo UTF-16
  (`text.slice`, `text[index]`). Emoji có tone da (👋🏽) bị cắt đôi thành ký tự hỏng giữa animation; chữ tiếng Việt dạng
  NFD (dấu tách rời) hiện chữ trước, dấu sau. motion-canvas và anime.js đều tách bằng `Intl.Segmenter('grapheme')`;
  trong repo mình chưa chỗ nào dùng nó.
- **Khuyến nghị:** (1) sửa grapheme — S; (2) thêm `unit`/`order`/`step`/`mask` vào `AnimationSchema` và viết lại
  `wordTweaks` thành bộ "domain map + coverage" theo Skottie — M; (3) visual `add_title` (lower third / name tag /
  chapter title) dựng từ rect + text + path có sẵn, gắn vào câu nói bằng `quote`, dùng brand kit — M. Không thêm
  runtime mới (không GSAP/HTML, không Lottie text): mọi thứ vẽ qua `clip-render`, preview và export giống hệt nhau.

## Phát hiện

### 1. Đối thủ: chữ động có template là chiến trường tháng 9–10/2026

- **OpusClip, 28/09/2026 — Animated Lower Thirds:** panel Text của editor thêm overlay Name Tag và Location, 12
  preset động sửa được hết, và **tạo được từ chữ chọn trong transcript**. Cùng đợt: Brand Vocabulary (07/09), Motion
  Studio tạo B-roll động từ ảnh tham chiếu (18/09), connector chính thức cho Claude (11/09). Nguồn: changelog OpusClip.
- **Descript, 17/09/2026 — Redesigned captions:** 18 preset caption mới, 10 text animation mới, preset tìm/lọc được.
  12/10: tìm kiếm toàn Drive, recording request, voice clone chạy ElevenLabs v4 (mình không làm voice clone).
- **Ý nghĩa với mình:** lower third là thứ creator dạng phỏng vấn/podcast cần ngay ở clip đầu tiên (ai đang nói).
  Người dùng của mình upload video của chính họ, thường là talking head hoặc phỏng vấn — đúng tệp dùng name tag.
  Chưa có số liệu activation của Opus cho tính năng này (ý kiến: nó rẻ để làm và dễ thấy trong demo).

### 2. Mô hình "text animator + range selector" (After Effects → Lottie → Skottie)

Đọc `modules/skottie/src/text/RangeSelector.cpp`, `TextAnimator.cpp`, `TextAdapter.cpp` (google/skia):

- Chữ được shape thành **fragment** (glyph). `TextAdapter::buildDomainMaps` dựng ba bảng ánh xạ: ký tự bỏ khoảng
  trắng, **từ** (khoảng trắng hoặc xuống dòng cắt từ), **dòng** — mỗi mục là `{offset, count, advance, ascent}`.
- Một **animator** = một bộ thuộc tính đích (position, scale, rotation, opacity, fill color, blur, tracking…) + một
  hay nhiều **range selector**. Selector sinh **coverage 0..1 cho từng đơn vị** của domain (ký tự/từ/dòng) rồi cộng
  dồn (`CoverageProcessor::add_proc`, kẹp −1..1). Thuộc tính của fragment = giá trị gốc + đích × coverage (biến đổi
  cộng/nhân; màu và opacity nội suy với coverage kẹp ≥ 0).
- **Hình dạng selector** là một hàm tín hiệu duy nhất với ba tham số: mép trái `e0`, mép phải `e1`, độ dài dốc `crs`,
  qua một đường cong Bezier; square/ramp up/ramp down/triangle/round/smooth chỉ là sáu bộ tham số (`gShapeInfo`).
  Thêm `ease_lo/ease_hi` và `smoothness` cho square. Lấy mẫu ở **giữa** mỗi đơn vị (`t = (0.5 − r0)/len`).
- `randomize_order` xáo bảng domain bằng `mt19937` với **seed cố định 42** — ngẫu nhiên nhưng tất định, tua lại vẫn
  y hệt (đúng luật golden test của mình).
- `AnchorPointGrouping` (ký tự/từ/dòng/tất cả) quyết định scale/rotation quay quanh tâm của đơn vị nào.
- lottie-web (`player/js/utils/text/TextSelectorProperty.js`, `getMult`) cài cùng mô hình bằng JS; repo ít hoạt động
  (commit cuối 19/11/2024 — **cũ hơn 6 tháng**), chỉ dùng để đối chiếu công thức.

**Vì sao quan trọng:** với mô hình này, "slide up theo từ", "fade theo ký tự từ giữa ra", "pop theo dòng", "reveal
có mặt nạ theo dòng" không phải 4 loại animation mới mà là **một** animator với `unit` và thứ tự khác nhau. Agent chỉ
cần học vài tham số thay vì 20 tên preset.

### 3. Stagger có thứ tự và tách chữ đúng grapheme (anime.js v4, motion-canvas)

- anime.js `src/utils/stagger.js`: độ trễ đơn vị i = `start + spacing × khoảng cách(i, from)`, với `from` =
  first/center/last/random/chỉ số; có `ease` trên chính phân bố độ trễ, `reversed`, `jitter` có seed
  (`createSeededRandom`), và lưới 2D/3D. Bản v4 chỉnh lại để chỉ số ngoài phạm vi không đọc `undefined`.
- anime.js `src/text/split.js` (`TextSplitter`): tách dòng/từ/ký tự bằng `Intl.Segmenter` (grapheme cho ký tự,
  word cho từ), có fallback regex; tách dòng chờ `document.fonts.ready` để không ngắt dòng bằng font dự phòng; giữ
  `aria-label` cho chữ gốc.
- motion-canvas `packages/2d/src/lib/components/TxtLeaf.ts`: `Intl.Segmenter(undefined, {granularity: 'grapheme'})`
  dùng cho nội suy chữ; `Txt.ts` `tweenText` tween **kích thước hộp** cùng lúc với chữ để đổi nội dung không nhảy
  layout.
- **Mình:** `packages/clip-render/src/text.ts` `revealChars` dùng `text.slice(0, floor(ratio × text.length))`,
  `scramble` duyệt `text[index]` — đều theo đơn vị UTF-16. `grep -rn Segmenter packages apps/web/lib` không ra kết
  quả nào. HyperFrames `bottom-up-letters` dùng `Array.from` (theo code point) — vẫn cắt sai emoji ghép và dấu tổ hợp.

### 4. Lower third: luật thiết kế đã được viết sẵn (iart-ai/lower-thirds-skills, HyperFrames registry)

- `iart-ai/lower-thirds-skills` `SKILL.md` + `templates/lower-third.html` (MIT, commit 30/09/2026):
  - chữ luôn có **nền đỡ** (panel, band, bóng đậm) vì graphic không biết phía sau là cảnh sáng hay tối;
  - **title-safe**: cách mỗi mép ≥ 5% (template dùng `SAFE = 0.06`); giữa khung để trống cho người nói;
  - **nhỏ**: tên cao ~50–80 px ở 1080p, vai trò ~một nửa;
  - **đứng yên khi đang được đọc**: chuyển động chỉ ở build-in/build-out; mặc định ~8 s (vào < 1 s, giữ 5–6 s,
    ra 0,5 s);
  - **bắt đầu và kết thúc trống** (`LEAD = 0.2`, `TAIL = 0.3`) để không "bật" khi cắt;
  - **chữ không bao giờ bị cắt**: `fit()` giảm cỡ chữ từng px tới khi vừa hộp; mọi wipe/mask phải rộng bằng thứ rộng
    nhất nó lộ ra; kiểm entry dài nhất;
  - font serif kiểu old-style đẩy số xuống dưới dòng ("Episode 12") — chọn font có lining numerals;
  - vòng kiểm: `--check` (font, khung đầu/cuối trống, title-safe), ảnh tĩnh của đoạn giữ trên nền tối **và** sáng,
    contact sheet build-in/build-out theo `window.PHASES`.
- HyperFrames `registry/blocks/lt-kicker-name/lt-kicker-name.html` (Apache-2.0): ba lớp — kicker trên nền accent rơi
  xuống (0,42 s, `back.out(2)`, bắt đầu 0,1 s), tên trồi lên (0,45 s, bắt đầu 0,32 s), đường gạch accent vẽ ra từ trái
  (`scaleX` 0→1, 0,5 s). **Ra nhanh hơn vào** (0,3 s, `power2.in`) và theo thứ tự ngược. Kicker nằm trong wrapper
  `overflow:hidden` — chính là reveal có mặt nạ.
- HyperFrames `registry/components/bottom-up-letters/registry-item.json`: mỗi template khai **biến** có `id`, `type`,
  `role` (`content`/`motion`/…), `label`, `description`, `default`, `options` có nhãn; độ lớn đặt tên
  (`close`/`standard`/`far` = 0,45/0,85/1,5 em) thay vì số. Đây là hình mẫu tốt cho inspector và cho tool của agent.
- `iart-ai/kinetic-typography-skills` `SKILL.md` (MIT): bảng nhịp — stagger dòng 60–100 ms, từ 40–70 ms, ký tự
  20–40 ms; mỗi đơn vị 400–600 ms; tổng reveal ~800 ms; vào bằng ease-out kiểu `cubic-bezier(0.16, 1, 0.3, 1)`; chọn
  đơn vị theo độ dài (ký tự chỉ cho chuỗi ngắn). Reveal bền nhất là **mặt nạ theo dòng** (chữ trượt lên từ dưới
  baseline bị che).
- `notivn/AIEV` `engines/remotion/src/components/HighlightTrack.tsx` + `vietnameseFont.ts` (MIT, repo Việt): thẻ key
  nằm ngoài **vùng UI của nền tảng** (dọc: 10% trên, 16% dưới) và tự đẩy lên khi có caption; vào 5 khung/ra 6 khung
  vì "bật tắt cứng trông rẻ trên footage thật". Font tiếng Việt phải khai `unicode-range` cho từng subset, không thì
  hai subset đè nhau và **mất dấu**; render chờ font thật để khung đầu không vẽ bằng font dự phòng.
- **Bài học riêng cho tiếng Việt (ý kiến, từ đọc code trên):** mặt nạ theo dòng tính bằng font-size sẽ cắt dấu chồng
  ("Nguyễn", "Hương") — hộp mặt nạ phải lấy `actualBoundingBoxAscent/Descent` đo thật, không lấy cỡ chữ.

## Repo đáng học

| Repo | Học được gì | File nên đọc | Licence | Copy hay chỉ học |
|---|---|---|---|---|
| [google/skia](https://github.com/google/skia) (Skottie), ★11k, commit 16/10/2026 | Text animator + range selector: domain map ký tự/từ/dòng, coverage, hàm hình dạng chung, xáo có seed, anchor grouping | `modules/skottie/src/text/RangeSelector.cpp`, `TextAnimator.cpp`, `TextAdapter.cpp` (`buildDomainMaps`, `fragmentAnchorPoint`) | BSD-3-Clause | Học ý, viết lại bằng TS; nếu port sát hàm `ShapeGenerator` thì thêm notice BSD |
| [juliangarnier/anime](https://github.com/juliangarnier/anime), ★73,7k, commit 09/08/2026 | Stagger có `from` first/center/last/random, ease trên phân bố trễ, jitter có seed; tách chữ bằng `Intl.Segmenter` | `src/utils/stagger.js`, `src/text/split.js` | MIT | Học ý (logic nhỏ, viết lại cho document của mình) |
| [motion-canvas/motion-canvas](https://github.com/motion-canvas/motion-canvas), ★19,4k, commit 02/07/2026 | Grapheme segmenter cho nội suy chữ; tween hộp cùng chữ khi đổi nội dung | `packages/2d/src/lib/components/TxtLeaf.ts`, `Txt.ts` (`tweenText`) | MIT | Học ý |
| [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes), ★65,2k, commit 16/10/2026 — **đọc lại**: lần trước chỉ lấy hướng dẫn kể chuyện cho explainer; lần này đọc phần `registry/` (210 block) | Lower third 3 lớp, vào chậm ra nhanh, mặt nạ; biến template có `role` + độ lớn đặt tên | `registry/blocks/lt-kicker-name/lt-kicker-name.html`, `registry/components/bottom-up-letters/*`, `registry/components/caption-editorial-emphasis/*.html` | Apache-2.0 | Học ý; HTML + GSAP là runtime thứ hai, không đem vào |
| [iart-ai/lower-thirds-skills](https://github.com/iart-ai/lower-thirds-skills), ★1, commit 30/09/2026 | Luật lower third (nền đỡ, title-safe, khung đầu/cuối trống, `fit()`, lining numerals) và vòng kiểm bằng mắt | `skills/lower-thirds/SKILL.md`, `templates/lower-third.html` | MIT | Học ý; viết lại luật vào guide của mình (thêm notice nếu bám sát câu chữ) |
| [iart-ai/kinetic-typography-skills](https://github.com/iart-ai/kinetic-typography-skills), ★14, commit 22/06/2026 | Bảng nhịp stagger theo đơn vị, chọn đơn vị theo độ dài, mặt nạ theo dòng | `skills/kinetic-typography/SKILL.md`, `references/reveal-recipes.md` | MIT | Học ý (số liệu là kiến thức chung) |
| [notivn/AIEV](https://github.com/notivn/AIEV), ★137, commit 09/10/2026 | Vùng UI nền tảng, đẩy thẻ khi có caption, font tiếng Việt `unicode-range`, chờ font | `engines/remotion/src/components/HighlightTrack.tsx`, `vietnameseFont.ts` | MIT | Học ý |
| [airbnb/lottie-web](https://github.com/airbnb/lottie-web), ★32,2k, commit 19/11/2024 (**cũ hơn 6 tháng**) | Bản JS của range selector, để đối chiếu công thức | `player/js/utils/text/TextSelectorProperty.js` (`getMult`), `TextAnimatorProperty.js` | MIT | Chỉ đối chiếu |

## Gắn vào OpenCMO

Xếp theo giá trị cho activation / retention / doanh thu.

### G1. Visual `add_title`: lower third, name tag, chapter title — gắn vào câu nói

- **Nguồn:** HyperFrames `lt-kicker-name.html` (cấu trúc 3 lớp, vào chậm ra nhanh), `bottom-up-letters/registry-item.json`
  (biến có `role` và độ lớn đặt tên); iart `lower-thirds-skills` `SKILL.md` + `lower-third.html` (`fit()`, `SAFE`,
  `LEAD/TAIL`); OpusClip 28/09 (tạo từ chữ chọn trong transcript).
- **Đích:** file mới `packages/editor-core/src/visuals/title.ts` (`buildTitle`, `titleInput`) theo đúng mẫu của
  `visuals/chart.ts`/`icon.ts`; đăng ký `addTitle = visualOp('add_title', titleInput, …)` trong
  `packages/editor-core/src/ops/visuals.ts` và `REGISTRY` ở `ops/index.ts`; tool agent đi qua cơ chế op sẵn có
  (`apps/web/lib/agent/tools.ts`); nút "Add title" trong panel Text của editor; `update_visual` sửa tên/vai trò nhờ mark
  `visual` có sẵn.
- **Thay đổi cụ thể:** input `{ kind: 'lowerThird' | 'nameTag' | 'chapter', title, sub?, quote? | start/end, look:
  'bar' | 'kicker' | 'card', side: 'left' | 'right', motion: 'calm' | 'standard' | 'punchy' }`. `buildTitle` trả
  `visualGroup` gồm `rect` nền đỡ (màu brand, opacity ~0,9), `text` tên (cỡ đặt bằng vòng `fit` dùng `Measurer` của
  `clip-render` — có sẵn trong `layoutText`), `text` vai trò (~0,42 × cỡ tên), `path`/`rect` gạch accent; animation
  `in` lệch nhau 0,1/0,32/0,5 s, `out` ngắn hơn (~0,3 s) và ngược thứ tự; vị trí trong title-safe 6% và tránh vùng
  caption (`panelRegionAt`/layout hiện có). Thời gian: có `quote` thì dùng `quoteRange` (đã có), mặc định giữ 5–6 s.
  Màu và font lấy từ brand kit (`readBrand`/`themeFromBrand`). Không có node kind mới, không đổi schema clip-doc.
  `motion` là độ lớn đặt tên (giống `travel` của HyperFrames), không lộ số giây cho người dùng.
  Liên hệ `docs/style-skills-build.md`: `add_hook_title` (capability `title.hook`) nên là một `kind` của `add_title`
  thay vì op riêng — đề xuất thêm capability `title.lowerThird` vào bảng `CAPABILITIES` khi Track A tạo file.
- **Copy/adapt/skip:** adapt — HyperFrames Apache-2.0 và iart MIT đều cho phép copy, nhưng code của họ là HTML/GSAP và
  canvas trong trình duyệt, không dùng được trong document của mình; chỉ học cấu trúc và số. Nếu đưa câu chữ luật
  thiết kế vào guide gần nguyên văn thì thêm dòng cho iart (MIT) vào `THIRD_PARTY_NOTICES.md`.
- **Chi phí:** M (op + builder + test + nút editor + guide; ~2–3 ngày).
- **Cách kiểm:** test đơn vị trong `packages/editor-core/src/visuals.test.ts` (tên dài nhất co lại vừa hộp; mọi node
  trong title-safe; out ngắn hơn in; `quote` không thấy → `OpFailure`); golden frame mới trong
  `packages/editor-core/src/golden`. **Xem bằng mắt:** export một clip 1080×1920, trích 4 khung từ file đầy đủ (không
  phải `*.preview.mp4`) — giữa build-in, giữa đoạn giữ, giữa build-out, khung ngay sau out (phải trống) — trên một
  cảnh tối và một cảnh sáng; tên "Nguyễn Thị Hương" và "Episode 12" để soi dấu và số. Không đụng worker nên không cần
  đo lại hard budgets.
- **Thuộc:** track Editor & motion; một PR riêng, nên đi sau G2 nếu muốn kiểu `kicker` có mặt nạ.

### G2. Text animator theo đơn vị: `unit` + `order` + `step` + `mask` cho animation sẵn có

- **Nguồn:** Skottie `TextAdapter::buildDomainMaps`, `RangeSelector::modulateCoverage`, `TextAnimator::modulateProps`;
  anime.js `stagger` (`from`, seed); iart `kinetic-typography` (nhịp, mặt nạ theo dòng).
- **Đích:** `packages/clip-doc/src/schema.ts` (`AnimationSchema`), `packages/clip-render/src/frame.ts`
  (`applyAnimation`), `packages/clip-render/src/text.ts` (`wordTweaks` → `unitTweaks`), `apps/web/lib/agent/guides.ts`
  (mô tả cho agent), inspector của editor.
- **Thay đổi cụ thể:**
  - Schema: thêm vào `AnimationSchema` các trường tuỳ chọn `unit: 'char' | 'word' | 'line'`, `order: 'first' |
    'center' | 'last' | 'random'`, `step` (giây giữa hai đơn vị, 0,02–0,5), `mask: boolean` (chỉ ý nghĩa với
    `slideUp/slideDown`). Không thêm loại animation mới: `fade`, `slideUp`, `pop`, `blur`, `grow` chạy được theo đơn vị.
    `wordSlide` cũ = `slideUp` + `unit: 'word'` — giữ tên cũ để document cũ vẫn chạy (đăng ký trong
    `clip-doc/src/migrate.ts` nếu muốn chuẩn hoá).
  - Renderer: sau `layoutText`, dựng bảng domain (ký tự không tính khoảng trắng / từ / dòng) đúng như Skottie
    (`{offset, count}` trên danh sách grapheme, dòng lấy từ `word.y`). Mỗi đơn vị i có trễ `delay_i = step × rank(i)`
    với rank theo `order` (`random` xáo bằng PRNG có seed từ id node — tua lại y hệt, như `scramble` đang làm). Tiến
    độ của đơn vị = easing của preset trên `(t − delay_i)/duration`; tweak `{dx, dy, scale, alpha, blur}` áp quanh tâm
    đơn vị (anchor grouping của Skottie). `mask`: clip theo hộp của **dòng** dùng
    `actualBoundingBoxAscent/Descent` đo thật (dấu tiếng Việt chồng cao hơn cỡ chữ).
  - Giới hạn chi phí: `unit: 'char'` chỉ cho node `text` ≤ ~200 grapheme; node `captions` chỉ `word`/`line` (caption
    đã có hệ `highlight` riêng).
- **Copy/adapt/skip:** adapt — Skottie là C++ (BSD-3 cho phép port, nhưng cấu trúc animator của nó gắn với JSON
  Lottie); mình chỉ cần phần domain map + trễ theo thứ hạng, viết mới bằng TS. Nếu sau này port nguyên
  `ShapeGenerator` (selector hình tam giác/round) thì ghi notice BSD-3 trong `THIRD_PARTY_NOTICES.md`.
- **Chi phí:** M (~3 ngày: schema + renderer + migrate + golden + guide).
- **Cách kiểm:** test trong `packages/clip-render/src/text-fx.test.ts` (trễ của đơn vị đầu/giữa/cuối với từng
  `order`; `random` tất định giữa hai lần gọi; mặt nạ không cắt "ễ"); golden ảnh trong `clip-render`; kiểm tương
  đương `wordSlide` cũ = `slideUp`+`word` bằng so ảnh. Đo export một clip 60 s có 10 node chữ `unit: 'char'` với
  `/usr/bin/time -v` để chắc thời gian export và RAM không tăng đáng kể (không đụng hard budget 45 phút → 5 clip,
  nhưng export dùng chung `clip-render`). **Xem bằng mắt:** trích khung giữa reveal từ file export đầy đủ.
- **Thuộc:** track Editor & motion; là nền cho `caption.reveal` của `docs/style-skills-build.md` (Track B) — nên báo
  Track B trước khi ai đó viết reveal riêng cho caption.

### G3. Tách chữ đúng grapheme trong `revealChars`, `typewriter`, `scramble`

- **Nguồn:** motion-canvas `TxtLeaf.ts` (segmenter `grapheme`), anime.js `split.js` (segmenter + fallback).
- **Đích:** `packages/clip-render/src/text.ts` (`revealChars`, `scramble`), `packages/clip-render/src/frame.ts`
  (`typewriter`).
- **Thay đổi cụ thể:** một hàm `graphemes(text)` dùng `Intl.Segmenter(undefined, { granularity: 'grapheme' })` (Node
  và trình duyệt đều có; fallback `Array.from` nếu thiếu); `revealChars` lấy `floor(ratio × n)` grapheme;
  `scramble` xáo theo grapheme và giữ nguyên grapheme khoảng trắng. Nhịp ổn định của `scramble` (ảnh vàng) giữ như cũ
  theo chỉ số grapheme.
- **Copy/adapt/skip:** adapt (vài dòng, dùng API chuẩn).
- **Chi phí:** S (nửa ngày).
- **Cách kiểm:** test mới: `"Xin chào 👋🏽"` ở mọi `ratio` không bao giờ ra ký tự lẻ cặp surrogate; chuỗi NFD
  `"Nguyễn"` không hiện chữ thiếu dấu; golden cũ của `scramble` vẫn khớp (chuỗi ASCII không đổi). Xem
  một khung giữa `typewriter` trên clip có emoji.
- **Thuộc:** sửa lỗi nhỏ, có thể đi chung PR của G2 hoặc riêng (khuyên riêng: nhanh, rủi ro thấp).

### G4. `checkDocument`: chữ ngoài title-safe / vùng UI nền tảng, chữ bị cắt

- **Nguồn:** iart `lower-thirds-skills` (`SAFE`, "the words are never cut"), AIEV `HighlightTrack.tsx` (dọc: 10% trên,
  16% dưới là UI của TikTok/Reels).
- **Đích:** `packages/editor-core/src/check.ts` (thêm loại issue cạnh `caption-overlap`, `captions-covered`).
- **Thay đổi cụ thể:** issue `text-unsafe` khi hộp của `text` (không phải captions) nằm ngoài vùng an toàn ở khung
  dọc; `text-clipped` khi chữ rộng hơn hộp/mặt nạ của nó. Agent đọc report này sau khi đặt title (vòng
  "verify by looking" bằng dữ liệu).
- **Copy/adapt/skip:** adapt (con số là quy ước chung của nền tảng).
- **Chi phí:** S.
- **Cách kiểm:** `packages/editor-core/src/check.test.ts`: một text sát mép trên ở 1080×1920 → `text-unsafe`; lower
  third của G1 → không issue.
- **Thuộc:** đi cùng G1.

### G5. Guide cho agent: nhịp chữ động và luật lower third

- **Nguồn:** iart `kinetic-typography/SKILL.md` (bảng nhịp), `lower-thirds/SKILL.md` (luật), HyperFrames (vào chậm ra
  nhanh).
- **Đích:** `apps/web/lib/agent/guides.ts` (mục text/title) hoặc `motion-guide.ts`.
- **Thay đổi cụ thể:** vài dòng: chọn `unit` theo độ dài (ký tự ≤ ~20 ký tự, từ cho tagline, dòng cho đoạn), `step`
  theo bảng (ký tự 0,02–0,04 s, từ 0,04–0,07 s, dòng 0,06–0,1 s), tổng reveal ≲ 0,8 s, out ngắn hơn in, đứng yên khi
  đang đọc, một title cho mỗi người nói ở lần xuất hiện đầu.
- **Copy/adapt/skip:** adapt, viết lại bằng lời của mình; thêm iart (MIT) vào `THIRD_PARTY_NOTICES.md` nếu bám sát.
- **Chi phí:** S.
- **Cách kiểm:** eval agent hiện có (`apps/web/lib/agent/eval`): yêu cầu "thêm tên tôi khi tôi tự giới thiệu" → một
  `add_title` gắn `quote`, không có số giây tự bịa.
- **Thuộc:** đi cùng G1/G2.

### Bỏ qua (và vì sao)

- **Đem GSAP/HyperFrames HTML vào editor** để có ngay 210 block: là runtime thứ hai, vi phạm luật "editor chỉ vẽ qua
  `clip-render`", và preview/export sẽ lệch nhau. Bỏ.
- **Lower third bằng Lottie có text layer** (Skottie đã vẽ được range selector): font trong Lottie khó khớp brand kit,
  sửa chữ phải đi qua slot text của player, và Lottie của mình được vẽ thành ảnh trong hộp (`drawLottie`) — không
  đo được chữ để `fit`. Bỏ.
- **Animation trục variable font (`wght`)**: font bundle của mình chủ yếu là file tĩnh theo weight; giá trị thấp. Để
  sau.
- **`tweenText` của motion-canvas** (đổi nội dung có tween hộp): hay cho "số đếm" nhưng `clip-three` template
  `number.ts` đã phủ trường hợp chính. Để sau.

## Khuyến nghị

1. **G3 — sửa grapheme** · S · rủi ro (lỗi hiển thị với emoji/tiếng Việt trong demo), retention · PR sửa lỗi nhỏ
   trong `clip-render`. Làm ngay, độc lập.
2. **G1 + G4 + G5 — `add_title` (lower third/name tag/chapter) gắn vào câu nói, có check và guide** · M · activation
   (clip đầu tiên của người dùng phỏng vấn/podcast trông "đã edit" ngay), cân bằng với OpusClip 28/09 · track Editor &
   motion; thay cho việc viết `add_hook_title` riêng trong `docs/style-skills-build.md` (gộp thành một `kind`).
3. **G2 — text animator theo đơn vị** · M · retention (thêm "kiểu" mà không thêm 20 preset; agent học ít tham số
   hơn), doanh thu gián tiếp (preset caption/title là thứ khách so sánh) · nền cho `caption.reveal` (Track B của
   style-skills). Làm sau G1 nếu muốn ship nhanh; trước G1 nếu muốn kiểu `kicker` có mặt nạ ngay từ đầu.
4. **Không làm:** runtime HTML/GSAP, Lottie text, variable font — lý do ở trên.

Thứ tự đề xuất: G3 (½ ngày) → G1+G4+G5 (2–3 ngày) → G2 (3 ngày). Tổng ~1 tuần, không đụng worker, không đụng hard
budgets, không thay đổi DB.

## Nguồn

Đọc ngày 2026-10-17 (giờ Việt Nam).

- OpusClip changelog — https://opusclip.canny.io/changelog
- Descript changelog — https://descript.canny.io/changelog
- CapCut AI Assistant (Pandaily; trang không ghi ngày, chỉ dùng làm bối cảnh) — https://pandaily.com/cap-cut-launches-ai-assistant-for-natural-language-video-editing
- google/skia, `modules/skottie/src/text/` — https://github.com/google/skia/tree/main/modules/skottie/src/text
- airbnb/lottie-web, `player/js/utils/text/` — https://github.com/airbnb/lottie-web/tree/master/player/js/utils/text
- juliangarnier/anime, `src/utils/stagger.js`, `src/text/split.js` — https://github.com/juliangarnier/anime
- motion-canvas/motion-canvas, `packages/2d/src/lib/components/` — https://github.com/motion-canvas/motion-canvas
- heygen-com/hyperframes, `registry/` — https://github.com/heygen-com/hyperframes/tree/main/registry
- iart-ai/motion-skills (danh mục pack) — https://github.com/iart-ai/motion-skills
- iart-ai/lower-thirds-skills — https://github.com/iart-ai/lower-thirds-skills
- iart-ai/kinetic-typography-skills — https://github.com/iart-ai/kinetic-typography-skills
- notivn/AIEV — https://github.com/notivn/AIEV
