# Editor & motion: vì sao animation của Opus và Claude Design đẹp hơn explainer của mình  (2026-10-22)

## TL;DR

- Opus công khai một thí nghiệm: **Claude Opus 5.5 dựng lại "mù" 34 component motion chỉ từ một file `TASK.md`**,
  một lượt, không có người góp ý. Trung vị 15 phút và 5 vòng tự xem lại, kết quả đặt cạnh bản gốc (người duyệt
  nhiều vòng) gần như ngang. Mã nguồn các bản dựng lại là **MIT**.
- Claude Design làm animation trên một starter **rất mỏng** (`animations.jsx`, ~700 dòng: `Stage`, `Sprite`,
  `useTime`, easing). Họ không có kit đồ sộ; chất lượng đến từ model mạnh, code tự do, ngữ cảnh thiết kế thật
  (design system, UI thật) và một agent kiểm tra riêng.
- Cả hai cùng một công thức: **phạm vi nhỏ + spec có con số + vòng render → nhìn → sửa dài + tài nguyên thật**.
- Explainer của mình thua ở cả bốn: viết cả video 15–90 s trong một đoạn code, beat không có số chuyển động, preview
  khung cố định tối đa 3 vòng, sandbox cấm ảnh. Sửa prompt một mình sẽ không đẹp lên rõ.
- MCP hưởng lợi nhiều nhất: model của khách (thường là Claude mạnh) đã viết code; thứ nó thiếu là tool preview tốt,
  template và tài nguyên.

## Phát hiện

### 1. Opus: thư viện template + agent sửa mã nguồn gốc

