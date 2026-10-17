# Tăng trưởng: kế hoạch 30 ngày — từ 0 khách trả tiền đến 10  (2026-10-17)

## TL;DR

- **Code không còn là điểm nghẽn. Bán hàng mới là.** Production (đọc ngày 17/10): **2 user, 0 lượt mua Polar,
  0 thẻ Sales**, trong khi repo đã có 105 migration và khoảng 70 PR. Mọi thứ đã deploy (Vercel chạy `main` mới
  nhất, DB đã nhận migration cuối `20261130090000`). Sản phẩm đủ để bán; chỉ là chưa có ai được mời mua.
- **Đã làm xa hơn v1 rất nhiều, nhưng 4 bước cuối của lộ trình v1 vẫn chưa xong** (`opencmo-internal/docs/cmo/san-pham.md`
  §9): C (thanh toán chạy hết luồng), 3 (14 ngày tự dùng Post), 4 (Sales chạy thật), 7 (dogfood + được Polar duyệt).
  Trong khi đó 3D, Lottie, code scenes, `/video` AI, MCP và style skills đều đã ship.
- **Sales đang tắt trên production:** Vercel không có `SCRAPECREATORS_API_KEY`, nên W4 (Reddit) và W7 (nghiên cứu
  đối thủ) không chạy được. Đây lại là department khác biệt nhất: GummySearch đóng cửa ngày 30/11/2025 và để lại một
  thị trường rời rạc ($19–59/tháng).
- **Giá đang lệch:** `pricing.ts` bán $80/tháng (năm: $60/tháng), còn `san-pham.md` ghi "$15 khởi đầu, trả theo dùng".
  Gói năm có lỗi đã biết: chỉ cộng 400 credit cho **cả năm** (comment trong `pricing.ts`). Okara bán $129–249,
  công cụ đơn lẻ (Opus Clip, RedShip, Hypefury) bán $15–29.
- **Khuyến nghị:** đóng băng tính năng 30 ngày. Tuần 1 bật đường tiền, tuần 2 tự dùng, tuần 3 tự tay tìm 10 khách,
  tuần 4 launch công khai. Mục tiêu đo được: **10 khách trả tiền và 3 người vẫn dùng ở tuần thứ 2 sau khi trả tiền**.

## Phát hiện

### 1. Hiện trạng production (đọc trực tiếp ngày 17/10/2026)

| Chỉ số | Giá trị | Nghĩa là |
|---|---|---|
| `auth.users` | 2 (1 trong 30 ngày qua) | Chưa có người lạ nào dùng thử |
| `polar_purchases`, `polar_subscriptions` | 0 / 0 | Chưa có đồng doanh thu nào, kể cả lượt mua thử |
| `jobs` | 15 done, 2 failed | Đường clip chạy được |
| `cmo_runs` | 16 done | Động cơ CMO chạy được |
| `content_items` | 7 planned, 8 in_review, **3 approved** (lần cuối 10/10) | Inbox Post có thẻ, nhưng ít được duyệt; 5 ngày nay không ai duyệt thẻ nào |
| `opportunities` | **0** | Sales chưa chạy lần nào trên production |
| `generations` | 25 done, 2 failed | AI media chạy được |
| Env Vercel production | Có Anthropic, Gemini, fal, ElevenLabs, Polar (5 biến), Google OAuth. **Thiếu `SCRAPECREATORS_API_KEY`**, không thấy DSN của Sentry | Sales/W7 tắt; lỗi production không được báo về đâu (`@sentry/nextjs` có trong `package.json`) |

Mình không mở được `opencmo.io` từ container này (proxy chặn), nên chưa kiểm landing từ bên ngoài.

### 2. Lộ trình v1 bị bỏ dở ở đúng đoạn tạo ra doanh thu

`san-pham.md` §9 tự đặt luật "không sang bước sau khi bước trước chưa đạt". Bước 3 cần "14 ngày liền Marcus đăng
1 bài/ngày từ Inbox", nhưng DB chỉ có 3 bài được duyệt. Bước 4 cần "≥ 30% thẻ đúng người đang cần", nhưng chưa có
thẻ nào. `VIEC-CAN-LAM.md` có khoảng 60 mục **CHỜ BẠN**, phần lớn là việc của tài khoản (khoá, deploy, mua thử),
không phải việc code. *Ý kiến:* cảm giác "không biết làm gì tiếp" là vì danh sách việc là danh sách tính năng.
Không có danh sách nào bắt đầu bằng "khách hàng".

