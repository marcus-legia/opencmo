# Tăng trưởng: Article cho AI CMO — đối thủ làm gì, đăng đi đâu được, rủi ro SEO  (2026-11-11)

Bối cảnh: Writer chưa viết article (`docs/architecture/writer.md`: "❌ later", owner 2026-11-08; plan CMO review 3:
"articles (research first)"). Báo cáo này là phần "research first" đó. Spec đi kèm:
[`docs/plans/cmo/2026-11-11-article-spec.md`](../../plans/cmo/2026-11-11-article-spec.md).

## TL;DR

- **Okara, đối thủ trực tiếp, đã bán article**: có Articles Writer, SEO Agent và GEO Agent. Docs của họ nói article
  được đăng thẳng lên CMS, nhưng một bài so sánh bên thứ ba lại nói chỉ là bản nháp chờ duyệt. Article chỉ có ở gói
  trả phí. Với một sản phẩm tự gọi là "AI CMO", article đã thành tính năng mà khách mặc định phải có.
- **Đăng tự động rất hẹp.** LinkedIn không có API đăng article hay newsletter. Medium ngừng cấp token mới. Substack
  không có API công khai (mình không tìm thấy). Còn mở: X Articles (API chính thức từ 2026-06-11, có vẻ cần X
  Premium), WordPress qua Zernio (nhà cung cấp mình đang dùng; thêm WordPress tháng 9/2026), và Ghost Admin API.
- **Rủi ro lớn nhất là SEO, không phải kỹ thuật.** Google không cấm nội dung AI. Nhưng chính sách "scaled content
  abuse" (từ 2024-03) phạt việc đẩy ra nhiều trang mà không thêm giá trị, và từ 2026-05 áp cả cho AI Overviews và AI
  Mode. Một gói kiểu "30 article/tháng" là đi ngược luật này và ngược quy tắc no-ai-slop của mình.
- **Ràng buộc trong code:** `content_items.final_text` tối đa 4000 ký tự, `body` tối đa 16 KB. Một article 1.200–2.000
  từ không vừa, nên cần bảng riêng. Phần còn lại của Writer (prompt, checker, no-ai-slop, giọng văn, card) dùng lại
  được.
- **Ý kiến:** chưa làm ngay. Vòng CMO (post, slide, script) vừa xong và chưa test với khách trả tiền. Khi làm thì làm
  v1 nhỏ: một article mỗi tuần, founder duyệt rồi copy hoặc tải về, và article làm nguồn cho post, slide, script của
  tuần. Đăng tự động để v2.

## Phát hiện

### 1. Okara bán article như một agent riêng

- Okara liệt kê SEO Agent, GEO Agent và AI Content Writer (cùng Reddit, X, LinkedIn, HN agent…). Articles Writer
  "produces full SEO-optimized articles on high-value topics and publishes them directly to your CMS" (docs
  okara.ai). Một bài so sánh bên thứ ba (ranked.ai) thì nói blog của Okara là "drafts for your approval". Hai nguồn
  mâu thuẫn; docs chính chủ đáng tin hơn về hành vi, nhưng đó cũng là chỗ họ quảng cáo.
- Article, GEO, LinkedIn, Reddit… chỉ có ở gói trả phí. Giá theo nguồn thứ cấp: $99/tháng cho gói AI CMO; một nguồn
  khác nói gói Pro $249 có "30+ articles/month". Chưa kiểm trên okara.ai.
- **Vì sao quan trọng:** khi founder so OpenCMO với Okara, thiếu article là một ô trống trên bảng so sánh. Nhưng cách
  Okara làm (đăng thẳng, số lượng lớn) đi ngược hai quy tắc của mình: "Assist, never act" và no-ai-slop. Mình không
  nên chép cách đó.

### 2. Google: nội dung AI không bị cấm, nội dung hàng loạt thì bị

- 2024-03-05 Google ra chính sách "scaled content abuse": nhiều trang làm ra chủ yếu để thao túng xếp hạng là spam,
  dù làm bằng AI, bằng tay hay kết hợp. Ví dụ Google nêu: dùng AI tạo nhiều trang mà không thêm giá trị cho người
  đọc (Search Central blog).
