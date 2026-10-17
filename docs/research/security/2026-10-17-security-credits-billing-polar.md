# Bảo mật: tiền đi qua credit và Polar — huỷ job là được làm miễn phí, hoàn tiền không thu lại credit  (2026-10-17)

## TL;DR

- **Chủ đề tuần này:** sổ credit (`credit_hold` / `credit_settle` / `credit_refund`), webhook Polar, checkout và
  các cron. Báo cáo trước của mảng này (cùng ngày, [agent injection + MCP](2026-10-17-security-agent-injection-mcp.md))
  đã phủ agent và MCP nên lượt này chuyển sang đường tiền, thứ chạm trực tiếp tới doanh thu.
- **Phần lõi làm tốt:** ledger chỉ ghi thêm, số dư do trigger tính, giá tính ở server từ catalog, `credit_*` chỉ
  `service_role` gọi được, webhook không cộng trùng (khoá theo `webhook-id` và theo `order_id`). Không thấy đường nào để
  người dùng tự in credit.
- **Lỗ hổng nằm ở các đường "huỷ / hoàn".** (1) Huỷ một job đang chạy hoàn lại toàn bộ credit trừ 1, mà các clip đã
  publish vẫn giữ và tải được. Làm vậy lặp đi lặp lại là có clip gần như miễn phí. (2) Polar `order.refunded` chỉ ghi
  số tiền hoàn, không thu lại credit, và Polar không có event chargeback, nên ai cũng có thể mua, dùng hết rồi đòi
  hoàn tiền. (3) Link checkout công khai mang `customer_external_id=<user id>`, và webhook tin trường đó trước tiên.
- **Cần xác minh ngay (S):** `apps/web/lib/polar.ts` **giải mã base64** secret webhook. SDK chính thức của Polar thì
  dùng chính chuỗi secret làm khoá HMAC. Nếu secret production không phải dạng `whsec_<base64>` thì mọi webhook sẽ bị
  401: khách trả tiền mà không nhận credit, và Polar có thể tự tắt endpoint.
- **Advisory 7–14 ngày qua:**
  - Next.js 14/10/2026 (GHSA-2464-fhr4-w9xw / CVE-2026-96889, GHSA-673q-mjm6-r5xr, GHSA-p3m5-59mp-jv5r): **có ảnh
    hưởng về phiên bản.** Mình pin `next@15.5.27`, bản vá là 15.5.28. Mức phơi nhiễm thực tế thấp: `sharp` đã ở 0.35.5
    (bản đã vá), không có Server Action, không dùng `use cache` của 16.x, và `next/og` chỉ vẽ chữ. Vẫn nên nâng (S).
  - Supabase Realtime CVE-2026-62247 (presence): **không ảnh hưởng**, vì mình không dùng presence.
  - MCP TS SDK CVE-2026-104850: **không ảnh hưởng.** Đây là lỗi phía client và mình đang pin `1.31.0`, bản đã vá.
  - yt-dlp CVE-2026-55404 / CVE-2026-50023: **không ảnh hưởng.** Lockfile ở `2026.8.19`, và mình không dùng
    `--write-link`.
  - `@anthropic-ai/sdk` 0.133.0, `@google/genai` 2.29.0, `modal` 1.5.5, `mediapipe` 1.0.1, `remotion` 4.0.535: không
    tìm thấy advisory mới.

## Phát hiện

Thang mức độ: Cao / Trung bình / Thấp. "Đã xác nhận" nghĩa là đã đọc đoạn code chứng minh. "Nghi ngờ" nghĩa là cần
chạy thử hoặc đối chiếu với dữ liệu thật. Mình không chạy exploit và không đụng production.

### 0. Advisory của stack

**Next.js, đợt vá ngoài lịch ngày 14/10/2026.** Bản vá: 15.5.28 và 16.4.1. Thông báo trước có từ 08/10.

| Advisory | Mức | Điều kiện | Mình |
|---|---|---|---|
| GHSA-2464-fhr4-w9xw / CVE-2026-96889 | Critical | RCE khi tối ưu ảnh SVG qua `sharp`/librsvg trên Linux glibc, không cần đăng nhập. Sửa ở `sharp` 0.35.5. | `sharp` trong lockfile đã là 0.35.5. Trên Vercel, `/_next/image` do hạ tầng Vercel xử lý. `next.config.ts` không có `images`. `apps/web/lib/og/card.tsx` dùng `ImageResponse` nhưng chỉ vẽ chữ, không nạp SVG lạ. Phơi nhiễm thấp. |
| GHSA-673q-mjm6-r5xr | Critical | Chỉ 16.x, cần Cache Components và `use cache` trả về typed array. | Không ảnh hưởng (mình ở 15.5). |
| GHSA-p3m5-59mp-jv5r | High | DoS, cần ít nhất một Server Action. | Không tìm thấy `"use server"` trong `apps/web`. Không ảnh hưởng. |