### 3. Bối cảnh thị trường

| Đối thủ | Giá | Ghi chú |
|---|---|---|
| Okara (AI CMO) | Lite $129, Pro $249/tháng (09/2026); lúc launch 03/2026 là $99 | Đối thủ trực tiếp. Reviewer chê "chưa có số liệu về traffic/chuyển đổi" |
| Opus Clip | Starter $15, Pro $29/tháng; 1 credit = 1 phút video | Chỉ có clip |
| Submagic | $12–88/tháng; clip là add-on | Chỉ có phụ đề + clip |
| RedShip / Subreddit Signals / Leedlime | $19–59/tháng, hoặc credit $20–79 | Lấp khoảng trống GummySearch để lại; chấm điểm 0–100 + soạn trả lời, giống hệt W4 |
| Hypefury / Typefully | $29 / $8–20 mỗi tháng | Chỉ có X |

Gộp các công cụ đơn lẻ lại (clip $29 + Reddit $29 + X $29) thì ra khoảng $87/tháng, gần mức $80 của mình. Nhưng
khách chỉ trả giá gộp khi họ tin cả ba phần đều chạy, và hôm nay landing chưa có bằng chứng nào. *Ý kiến:* với
khách đầu tiên, giá thấp hơn và một lời hứa hẹp hơn sẽ dễ bán hơn.

### 4. Polar: duyệt dựa trên sản phẩm chạy thật

Theo docs của Polar, account review gồm một khảo sát về sản phẩm và KYC (hộ chiếu + selfie) **trước lần payout
đầu tiên**. Polar khuyên tích hợp xong và có website chạy thật trước khi xin duyệt. Lần duyệt đầu mất 24–48h
(nguồn thứ ba nói tới một tuần), và có các lần duyệt lại ở mốc doanh thu $1k/$5k/$10k. Phí gói Starter là
5% + $0.50 từ 27/05/2026 (theo nguồn thứ ba, chưa kiểm trên trang của Polar). Nghĩa là: chỉ có lượt mua thật đầu
tiên mới cho biết mình có bị chặn hay không. Đừng đợi đến tuần 4 mới biết.

## Repo đáng học

Lượt này không đọc repo nào. Câu hỏi của lượt này là đi bán thế nào, không phải xây gì. Repo đáng học cho Sales
eval (`elie222/inbox-zero`) đã có trong `agents/2026-10-17-agent-evals-draft-signal.md`.

## Khuyến nghị

### 0. Luật cho 30 ngày (17/10 → 15/11)

1. **Đóng băng tính năng.** Chỉ có 3 loại việc được code: (a) lỗi chặn một người dùng thật, (b) lỗi chặn thanh
   toán, (c) chỗ ma sát mà người dùng thật vấp phải trong onboarding. Các việc trong `docs/ke-hoach-pr-sau.md`
   (60 fps, document phình), text animator, chained shots, 3D… để sang tháng sau.
2. **Mỗi ngày đổi một chỉ số.** Mỗi tối trả lời: hôm nay có thêm signup / activation / lượt mua / người quay lại không?
3. **Một lời hứa trên landing:** "Every morning: 3 posts and 5 Reddit conversations ready to approve. Got video?
   We turn it into clips." Post + Sales là thói quen hằng ngày (giữ chân khách). Video là thứ khác biệt cho khách có
   video. Không để video làm headline, vì đa số solo founder chưa có video dài. *(Ý kiến, kiểm lại ở tuần 3 bằng
   câu hỏi "bạn có video dài không?")*

### Tuần 1 (17–23/10): bật đường tiền và nhìn sản phẩm bằng mắt người lạ

