# Báo cáo nghiên cứu

Do scheduled task nghiên cứu (hai lần mỗi tuần) và các agent đóng vai product advisor viết
(`CLAUDE.md`, "Product advisor role"). Mỗi báo cáo một file: `YYYY-MM-DD-<topic>.md` (slug tên file viết tiếng Anh
không dấu).

**Ngôn ngữ:** báo cáo trong thư mục này viết bằng **tiếng Việt** (ngoại lệ của quy tắc "mọi thứ trong repo bằng
tiếng Anh" trong `CLAUDE.md`). Giữ nguyên tiếng Anh cho tên file, đường dẫn, tên hàm/biến, tên sản phẩm, mã CVE,
câu trích và URL. Commit message vẫn bằng tiếng Anh; tiêu đề và mô tả PR của báo cáo viết bằng tiếng Việt.

## Vòng luân phiên

Mỗi lượt chọn mảng tiếp theo trong danh sách sau mảng của báo cáo gần nhất, trừ khi có việc khẩn cấp
(một đợt ra mắt lớn, một advisory bảo mật ảnh hưởng stack của mình):

1. AI agents: thiết kế tool, vòng lặp agent, bộ nhớ, evals
2. Video editing: tính năng editor, style caption/motion, định dạng video ngắn, bản phát hành của đối thủ
3. Bảo mật (Security): bảo mật LLM/agent (prompt injection, lạm dụng tool), bảo mật web app, advisory Supabase/Next.js
4. Workflow và tự động hoá: job engine, scheduler, marketing automation, API mạng xã hội
5. Tăng trưởng cho SaaS của solo founder: giá, onboarding, activation, phân phối (cái gì đang hiệu quả)
6. Kỹ năng editor và template sáng tạo: thư viện style, đóng gói prompt/skill, repo tham khảo

## Định dạng báo cáo

```markdown
# <Mảng>: <tiêu đề một dòng>  (YYYY-MM-DD)

## TL;DR
3–5 gạch đầu dòng: thế giới vừa thay đổi gì, điều đó nghĩa là gì cho OpenCMO.

## Phát hiện
Mỗi phát hiện: nó là gì, link, vì sao quan trọng với mình, bằng chứng (số liệu, sao, ngày).

## Repo đáng học
| Repo | Học được gì | File nên đọc | Licence | Copy hay chỉ học |

## Khuyến nghị
Có xếp hạng. Mỗi mục: làm gì, chi phí (S/M/L), cải thiện gì (activation, retention, doanh thu, chi phí, rủi ro),
và thuộc doc/PR/track nào. "Không làm gì" cũng là một khuyến nghị hợp lệ.

## Nguồn
Mọi URL đã dùng, kèm ngày đọc.
```

Quy tắc: tiếng Việt; dẫn nguồn mọi thứ; không chép code vào báo cáo; dữ kiện cũ hơn 6 tháng phải ghi rõ; nhận định
không có nguồn phải gắn nhãn là ý kiến.

## Mục lục

Mới nhất ở trên. Mỗi lượt thêm một dòng và kiểm danh sách này để không lặp lại nguồn.

| Ngày | Mảng | Báo cáo | Nguồn chính |
|---|---|---|---|
| 2026-10-17 | Bảo mật | [2026-10-17-security-agent-injection-mcp.md](2026-10-17-security-agent-injection-mcp.md) — chữ của người lạ ghi được vào bộ nhớ founder; token MCP không gắn audience | Đợt vá bảo mật Next.js tháng 7/8/9 2026; spec MCP 2026-07-28; supabase/auth #2610; arXiv 2607.06595; Unit 42 injection ngoài thực tế; CaMeL, LlamaFirewall, llm-guard, MCP TS SDK, mcp-scan, splinter |
| 2026-10-16 | Video editing | (seed) xem reel tham khảo, dẫn tới `docs/style-skills-build.md` | Instagram reel "5 Plugins To Code Like A Senior Dev" |