Ghi chú từ HOL: `next@15.5.28` vẫn chấp nhận `sharp ^0.34.3`. Khi nâng Next, cần kiểm lockfile để `sharp` không bị kéo
lùi xuống 0.34.

Các advisory khác:

- **Supabase Realtime CVE-2026-62247** (công bố 21/09, sửa ở 2.111.2): lộ metadata presence khi client được ghi nhưng
  không được đọc. Mình không dùng presence, nên không ảnh hưởng.
- **`@modelcontextprotocol/sdk` CVE-2026-104850** (06/10, CVSS 7.5): OAuth client gửi credential tới authorization
  server do một MCP server độc chọn. Mình là server và pin 1.31.0 (bản đã vá). Không ảnh hưởng.
- **yt-dlp CVE-2026-55404** (08/07, sửa ở 2026.07.04) và **CVE-2026-50023** (16/06, sửa ở 2026.06.09): cả hai là lỗi
  file shortcut khi dùng `--write-link`. `uv.lock` ở 2026.8.19. Không ảnh hưởng. Riêng `pyproject.toml` vẫn để sàn
  `>=2025.11.12`; nếu image cài không theo lock thì sàn này cho phép bản cũ (ý kiến: nên nâng sàn khi tiện).

### 1. [Cao, nghi ngờ, cần xác minh ngay] Khoá HMAC của webhook Polar có thể sai cách giải mã

- **Code:** `apps/web/lib/polar.ts`, `verifyPolarWebhook`: bỏ tiền tố `whsec_` rồi `Buffer.from(raw, "base64")`.
- **Polar làm khác:** SDK `polarsource/polar-js`, `src/webhooks.ts` → `validateEvent` lấy secret dạng UTF-8 rồi
  **mã hoá** base64 (`Buffer.from(secret, "utf-8").toString("base64")`) trước khi đưa cho `standardwebhooks`. Thư viện
  đó lại giải mã base64, nên khoá HMAC thực chất là chính chuỗi secret. Hookdeck cũng ghi rằng secret của Polar "không
  có tiền tố `whsec_`" và với bộ kiểm tay thì phải *encode* trước.
- **Hệ quả nếu đúng là lệch:** `Buffer.from(..., "base64")` không báo lỗi khi gặp ký tự lạ, nó chỉ ra một khoá khác.
  Khi đó mọi delivery bị 401. Người dùng trả tiền mà không nhận credit, Polar retry nhiều lần rồi có thể tắt endpoint.
  Test `polar.check.ts` tự ký bằng chính cách giải mã của mình, nên không bắt được lỗi này.
- **Cách xác minh (5 phút):** xem tab Deliveries của endpoint trên dashboard Polar (sandbox và production) có thấy 401
  không, hoặc so một `order.paid` thật với bảng `polar_webhook_receipts`. Nếu đang chạy được, ghi lại định dạng secret
  vào comment để người sau không "sửa" nhầm.

### 2. [Cao, đã xác nhận] Huỷ job đang chạy được hoàn gần hết credit mà vẫn giữ clip

- **Code:** `supabase/migrations/20261101090000_r6_credit_module.sql`, `cancel_job`. Hàm gọi
  `refund_job(p_job_id, …)` để hoàn **toàn bộ** số đang giữ, rồi chỉ giữ lại 1 credit nếu job đang `running`.
- **Clip vẫn còn:** clip được publish dần trong lúc job chạy (`publish_job_clip`, migration
  `20260918100000_progressive_clips.sql`). pgTAP `supabase/tests/065_progressive_clips.test.sql` dòng 68–69 khẳng định
  "cancellation retains ready clip". Route `apps/web/app/api/v1/clips/[id]/file/route.ts` ký URL tải cho mọi clip đọc
  được dưới RLS, không kiểm trạng thái job.
- **Đường tấn công:** mua gói nhỏ nhất, nộp video 54 phút (giữ khoảng 54 credit), chờ 4/5 clip publish, gọi
  `cancel_job`. Kết quả: nhận lại 53 credit, giữ 4 clip đã render. Lặp lại vô hạn bằng cùng số dư.