| # | Việc | Ai | Cỡ | Xong khi |
|---|---|---|---|---|
| 1 | Thêm `SCRAPECREATORS_API_KEY` trên Vercel. Chạy W4 một lần cho chính OpenCMO, sửa parser theo response thật (`lib/cmo/social/scrapecreators.ts`) | Bạn + agent | S | `opportunities` có ≥ 5 thẻ thật |
| 2 | Mở dashboard Polar: account đã duyệt chưa, payout có bị khoá không. Chưa duyệt thì nộp khảo sát + KYC ngay | Bạn | S | Biết rõ trạng thái |
| 3 | **Chốt giá.** Đề xuất: một gói **$49/tháng** (giá gạch ngang thường trực $79, theo đúng triết lý trong `pricing.ts`); tạm ẩn gói năm cho tới khi sửa xong lỗi cộng credit theo tháng. 20 khách đầu được "founding price" $29 trọn đời gói | Bạn quyết, agent sửa `pricing.ts` + product Polar | S | `check:pricing`, `check:polar` xanh |
| 4 | Mua thật bằng thẻ của bạn (hoặc mã giảm 100%), rồi refund trong app | Bạn | S | `polar_purchases` = 1, credit cộng đúng, refund trừ đúng |
| 5 | Bật Sentry (DSN trên Vercel + Modal) | Bạn | S | Một lỗi thử hiện trên Sentry |
| 6 | UAT bằng tài khoản Google mới, trên laptop và điện thoại: landing → signup → URL website → 6 document → 5 bài nháp → thử clip → paywall. Ghi mọi chỗ vấp | Bạn (agent soạn checklist) | M | Danh sách ma sát xếp hạng |
| 7 | Kiểm: người chưa trả tiền có thấy giá trị **trước** paywall không? (`free` hiện "No monthly credits", tài khoản bị xoá sau 30 ngày.) Nếu chưa thì cho onboarding + 5 nháp + 1 lượt quét Reddit miễn phí | Agent | S–M | Người mới thấy thẻ Inbox đầu tiên trong < 5 phút mà không phải trả tiền |
| 8 | Funnel bằng SQL (chưa cần công cụ analytics): signup → onboarding xong → duyệt thẻ đầu tiên → mua → quay lại ngày 7. Một file `scripts/funnel.sql` chỉ đọc | Agent | S | Chạy ra bảng 5 dòng |

### Tuần 2 (24–30/10): tự dùng OpenCMO để bán OpenCMO

- **Mỗi sáng 20 phút trong Inbox:** duyệt 1–3 bài X, mở 5 thread Reddit và tự trả lời những thread thật sự đúng
  người (theo luật subreddit, có ích trước, không spam). Đây vừa là bước 3 và 4 của lộ trình v1, vừa là kênh phân
  phối đầu tiên.
- **Quay một video 15–20 phút** (demo + câu chuyện vì sao làm OpenCMO), cho chạy qua Video → 5 clip → tự đăng
  TikTok/Shorts/Reels/X. Trích frame từ file full-size ra xem (CLAUDE.md "Verify by looking").
- **Thay hình landing bằng output thật** của tuần này: thẻ Inbox, clip, thread Reddit đã chấm. Luật "không bán thứ
  chưa có" thì đây là bằng chứng mạnh nhất.
- Chỉ sửa lỗi gặp khi tự dùng. Ghi lại tỉ lệ duyệt không sửa (đề xuất 1 của báo cáo agents tuần này).
- **Xong khi:** 7/7 ngày có bài đăng từ Inbox, ≥ 30% thẻ Reddit đúng người, landing có ≥ 3 ảnh output thật.

### Tuần 3 (31/10–6/11): tự tay tìm 10 khách đầu tiên

Không quảng cáo, không launch. Mỗi ngày 1 giờ, làm trên tài khoản của chính bạn:

1. **Danh sách 50 solo founder** đang than về marketing. Lấy từ chính thẻ Sales của OpenCMO, từ r/SaaS,
   r/indiehackers, r/startups, và từ những người #buildinpublic trên X đang có một sản phẩm.
2. **Mỗi ngày nhắn 10 người.** Đừng hỏi "dùng thử nhé". Hỏi để xin góp ý: "Mình chạy thử OpenCMO trên website của
   bạn rồi, đây là 3 bài nháp và 2 thread Reddit nó tìm ra. Có đúng không?". Kèm ảnh chụp *(khuyến nghị: làm bằng
   tay, đúng luật "assist, never act")*.
