# PR 45: việc còn lại

Nhánh `user-scenarios`, PR #45. CI xanh trên `b837c60` (web, engine, database, parity, browsers).
Các mục dưới đây là những gì code và CI không tự làm được: chạy với model thật, deploy, và các quyết định sản phẩm.

## 1. Đo Assistant với Claude thật (làm đầu tiên)

Mọi thay đổi Assistant trong PR (đọc song song, `place_broll`, `wait_for_media`, cổng kiểm tra, prompt định tuyến) mới chỉ được kiểm bằng model giả. Đo trước/sau như sau:

```bash
cd apps/web
export ANTHROPIC_API_KEY=...          # key thật

# 1. Trước (bản cũ)
git checkout 3bfa858
npm run agent:eval -- --provider anthropic --yes --out .agent-eval/before

# 2. Sau (nhánh này)
git checkout user-scenarios
npm run agent:eval -- --provider anthropic --yes --out .agent-eval/after

# 3. Sau + hai cờ mới
OPENCMO_AGENT_TOOL_SEARCH=1 OPENCMO_AGENT_CONTEXT_EDITING=1 \
  npm run agent:eval -- --provider anthropic --yes --out .agent-eval/flags
```

**So sánh:** `report.json` trong ba thư mục — số bài qua, `totals.steps`, `totals.calls`, `totals.input` / `cached` / `output`, `cost`.
- Bản sau phải qua ít nhất bằng bản trước, với ít bước và ít token hơn.
- Bật hai cờ ở production (`OPENCMO_AGENT_TOOL_SEARCH`, `OPENCMO_AGENT_CONTEXT_EDITING`) chỉ khi lần 3 tốt hơn lần 2.
- **Chi phí:** mỗi lần chạy đủ 36 bài tốn khoảng vài USD (script in ước lượng trước khi chạy).
- **Chỉ thử luồng làm video** (rẻ, không tốn credit media): `npm run agent:eval -- --provider anthropic --yes --until-card --task video-`.

**Bài cần xem kỹ:**
- `broll`: model có dùng `place_broll` không;
- `verifygate`: model có tự sửa lỗi không;
- `video-*`: có đi vào `create_video` không;
- `ask`: có hỏi trước không.

## 2. Chạy kịch bản người dùng thật

```bash
npm run dev                                   # ở thư mục gốc
cd apps/web && npm run test:scenarios         # tất cả
npm run test:scenarios -- -g " 4\. "          # một kịch bản
```

- **Kịch bản 7–15:** chưa chạy lần nào (quảng cáo, listicle, dịch phụ đề, brand kit, Stop, undo, `/video` 20 s và 5 s, hết credit).
- **Kịch bản 4–6:** chạy lại để xác nhận lỗi đã sửa (`/background` cả clip, `/background` đoạn đầu, `/broll`).
- **Cách xem kết quả:** đọc `.scenarios-out/report.jsonl` và **xem frame xuất ra** (CLAUDE.md: "Verify by looking").
- **Chi phí:** tốn credit thật (fal, Veo, ElevenLabs).

## 3. Khi deploy

- [ ] Chạy 3 migration mới: `20261120090000`, `20261121090000`, `20261122090000` (pgTAP 150–152 đã xanh trên CI).
- [ ] Deploy lại Modal để image export có font Noto (chữ Nhật, Thái, Devanagari, emoji).
- [ ] Production tự host (không phải Vercel): đặt `OPENCMO_ENV=production` cho **cả** web và worker.
- [ ] Sau bước 1, nếu có lợi: bật `OPENCMO_AGENT_TOOL_SEARCH=1` và/hoặc `OPENCMO_AGENT_CONTEXT_EDITING=1`.

## 4. Cần bạn quyết (sản phẩm)

- **Model video mặc định:** Seedance hay Veo.
- **Ảnh nền bị chặn nhầm** là "logo của hãng khác" (lỗi số 5 của lần chạy đầu): nới policy kiểm duyệt hay giữ nguyên.
- **Phụ đề AI đè lên phụ đề in sẵn** trong video: có tự phát hiện và dời/ẩn không.
- **Layout chia đôi bị trống ô trên** (lỗi số 8): hành vi của Assistant. Xem lại sau khi chạy bước 1–2.

## 5. Việc lớn, để PR sau

| Việc | Vì sao chưa làm |
|---|---|
| Export 24/25/50/60 fps lấy mẫu trên lưới 30 fps (60 fps chỉ lặp khung, thời lượng vẫn đúng) | Phải đổi sang khung lẻ trong toàn bộ renderer và golden test parity |
| File project phình to: mỗi đoạn cắt mang một bản copy track theo dõi khuôn mặt | Các đoạn mới dựng lại từ đoạn đầu; cắt bớt keyframe sẽ mất track đầy đủ. Cần đổi schema để lưu track một chỗ |
| Chụp khung hình (`capture`) trên server thay vì vòng qua tab | Vercel không có ffmpeg; phải làm task mới trên worker Modal, chưa chắc nhanh hơn |
| Thu hồi quyền gọi trực tiếp `save_editor_document` / `agent_record_tool` | Route handler gọi chúng với quyền user, thu hồi sẽ hỏng autosave; mỗi user chỉ đụng dữ liệu của mình |

## 6. Tham khảo

- **Mô tả PR #45:** bảng đầy đủ các lỗi đã sửa (9 đợt) và phần "A higher-level Assistant".
- **File check mới:**
  - `apps/web/lib/agent/agent-design.check.ts`
  - `apps/web/lib/agent/video-usecases.check.ts`
  - `apps/web/components/editor/generate/chain.check.ts`
- **Model giả có kịch bản:** `apps/web/lib/agent/providers/fake.ts`. Eval với model giả: 36/36, nhưng chỉ chứng minh tool chạy được từ đầu đến cuối, không chứng minh model thật chọn đúng tool.
