# Bảo mật: audit MCP trên Modal và OAuth — container giữ chìa khoá của cả hệ thống, token OAuth nào cũng qua  (2026-10-17)

Session A của plan [`docs/plans/security/2026-10-17-mcp-auth-api-audit-plan.md`](../../plans/security/2026-10-17-mcp-auth-api-audit-plan.md)
(PR #73). Chỉ audit, không sửa code. Code đọc trên `main` ở `ddb63c5`.

## TL;DR

- **Lõi tool làm đúng.**
  - Mọi tool chạy dưới RLS của người gọi; `userId` chỉ lấy từ phiên, không lấy từ tham số.
  - Lỗi nội bộ không lộ ra cho model.
  - Mã confirm của server mới ký HMAC và chỉ dùng được một lần (`mcp_confirm_use`).
  - Body bị chặn ở 1 MiB.

  Không tìm thấy đường đọc dữ liệu của người khác qua MCP.
- **Rủi ro lớn nhất là chỗ đặt server, không phải code tool.**
  - Container `opencmo-mcp` mở ra internet nhưng mount nguyên secret của worker: service role, Anthropic, `OPENCMO_WORKER_TOKEN`, `CRON_SECRET`.
  - Nó còn giữ `SUPABASE_JWT_SECRET`, khoá ký được JWT cho **bất kỳ** user nào.
  - Một lỗi RCE hay dependency độc trong container này đồng nghĩa mất toàn bộ database.
  - `CRON_SECRET` và token Modal không được code nào trong bundle dùng tới.
- **Dễ bị đánh sập:**
  - Modal không có `max_containers`.
  - Không có giới hạn theo IP.
  - Nếu giới hạn 200 request/giây của Modal tính chung cho cả workspace (nghi ngờ, cần xác nhận), thì chỉ cần flood request không token vào MCP là đủ chặn luôn endpoint `submit` mà web app dùng để gửi job video.
- **OAuth:**
  - Server nhận mọi token OAuth của Supabase có `client_id` bất kỳ (đã chạy thử).
  - DCR mở, tên client do người đăng ký tự đặt và hiện ngay trên tiêu đề màn consent.
  - Kẻ tấn công có thể dựng client tên "Claude" để lừa user bấm đồng ý. Token lấy được là JWT user đầy đủ, gọi thẳng PostgREST được chứ không chỉ MCP.
- **Tài khoản free (0 credit, hard paywall) vẫn dùng được tài nguyên tốn tiền qua MCP:** 30 preview render/giờ, 180 lookup ScrapeCreators/giờ, 20 lần đọc web/giờ. Giá để có một tài khoản chỉ là một tài khoản Google.
- **Route cũ `/api/mcp` trên Vercel vẫn chạy và app vẫn trỏ tới.**
  - Không chặn kích thước body (đã parse thử 32 MiB).
  - Mã confirm dùng lại được, nhưng không bị trừ tiền hai lần vì `create_generation` dùng lại theo `spec_hash`.
  - Nên tắt route này.

## Phát hiện

Thang mức độ: Cao / Trung bình / Thấp.

- **"Đã xác nhận"**: đã đọc code và chạy lại được trong máy này. Các PoC chạy in-process, gọi thẳng `handle()` của `packages/mcp-server/src/http.ts` hoặc `POST` của route cũ, với `fetch` giả lập Supabase.
- **"Nghi ngờ"**: cần Modal thật, Supabase Auth thật hoặc claude.ai để kiểm.

**Môi trường:** không có Modal CLI, không có Supabase CLI/Docker. Vì vậy không chạy được `modal serve` hay luồng OAuth thật; mục nào cần những thứ đó đều ghi rõ cách kiểm tay. Trong PoC, `getUser` của Supabase là bản giả lập, nên mục 3 chỉ chứng minh phần kiểm ở phía server mình; Supabase thật có nhận token đó hay không thì vẫn là nghi ngờ. Không có request nào đi ra production.

### 1. [Cao, đã xác nhận] Container MCP giữ secret của cả hệ thống, nhiều hơn mức nó cần

- **Code:** `packages/engine/modal_app.py:722-732`: `secrets=[secret, voice_secret, fal_secret, modal.Secret.from_name("opencmo-mcp")]`.
  - `secret` là secret `opencmo` của worker: `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `OPENCMO_WORKER_TOKEN`, `CRON_SECRET`, `OPENCMO_WEB_URL`, có thể thêm `GEMINI_API_KEY` (header `modal_app.py:3-8`).
  - `opencmo-mcp` thêm `SUPABASE_JWT_SECRET`, `MOTION_PREVIEW_TOKEN`, và tuỳ chọn `MODAL_TOKEN_ID/SECRET`.
- **Bundle thật sự đọc biến nào:** build `dist/server.cjs` rồi grep `process.env` (đã chạy).

  | Biến | Bundle có dùng? | Để làm gì |
  |---|---|---|
  | `SUPABASE_JWT_SECRET` | Có | Ký JWT 5 phút cho đường API key (`apps/web/lib/mcp/auth.ts:33-40`); làm khoá cho mã confirm (`src/confirm.ts:18-23`) |
  | `SUPABASE_SERVICE_ROLE_KEY` | Có | Chỉ `api_key_owner` (`lib/mcp/auth.ts:51-56`); fallback khoá confirm; `kickCmoQueue` (không chạy qua MCP vì `brain: "claude"`) |
  | `OPENCMO_WORKER_TOKEN` | Có | Đánh thức worker khi tạo task (`wakeWorker` trong `apps/web/lib/modal.ts`). Đây là token mà endpoint `submit` của Modal tin tưởng, nên lộ nó là gửi được job thẳng vào worker |
  | `ANTHROPIC_API_KEY`, `GEMINI_API_KEY` | Có | Kiểm duyệt prompt (`moderateText`) |
  | `FAL_KEY`, `ELEVENLABS_API_KEY` | Có | Catalog model, ẩn/hiện tool generation. `FAL_KEY` còn bắt buộc cho kiểm duyệt prompt: `moderationReady()` cần cả khoá Anthropic lẫn `FAL_KEY` (`apps/web/lib/generate/moderation.ts:40`) |
  | `MOTION_PREVIEW_URL/TOKEN`, `MODAL_SUBMIT_URL` | Có | Preview, gửi task |
  | `CRON_SECRET` | **Không** | Không có dòng nào đọc |
  | `MODAL_TOKEN_ID/SECRET` | Có code, nhưng không tool nào gọi `callModal` (`src/modal.ts:4-9`) | Không cần lúc này |

- **Ai tấn công:** dependency độc trong 11,3 MB bundle (1.124 file), một lỗi RCE trong SDK hay Node, hoặc một lỗi SSRF/đọc file trong tương lai.
- **Tác động:**
  - `SUPABASE_JWT_SECRET` cho phép ký JWT `authenticated` cho bất kỳ `sub` nào, tức là đọc và ghi như mọi user.
  - Service role thì bỏ qua RLS hoàn toàn.
  - `CRON_SECRET` gọi được route cleanup, route xoá tài khoản chưa trả tiền (`app/api/cron/cleanup`).
  - Mã confirm và JWT dùng chung một gốc khoá, nên lộ một là lộ cả hai.
- **Regression test cần có:** một check đọc `modal_app.py` và từ chối khi hàm `mcp_server` mount `secret` (`opencmo`) hoặc `CRON_SECRET`.

### 2. [Cao, nghi ngờ] Flood không cần token có thể làm nghẽn cả workspace Modal; autoscale không trần

- **Code:** `modal_app.py:722-734`: `min_containers=1`, `@modal.concurrent(max_inputs=50)`, **không có `max_containers`**. Các hàm worker khác đều đặt trần 4–10. `src/http.ts` không giới hạn theo IP.
- **Chi phí mỗi request (đã chạy PoC):**

  | Request | Status | Gọi ra ngoài |
  |---|---|---|
  | Không token | 401 | 0 |
  | API key sai đúng định dạng | 401 | 1 (`POST /rest/v1/rpc/api_key_owner`, service role, là một câu `UPDATE … RETURNING`) |
  | Token 3 phần rác | 401 | 1 (`GET /auth/v1/user`) |
  | Lô 20 message, token hợp lệ | 200 | 21 (1 `getUser` + 20 lần `rate_limit_hit` **tuần tự**) |

- **Điểm nghi ngờ:**
  - Docs MCP-on-Modal của chính repo (`docs/mcp-on-modal-plan.md`, bảng "What Modal gives us") ghi giới hạn 200 request/giây cho mỗi workspace (burst ×5), trả 429 khi vượt.
  - Một nguồn bên thứ ba nói giới hạn này tính chung cho mọi lời gọi hàm và mọi HTTP request của workspace.
  - Nếu đúng, request 401 rẻ tới đâu cũng vẫn tốn quota chung. Đẩy đủ ~200–1.000 rps vào `…-opencmo-mcp.modal.run` là `submit` (web app gửi job) và `motion_preview` bị 429, tức là cả sản phẩm video ngừng nhận việc.
  - Chưa xác nhận được vì không đọc được modal.com từ máy này.
- **Chi phí khi autoscale (đã xác nhận từ config):**
  - Một user hợp lệ được 600 message/giờ. Mỗi lần `wait_for_media` hay inbox giữ request tới 50 giây (`packages/mcp-server/src/groups/studio.ts:189`, `apps/web/lib/cmo/mcp/inbox.ts:47`).
  - 50 request đồng thời mỗi container × không trần container, nên N tài khoản free (mục 4) là N lần số container.
  - Mỗi container khoảng 0,25 core + 0,5 GiB (~$10/tháng nếu chạy liên tục, theo `docs/mcp-on-modal-plan.md`). Tiền tăng tuyến tính mà không có trần.
- **Cách kiểm tay:**
  - Đọc trang rate limit chính thức của Modal xem giới hạn tính theo workspace hay theo endpoint.
  - Hỏi Modal support xem request vào web endpoint của một app có trừ vào quota của app khác cùng workspace không.
- **Regression test cần có:** check `modal_app.py` để hàm `mcp_server` có `max_containers`.

### 3. [Trung bình–Cao, đã xác nhận phía server; nghi ngờ phía Supabase] Token OAuth không gắn với server mình; DCR mở; consent dễ giả

- **Code:** `packages/mcp-server/src/oauth.ts:64-73`.
  - Hàm gọi `getUser(token)` rồi decode payload **không kiểm chữ ký**.
  - Nó chỉ đòi `client_id` là chuỗi khác rỗng. Không kiểm `aud`, resource hay danh sách client được phép.
  - Token sau đó được gửi nguyên văn sang PostgREST (`src/client.ts`).
- **PoC (đã chạy):**
  - Token có `client_id: "attacker-registered-client"` được trả 200, chỉ tốn 1 `getUser` và 1 `rate_limit_hit`.
  - Token không có `client_id` (phiên trình duyệt) bị 401. Phần này đúng.
- **Supabase:**
  - `supabase/config.toml:400-403` đặt `allow_dynamic_registration = true`: ai cũng đăng ký được client với redirect URI tuỳ ý.
  - Màn consent `app/oauth/consent/page.tsx:36-48` lấy **tên client do người đăng ký đặt** làm tiêu đề ("Connect {client} to OpenCMO"). Host redirect chỉ hiện ở một dòng chữ nhỏ cuối trang.
  - Client đã được duyệt một lần thì lần sau redirect thẳng, không hỏi lại (`page.tsx:33`).
- **Đường tấn công:**
  1. Đăng ký client tên "Claude", redirect về `evil.example`.
  2. Gửi link authorize cho founder. Founder thấy "Connect Claude to OpenCMO" và bấm Allow.
  3. Kẻ tấn công nhận access token kèm refresh token.

  Token này là JWT user đầy đủ (`aud: "authenticated"`), nên gọi được **cả MCP lẫn PostgREST trực tiếp** với mọi quyền của user. Không có scope nào để giới hạn.
- **Thu hồi (nghi ngờ):** Settings → Connected apps gọi `revokeGrant`. Server kiểm `getUser` ở mỗi request. Cần kiểm tay xem sau khi revoke, access token còn hạn (tối đa `jwt_expiry = 3600`) có bị `getUser` từ chối ngay không, hay vẫn chạy tới khi hết hạn.
- **Mới so với báo cáo 10-17:** báo cáo cũ đã nêu chuyện thiếu kiểm audience. Lần này bổ sung DCR mở cùng tên client giả mạo được trên consent, và việc token dùng thẳng được với PostgREST.
- **Regression test cần có:**
  - `server.check.ts`: token có `client_id` ngoài allowlist phải bị 401.
  - e2e: màn consent hiện cảnh báo khi tên client là "Claude" mà redirect không thuộc `claude.ai`.

### 4. [Trung bình, đã xác nhận] Tài khoản free lách hard paywall để dùng tài nguyên tốn tiền

- **Bối cảnh:** `20260921150000_hard_paywall.sql` đặt `signup_credits() = 0` với ý "không mua thì không làm được gì". Trong app, Assistant cần giữ 5 credit mỗi lượt.
- **Qua MCP thì không cần credit cho các thứ sau.** Không đường nào kiểm plan hay số dư; chỉ có trần theo giờ:

  | Tài nguyên | Trần mỗi user | Ai trả tiền |
  |---|---|---|
  | `preview_explainer` (render trên Modal) | 30/giờ (`studio.ts:60, 166`) | Modal compute |
  | Research mạng xã hội | 60 lượt/giờ × 3 lookup = 180 lookup ScrapeCreators/giờ (`lib/cmo/mcp/cmo.ts:28, 61, 90`) | ScrapeCreators |
  | `read_site` | 20/giờ × tối đa 4 lần fetch | Băng thông, IP Modal |
  | `create_task` với `brain: "claude"` | Trần theo ngày của từng loại (`cmo_enqueue`, giá 0) | Lượt đọc Reddit/social của run |
  | Tool call nói chung | 600/giờ | Supabase |

- **Hệ số nhân:** tài khoản mới chỉ cần đăng nhập Google. Nếu đăng ký email/password gọi thẳng được (Session B, mục B8), giá còn rẻ hơn. 100 tài khoản là 3.000 preview/giờ và 18.000 lookup/giờ.
- **Ghi chú:** research qua Modal chỉ chạy được khi `SCRAPECREATORS_API_KEY` có trong secret của container. Template `opencmo-mcp` và `opencmo` đều không liệt kê biến này (nghi ngờ: trên production có thể research qua MCP đang trả "not set up").
- **Regression test cần có:** pgTAP hoặc `server.check.ts`. Một user `plan = 'free'`, 0 credit gọi `preview_explainer` / `search_reddit` phải nhận lỗi "Top up / upgrade" (nếu chọn chính sách chặn).

### 5. [Trung bình, đã xác nhận] Route cũ `/api/mcp` vẫn chạy, yếu hơn bản Modal, và app vẫn chỉ người dùng tới đó

- **Vẫn được trỏ tới:**
  - `apps/web/lib/cmo/connect.ts:8` và `components/clipping/web/ApiKeys.tsx:63` dùng `OPENCMO_MCP_URL || ${SITE_URL}/api/mcp`.
  - `e2e/mcp.spec.ts` vẫn test route cũ.
- **Không chặn body:**
  - `app/api/mcp/route.ts` dùng `request.json()`.
  - PoC: body 2 MiB và 32 MiB với API key hợp lệ đều trả 200; heap tăng khoảng 59 MiB cho lần 32 MiB.
  - Trên Vercel, nền tảng tự chặn ở ~4,5 MB, nên thực tế bị chặn ở đó.
  - 20 message chạy **song song** (`Promise.all`), `maxDuration = 300`.
- **Mã confirm không có nonce:**
  - `lib/mcp/server.ts:80-102` (`signConfirm` / `readConfirm`, nhãn HMAC `opencmo-mcp-confirm`) cho dùng lại trong 10 phút.
  - Đã kiểm `runGeneration`: mỗi lần tạo `requestId` mới, nhưng `create_generation` (`20261122090000_generation_dead_reuse.sql:63-68`) trả lại generation có cùng `spec_hash` trong cùng job. Vì vậy dùng lại mã **không trừ credit lần hai**; nó chỉ đặt lại cùng media lên clip.
  - **Hạ xuống Thấp** so với ghi chú lúc lập plan.
- **Phiên bản giao thức:** route cũ nói `2025-06-18`. Server Modal dùng SDK 1.31.0 (`LATEST_PROTOCOL_VERSION = '2025-11-25'`).
- **Regression test cần có:** e2e `mcp.spec.ts` chuyển sang server mới; một check rằng `/api/mcp` trả 410 hoặc redirect.

### 6. [Trung bình, nghi ngờ] `read_site` qua MCP trả chữ của trang về thẳng cho người gọi, nên lý do chấp nhận DNS rebinding không còn đúng

- **Code:** `apps/web/lib/cmo/site.ts:12-13`. Comment chấp nhận khe DNS rebinding "vì không có gì trả về cho người gọi ngoài chữ đã rút gọn của trang". Qua MCP, chữ đó **chính là** kết quả tool trả cho client của kẻ tấn công.
- **Các khe (đã chạy `privateAddress` và `normalizeSite`):**
  - Lọt: NAT64 `64:ff9b::7f00:1`, `64:ff9b::a9fe:a9fe`; 6to4 `2002:7f00:1::`, `2002:a9fe:a9fe::`; `192.0.0.8`.
  - `::ffff:7f00:1` dạng hex trả `false`. Thực tế `dns.lookup` thường trả dạng chấm (`::ffff:127.0.0.1`, đã chặn), nên khe này nhỏ.
  - Redirect: `fetchPage` (`site.ts:103-121`) không kiểm lại cổng hay user:pass ở các chặng sau. Chặng sau chỉ đi tới host công khai, vì `assertPublic` vẫn chạy và IP literal bị từ chối, nên tác động là quét cổng host công khai từ IP Modal.
  - `siteReads: 0` được truyền ở mỗi lần gọi (`lib/cmo/mcp/cmo.ts:96`), nên trần "3 lần mỗi lượt" vô nghĩa; chỉ còn trần 20/giờ.
- **Chưa biết:** từ container Modal (gVisor) thì đi tới được những gì? Metadata của cloud, các web endpoint nội bộ khác của workspace? Cần kiểm tay bằng một hàm thử trong môi trường dev của Modal.
- **So sánh:** worker có `packages/engine/opencmo/capture/addresses.py` và `guard.py`, chặn ở tầng kết nối và phủ NAT64. Nên dùng chung danh sách đó.
- **Regression test cần có:** `*.check.ts` cho `privateAddress` với bảng địa chỉ trên; test redirect sang `host:6379` phải bị từ chối.

### 7. [Thấp, đã xác nhận] Giới hạn tần suất tốn 20 lượt gọi tuần tự; API key ghi DB ở mọi request

- `src/http.ts:74-84` gọi `rate_limit_hit` một lần cho mỗi message (PoC: 21 lần gọi ra ngoài cho lô 20). Đủ đúng, nhưng mỗi lô thêm ~20 RTT tới Supabase.
- `api_key_owner` là `UPDATE api_keys SET last_used_at` ở **mọi** request, kể cả request lỗi, nên mỗi request hợp lệ là một lần ghi.
- Xác thực chạy trước giới hạn tần suất. Đúng thứ tự, nhưng không có lớp chặn theo IP trước nó.

### 8. [Thấp, đã xác nhận] Header Host đổi được URL metadata khi thiếu `OPENCMO_MCP_URL`

- PoC: khi không đặt `OPENCMO_MCP_URL`, gửi `x-forwarded-host: evil.example` làm `WWW-Authenticate` trỏ tới `https://evil.example/.well-known/oauth-protected-resource`, và `resource` trong metadata thành `http://evil.example/mcp`.
- Tác động thấp: chỉ chính người gửi header nhận được câu trả lời đó, và không có cache ở giữa. Template secret trong `modal_app.py:709` có `OPENCMO_MCP_URL`.
- Vẫn nên bắt buộc biến này (fail closed) khi chạy trên Modal.

### 9. [Thấp, đã xác nhận] CORS `*`, không kiểm Origin, `/` là bí danh của `/mcp`

- `src/http.ts:23-29`. Vì chỉ dùng Bearer, không cookie, nên CORS `*` không mở đường CSRF.
- Tuỳ chọn `allowedHosts` / `allowedOrigins` của SDK nhắm vào server chạy localhost (DNS rebinding tới máy dev). Với server remote có token thì không cần.
- Chỉ ghi lại để lần sau không bị xếp nhầm là lỗi.

### 10. [Thấp, đã xác nhận] Mã confirm nằm trong tay model

- `src/server.ts:127-155` ép bước báo giá rồi confirm, và mã chỉ dùng một lần. Nhưng mã trả về cho model, nên một phiên Claude bị tiêm lệnh có thể tự confirm.
- Trần thiệt hại là số credit đang có cộng các trần theo giờ.
- Hướng sửa vẫn như báo cáo 10-17: dùng elicitation để user tự bấm trên UI của client, kèm ngưỡng credit mỗi giờ cho MCP.

### 11. Kiểm quyền từng tool (A8) và lộ dữ liệu qua output (A9): không thấy lỗi

- Mọi group (find, studio, generations, explainer, export, guides, cmo, inbox, account; 125 tool theo `server.check.ts`) dùng `ctx.supabase`, là client dưới RLS của người gọi.
- `userId` chỉ đến từ `ctx` (`studio.ts:158, 224, 240`; `lib/cmo/mcp/account.ts:58, 71`). Id trong tham số đều đi qua RLS hoặc RPC có kiểm chủ.
- Service role trong bundle chỉ có ở ba chỗ:
  - `api_key_owner`
  - `kickCmoQueue`: qua MCP luôn có `brain: "claude"`, nên không chạy (`lib/agent/cmo-tools.ts:320`, `jobs/start.ts:45`)
  - fallback khoá confirm
- **Lỗi:** `callTool` chỉ trả message của `ApiError` dưới 500 và `ConfirmError`. Lỗi khác thì ghi log và trả "Something went wrong" (`server.ts:147-155`). Log không chứa token, header hay tham số.
- **Link tải:** link export ký 5 phút (`DOWNLOAD_TTL = 300`, `lib/storage.ts:49`).
- **[Thấp] Lộ số dư ScrapeCreators của công ty:** tool `research_credits` (`apps/web/lib/agent/cmo-research.ts:85-86, 157`) trả cho mọi user số lookup còn lại trên tài khoản ScrapeCreators mà OpenCMO trả tiền, không phải hạn mức riêng của user. Đây là thông tin kinh doanh, và kẻ đang tấn công chi phí (mục 4) nhìn vào đó là biết đòn của mình có hiệu quả không. Nên trả "còn / hết" thay vì con số.
- **Ngoài phạm vi MCP nhưng cần ghi:** `enqueue_cmo_run` được grant cho `authenticated`, và `cmo_enqueue` nhận `brain: "claude"` từ chính user (giá 0). Đây là thiết kế có chủ ý, đã ghi trong migration `20261128090000_cmo_inbox.sql:53-55`. Session B kiểm khi rà bề mặt PostgREST.

### Những gì đang làm tốt (để giữ)

- Body đọc theo stream, cắt ở 1 MiB kể cả khi `content-length` nói dối. Lô tối đa 20. PoC: 2 MiB trả 413.
- Xác thực trước khi đọc body. Request không token tốn 0 lần gọi ra ngoài.
- Token phiên trình duyệt (không `client_id`) không dùng được cho MCP.
- Mã confirm của server mới:
  - HMAC gắn user, mục đích, `tool:clip_id` và hạn dùng
  - nonce dùng một lần qua `mcp_confirm_use`
  - giới hạn inflate 4 MB
  - không tin tham số của client ở bước confirm
- Preview phải có `preview_token` gắn với `sha256(code)` thì mới được `add_explainer`.
- `src/modal.ts` chỉ cho gọi `render_motion`, `render_three`, `run_task`, không bao giờ `submit` hay `run_job`.
- API key: chỉ lưu sha256, revoke có hiệu lực ngay, `api_key_owner` chỉ service role gọi được, tối đa 10 khoá.
- `read_site` vẫn phân giải DNS và chặn địa chỉ private ở mọi chặng redirect. Từ chối IP literal, cổng lạ ở URL đầu, `.local`, `.internal`.

### Trạng thái khuyến nghị của báo cáo 10-17 (A10)

| # | Khuyến nghị | Trạng thái | Bằng chứng |
|---|---|---|---|
| 1 | Chặn tool ghi sau khi đọc dữ liệu lạ; ký ức của agent mang `type` riêng | **Chưa làm** | Không có cờ taint trong `lib/agent`, `lib/cmo`. `cmo_remember` vẫn insert `type = 'user'` (`20261109090000_cmo_memory_tiers.sql:78-79`). Qua MCP, `remember` và các tool research cùng nằm trong phiên Claude của user |
| 2 | Helper làm sạch chữ không tin cậy (`untrusted.ts`) | **Chưa làm** | Không có `apps/web/lib/cmo/untrusted.ts`, không có regex Unicode tag. Research vẫn bọc `untrusted_data` (`cmo-research.ts:105`) |
| 3 | `mcp_grants`, scope, elicitation | **Chưa làm** | Không có `mcp_grants` trong migration hay code. Xem mục 3 và 10 |
| 4 | `db lint` làm CI fail | **Chưa làm** | `.github/workflows/ci.yml:203` vẫn là `supabase db lint --local --level warning`, không có `--fail-on` |
| 5 | Chuyển sang spec 2026-07-28 | **Một phần** | Server Modal dùng SDK 1.31.0, nói tới `2025-11-25`. Route cũ vẫn `2025-06-18` |
| 6 | Chạy Snyk Agent Scan | **Chưa làm** | Không có kết quả trong `docs/` |
| 7 | Next.js/ffmpeg: không làm gì | Giữ | Next.js thuộc PR #71 (lên 15.5.28) |
| Ngoài phạm vi | `license: AGPL-3.0-only` trong `packages/mcp-server/package.json` | **Chưa sửa** | Dòng 5. Repo đã đóng mã nguồn |

## Repo đáng học

| Repo | Học được gì | File nên đọc | Licence | Copy hay chỉ học |
|---|---|---|---|---|
| [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) | `requireBearerAuth` / `verifyBearerToken` với `expectedResource` và `requiredScopes`: verifier phải trả `resource` (từ `aud`) và scope, sai thì 403 `insufficient_scope`. Đúng hình dạng mình cần cho mục 3, kể cả khi Supabase chưa điền `aud` (khi đó so `client_id` với allowlist) | `src/server/auth/middleware/bearerAuth.ts` (nhánh 1.x mình pin) | MIT (đang chuyển sang Apache-2.0) | Dùng qua dependency sẵn có, không chép |
| [supabase/auth](https://github.com/supabase/auth) | Cách OAuth server của Supabase cấp token: `client_id` trong claim, DCR, consent. Để biết revoke có làm token đang sống chết ngay không (mục 3) | Thư mục `internal/api/oauthserver/` | MIT | Chỉ học |
| Worker của mình, `packages/engine/opencmo/capture/addresses.py` + `guard.py` | Chặn SSRF ở tầng kết nối, phủ NAT64/6to4. Bản TS cho `read_site` nên dùng cùng danh sách và ghim IP đã phân giải (undici `Agent` với `connect.lookup`) | 2 file trên | Code nội bộ | Port sang TS |

Không đọc được docs của Modal và MCP từ máy này (DNS bị chặn). Các dữ kiện về Modal lấy từ `docs/mcp-on-modal-plan.md` (tác giả đã đọc docs Modal ngày 2026-10-16) và từ kết quả tìm kiếm, ghi ở Nguồn.

## Khuyến nghị

Xếp theo rủi ro gỡ được trên mỗi ngày công. Tất cả là PR code riêng, sau PR này.

1. **Thu hẹp secret của container MCP** (mục 1).
   - Chi phí: **S** (nửa ngày).
   - Cải thiện: **rủi ro**.
   - Cách làm:
     - Bỏ `secret` (`opencmo`) khỏi `mcp_server`.
     - Tạo `opencmo-mcp` đủ dùng: Supabase URL và anon, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` (chỉ để gọi `api_key_owner`), `OPENCMO_WORKER_TOKEN`, khoá moderation và provider.
     - Không đưa `CRON_SECRET`, không đưa token Modal khi chưa có tool dùng.
     - Tách khoá mã confirm thành `OPENCMO_MCP_CONFIRM_KEY` riêng, không dẫn xuất từ JWT secret.
   - Bước sau, **M**: cân nhắc chuyển đổi API key sang JWT về web app trên Vercel, để container MCP không còn giữ JWT secret.
   - Thuộc: PR "mcp hardening".
2. **Đặt trần cho Modal và chặn flood trước khi vào app** (mục 2, 7).
   - Chi phí: **S**.
   - Cải thiện: **rủi ro** (không để MCP kéo sập `submit`), **chi phí**.
   - Cách làm:
     - Thêm `max_containers` (ví dụ 3).
     - Xác nhận quota của Modal tính theo workspace hay theo endpoint. Nếu theo workspace, chuyển MCP sang workspace hoặc environment Modal riêng, hoặc đặt sau một proxy có giới hạn theo IP.
     - Gộp 20 lần `rate_limit_hit` thành một RPC nhận `p_count`.
   - Thuộc: PR "mcp hardening".
3. **Khoá OAuth vào client của mình** (mục 3).
   - Chi phí: **M** (1–2 ngày).
   - Cải thiện: **rủi ro**, **niềm tin** khi lên connector.
   - Cách làm:
     - Allowlist redirect host của client (claude.ai, `localhost` cho Claude Code/Desktop) ở màn consent. Client khác thì từ chối, hoặc hiện cảnh báo to.
     - `userForAccessToken` từ chối `client_id` không có trong bảng grant do consent ghi (`mcp_grants`, như khuyến nghị 3 của báo cáo 10-17).
     - Tiêu đề consent hiện host redirect, không chỉ tên tự khai.
     - Kiểm tay xem revoke có cắt token ngay không.
   - Thuộc: PR "mcp oauth".
4. **Quyết định chính sách cho tài khoản free qua MCP** (mục 4).
   - Chi phí: **S**.
   - Cải thiện: **chi phí**; và **doanh thu** (ý kiến: MCP miễn phí cho người chưa trả tiền là một phễu tốt, nhưng nên có trần theo ngày chứ không chỉ theo giờ).
   - Đề xuất:
     - Preview và research qua MCP cần plan trả phí hoặc số dư > 0.
     - Hoặc trần theo ngày rất thấp cho plan `free`.
   - Thuộc: PR "mcp hardening", cần owner quyết.
5. **Tắt route `/api/mcp` cũ** (mục 5).
   - Chi phí: **S**.
   - Cải thiện: **rủi ro**, ít code phải giữ.
   - Cách làm:
     - Trả 410 kèm URL mới, hoặc redirect một bản phát hành.
     - Bắt buộc `OPENCMO_MCP_URL` trong `connect.ts` và `ApiKeys.tsx`.
     - Chuyển `e2e/mcp.spec.ts`.
   - Thuộc: PR "mcp hardening".
6. **Chặn SSRF của `read_site` ở tầng kết nối** (mục 6).
   - Chi phí: **S–M**.
   - Cải thiện: **rủi ro**.
   - Cách làm:
     - Ghim IP đã kiểm khi fetch.
     - Thêm NAT64/6to4/`192.0.0.0/24`.
     - Kiểm cổng và user:pass ở mọi chặng redirect.
     - Viết một bảng địa chỉ dùng chung cho `lib/api/source.ts` (Session B).
   - Thuộc: PR "ssrf".
7. **Bắt buộc `OPENCMO_MCP_URL` khi chạy trên Modal** (mục 8).
   - Chi phí: **S**.
   - Cách làm: `main.ts` thoát nếu thiếu biến này khi `HOST=0.0.0.0`.
8. **Làm nốt khuyến nghị 1–2 của báo cáo 10-17 trước khi công bố connector.** Qua MCP, `remember` và research cùng nằm trong một phiên Claude, nên đường đầu độc bộ nhớ ngắn hơn trong app.
   - Chi phí: **M**.
   - Thuộc: track CMO.

**Không làm:** không cần kiểm Origin / `allowedHosts` (mục 9). Không cần đổi cơ chế mã confirm của server mới, chỉ cần tách khoá.

## Nguồn

Ngày đọc: 2026-10-17 cho tất cả.

- Code nội bộ (commit `ddb63c5`):
  - `packages/mcp-server/src/{http,auth,oauth,client,confirm,server,modal,main}.ts`, `src/groups/*.ts`, `src/shims/*.ts`, `scripts/build.mjs`
  - `packages/engine/modal_app.py` (header, các secret, khối `mcp_server`)
  - `apps/web/lib/mcp/{auth,server}.ts`, `apps/web/app/api/mcp/route.ts`, `apps/web/lib/cmo/mcp/{cmo,account}.ts`
  - `apps/web/lib/cmo/site.ts`, `apps/web/lib/cmo/jobs/start.ts`, `apps/web/lib/agent/{cmo-tools,generate-tool}.ts`
  - `apps/web/app/oauth/consent/page.tsx`, `apps/web/app/api/v1/oauth/consent/route.ts`
  - `apps/web/lib/cmo/connect.ts`, `apps/web/components/clipping/web/ApiKeys.tsx`
  - `supabase/config.toml`
  - `supabase/migrations/20261107090000_g5_api_keys.sql`, `20261129090000_mcp_server.sql`, `20261128090000_cmo_inbox.sql`, `20261128100000_cmo_inbox_read_caps.sql`, `20261122090000_generation_dead_reuse.sql`, `20260921150000_hard_paywall.sql`, `20261109090000_cmo_memory_tiers.sql`
  - `.github/workflows/ci.yml`
  - `node_modules/@modelcontextprotocol/sdk/dist/esm/types.js` (1.31.0: `LATEST_PROTOCOL_VERSION`)
- `docs/mcp-on-modal-plan.md` (bảng giới hạn của Modal, tác giả đọc docs Modal ngày 2026-10-16)
- Kết quả tìm kiếm về rate limit của Modal (nguồn thứ ba, chưa đối chiếu docs chính thức):
  - https://cdn.jsdelivr.net/npm/@saibolla/ada@0.1.3/skills/modal/references/web-endpoints.md
  - https://markaicode.com/errors/modal-rate-limit-fix/
  - https://apis.io/rate-limits/modal-labs/modal-labs-rate-limits/
- Spec MCP, security best practices (bản mới nhất; đọc qua kết quả tìm kiếm, trang gốc không tải được): https://modelcontextprotocol.io/specification/latest/basic/security_best_practices
- Báo cáo trước: [`2026-10-17-security-agent-injection-mcp.md`](2026-10-17-security-agent-injection-mcp.md)
