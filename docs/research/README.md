# Báo cáo nghiên cứu

Do các scheduled task nghiên cứu và các agent đóng vai product advisor viết (`CLAUDE.md`, "Product advisor
role"). Mỗi mảng có một thư mục riêng và một mục lục riêng, để các PR mở cùng một sáng không đụng nhau.

**Ngôn ngữ:** báo cáo trong thư mục này viết bằng **tiếng Việt** (ngoại lệ của quy tắc "mọi thứ trong repo bằng
tiếng Anh" trong `CLAUDE.md`). Giữ nguyên tiếng Anh cho tên file, đường dẫn, tên hàm/biến, tên sản phẩm, mã CVE,
câu trích và URL. Commit message vẫn bằng tiếng Anh; tiêu đề và mô tả PR của báo cáo viết bằng tiếng Việt.

## Các mảng

Mỗi mảng chạy một lần mỗi tuần, sáng Thứ 4 (~5h giờ Việt Nam), mỗi lượt mở đúng một PR chỉ sửa thư mục của mảng
đó.

| Mảng | Thư mục | Phạm vi |
|---|---|---|
| Bảo mật | [`security/`](security/README.md) | Review bảo mật chính sản phẩm: RLS/RPC, auth, agent và LLM (prompt injection, lạm dụng tool), MCP, upload và ffmpeg, secret và dependency; advisory của Next.js, Supabase, Electron, Modal, ffmpeg, stack LLM/agent. Chỉ báo cáo, không sửa code. |
| Editor & motion | [`editor/`](editor/README.md) | Sản phẩm và tính năng editor, caption, animation, 3D, motion graphic, AI editor; đối thủ (CapCut, Opus Clip, Descript, Submagic, Captions…); thư viện style, template, repo tham khảo. |
| AI agent & automation | [`agents/`](agents/README.md) | AI agent cho sản phẩm của mình: thiết kế tool, vòng lặp agent, bộ nhớ, evals; job engine, scheduler, marketing automation, API mạng xã hội. |
| Tăng trưởng | [`growth/`](growth/README.md) | Tăng trưởng cho SaaS của solo founder: giá, onboarding, activation, retention, phân phối, cái gì đang hiệu quả (Typefully, Hypefury và các SaaS indie). |

Tên file: `<thư mục>/YYYY-MM-DD-<slug>.md` (slug tiếng Anh không dấu). Mỗi lượt đọc mục lục của thư mục mình
trước để không lặp chủ đề hay nguồn, và chọn chủ đề con chưa được phủ gần đây.

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