- **Tác động:** ăn trực tiếp vào biên lợi nhuận (compute Modal, LLM chọn đoạn) và làm mất giá gói credit. Đây cũng là
  hành vi mà một người dùng bình thường có thể tình cờ phát hiện ra ("huỷ là được hoàn").
- **Test:** `085_abuse_limits.test.sql` chỉ kiểm việc giữ 1 credit. Test 065 còn khoá chặt hành vi giữ clip.

### 3. [Cao về kinh doanh, đã xác nhận] Hoàn tiền Polar không thu lại credit; chargeback không có đường xử lý

- **Code:** `supabase/migrations/20260921140000_polar_external_id.sql`, `process_polar_event`. Nhánh `order.refunded`
  chỉ cập nhật `polar_purchases.refunded_amount`, `refunded_tax_amount`, `refunded_at`; migration gốc ghi rõ là không
  trừ credit. Nhánh `subscription.revoked` chỉ hạ `profiles.plan`.
- **Polar không có event dispute/chargeback.** Danh sách event chính thức chỉ có `order.refunded` và
  `refund.created/updated`. Polar là Merchant of Record nên tự xử lý dispute, nhưng mình chỉ biết qua refund.
- **Đường lạm dụng:** mua, dùng hết credit, rồi xin hoàn tiền (hoặc mở dispute). Người đó giữ toàn bộ thứ đã tạo ra,
  cùng phần credit còn lại.
- **Test:** `041_polar_billing.test.sql` kiểm số tiền hoàn nhưng không kiểm số dư. Không có test nào bắt được chuyện
  credit không bị thu lại.

### 4. [Trung bình, đã xác nhận] Người mua quyết định thanh toán gắn vào tài khoản nào

- **Code:** `apps/web/lib/pricing.ts`, `checkoutUrlFor`, gắn `customer_external_id=<profiles.id>` vào **link checkout
  công khai**, thứ mà người mua sửa được trên thanh địa chỉ. `process_polar_event` tin `customer.external_id` (hoặc
  `customer.metadata.user_id`) trước email, và gắn vĩnh viễn `polar_customers(customer_id → user)`.
- **Đường tấn công:** kẻ biết UUID của nạn nhân thanh toán với `customer_external_id=<nạn nhân>`. Kẻ đó không được
  credit (họ là người trả tiền), nhưng customer Polar của họ bị gắn vào nạn nhân.
- **Nghi ngờ:** lần mua sau của chính nạn nhân có thể rơi vào nhánh `skipped: 'account already linked'` (xem mục 5),
  hoặc customer portal của kẻ tấn công điều khiển subscription của nạn nhân.
- **Docs Polar** hướng dẫn tạo checkout session **ở server** với `external_customer_id` lấy từ phiên đã đăng nhập; khi
  đó email bị điền sẵn và khoá lại.
- **Test:** test 086 chỉ phủ đường thuận.

### 5. [Trung bình, đã xác nhận] Webhook trả 200 cho những lần "nhận tiền mà không cộng credit"

- **Code:** `process_polar_event` trả `ok: true` kèm `skipped: 'no matching account' | 'account already linked' |
  'account no longer exists'`. `apps/web/app/api/webhooks/polar/route.ts` (khoảng dòng 109–113) chỉ `console.warn` rồi
  trả 200.
- **Hệ quả:** Polar không retry, và không có dòng nào trong DB để đối soát. Tiền đã vào mà credit không được cộng, và
  chỉ phát hiện được khi khách phàn nàn.

### 6. [Trung bình, đã xác nhận] Gọi thẳng RPC là bỏ qua được bước kiểm duyệt prompt

- **Code:** `create_generation` được `grant execute … to authenticated`
  (`20260929090000_generations.sql:385`; bản `create or replace` ở `20261122090000_generation_dead_reuse.sql` giữ
  nguyên quyền). `moderateText` chỉ chạy trong Next.js (`apps/web/lib/generate/create.ts`, `checkGeneration`, dòng
  128). Worker chỉ kiểm đầu ra, không kiểm lại prompt.
- **Đường tấn công:** POST `/rest/v1/rpc/create_generation` bằng anon key cùng JWT của chính mình. Lệnh này giữ credit
  và đưa vào hàng đợi một prompt chưa kiểm duyệt.
