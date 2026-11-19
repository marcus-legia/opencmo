# Chất lượng quét trên sản phẩm thật (đợt 4 B1, 20/11/2026)

Chạy bằng `lib/cmo/jobs/eval/scan-quality.ts` với model và reader thật, trên bộ nhớ trong RAM (không ghi database nào).
Ba site: `ferreto.io` (sản phẩm của mình), `tally.so` (form builder), `plausible.io` (analytics); mỗi site một lượt
free và một lượt trả phí. Tổng chi **$0.345** (model $0.161, reader $0.184: 56 lượt Lurk, 36 lượt ScrapeCreators).

## Kết quả

| Site | Lượt | Thread đã chấm | Thẻ | Nguồn lỗi |
|---|---|---|---|---|
| ferreto.io | free | 24 | 4 | Facebook, Threads |
| ferreto.io | trả phí | 26 | 4 | Facebook, Threads |
| tally.so | free | 9 | 0 | Facebook, Threads |
| tally.so | trả phí | 9 | 0 | Facebook, Threads |
| plausible.io | free | 11 | 1 | Facebook, Threads |
| plausible.io | trả phí | 14 | 0 (2 bị bỏ vì draft trượt kiểm) | Facebook, Threads |

Theo nguồn: **Reddit** ra cả 9 thẻ; **Hacker News** 0 thẻ; **Facebook groups** và **Threads** không trả lời ở cả 6 lượt.

## Chấm tay (9 thẻ, 7 thread khác nhau)

Tiêu chí: đúng người (người mua giống ICP), nỗi đau thật bằng lời của họ, còn mới (dưới 7 ngày), reply đáng đăng.

| Thẻ | Đúng người | Nỗi đau thật | Mới | Reply đáng đăng |
|---|---|---|---|---|
| ferreto · r/SaaS "getting the first 10 users still takes me months" (×2) | có | có | 1 ngày | có (bản trả phí) |
| ferreto · r/SaaS "first 10 customers for a niche B2B SaaS" (×2) | có | có | 1 ngày | có |
| ferreto · r/smallbusiness "Solo founder, just launched a B2B app" | có | có | 2 ngày | (free, không draft) |
| ferreto · r/microsaas "first paying users for an AI SaaS" | có | có | 2 ngày | có |
| ferreto · r/SaaS "How did you get your first users?" | có | có | 3 ngày | có |
| ferreto · r/smallbusinessowner freelancer web dev | một phần (bán dịch vụ, không phải phần mềm) | có | 2 ngày | (free) |
| plausible · r/statichosting "free simple web analytics" | có | yếu (hỏi đồ free) | 11 giờ | (free) |

**Reddit: 8/9 thẻ đúng người, 9/9 còn mới (≤ 3 ngày), mọi reply đã draft đều đáng đăng** (giúp trước, không chèn
link, theo luật sub). Chất lượng từng thẻ tốt; vấn đề là **số lượng**.

## Vấn đề, xếp theo độ nặng

1. **ScrapeCreators hết credit (production).** Lỗi trả về: "Social research is paused (out of lookup credits)". Facebook
   groups và Threads đọc qua ScrapeCreators, nên hai nguồn này đang chết với mọi người dùng, và landing kể bốn nguồn.
   Việc của chủ dự án: nạp credit ScrapeCreators (hoặc bật gói tự nạp), rồi kiểm `/api/health/cmo` (B2).
2. **Reddit tìm được quá ít với sản phẩm ngoài ngách "tìm khách".** Tally chỉ 9 thread được chấm, Plausible 11–14, so
   với Ferreto 24–26. Query model viết dài như câu hỏi ("typeform too expensive per submission", "form builder file
   upload paid plan"); tìm kiếm Reddit trả ít kết quả cho câu dài. Hướng sửa (session B): thêm query ngắn 2–4 từ khoá
   ("typeform alternative", "GA4 alternative"), và tìm thẳng trong các sub ở `strategy.where_they_ask`.
3. **Hacker News 0 thẻ ở cả 3 site.** Cần xem HN trả gì cho các query trên (có thể cùng nguyên nhân query dài).
4. **Plausible trả phí: 2 thẻ bị bỏ vì draft trượt kiểm**, nên lượt trả phí ra ít thẻ hơn lượt free (0 so với 1).
   Nên giữ thẻ và để trống draft (như bản free) thay vì bỏ cả người.

## Kết luận cho launch

- Nguồn dưới một nửa "đáng trả lời": **không có** trong các thẻ đã ra. Nhưng 2/4 nguồn đang chết vì hết credit, và
  Reddit ít kết quả cho sản phẩm không thuộc ngách founder. Trước launch: nạp ScrapeCreators (chủ dự án), sửa query
  ngắn và tìm theo sub (B), giữ thẻ khi draft trượt (B).
- Đo lại sau khi sửa với cùng ba site, so số thread đã chấm và số thẻ.
