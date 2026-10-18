# Bảo mật

Review bảo mật chính sản phẩm và theo dõi advisory của stack. Chỉ báo cáo, không sửa code.

Mới nhất ở trên. Mỗi lượt thêm một dòng và kiểm danh sách này để không lặp lại chủ đề hay nguồn. Định dạng báo cáo: [`../README.md`](../README.md).

| Ngày | Chủ đề | Báo cáo | Nguồn chính |
|---|---|---|---|
| 2026-10-17 | Credit, billing Polar, cron | [2026-10-17-security-credits-billing-polar.md](2026-10-17-security-credits-billing-polar.md) — huỷ job đang chạy được hoàn gần hết mà giữ clip; hoàn tiền Polar không thu credit; khoá HMAC webhook cần xác minh | Đợt vá Next.js 14/10/2026 (CVE-2026-96889); docs webhook/checkout Polar; polar-js, standard-webhooks, pgledger, supabase-test-helpers, lago-api |
| 2026-10-17 | Audit đăng nhập web, API route, quyền DB (Session B, PR #73) | [2026-10-17-audit-auth-api.md](2026-10-17-audit-auth-api.md) — open redirect `next=/.//evil` sau đăng nhập; SSRF ở link video (yt-dlp gọi được địa chỉ nội bộ); `brain: claude` cho tài khoản 0 credit chạy quét Reddit giá 0; email signup mở trong config; 0/660 lời gọi IDOR chéo user lọt | Code `apps/web`, 109 migration áp lên Postgres 16 + shim Supabase, `next dev` + GoTrue giả, yt-dlp 2026.8.19; docs identity linking Supabase; OWASP |
| 2026-10-17 | Audit MCP trên Modal, OAuth (Session A, PR #73) | [2026-10-17-audit-mcp-modal.md](2026-10-17-audit-mcp-modal.md) — container MCP mount secret của worker và `SUPABASE_JWT_SECRET`; không `max_containers`; token OAuth `client_id` nào cũng qua, DCR mở; tài khoản free dùng preview/research không cần credit; route `/api/mcp` cũ vẫn chạy | Code `packages/mcp-server`, `modal_app.py`, PoC in-process; MCP TS SDK `bearerAuth`; supabase/auth; docs MCP-on-Modal |
| 2026-10-17 | Agent/LLM injection, MCP auth | [2026-10-17-security-agent-injection-mcp.md](2026-10-17-security-agent-injection-mcp.md) — chữ của người lạ ghi được vào bộ nhớ founder; token MCP không gắn audience | Đợt vá bảo mật Next.js tháng 7/8/9 2026; spec MCP 2026-07-28; supabase/auth #2610; arXiv 2607.06595; Unit 42 injection ngoài thực tế; CaMeL, LlamaFirewall, llm-guard, MCP TS SDK, mcp-scan, splinter |