- Plugin "Opus Video Studio" ([opus-pro/opusclip-video-tools](https://github.com/opus-pro/opusclip-video-tools),
  đọc 2026-10-22). Skill `motion-ui` chỉ agent tải **mã nguồn gốc** của một template ở
  product-videos.labs.opus.pro rồi giữ nguyên chuyển động, chỉ thay nội dung (`docs/template-source.md`). Không có
  template thì tự làm, theo các luật: một trung tâm thị giác mỗi đoạn, tránh bố cục slide và thẻ song song, mọi
  chuyển động có đường cong có chủ đích, vào nhanh phanh dài, blur phải tan lúc dừng, chữ động theo nghĩa.
- Kết luận bản nghiên cứu nội bộ trước đó (`opencmo-internal/docs/specs/2026-10-19-hoc-agent-opus.md` §3.6) vẫn
  đúng: motion graphics của Opus là LLM viết Remotion TSX, chạy với danh sách thư viện cho phép.

### 2. Thí nghiệm `remakes/opus-5.5` (bằng chứng mạnh nhất)

- `remakes/opus-5.5/README.md`: 34 component (27 có spec chính xác, 7 chỉ có mô tả một đoạn). Mỗi bản dựng lại nhận
  **chỉ** `TASK.md` (spec + danh sách asset + luật dự án) và một dự án Remotion rỗng cùng kích thước, fps, độ dài.
  Không thấy bản gốc. Model tự render still, tự xem, tự sửa. Trung vị 15 phút, 5 vòng.
- `TASK.md` mẫu (`pf-brand-dots`): toàn con số. "1920x1080, 60 fps, 336 frames. Start with five 72px color points at
  y540. Between .7-1.45s morph them … into a 1760x920 five-panel … board with 12px seams…". Cuối có một **chuẩn**:
  khớp mọi số, rồi làm đẹp hết mức về easing, motion blur, typography, chiều sâu, bố cục; chữ lúc dừng phải nét.
- `BUILD-LOG.md` cho thấy vòng xem lại bắt được lỗi rất tinh mà khung cố định của mình sẽ bỏ sót: motion blur cộng dồn
  làm lệch màu, khe giữa hai mảng còn 4px giữa chừng, ảnh zoom ra rồi vào vì hai chuyển động đánh nhau. Model còn tự
  viết `spatial-audit.json` để kiểm hình học bằng số và tách toán chuyển động ra một module thuần để kiểm được.

### 3. Claude Design: starter mỏng, ngữ cảnh dày, kiểm tra riêng

- Repo xuất video MIT [dawoodtrumboo/claude-video-export](https://github.com/dawoodtrumboo/claude-video-export)
  mô tả hợp đồng: animation phải dựng trên `<Stage>` của starter `animations.jsx`, mọi chuyển động đọc từ
  `useTime()` hoặc `<Sprite start end>`, không dùng CSS `@keyframes`, `setTimeout`, `Math.random()` (để mỗi khung
  tái lập được).
- Bản system prompt bị lộ ([gist](https://gist.github.com/hqman/f46d5479a5b663c282c94faa8be866de), chưa xác minh
  chính thức; khớp với repo trên): tool `copy_starter_component` chép starter vào dự án; prompt bắt "mock từ con số 0
  là phương án cuối", phải lấy design system, UI kit, ảnh chụp sản phẩm trước; sau `done` có `fork_verifier_agent`
  chụp màn hình và kiểm riêng.
- REA: mở `claude.ai/design` bằng Chrome headless bị Cloudflare chặn ở bước kiểm tra bot; dừng ở đó, không vượt.

## Repo đáng học

| Repo | Học được gì | File nên đọc | Licence | Copy hay chỉ học |
|---|---|---|---|---|
| opus-pro/opusclip-video-tools — `remakes/` | Spec có số, chuẩn chất lượng, vòng tự xem, audit hình học; code 34 component | `remakes/opus-5.5/README.md`, `*/project/TASK.md`, `BUILD-LOG.md`, `src/` | MIT (`remakes/LICENSE`) | **Copy được** (ghi `THIRD_PARTY_NOTICES.md`); media trong template thuộc bản phát hành gốc, không copy |
| opus-pro/opusclip-video-tools — `plugins/` | Luật motion-ui, quy trình sửa template | `skills/motion-ui/SKILL.md`, `docs/template-source.md` | Không có LICENSE | Chỉ học ý, tự viết lời |
| dawoodtrumboo/claude-video-export | Hợp đồng "thuần hàm của thời gian", Stage/Sprite | `README.md`, `starter/animations.jsx` | MIT | Học ý (mình đã có Remotion) |

## Gắn vào OpenCMO

| Học từ | File của mình | Sửa ra sao | Licence | Chi phí | Cách kiểm |
|---|---|---|---|---|---|
| `TASK.md` của Opus | `apps/web/lib/agent/explainer-tool.ts`, `motion-guide.ts`, guide `explainer` | Trường `direction` bắt buộc: spec có số trước khi viết code | Học ý | S | Eval + xem still |
| `BUILD-LOG.md` | `packages/clip-motion/src/preview.ts`, `layout.ts` | Model tự chọn thời điểm still; phát hiện "nhảy khung"; 6 vòng; checklist xem lại | Học ý | M | vitest + still thật |
| motion-ui "real UI" | `job.ts`, `kit/`, worker `motion.py`, migration | Ảnh của thư viện người dùng vào scene (`kit.Image`), kiểm quyền sở hữu trong SQL | Tự viết | M | pgTAP + still có ảnh |
| `remakes/` | `packages/clip-motion/templates/` | Port 3 component (brand intro, carousel điện thoại, số liệu) thành template có slot | MIT | M | Render so với bản gốc |
| Template ngắn không lời | `ai-models.json`, migration, `motion.py`, tools | Loại `clip`: 3–30 s, không giọng | Tự viết | M | pgTAP + render thật |

## Khuyến nghị

1. **Spec có số + vòng xem lại tốt hơn** (S+M). Rẻ nhất, áp dụng cho cả Assistant và MCP. Plan: `docs/plans/editor/2026-10-22-motion-quality-plan.md`.
2. **Ảnh thật trong scene** (M). Video demo sản phẩm cần ảnh chụp UI thật; đây là chất liệu chính của video marketing OpenCMO.
3. **Template từ `remakes/` + clip ngắn không lời** (M). Cho ra brand intro và khoảnh khắc sản phẩm đẹp ngay lần đầu.
4. **Model mạnh hơn cho bước viết code trong Assistant**: chưa làm. Owner (2026-10-22): chọn model không quan trọng lúc này, ưu tiên là MCP chạy được.
5. Không làm: đổi sang starter kiểu Claude Design hay bỏ kit. Kit vẫn giữ màu, chữ, an toàn sandbox; cái thiếu là spec, vòng xem lại và tài nguyên.

## Nguồn

- https://github.com/opus-pro/opusclip-video-tools (đọc 2026-10-22: `remakes/opus-5.5/README.md`, `pf-brand-dots/project/{TASK.md,BUILD-LOG.md,spatial-audit.json}`, `pf-phone-carousel/project/TASK.md`, `plugins/opus-video-studio/skills/motion-ui/SKILL.md`, `docs/{template-source,shared-rules}.md`, `remakes/LICENSE`)
- https://github.com/dawoodtrumboo/claude-video-export (đọc 2026-10-22: `README.md`, `starter/animations.jsx`)
- https://gist.github.com/hqman/f46d5479a5b663c282c94faa8be866de (đọc 2026-10-22; nguồn cộng đồng, chưa xác minh)
- https://eesel.ai/blog/claude-motion, https://json2video.com/claude-video/claude-animation/ (đọc 2026-10-22; bối cảnh sản phẩm)
- `opencmo-internal/docs/specs/2026-10-19-hoc-agent-opus.md`, `2026-10-19-hoc-agent-opus-2-prompt-tool-agent.md`