- Theo nguồn thứ cấp (ppc.land), ngày 2026-05-15 Google ghi rõ mọi chính sách spam áp cho cả câu trả lời AI trong
  Search (AI Overviews, AI Mode). Rater guidelines cập nhật tháng 1/2025 có mục riêng về scaled abuse. Chưa đối
  chiếu changelog chính chủ.
- **Vì sao quan trọng:** làm hại SEO của founder là làm hại retention. Điều này kéo theo ba thiết kế: giới hạn số
  lượng (mặc định 1 bài/tuần); mỗi bài phải dựa trên điều chỉ founder có (documents, số liệu thật, câu chuyện của
  họ, chẳng hạn từ một video họ đã quay); và founder duyệt từng bài.

### 3. Đăng đi đâu được (tình trạng 2026-11)

| Nơi | Đăng qua API? | Bằng chứng | Ghi chú cho mình |
|---|---|---|---|
| LinkedIn article / newsletter | **Không** | Posts API chỉ có text, ảnh, video, link share; Articles API chỉ đọc bài đã đăng (Microsoft Learn); một guide 2026 xác nhận newsletter không có API | Copy ra, founder tự đăng. Post LinkedIn link tới bài thì đăng được như post thường |
| X Articles | **Có** | `POST /2/articles/draft` và `POST /2/articles/{id}/publish`, changelog X ngày 2026-06-11 (docs.x.com) | Các blog bên thứ ba nói cần X Premium; chưa rõ Zernio có hỗ trợ không |
| WordPress | **Có, qua Zernio** | Zernio thêm WordPress tháng 9/2026: WordPress.com (OAuth) hoặc self-hosted (Application Password), `POST /v1/accounts/{id}/blogs/{id}/articles`; chỉ bài chuẩn, không custom post type, không field SEO plugin (zernio.com/wordpress) | Trang docs "Create a blog article" vẫn ghi Shopify, cần kiểm lại trước khi dựa vào |
| Ghost | **Có** | Admin API tạo post nháp, chỉ `title` bắt buộc (docs.ghost.org) | Tích hợp riêng, ngoài Zernio |
| Shopify blog | Có, qua Zernio | Zernio Blogs API | Ít founder SaaS dùng |
| Medium | **Không** (cho tích hợp mới) | "will not be issuing any new integration tokens" (help.medium.com); repo API ghi không còn hỗ trợ | Bỏ |
| Substack | Không thấy API công khai | Không có kết quả (chưa kết luận) | Copy ra |

**Vì sao quan trọng:** "đăng tự động" chỉ khả thi cho WordPress (qua Zernio, hợp đồng đã có), Ghost và X Articles.
Phần lớn founder sẽ copy ra, nên v1 nên làm thật tốt bước copy và tải về (Markdown, HTML), không phải bước đăng.

### 4. Typefully và Taplio: long-form, không phải article

- Typefully có trình soạn LinkedIn cho post dài, đăng lên X, LinkedIn, Threads, Bluesky. AI chỉ có ở gói trả phí.
  Changelog 2024 của họ nói chưa đăng được long-form trên X (dữ kiện cũ, có thể đã đổi).
- Một review Taplio nói output AI "robotic and generic", cần 15–30 phút sửa mỗi post (nguồn thứ cấp).
- **Vì sao quan trọng:** đối thủ mảng social không làm article thật. Chỗ mình khác được là chất lượng: giọng của
  founder (đã học từ các lần sửa), số liệu từ documents, và no-ai-slop. Một article tệ còn hại hơn không có.

### 5. Trong repo: dùng lại được gì, thiếu gì

- **Dùng lại được:** `createWriter().draft()` (`lib/cmo/writer/jobs.ts`), checker Haiku ở context riêng, `NO_AI_SLOP`
  và `no-ai-slop.check.ts`, voice notes và corrections, check "số liệu phải có trong documents"
  (`lib/cmo/writer/checks.ts`), card duyệt, `cmo_job_price` và hold credit (charge before running), và
  `capabilities.json` để khai báo job.
- **Thiếu:** chỗ chứa bài dài (`content_items.final_text` ≤ 4000 ký tự, `body` ≤ 16 KB; schema dump 2026-11-11); một
  loại card mới; một màn đọc và sửa bài dài; và quy tắc link (post cấm link, nhưng article thì cần link tới site của
  founder và tới nguồn).