- **Tác động:** giá vẫn tính ở server nên không mất tiền. Nhưng nó phá quy tắc trong `CLAUDE.md` ("prompt đi qua
  `lib/generate/moderation.ts` trước khi giữ credit"), và gửi prompt vi phạm tới nhà cung cấp dưới API key của mình,
  tức rủi ro bị khoá tài khoản nhà cung cấp.

### 7. [Trung bình, một phần nghi ngờ] Các đường dừng/huỷ khác do người dùng điều khiển

- **Assistant:** `agent_record_usage`, `agent_finish_turn` và `agent_stop` được grant cho `authenticated`.
  `agent_close_turn` settle bằng `least(hold, usage đã ghi)`. Nghi ngờ: gọi `agent_stop` trong lúc lời gọi LLM đang chạy
  thì bước đó không bị tính tiền. Cần đọc thêm để biết người dùng có nhận được kết quả của bước đó không.
- **Dịch caption:** `refund_caption_translation` được grant cho `authenticated`
  (`20261024090000_captions_media.sql:314`). Người dùng có thể hoàn tiền giữa chừng. Họ không nhận được kết quả, nhưng
  mình vẫn trả tiền token.
- **Generation:** `cancel_generation` hoàn đủ kể cả khi nhà cung cấp đã tính tiền mình. Nghi ngờ, khả năng thấp: có một
  khe hở nhỏ, trong lúc file đã upload mà chưa `complete_generation`, để lấy được file.

### 8. [Thấp] Các mục khác

- **Gói năm:** `pricing.ts` tự ghi "CHƯA XONG": gói năm chỉ nhận 400 credit cho cả năm. Đây là lỗi làm thiệt khách,
  không phải lỗ hổng, nhưng phải sửa trước khi bán gói năm.
- **Cron:** `apps/web/lib/cron-auth.ts`, `cronAuthorized` (và bản copy trong `cron/cleanup/route.ts`) cho qua khi thiếu
  `CRON_SECRET` mà `NODE_ENV !== "production"`. Trên Vercel thì an toàn. Một staging chạy `next dev` sẽ mở route
  cleanup (xoá tài khoản chưa trả tiền) và route chạy CMO.
- **Quyền hàm:** `20260914091000_web_rls.sql` đổi default privileges cho `public` và `anon`, nhưng Supabase grant thẳng
  cho `authenticated`. Kết quả: mỗi hàm `SECURITY DEFINER` mới đều gọi được từ trình duyệt nếu không có `revoke`.
  Hiện mọi hàm nội bộ về tiền đều đã revoke đúng, nhưng chưa có pgTAP nào liệt kê các hàm mà `authenticated` gọi được
  và so với allowlist. Mục 6 chính là kiểu lỗi mà test này sẽ bắt.
- **Giá theo độ phân giải (nghi ngờ):** `ai_price` dùng `coalesce(price.resolution[spec.resolution], 1)`. Spec thiếu
  `resolution` sẽ bị tính theo mức rẻ nhất, trong khi adapter của worker có thể mặc định một độ phân giải đắt hơn.

### Những gì đang làm tốt (để giữ)

- Webhook Polar kiểm `id.timestamp.body` bằng `timingSafeEqual` có kiểm độ dài, sai lệch thời gian tối đa ±5 phút,
  chấp nhận nhiều chữ ký, giới hạn body 64 KB, và kiểm trên raw body.
- Chống cộng trùng hai lớp: advisory lock cùng khoá chính `polar_webhook_receipts`, và `external_id = 'polar:' ||
  order_id` có unique index.
- `credit_ledger` chỉ ghi thêm (trigger `reject_credit_ledger_change`). Thứ tự khoá cố định (profile rồi job).
  `credit_hold` bỏ qua số ≤ 0. Retry có fence theo attempt và `worker_operations`.
- Không có policy INSERT/UPDATE nào cho ledger, `profiles`, `jobs` hay `polar_*`. RPC của người dùng lấy
  `auth.uid()`, không nhận `user_id` từ client.

## Repo đáng học

| Repo | Học được gì | File nên đọc | Licence | Copy hay chỉ học |
|---|---|---|---|---|
| [polarsource/polar-js](https://github.com/polarsource/polar-js) | Cách Polar thật sự dựng khoá HMAC: encode base64 chuỗi secret rồi mới đưa cho `standardwebhooks`. Đây là chuẩn để đối chiếu mục 1. | `src/webhooks.ts` (`validateEvent`, `WebhookVerificationError`) | MIT | Có thể dùng thẳng SDK, hoặc copy đúng đoạn dựng khoá (kèm notice trong `THIRD_PARTY_NOTICES.md`) |
| [standard-webhooks/standard-webhooks](https://github.com/standard-webhooks/standard-webhooks) | Bản tham chiếu: header, sai lệch ±5 phút, chỉ nhận `v1`, so sánh constant-time, hai chế độ secret (`whsec_` base64 hoặc `raw`). Dùng để viết test vector cho `polar.ts`. | `libraries/javascript/src/index.ts`, `timing_safe_equal.ts` | Apache-2.0 | Copy được (kèm notice), hoặc dùng `standardwebhooks` 1.1.1 vốn đã có trong lockfile |
| [pgr0ss/pgledger](https://github.com/pgr0ss/pgledger) | Ledger kép thuần Postgres: mỗi entry lưu version cùng số dư trước/sau, nên đối soát được số dư tại một thời điểm. Hợp để thêm "tài khoản đối ứng" (refund / clawback / write-off) thay vì chỉ có một chiều credit. | `pgledger.sql` (`pgledger_create_transfer`) | MIT | Chỉ học ý tưởng (ledger của mình đã ổn, không cần thay) |
| [usebasejump/supabase-test-helpers](https://github.com/usebasejump/supabase-test-helpers) | Helper pgTAP: `tests.authenticate_as`, `tests.rls_enabled`, `tests.freeze_time`. Viết test "đổi vai thành authenticated rồi gọi từng hàm" gọn hơn. | `supabase_test_helpers--0.0.6.sql` | MIT | Copy được (kèm notice) nếu cần; ý chính là test allowlist quyền hàm |
| [getlago/lago-api](https://github.com/getlago/lago-api) | Mô hình wallet / prepaid credit kèm credit note và void: hoàn tiền thì thu lại phần chưa dùng, phần đã dùng ghi thành công nợ hoặc write-off. | Phần wallet / credit note trong `app/services` (không đọc được thư mục do robots; xem docs của Lago) | AGPL-3.0 | **Chỉ học**, tuyệt đối không copy |

## Khuyến nghị

Xếp theo tác động trên chi phí. Tất cả là việc cho một PR code riêng sau này; PR này chỉ thêm báo cáo.

1. **Xác minh khoá HMAC của webhook Polar** (mục 1).
   - Chi phí: **S** (vài phút xem Deliveries, rồi có thể một PR nhỏ).
   - Cải thiện: **doanh thu, rủi ro** (khách trả tiền mà không nhận credit là churn ngay ở bước kích hoạt).
   - Cách làm: nếu lệch, dựng khoá như `validateEvent` của Polar, hoặc dùng `standardwebhooks` với secret đã encode.
     Thêm một test vector lấy từ delivery thật của sandbox Polar.
   - Thuộc: PR billing.
2. **Huỷ job đang chạy chỉ hoàn phần chưa xử lý** (mục 2).
   - Chi phí: **S–M**.
   - Cải thiện: **chi phí, doanh thu** (đóng vòng compute miễn phí).
   - Hai cách, nên chọn cách (a):
     - (a) tính lại bằng `settle_job_credits` theo số clip hoặc số phút đã publish, rồi chỉ hoàn phần còn lại;
     - (b) ẩn hoặc xoá clip khi huỷ. Cách này tệ cho UX: người dùng mất thứ đã thấy.
   - Sửa test 065 và 085 cho khớp.
   - Thuộc: migration mới kèm pgTAP.
3. **Thu lại credit khi Polar báo hoàn tiền** (mục 3).
   - Chi phí: **M**.
   - Cải thiện: **doanh thu, rủi ro gian lận**.
   - Cách làm: trên `order.refunded`, ghi một dòng ledger âm, tỉ lệ với `refunded_amount / amount`, nhưng không vượt
     số dư hiện tại. Phần thiếu ghi thành "nợ" để chặn mua job mới cho tới khi bù. Ghi kết quả vào receipt.
   - Thuộc: migration và `process_polar_event`.
4. **Tạo checkout ở server, ghi lại mọi trường hợp bị bỏ qua** (mục 4 và 5).
   - Chi phí: **S–M**.
   - Cải thiện: **rủi ro, doanh thu**.
   - Cách làm: thêm route `POST /api/v1/billing/checkout` gọi `checkouts.create` với `external_customer_id = auth.uid()`
     lấy từ phiên. Bỏ tham số khỏi link công khai. Mọi `skipped` đều ghi một dòng receipt và một cảnh báo (Sentry đã có
     trong stack) để đối soát được.
   - Thuộc: PR billing (gộp với mục 1).
5. **Chuyển kiểm duyệt prompt vào cùng lối với việc giữ credit** (mục 6).
   - Chi phí: **S**.
   - Cải thiện: **rủi ro** (khoá API nhà cung cấp, quy tắc moderation).
   - Cách làm: `revoke execute on create_generation from authenticated`, rồi để route Next.js (đã moderate) gọi qua một
     RPC wrapper nhận kết quả moderation đã ký, hoặc gọi bằng service role sau khi kiểm `auth.uid()`. Cách nhẹ hơn:
     worker gọi lại `moderation.py` cho prompt trước khi gọi nhà cung cấp.
   - Thuộc: PR generate.
6. **pgTAP allowlist cho mọi hàm `authenticated` gọi được** (mục 8).
   - Chi phí: **S**.
   - Cải thiện: **rủi ro lâu dài**. Mỗi migration mới quên `revoke` sẽ đỏ CI ngay.
   - Cách làm: một test duy nhất so `has_function_privilege('authenticated', oid, 'execute')` trên schema `public` với
     một danh sách cố định.
   - Thuộc: `supabase/tests/`.
7. **Nâng `next` lên 15.5.28 và giữ `sharp` ≥ 0.35.5** (mục 0).
   - Chi phí: **S**.
   - Cải thiện: **rủi ro** (phơi nhiễm thấp nhưng đã có CVE critical công khai).
   - Thuộc: PR dependency.
8. **Để sau:**
   - Các đường dừng ở mục 7: settle theo thời gian thực của bước LLM đang chạy, thay vì `least(hold, usage)`.
   - Mặc định `fail closed` cho cron khi thiếu secret ở mọi môi trường trừ `localhost`.
   - Sửa gói năm trước khi mở bán.

**Không làm:** không cần thay ledger hay chuyển sang Lago/Stripe Billing. Lõi hiện tại chắc chắn; vấn đề chỉ nằm ở
chính sách hoàn/huỷ.

## Nguồn

Ngày đọc: 2026-10-17 cho tất cả.

- https://nextjs.org/blog/upcoming-nextjs-security-update-october-2026
- https://www.netlify.com/changelog/2026-10-14-nextjs-react-security-vulnerabilities/
- https://hol.org/guard/security/campaigns/cve-2026-96889-nextjs-october-2026-security-update-rce
- https://github.com/vercel/next.js/security/advisories
- https://hol.org/guard/security/cves/CVE-2026-62247-supabase-realtime-incorrect-authorization
- https://vulert.com/vuln-db/CVE-2026-104850
- https://www.strix.ai/cve/CVE-2026-55404 (công bố 08/07/2026)
- https://advisories.gitlab.com/pypi/yt-dlp/CVE-2026-50023/ (công bố 16/06/2026)
- https://polar.sh/docs/integrate/webhooks/events.md
- https://polar.sh/docs/features/checkout/session.md
- https://hookdeck.com/webhooks/skills/polar-webhooks.md
- https://github.com/polarsource/polar-js/blob/main/src/webhooks.ts
- https://github.com/polarsource/polar-js/blob/main/LICENSE
- https://github.com/standard-webhooks/standard-webhooks/blob/main/libraries/javascript/src/index.ts
- https://github.com/standard-webhooks/standard-webhooks/blob/main/LICENSE
- https://github.com/pgr0ss/pgledger
- https://github.com/usebasejump/supabase-test-helpers
- https://github.com/getlago/lago-api
- Code nội bộ:
  - `supabase/migrations/20261101090000_r6_credit_module.sql`
  - `supabase/migrations/20260921140000_polar_external_id.sql`
  - `supabase/migrations/20260929090000_generations.sql`
  - `supabase/migrations/20261122090000_generation_dead_reuse.sql`
  - `supabase/migrations/20261024090000_captions_media.sql`
  - `supabase/migrations/20260914091000_web_rls.sql`
  - `supabase/tests/065_progressive_clips.test.sql`, `085_abuse_limits.test.sql`, `041_polar_billing.test.sql`
  - `apps/web/lib/polar.ts`, `apps/web/lib/pricing.ts`, `apps/web/lib/cron-auth.ts`
  - `apps/web/app/api/webhooks/polar/route.ts`, `apps/web/lib/generate/create.ts`, `apps/web/lib/og/card.tsx`
  - `package-lock.json`, `packages/engine/uv.lock`, `packages/engine/pyproject.toml`
