# Bảo mật: audit đăng nhập web, API route và quyền DB — open redirect sau đăng nhập, SSRF ở link video, việc CMO trả phí chạy giá 0  (2026-10-17)

Session B của [PR #73](https://github.com/marcus-legia/opencmo/pull/73). Plan:
[`docs/plans/security/2026-10-17-mcp-auth-api-audit-plan.md`](../../plans/security/2026-10-17-mcp-auth-api-audit-plan.md).
Phần MCP và OAuth là của Session A ([`2026-10-17-audit-mcp-modal.md`](2026-10-17-audit-mcp-modal.md)). Billing là của
[PR #71](https://github.com/marcus-legia/opencmo/pull/71); báo cáo này chỉ trỏ tới, không lặp lại.

## TL;DR

- **Một lỗi Cao, đã tái hiện trên route thật:** `/auth/callback?next=/.//evil.example` trả `303 Location: //evil.example`.
  Bộ kiểm origin trong route đúng về ý tưởng, nhưng nó trả về `pathname`, và WHATWG URL chuẩn hoá `/.//x` thành
  `//x`. Đây là open redirect ngay sau một lần đăng nhập Google thành công. Sửa mất khoảng một giờ.
- **SSRF ở link video (Trung bình, đã xác nhận phần web và yt-dlp):** cả `lib/api/source.ts` lẫn regex trong
  `create_job` chỉ so chuỗi host. `0.0.0.0`, `100.64/10`, `metadata.google.internal`, IPv6 ULA/link-local, `::ffff:`,
  một tên miền trỏ về IP nội bộ, và redirect đều lọt. yt-dlp 2026.8.19 (bản trong lock) gọi thẳng những địa chỉ đó, đi
  theo redirect, và `jobs.error` phân loại 403/404/timeout nên thành một oracle quét cổng nội bộ.
- **Việc CMO tốn tiền chạy giá 0 cho tài khoản 0 credit (Trung bình, đã xác nhận):** `cmo_enqueue` đặt giá 0 khi
  `p_input.brain = 'claude'`, và `p_input` do client gửi. Một tài khoản free mới tạo, 0 credit, gọi thẳng
  `enqueue_cmo_run('sales_scan', '{"brain":"claude"}')` qua PostgREST là có lượt quét Reddit (tối đa 8 lượt gọi
  ScrapeCreators) mỗi lần, 3 lần/ngày, cộng `competitor_research` 2 lần/ngày.
- **Cấu hình Auth (nghi ngờ, cần xem dashboard production):** `supabase/config.toml` bật đăng ký email/mật khẩu,
  tắt xác nhận email, mật khẩu tối thiểu 6, không captcha, trong khi UI chỉ có Google. Nếu production giống vậy thì
  ai cũng tạo được tài khoản hàng loạt (nhân lên mục trên), và có thể đăng ký trước bằng email của nạn nhân.
- **Phần lõi rất chắc:** quét IDOR 660 lời gọi RPC chéo user (mọi hàm nhận uuid, với id của user khác) không lần nào
  đọc hay sửa được dữ liệu của user kia. Mọi bảng đều bật RLS, không có policy ghi nào cho client, `rate_limit_hit`
  có allowlist bucket/limit/window, storage kiểm size thật so với reservation. Token cron/worker so sánh hằng thời gian
  và đóng khi thiếu secret trên production.

## Cách làm và giới hạn

- **Môi trường:** Docker trong container này không kéo được image Supabase (proxy chặn `ghcr.io` và ECR). Mình dựng
  Postgres 16 có sẵn, thêm một shim tối thiểu của Supabase (role `anon`/`authenticated`/`service_role`, `auth.uid()`,
  `auth.users`, schema `storage`, và **default privileges giống Supabase**: `grant all on functions/tables in schema
  public to anon, authenticated, service_role`), rồi áp đủ 109 migration. Mọi phép thử SQL chạy với `set role
  authenticated` cộng `request.jwt.claims`, đúng như PostgREST làm. Ba user thử (`u1`, `u2`, `u3` với 0 credit).
- **Route Next.js:** chạy `next dev` thật với một GoTrue giả cục bộ (trả session cho mọi `code`) để tái hiện B1, B5,
  B11. Không chạy được luồng Supabase Auth thật, Storage API hay worker Modal.
- **Không đụng production.** Script PoC nằm trong scratchpad, không commit.
- **Nhãn:** "đã xác nhận" = đọc code và tái hiện cục bộ. "Nghi ngờ" = cần dữ liệu hay cấu hình production.

## Phát hiện

### 1. [Cao, đã xác nhận] Open redirect sau đăng nhập ở `/auth/callback` (B1)

- **Code:** `apps/web/app/auth/callback/route.ts:67-76`. `new URL(next, "http://redirect.invalid")` rồi so `origin`,
  nhưng `Location` lại là `target.pathname + target.search`. Với `next=/.//evil.example`, URL vẫn cùng origin
  (`http://redirect.invalid`), còn `pathname` sau chuẩn hoá dot-segment là `//evil.example`. Trình duyệt đọc
  `Location: //evil.example` thành URL tương đối giao thức, tức là sang `https://evil.example`.
- **Actor:** người lạ trên internet; chỉ cần gửi link.
- **Tái hiện:** `next dev` cộng GoTrue giả, `GET /auth/callback?code=abc&next=<x>`:

  | `next` | Kết quả |
  |---|---|
  | `/.//evil.example` | `303 Location: //evil.example` |
  | `%2F.%2F%2Fevil.example` | `303 Location: //evil.example` |
  | `/..//evil.example` | `303 Location: //evil.example` |
  | `//evil.example`, `/\evil.example` | bị chặn → `/app` |

  `/%2e//x`, `/a/..//x`, `/./\x` cũng lọt (thử bằng WHATWG URL của Node 22, cùng bộ phân tích Next dùng).
- **Đường thật:** `/login?next=/.//evil.example` → `LoginForm` đưa `next` vào `redirectTo` của Google OAuth → sau
  khi đăng nhập, callback chuyển sang trang của kẻ tấn công. Supabase chỉ duyệt địa chỉ callback trong allowlist,
  không duyệt query của nó (comment trong code đã ghi đúng điều này).
- **Cũng nằm trên đường connector:** trang consent OAuth đưa người chưa đăng nhập tới
  `/login?next=/oauth/consent?authorization_id=…` (`app/oauth/consent/page.tsx:28`), nên cùng một lỗi nằm ngay trên
  luồng "kết nối Claude" mà Session A audit (A §3).
- **Tác động:** trang lừa "phiên hết hạn, nhập lại mật khẩu Google" hay "cài connector" xuất hiện ngay sau một lần
  đăng nhập thật trên `opencmo.io`, đúng lúc người dùng tin nhất. Không lộ token (code PKCE đã đổi xong trước khi
  chuyển).
- **Chỗ khác đọc `next`/`url`/`redirect_to`:** `middleware.ts` (chỉ đặt `next` từ `pathname` và chặn `//`; an toàn
  vì giá trị đó tới từ chính request đã định tuyến), `app/oauth/consent/page.tsx:28,33` (redirect sang
  `data.redirect_url` của Supabase; thuộc Session A), `app/app/page.tsx` và `app/app/cmo/page.tsx` (chỉ đưa `url`/`site`
  vào query nội bộ, đã `encodeURIComponent`). Không thấy sink nào khác.
- **Sửa (S):** chỉ nhận `next` khớp `^/(?![/\\])` **sau** khi chuẩn hoá, và trả `Location` đã kiểm lại cùng quy tắc;
  hoặc đơn giản hơn: allowlist tiền tố (`/app`, `/oauth/consent`) trên `target.pathname` và từ chối mọi pathname bắt đầu
  bằng `//`.
- **Test:** một `*.check.ts` cho hàm chọn đích (tách khỏi route), bảng ca ở trên cộng `\t`, `%09`, `/%5C`.

### 2. [Trung bình, đã xác nhận ở web và yt-dlp; nghi ngờ phần mạng Modal] SSRF ở link video nguồn (B4)

- **Code:** `apps/web/lib/api/source.ts:36-48` và regex trong `create_job`
  (`supabase/migrations/20261101090000_r6_credit_module.sql:697`, cùng regex từ
  `20260922120000_public_video_urls.sql:51`). Worker: `packages/engine/opencmo/steps/download.py:71-113` (`_base_opts`,
  `probe`), không có bộ chặn địa chỉ riêng như `capture/guard.py`.
- **Actor:** người dùng đã đăng nhập (gọi `create_clip_job` thẳng qua PostgREST là bỏ qua lớp TypeScript).
- **Tái hiện, lớp chặn:** gọi `create_clip_job(<url>, …, p_ownership_confirmed => true)` dưới vai `authenticated`, và
  `sourceProblem()` trong Node:

  | URL | TS `sourceProblem` | SQL `create_job` |
  |---|---|---|
  | `http://0.0.0.0:8000/` | lọt | lọt |
  | `http://100.100.100.200/latest/meta-data` (100.64/10) | lọt | lọt |
  | `http://metadata.google.internal/computeMetadata/v1/` | lọt | lọt |
  | `http://[fd00::1]/`, `http://[fe80::1]/`, `http://[::]/` | lọt | lọt |
  | `http://[::ffff:127.0.0.1]/` | lọt | lọt |
  | `http://localhost./`, `http://localtest.me/` (DNS → 127.0.0.1) | lọt | lọt |
  | `http://2130706433/`, `http://0x7f.1/`, `http://017700000001/` | chặn (URL chuẩn hoá) | **lọt** |
  | `http://127.0.0.1/`, `http://127.1/` | chặn | chặn |

- **Tái hiện, worker:** yt-dlp 2026.8.19 với đúng `_base_opts` (không proxy), máy chủ HTTP cục bộ:
  - `http://127.0.0.1:8765/vid.mp4` và `http://0.0.0.0:8765/vid.mp4` → probe thành công (`extractor=generic`).
  - Trang HTML nội bộ → `Unsupported URL`, nên nội dung HTML không đọc ngược được qua tiêu đề.
  - Một URL redirect 302 sang `127.0.0.1` → yt-dlp đi theo, thông báo lỗi chứa URL đích.
- **Tác động:**
  - GET mù tới mạng mà worker nhìn thấy. `processing_error` (`opencmo/worker/errors.py:76-104`) trả câu khác nhau cho
    403, 404, timeout và lỗi chung, nên người dùng đọc được trạng thái từng cổng/đường dẫn qua `jobs.error`.
  - File media trên một host nội bộ có HTTPS thì tải được và cắt thành clip: đọc ngược đầy đủ (hiếm).
  - **Nghi ngờ:** nếu production đặt `OPENCMO_PROXY` (IPRoyal), yt-dlp đi qua proxy nên không chạm mạng nội bộ Modal,
    nhưng khi đó mình trả tiền băng thông proxy cho URL tuỳ ý. Cần xem secret `opencmo` để biết chế độ nào.
- **Chi phí cho kẻ tấn công:** mỗi job giữ 10 credit (hoàn lại khi hỏng ở bước tải), tối đa 3 job đang chạy và 10 job
  mỗi giờ. Đủ để quét chậm, không đủ để quét rộng.
- **Sửa (M):** một hàm guard dùng chung cho worker (đã có `capture/guard.py` + `addresses.py`): phân giải DNS, chặn
  mọi dải không phải unicast công cộng, gắn kết nối vào IP đã kiểm, và kiểm lại từng redirect. Với yt-dlp, gọi guard
  trong một `urlopen` hook hay đi qua proxy egress có allowlist. Ở web/SQL, dùng chung danh sách dải đó cho thông báo
  sớm. Cân nhắc chỉ nhận link của các extractor đã biết (YouTube…) vì sản phẩm chỉ hứa "video của bạn": upload là
  đường chính.
- **Test:** pytest cho guard với bảng URL ở trên; pgTAP cho `create_job` với `0.0.0.0`, `[fd00::1]`, `2130706433`.
- `read_site` (`lib/cmo/site.ts`) là của Session A (A §6: thiếu thêm NAT64 `64:ff9b::/96`, 6to4 `2002::/16`,
  `192.0.0.0/24`). Hai bên nên dùng chung **một** bảng dải địa chỉ riêng, cho cả TS, SQL và Python.

### 3. [Trung bình, đã xác nhận] `brain: "claude"` do client gửi làm việc CMO tốn phí chạy giá 0 (B3, B6)

- **Code:** `supabase/migrations/20261128090000_cmo_inbox.sql:60`:
  `v_price := case when p_input->>'brain' = 'claude' then 0 else cmo_job_price(p_kind) end`.
  `enqueue_cmo_run` được grant cho `authenticated`. Runner (`apps/web/lib/cmo/jobs/runner.ts:76`) chạy job tới lần
  gọi model đầu tiên rồi chờ inbox; `sales-scan.ts:144-190` gọi tối đa `MAX_QUERIES = 8` lượt tìm Reddit qua
  ScrapeCreators, và với `brain: claude` kết quả được memo lại để lượt chạy lại không tốn thêm.
- **Actor:** cost attacker với nhiều tài khoản free.
- **Tái hiện:** user `u3`, số dư 0:
  - `enqueue_cmo_run('sales_scan', '{}')` → `Not enough credits: 5 needed, 0 left.`
  - `enqueue_cmo_run('sales_scan', '{"brain":"claude"}')` → hàng `queued`, `credits = 0`.
  - `enqueue_cmo_run('competitor_research', '{"brain":"claude"}')` → `queued`, `credits = 0`.
  Để đi hết luồng, kẻ tấn công trả lời inbox bằng `inbox_submit` (cũng grant cho `authenticated`) với JSON bất kỳ khớp
  schema; không cần Claude thật.
- **Tác động:** mỗi tài khoản free: tới 3 × 8 lượt gọi ScrapeCreators/ngày cho `sales_scan`, cộng `competitor_research`.
  Session A ghi cùng hành vi ở A §11 (qua MCP); ở đây là đường gọi thẳng PostgREST, không cần MCP.
  Comment trong migration nói đây là chủ ý ("reads stay under the same daily caps"), nhưng trần đó là theo tài khoản,
  và tài khoản thì miễn phí (mục 4). Giá mỗi lượt ScrapeCreators: xem `COSTS.md` (không có trong báo cáo này).
- **Sửa (S):** chỉ cho giá 0 khi tài khoản đã bật chế độ "Claude của bạn" (cột/mode server biết, không phải field của
  client), và vẫn giữ một mức credit nhỏ cho phần đọc trả phí (Reddit, research). Hoặc cấm `brain` trong
  `enqueue_cmo_run` của người dùng, chỉ để MCP (đã xác thực) đặt nó qua một hàm riêng.
- **Test:** pgTAP: user 0 credit gọi `enqueue_cmo_run('sales_scan', '{"brain":"claude"}')` phải bị từ chối khi chưa bật
  mode.

### 4. [Trung bình, nghi ngờ: phụ thuộc dashboard production] Đăng ký email/mật khẩu mở dù UI chỉ có Google (B8)

- **Code:** `supabase/config.toml:201` `enable_signup = true`, `:207` `minimum_password_length = 6`, `:243`
  `[auth.email] enable_signup = true`, `:248` `enable_confirmations = false`, không có `[auth.captcha]`. UI chỉ có nút
  Google (`components/LoginForm.tsx`).
- **Actor:** cost attacker; kẻ chiếm tài khoản trước.
- **Tái hiện:** không làm được (không có GoTrue thật). Theo config, `POST /auth/v1/signup` với anon key công khai
  (`NEXT_PUBLIC_SUPABASE_ANON_KEY`) tạo ngay một user đã "xác nhận". Rate limit `sign_in_sign_ups = 30` mỗi 5 phút
  **theo IP**, nên xoay IP là hết trần.
- **Tác động nếu production giống config:**
  - Tài khoản free vô hạn: nhân mục 3, nhân A §4 (preview/research qua MCP không cần credit), onboarding (5 lượt/ngày, mỗi lượt đọc tới 4 trang và một lần gọi model; giá 0),
    và các trần "theo tài khoản" khác. Tài khoản mới nhận 0 credit (`signup_credits() = 0`), nên không có credit miễn phí.
  - Đăng ký trước bằng email người khác: kẻ tấn công tạo `victim@gmail.com` với mật khẩu. Supabase gỡ các identity
    *chưa xác nhận* khi tự liên kết một identity OAuth mới, nhưng khi tắt xác nhận email thì identity email đó đã được
    coi là xác nhận. Khi nạn nhân sau này đăng nhập Google, nhiều khả năng được liên kết vào chính tài khoản đó, và kẻ
    tấn công vẫn giữ mật khẩu. Cần thử trên một project Supabase dev.
- **Sửa (S):** trên dashboard production, tắt email signup (hoặc tắt toàn bộ provider email) vì sản phẩm chỉ dùng
  Google; bật captcha (Turnstile) nếu vẫn giữ email; đặt mật khẩu tối thiểu ≥ 12. Sửa `config.toml` theo cho khớp.
- **Test:** một bước trong `scripts/` hay e2e gọi `/auth/v1/signup` trên stack local và mong `422/403`.

### 5. [Trung bình, đã xác nhận; trùng PR #71 mục 7] Hàm sổ sách của Assistant gọi thẳng được (B3)

PR #71 mục 7 đã nêu nghi ngờ; mình tái hiện được cục bộ, nên chỉ ghi phần mới:

- **Đóng lượt sớm:** `agent_begin_turn` giữ 5 credit → người dùng gọi `agent_finish_turn(turn, 'done', null)` → số dư
  về lại như cũ → server ghi `agent_record_usage(turn, …, 200000, 20000, …)` sau đó, hàm trả 12 credit nhưng **số dư
  không đổi**. Bước LLM đang chạy lúc đó không bị tính. Code: `supabase/migrations/20260926090000_agent.sql`
  (`agent_finish_turn`, `agent_close_turn`).
- **Không có trần kích thước:** `agent_record_tool` (`20260927090000_agent_providers_browser_tools.sql:361`) nhận
  `p_input` 8.000.012 byte (pg lưu nén còn 91.601 byte vì chuỗi lặp; dữ liệu ngẫu nhiên thì giữ nguyên cỡ). Chỉ cần
  một lượt `running`, tức ≥ 5 credit. `agent_append` thì có trần 1 MB. Đây là đường làm phình database.
- **Sửa:** theo khuyến nghị 6 và 8 của PR #71 (revoke các hàm sổ sách khỏi `authenticated`, để route gọi qua một hàm
  wrapper hoặc service role sau khi kiểm `auth.uid()`); thêm `pg_column_size(p_input) <= 256 KB`.

### 6. [Thấp] CSRF và GET đổi trạng thái (B5)

- `withApi` (`lib/api/handler.ts:89-99`) chặn khi `Sec-Fetch-Site: cross-site` hoặc `Origin` khác host; thiếu cả hai
  thì cho qua. Trình duyệt hiện đại luôn gửi `Origin` với POST khác site, và cookie phiên của `@supabase/ssr` là
  `SameSite=Lax` (đặt rõ, nên không có ngoại lệ "Lax+POST 2 phút" của Chrome). Tái hiện: POST
  `/api/v1/cmo/onboarding` với `Origin: https://evil.example` → `403 Cross-site access denied.` Không có lỗ thật.
- `POST /auth/signout` không kiểm Origin (tái hiện: 303 về `/`), nhưng không có cookie nên không đăng xuất được ai.
- GET đổi trạng thái (top-level navigation mang cookie Lax):
  - `GET /api/v1/editor/project?clip_id=` tạo editor project lần đầu (idempotent, không ghi đè).
  - Trang `/app/editor` tự gọi `createBlankEdit` khi chưa có bản sửa (`components/editor/EditorHome.tsx`).
  - `GET /api/v1/cmo/workspace` gọi `kickCmoQueue` (service role, tới 250 s trong `after()`) khi có lượt `queued`;
    không có rate limit. Claim theo lease nên chỉ một lượt chạy thật; các lần gọi thừa tốn một function Vercel ngắn.
  Tác động thấp. Sửa khi tiện: chuyển tạo mới sang POST, thêm rate limit cho workspace.

### 7. [Thấp] DoS và chi phí còn lại (B6)

- **Hai vòng Auth mỗi API call:** middleware gọi `getUser()` (`lib/supabase/middleware.ts:31-33`) và `withApi` gọi lại
  (`handler.ts:157`). Không có cookie thì supabase-js không gọi mạng; có cookie (kể cả cookie rác) là một round trip
  tới Auth. Có thể bỏ `/api/` khỏi matcher vì `withApi` đã tự xác thực (đã kiểm: `/api/v1/account` không cookie →
  401 từ `withApi`).
- **Body cap:** `readJson` (`handler.ts:102-118`) kiểm `content-length`, nhưng với body chunked thì `request.text()` đọc
  hết rồi mới đo (và đo theo ký tự UTF-16, không theo byte). Vercel tự chặn ở 4,5 MB nên thực tế bị chặn trên.
- **Route tốn tiền không có rate limit trong `withApi`:** onboarding (trần 5/ngày nằm trong SQL, giữ được),
  `captions/translate` (có `editor-write` 240/phút, và tính credit), lượt Assistant (tính credit). Không thấy route nào
  gọi LLM hay Modal mà không có trần ở SQL hoặc credit, ngoài mục 3.
- **Fixed window:** `rate_limit_hit` đếm theo cửa sổ cố định, nên ở ranh giới cửa sổ được tới 2× trần (ví dụ `jobs`
  10/giờ → 20 trong hai phút quanh giờ chẵn). Chấp nhận được với các trần hiện tại.
- **`mcp_confirm_use`:** người dùng gọi thẳng được với nonce bất kỳ; mỗi lần thêm một hàng, chỉ dọn sau 1 ngày. Phình
  bảng, không lộ gì (khoá chính `(user_id, nonce)`, nên không đốt được nonce của người khác).
- **Ước tính 100 tài khoản free/giờ** (tính từ code, chưa đo): 100 × 5 onboarding/ngày (mỗi lượt một lần gọi model và
  ≤ 4 fetch), 100 × (3 × 8 + 2 × …) lượt ScrapeCreators/ngày qua mục 3. Chi phí đô-la phụ thuộc model và bảng giá
  ScrapeCreators trong `COSTS.md`.

### 8. [Thấp] Token cron, internal và worker (B7)

- `cronAuthorized` (`lib/cron-auth.ts:24-35`) và bản copy trong `cron/cleanup/route.ts:38-50` cho qua khi thiếu
  `CRON_SECRET` và `NODE_ENV !== "production"`. PR #71 mục 8 đã nêu; thêm: một staging chạy `next start` vẫn là
  `production`, nên rủi ro chỉ ở `next dev` lộ ra ngoài.
- Một `CRON_SECRET` cho ba route (cleanup xoá user, cron CMO, `/api/internal/cmo/run`). Modal gọi Next bằng
  `Authorization: Bearer` (`packages/engine/opencmo/worker/cmo_dispatch.py:60-79`), tối đa 10 lần mỗi phút. Secret
  này nằm trong secret `opencmo` của Modal, mà container `opencmo-mcp` cũng mount (xem Session A, A1): lộ ở MCP là lộ
  route cleanup. Nên tách secret cleanup riêng.
- `OPENCMO_WORKER_TOKEN` (`modal_app.py:548-550`) và `MOTION_PREVIEW_TOKEN` (`:512-514`): `hmac.compare_digest`, đóng
  khi thiếu, gửi trong body (lý do có ghi trong docstring). Ổn. `bearerMatches` dùng `timingSafeEqual` có kiểm độ dài.

### 9. [Thấp] Header, lỗi và rò rỉ (B9)

- CSP chặt (`frame-ancestors 'none'`, không `unsafe-eval` ở production, không wildcard host trừ `*.sentry.io`), HSTS
  preload, `nosniff`, `Referrer-Policy`. Trang sandbox 3D: `sandbox allow-scripts`, `connect-src 'none'`.
- `script-src 'unsafe-inline'` cộng cookie phiên **không `httpOnly`** (mặc định của `@supabase/ssr`) nghĩa là một lỗi XSS
  bất kỳ đọc được access + refresh token. Chưa thấy XSS; đây là chiều sâu phòng thủ. Hướng sửa dài hạn: nonce CSP.
- Lỗi trả client đi qua allowlist (`lib/api/errors.ts`), lỗi worker qua `processing_error` (câu cố định). Không thấy
  câu Postgres hay stack trace lọt ra. Ngoại lệ có chủ ý: thông báo phân loại lỗi tải ở mục 2.
- `NEXT_PUBLIC_*`: chỉ `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SITE_URL`, `SENTRY_DSN`. Đều là giá trị công khai.
- Sentry: `tracesSampleRate: 0`, không `sendDefaultPii`. `captureRequestError` gửi URL kèm query; với
  `/auth/callback?code=…` thì code PKCE đã dùng một lần nên vô hại.
- Webhook Polar trả `reason` trong 401: ngoài phạm vi (PR #71).

### 10. [Thấp] Storage (B10)

- Mọi bucket private. Chỉ có policy INSERT (qua reservation hoặc `brand_logo_allows`), SELECT và DELETE trong thư mục
  `<uid>/` của chính mình; không có UPDATE, nên không ghi đè được.
- Trigger `validate_reserved_upload_object` so size thật với `declared_size` và bắt `video/*`. Không "đặt 1 byte, đẩy
  2 GB" được.
- DELETE `sources` bị chặn khi có job trỏ tới (`storage://` = `jobs.source_url`), và chỉ ở cấp thư mục đầu, nên không
  xoá được proxy/section worker đang dùng.
- `signedObjectUrl` (`lib/storage.ts:62-86`) ký bằng phiên người dùng (RLS của Storage vẫn áp), chặn `..` và chỉ ký
  `sources/**/proxy/**`. TTL: phát 1 giờ, tải 5 phút.
- Ghi chú: policy SELECT của `sources` cho người dùng đọc file nguồn gốc của chính mình qua Storage API (lớp TS chỉ ký
  proxy). Không phải rò rỉ, chỉ là quy tắc "không phát nguồn thô" chỉ nằm ở một lớp.

### 11. [Không có lỗ] Middleware matcher (B11)

- Matcher bỏ qua `blog*` và `*.svg|png|jpg|mp4`. Đã thử: `/app/x.png` → 404, `/blogX` → 404,
  `/app/editor/x.mp4` → 307 về `/login` (layout `app/app/layout.tsx` gọi `getUser()` lần nữa).
- `/api/**` không dựa vào middleware: `/api/v1/account` không cookie → 401 do `withApi`; cron, internal, webhook tự
  kiểm token; `/api/mcp` là của Session A.

### 12. Bề mặt PostgREST (B3), tóm tắt

- `anon` chỉ execute được các hàm trả hằng số (`signup_credits`, `job_hold_credits`, giá, trần…) và hai hàm trigger
  (`handle_new_user`, `refund_media_captions_from_task`; PostgREST không gọi được hàm trigger). `anon` không gọi được
  `rate_limit_hit` hay bất kỳ RPC ghi nào.
- `authenticated` execute được 121 hàm (91 là `SECURITY DEFINER`; 23 hàm `anon` cũng gọi được). Đối chiếu với route:
  - Đúng ý định và tự giữ trần ở SQL: `create_clip_job` (credit, 3 job đang chạy, 10/giờ), `start_cmo_run` (5/ngày),
    `capture_create` (`capture_daily_limit`), `reserve_upload` (quota), `rate_limit_hit` (allowlist bucket/limit/window,
    người dùng chỉ tự làm cạn bucket của mình, không reset được), `cmo_read_hit` (trần theo bucket cố định).
  - Bỏ qua bước ở route: `create_generation` bỏ qua moderation (PR #71 mục 6); `enqueue_cmo_run` với `brain` (mục 3);
    các hàm sổ sách Assistant (mục 5); `refund_caption_translation` (PR #71 mục 7).
- Bảng: mọi bảng `public` bật RLS. Default privileges của Supabase cấp INSERT/UPDATE/DELETE cho `anon` và
  `authenticated` trên nhiều bảng, nhưng không có policy ghi nào, nên vô hiệu. `api_keys` có grant theo cột (không có
  `key_hash`). View `marketing_documents_latest` và `cmo_draft_quality_weekly` là `security_invoker`.
- **Token OAuth là một JWT `authenticated` đầy đủ** (A §3): mọi client OAuth đã được duyệt (đăng ký tự do qua DCR)
  gọi thẳng được toàn bộ 121 hàm trên, không chỉ tool MCP. Nghĩa là mọi chỗ "route kiểm, SQL không kiểm" ở danh sách
  trên (mục 3, mục 5, `create_generation`) cũng mở cho client bên thứ ba, không riêng chính người dùng.
- **IDOR (B2):** mọi hàm `authenticated` nhận `uuid`/`uuid[]` (66 hàm) được gọi dưới vai `u2` với id của `u1` lấy
  từ 10 bảng (jobs, clips, projects, tasks, api_keys, cmo_runs, content_items, page_captures, editor_skills,
  credit_ledger): 660 lời gọi, 610 trả `P0002`/`22023`/`P0001`, 50 "thành công" là 5 hàm trả `false` hay rỗng
  (`revoke_api_key`, `delete_brand_kit`, `refund_caption_translation`, `mcp_confirm_use`, `list_projects`); khoá của
  `u1` vẫn chưa bị thu hồi. `credit_balance('<u1>')` dưới vai `u2` trả 0 (RLS của `profiles`). Các route ký URL
  (`clips/[id]/file`, `tasks/[id]/file`, `captures/[id]/image`, `clips/[id]/source`, `brand-kits/logo`) đọc hàng dưới
  RLS rồi mới ký bằng phiên người dùng. Giới hạn: chưa chạy được từng route HTTP với hai phiên thật (không có GoTrue);
  lớp đọc của route là RLS, đã kiểm ở trên.

## Những gì đang làm tốt (để giữ)

- `withApi` là cửa duy nhất: `getUser()` (không `getSession()`), chặn cross-site cho method ghi, trần body, rate limit
  ở DB, lỗi theo allowlist, `Cache-Control: no-store` trên mọi response.
- RPC lấy `auth.uid()` qua `require_user()`, không nhận `user_id` từ client; lỗi "không tìm thấy" và "của người khác"
  cùng là `P0002`.
- `rate_limit_hit` chỉ nhận đúng các bộ (bucket, limit, window) đã định, nên gọi thẳng không nới được trần.
- Trần quan trọng nằm trong SQL chứ không chỉ ở route: credit, số job đang chạy, 5 lần onboarding/ngày, trần CMO,
  quota storage, trần capture.
- Storage: chỉ INSERT qua reservation, trigger kiểm size thật, không UPDATE, DELETE có điều kiện.
- `api_keys.key_hash` không đọc được từ client (grant theo cột).
- Token cron/worker/preview: so sánh hằng thời gian, đóng khi thiếu secret trên production.
- CSP và header chặt; lỗi worker là câu cố định, không lộ URL proxy hay stderr.
- `source-preview` chỉ gọi oEmbed của YouTube với host trong allowlist, không thành proxy fetch.

## Repo đáng học

| Repo | Học được gì | File nên đọc | Licence | Copy hay chỉ học |
|---|---|---|---|---|
| [supabase/auth](https://github.com/supabase/auth) | Logic tự liên kết identity theo email và việc gỡ identity chưa xác nhận; để kiểm mục 4 | `internal/models/linking.go`, `internal/api/external.go` | MIT | Chỉ học |
| [usebasejump/supabase-test-helpers](https://github.com/usebasejump/supabase-test-helpers) | `tests.authenticate_as` cho pgTAP: biến harness IDOR của báo cáo này thành test CI | `supabase_test_helpers--0.0.6.sql` | MIT | Copy được (kèm notice) |
| [doyensec/safeurl](https://github.com/doyensec/safeurl) | Client HTTP chống SSRF: phân giải DNS, chặn dải, kiểm lại redirect, ghim IP | `safeurl/` (Go) | MIT | Chỉ học (code Go), ý cho guard Python |

(Đã có trong PR #71: `polar-js`, `standard-webhooks`, `pgledger`, `lago-api`.)

## Khuyến nghị

Xếp theo rủi ro giảm được trên mỗi ngày công. Mỗi mục là một PR riêng.

1. **Sửa open redirect ở `/auth/callback`** (mục 1).
   - Chi phí: **S** (≤ 1 giờ kèm `*.check.ts`).
   - Cải thiện: **rủi ro, retention** (một trang lừa ngay sau đăng nhập là mất niềm tin của đúng người vừa kích hoạt).
   - Thuộc: PR web auth.
2. **Tắt email signup trên dashboard production, bật captcha nếu giữ** (mục 4).
   - Chi phí: **S** (cấu hình; sửa `config.toml` cho khớp).
   - Cải thiện: **chi phí, rủi ro**; cắt hệ số nhân của mọi trần theo tài khoản.
   - Thuộc: việc cần tài khoản (CHỜ chủ dự án), cộng PR config nhỏ.
3. **Không tin `brain` từ client trong `cmo_enqueue`** (mục 3).
   - Chi phí: **S** (migration + pgTAP).
   - Cải thiện: **chi phí** (ScrapeCreators).
   - Thuộc: PR CMO.
4. **Guard SSRF dùng chung cho worker và web** (mục 2, cùng A6 của Session A).
   - Chi phí: **M**.
   - Cải thiện: **rủi ro** (mạng nội bộ Modal, metadata cloud, oracle quét cổng).
   - Cách làm: tái dùng `capture/guard.py` + `addresses.py` cho yt-dlp; cùng danh sách dải trong TS và SQL.
   - Thuộc: PR engine + web.
5. **Revoke các hàm sổ sách Assistant khỏi `authenticated`, thêm trần kích thước** (mục 5).
   - Chi phí: **S–M**. Gộp vào khuyến nghị 6/8 của PR #71 (allowlist pgTAP các hàm `authenticated` gọi được).
   - Thuộc: PR billing/agent.
6. **Tách `CRON_SECRET` của cleanup khỏi secret Modal mà MCP mount** (mục 8).
   - Chi phí: **S**. Cải thiện: **rủi ro**. Thuộc: PR hạ tầng, cùng A1 của Session A.
7. **Để sau:** bỏ `/api/` khỏi matcher middleware (S); chuyển GET tạo mới sang POST và thêm rate limit cho
   `cmo/workspace` (S); nonce CSP để bỏ `unsafe-inline` (M); dọn `mcp_confirms` theo số hàng (S).

**Không làm:** không cần thêm lớp phân quyền mới ở route; RLS + RPC đang giữ chặt (0/660 lời gọi chéo user lọt).

## Nguồn

Ngày đọc: 2026-10-17 cho tất cả.

- https://supabase.com/docs/guides/auth/auth-identity-linking (tự liên kết theo email, gỡ identity chưa xác nhận)
- https://supabase.com/blog/supabase-auth-identity-linking-hooks
- https://red.anthropic.com/2026/cvd/findings/ANT-2026-7WJV60DR (liên kết thủ công không kiểm email đã xác nhận; mình
  để `enable_manual_linking = false`, nên không ảnh hưởng)
- https://workos.com/blog/stop-using-email-as-a-primary-key
- https://url.spec.whatwg.org/ (chuẩn hoá dot-segment trong path)
- https://cheatsheetseries.owasp.org/cheatsheets/Unvalidated_Redirects_and_Forwards_Cheat_Sheet.html
- https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html
- https://github.com/marcus-legia/opencmo/pull/71 (báo cáo credit/billing, để không lặp)
- Code nội bộ:
  - `apps/web/app/auth/callback/route.ts`, `apps/web/components/LoginForm.tsx`, `apps/web/middleware.ts`,
    `apps/web/lib/supabase/middleware.ts`
  - `apps/web/lib/api/handler.ts`, `apps/web/lib/api/errors.ts`, `apps/web/lib/api/source.ts`, `apps/web/lib/storage.ts`,
    `apps/web/lib/cron-auth.ts`, `apps/web/next.config.ts`, `apps/web/instrumentation.ts`
  - `apps/web/app/api/v1/**` (route ký URL, `cmo/workspace`, `editor/project`, `cmo/onboarding`, `source-preview`),
    `apps/web/app/api/cron/**`, `apps/web/app/api/internal/cmo/run/route.ts`
  - `apps/web/lib/cmo/jobs/{runner,think,start,sales-scan}.ts`, `apps/web/lib/cmo/onboard.ts`
  - `supabase/migrations/20261101090000_r6_credit_module.sql`, `20261128090000_cmo_inbox.sql`,
    `20260926090000_agent.sql`, `20260927090000_agent_providers_browser_tools.sql`,
    `20260917120000_web_d3_security_completion.sql`, `supabase/config.toml`
  - `packages/engine/opencmo/steps/download.py`, `packages/engine/opencmo/worker/errors.py`,
    `packages/engine/opencmo/worker/cmo_dispatch.py`, `packages/engine/modal_app.py`