- Quy tắc moderation của Creem áp cho prompt sinh ảnh và video, không áp cho text, nên article không cần gọi Creem
  (`CLAUDE.md`). Nếu sau này article có ảnh minh hoạ thì ảnh đi qua flow ảnh hiện có.

## Repo đáng học

Lần này không đọc repo; phần kỹ thuật (job, card, checker) đã có sẵn trong code của mình. Nếu làm v2 thì nên đọc
client chính thức của Ghost Admin API (`@tryghost/admin-api`, MIT) trước khi tự viết.

| Repo | Học được gì | File nên đọc | Licence | Copy hay chỉ học |
|---|---|---|---|---|
| — | — | — | — | — |

## Khuyến nghị

1. **Chưa làm bây giờ** (S, không tốn gì). Đúng thứ tự owner đã chọn: vòng CMO cho post, slide, script phải chạy
   được với khách trả tiền trước. Spec nằm sẵn trong `docs/plans/cmo/`, chờ owner quyết các câu hỏi mở.
2. **Khi làm, v1 = "Article tuần này"** (M). Một job `write_article`: dàn ý rồi bản nháp, trong một lần trừ credit.
   Card duyệt, màn đọc và sửa, nút copy và tải `.md`/`.html`. Bảng `articles` riêng. Mặc định tối đa 1 bài/tuần.
   Cải thiện: tăng giá trị mỗi tuần (retention), lấp ô trống so với Okara (chuyển đổi). Thuộc: plan mới của Writer.
3. **Article làm nguồn của tuần** (S–M, đi cùng v1). Bài đã duyệt thành nguồn cho post, slide và script trong week
   plan. Một ý được viết sâu một lần rồi chẻ ra, khớp chủ đề "repurpose" mà blog OpenCMO đang viết. Cải thiện:
   chất lượng post, ít ý rời rạc.
4. **v2: đăng lên WordPress qua Zernio** (M), sau khi kiểm docs Zernio Blogs API cho WordPress. Ghost (M) chỉ làm khi
   có founder hỏi. Vẫn là duyệt rồi mới đăng, đúng "Assist, never act".
5. **X Articles chỉ khi Zernio hỗ trợ** (S nếu có). Tự gọi API X nghĩa là thêm một tích hợp OAuth thứ hai, không đáng.
6. **Không làm:** đăng tự động không qua duyệt, gói "N article/tháng" kiểu Okara, trang SEO hàng loạt, Medium.

## Nguồn

Đọc ngày 2026-11-11 (qua công cụ tìm kiếm; nguồn thứ cấp ghi rõ ở trên).

- Okara AI CMO: https://okara.ai/docs · https://okara.ai/blog/introducing-okara-ai-cmo · https://www.ranked.ai/compare/ranked-ai-vs-okara · https://www.pulse.bot/digital-marketing/news/okara-launches-ai-cmo-platform-automating-seo-content-and-growth-for-99month-1483e392-ea1f-4ad9-b6aa-2d32e9cea1ff/
- Google: https://developers.google.com/search/blog/2024/03/core-update-spam-policies · https://blog.google/products/search/google-search-update-march-2024/ · https://ppc.land/google-spam-policies-now-officially-cover-ai-overviews-and-ai-mode-in-search · https://ppc.land/scaled-content-abuse/
- LinkedIn: https://learn.microsoft.com/en-gb/linkedin/marketing/community-management/shares/articles-api · https://zernio.com/blog/linkedin-posting-api
- X Articles: https://docs.x.com/x-api/articles/introduction · https://opentweet.io/how-to/x-articles-api-endpoints
- Zernio: https://zernio.com/wordpress · https://docs.zernio.com/blogs/create-blog-article · https://zernio.com/blog/september-17-2026-product-updates · https://docs.zernio.com/platforms
- Ghost: https://docs.ghost.org/admin-api/posts/creating-a-post
- Medium: https://help.medium.com/hc/en-us/articles/213480228 · https://github.com/Medium/medium-api-docs
- Typefully, Taplio: https://typefully.com/blog/taplio-alternatives · https://contentin.io/alternatives/typefully/ · https://typefully.com/changelog/page/4