3. **5 design partner:** miễn phí 1 tháng, đổi lấy một cuộc gọi 15 phút mỗi tuần. Ghi lại họ bỏ ở bước nào.
4. **Hỏi mua ngay ở cuộc gọi đầu tiên:** founding price $29, chỉ có cho 20 người đầu.
- **Xong khi:** ≥ 30 người đã thấy output trên website của chính họ, ≥ 5 cuộc gọi, **≥ 3 khách trả tiền**.

### Tuần 4 (7–13/11): launch công khai

- **Product Hunt** (thứ Ba hoặc thứ Tư), cùng ngày đăng thread "build in public" trên X và bài trên Indie Hackers.
  Đăng r/SaaS theo đúng ngày tự giới thiệu của sub đó.
- Trang `/vs/okara` và `/vs/gummysearch` (so sánh thật, không chê bịa).
- Email cho mọi người đã signup: founding price còn N suất.
- **Xong khi:** ≥ 100 signup trong tuần, **tổng ≥ 10 khách trả tiền**.

### Ngày 29–30 (14–15/11): nhìn số rồi quyết 30 ngày tiếp theo

| Nếu | Thì |
|---|---|
| ≥ 10 khách, ≥ 3 người duyệt thẻ ở tuần thứ 2 sau khi trả tiền | Giữ hướng; tháng sau mở Zernio (đăng có duyệt) + báo cáo tuần |
| Signup có nhưng activation < 30% | Tháng sau chỉ làm onboarding |
| Khách chỉ dùng Sales hoặc chỉ dùng Video | Thu hẹp lời hứa về đúng department đó, đổi landing và giá |
| < 3 khách dù đã nhắn 150 người | Định vị sai. Phỏng vấn lại 10 người trước khi viết thêm dòng code nào |

### Không làm trong 30 ngày

60 fps, chống document phình, `capture` trên worker, text animator / lower thirds, chained shots, 3D / Lottie /
code scenes mới, desktop app, LinkedIn, SEO/GEO, Creem (chỉ chuyển nếu Polar từ chối), agent mới. Ghi ý tưởng vào
`note.md` rồi để đó.

### Chi phí và đánh đổi

- Tiền: ScrapeCreators khoảng $3–6/khách/tháng (`san-pham.md` §4.5), Product Hunt miễn phí, Sentry gói free. Không
  có chi phí lớn mới.
- Đánh đổi: 30 ngày không có tính năng mới. *Ý kiến:* với 0 khách, mỗi tính năng thêm vào là một tính năng chưa ai
  dùng. Một tháng không ship tính năng rẻ hơn nhiều so với một tháng nữa không có khách.

## Nguồn

Dữ liệu nội bộ (17/10/2026): Supabase production `opencmo` (chỉ query tổng hợp, không đọc dữ liệu cá nhân), danh
sách env và deployment của Vercel (chỉ tên biến), `apps/web/lib/pricing.ts`, `opencmo-internal/docs/cmo/san-pham.md`,
`opencmo-internal/VIEC-CAN-LAM.md`, `docs/ke-hoach-pr-sau.md`, `docs/ai-video-status.md`.

Bên ngoài (đọc 17/10/2026):
- Polar account reviews — https://polar.sh/docs/merchant-of-record/account-reviews
- Polar review 2026 (phí, bên thứ ba) — https://fungies.io/polar-sh-review-2026-2/
- Giá Okara — https://toolradar.com/tools/okara/pricing ; https://aihola.com/article/okara-ai-cmo-launch ;
  https://iphonesoft.fr/2026/03/17/agents-marketing-ia-okara-ai-promesse-illusion
- Giá Opus Clip — https://www.castmagic.io/blog/opus-clip-pricing ;
  https://creatify.ai/blog/opusclip-pricing-plans-and-what-you-ll-actually-pay-in-2026
- Giá Submagic — https://costbench.com/software/ai-video-editing-saas/submagic/
- GummySearch đóng cửa, các bên thay thế — https://redship.io/best-gummysearch-alternatives ;
  https://simular.ai/alternatives/gummy-search-alternatives (cả hai là trang của vendor, có thiên vị)
- Typefully / Hypefury — https://toolradar.com/tools/typefully/pricing ; https://comparetiers.com/compare/hypefury-vs-typefully
- Playbook 10 khách đầu tiên (nguồn của vendor, độ tin thấp) — https://www.unilink.us/blog/how-to-build-a-saas-2026 ;
  https://designrevision.com/blog/how-to-start-a-saas-business.md
