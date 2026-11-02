# Bảo mật: chữ của người lạ ghi được vào bộ nhớ của founder, và token MCP không gắn với server của mình  (2026-10-17)

## TL;DR

- **Vòng luân phiên:** báo cáo trước là Video editing (seed, 2026-10-16), nên lượt này là mảng 3, Bảo mật. Không có
  gì khẩn cấp buộc phải đổi mảng: các advisory của Next.js tháng 7–9/2026 đã được vá trong bản `next@15.5.27` mình
  đang pin, còn các CVE ffmpeg mùa hè nằm ở những demuxer mà allowlist của mình không mở.
- **Rủi ro thật nằm ở thiết kế agent của chính mình, không ở dependency.** CMO chat đọc chữ không tin cậy (Reddit, X,
  Threads, transcript TikTok/YouTube, website bất kỳ qua `read_site`) và ngay trong lượt đó có thể gọi `remember`,
  `update_document`, `set_week_goal`, `create_task` mà không hỏi. `remember` lưu ghi chú với `type = 'user'`, tức
  mức tin cậy cao nhất, và mọi kế hoạch, bản nháp về sau đều đọc nó. Một comment Reddit có cài lệnh có thể trở thành
  "luật của founder" vĩnh viễn. Nghiên cứu năm 2026 đo được tỉ lệ tiêm thành công ~98% với đúng kiểu này (đầu độc bộ
  nhớ qua đầu vào bình thường).
- **PR #59 (MCP agent team) mở rộng cùng bề mặt đó**: tool research của CMO và `remember` được đưa sang Claude của
  chính người dùng, nơi thường cũng có connector Gmail/Drive. Kết quả trả về từ server mình trở thành đường tiêm lệnh
  vào phiên đó ("toxic flow"). Ngoài ra, OAuth 2.1 server của Supabase bỏ qua tham số `resource` của RFC 8707 và cấp
  token với `aud: "authenticated"`, nên server MCP không làm được bước kiểm audience mà spec MCP nay nói là MUST; hiện
  nó nhận mọi token OAuth của Supabase miễn có `client_id`.
- **Spec MCP 2026-07-28 đã ra** (lõi stateless, bỏ dần DCR để dùng Client ID Metadata Documents, client phải kiểm
  `iss` theo RFC 9207). Server mình đang nói `2025-06-18`. Chưa gấp, nhưng đó là phiên bản claude.ai sẽ chuyển sang.
- **Khuyến nghị:** dành ~1–2 ngày cho việc chặn ghi khi đã đọc dữ liệu lạ và làm sạch chữ không tin cậy trước khi
  PR #59 tới tay người dùng; sau đó gắn quyền MCP vào bản ghi consent của mình kèm scope. Next.js/ffmpeg: không cần
  làm gì đợt này.

## Phát hiện

### 1. Next.js: ba đợt vá bảo mật từ tháng 7, mình đang ở nhánh đã vá

- **Đợt 20/07/2026** (vá ở 15.5.21): DoS qua Server Action (CVE-2026-64641), bypass middleware khi dùng Turbopack +
  một locale (CVE-2026-64642), SSRF qua rewrites có hostname lấy từ request (CVE-2026-64645), SSRF trong Server Action
  trên custom server (CVE-2026-64649), cùng bốn lỗi mức trung bình.
- **25/08/2026**: hai lỗi RCE nghiêm trọng không cần đăng nhập, vá ở 15.5.24 — path traversal chỉ trên Windows
  (CVE-2026-75604) và tràn heap trong libheif khi tối ưu ảnh AVIF (GHSA-2xp9-vwfh-vxw4). Bản vá tắt hẳn tối ưu AVIF
  cho tới khi libheif có bản sửa.
- **30/09/2026** (vá ở 15.5.27): SSRF trong Image Optimization khi có `images.remotePatterns` (CVE-2026-94483), đầu
  độc cache SSG/ISR (CVE-2026-94543, CVE-2026-94484), lách `dynamicParams` ở route ảnh metadata (CVE-2026-94485), rò
  rỉ qua `use cache`, và endpoint MCP của `next dev` mà website bất kỳ đọc được (CVE-2026-94486, chỉ bản dev).
- **Mình:** `package-lock.json` resolve `next` về **15.5.27**; `apps/web/next.config.ts` không có cấu hình `images`
  (không remote patterns, không AVIF); chạy trên Linux/Vercel. Không cần làm gì. Lỗi endpoint MCP của `next dev` đáng
  biết: dev vừa chạy `npm run dev` vừa lướt web có thể lộ route và đoạn mã nguồn nếu chưa lên 15.5.27 (lockfile đã
  đảm bảo điều đó).

### 2. Supabase: vụ lộ dữ liệu tháng 9 là chuyện vệ sinh RLS, thứ mình đã có test

- TechCrunch (25/09/2026) và BleepingComputer đưa tin UpGuard tìm thấy ~16.000 database Supabase lộ dữ liệu cá nhân
  do khách hàng cấu hình sai; Supabase nói nền tảng an toàn mặc định.
- CVE-2026-31813 (Supabase Auth < 2.185.0, giả mạo token OIDC của Apple/Azure) là từ **tháng 3/2026 (cũ hơn 6
  tháng)**; project hosted đã được Supabase vá, và mình không dùng hai provider đó.
- **Mình:** `supabase/tests/010_rls.test.sql` kiểm `anon` không đọc được gì; 83 migration có hàm `SECURITY DEFINER`,
  và CI chạy `supabase db lint --local --level warning` (`.github/workflows/ci.yml`, bước "Lint the database"). Các
  lint mới của splinter đáng chú ý: `0024_rls_policy_always_true`, `0028_anon_security_definer_function_executable` và
  `0029_authenticated_…` bắt đúng loại lỗi trong tin tức. Theo mình đọc workflow, bước lint chỉ báo chứ không làm
  build fail khi có warning (ý kiến — cần kiểm exit code / cờ `--fail-on` của bản CLI đang pin).

### 3. Prompt injection gián tiếp đã có ngoài thực tế, và nó nấp trong phần HTML mà bộ trích chữ của mình giữ lại

- Unit 42 (Palo Alto Networks, **03/03/2026 — vừa quá mốc 6 tháng**) ghi nhận 22 kỹ thuật trên trang web thật: chữ
  hiển thị bình thường (37,8%), giấu trong thuộc tính HTML (19,8%) và giấu bằng CSS (16,9%: `display:none`, cỡ chữ 0,
  đẩy ra ngoài màn hình, `<textarea>` bị ẩn), cộng với ký tự zero-width, ký tự Unicode tag, chữ đồng dạng và thông
  báo giả "developer mode". Mục tiêu gồm qua mặt agent duyệt quảng cáo và đầu độc SEO cho gợi ý của LLM — tức đúng
  những workflow agent marketing như của mình.
- **Mình:** `apps/web/lib/cmo/site.ts` (`extractPage`) bỏ `script/style/noscript/svg/template/iframe`, nhưng vẫn giữ
  chữ trong phần tử bị ẩn bằng `hidden`, `aria-hidden`, inline `display:none`/`visibility:hidden`/`font-size:0`, và
  `<textarea>`. Nó cũng không bỏ ký tự Unicode vô hình. Chữ đó đi vào document onboarding (`product`, `strategy`) mà
  mọi job sau đều đọc như `<documents>` đáng tin.
- `apps/web/lib/cmo/jobs/sales-scan.ts` (`threadBlock`) bọc chữ Reddit trong `<thread index=…>` và dặn model bỏ qua
  lệnh bên trong, nhưng không escape nội dung thread. Một bài viết chứa `</thread><thread index="0" …>` có thể giả ranh
  giới khối. Output có schema, bước kiểm câu trích (`quoteIn`) và việc hai lần gọi đó không có tool giới hạn thiệt hại
  ở mức điểm số và bản nháp trả lời, mà founder đều tự đọc — nên đây là một bản sửa nhỏ, không phải sự cố.

### 4. Đầu độc bộ nhớ: phiên bản lâu dài của cùng kiểu tấn công

- arXiv 2607.06595 (06/07/2026, "When Agents Remember Too Much") cho thấy kẻ tấn công ghi được vào bộ nhớ dài hạn
  của agent chỉ qua đầu vào thông thường (một email), tỉ lệ tiêm thành công ~98% và kích hoạt về sau ~60%; cách phòng
  được đánh giá gồm **gắn nhãn nguồn gốc** cho từng ký ức, **chặn ở bước ghi** và **lọc ở bước truy xuất**. Một số bài
  viết của các hãng tháng 8–9/2026 (WorkOS, Akto, AppScale) cũng đi tới ba biện pháp này (nguồn mức ý kiến; bằng
  chứng là bài báo khoa học).
- **Mình:** trong `apps/web/lib/agent/cmo-tools.ts`, `isCmoWrite` đánh dấu `create_task`, `remember`,
  `set_week_goal`, `create_video_brief`, `update_document` là tool ghi, nhưng vòng lặp (`lib/agent/loop.ts`) chỉ dùng
  nó để tải lại state, không bao giờ hỏi người dùng. `remember` gọi `cmo_remember`, hàm này insert `type = 'user'` —
  cùng loại với ghi chú founder tự gõ (pgTAP `139_cmo_memory_tiers` xếp loại này cao nhất). Tool research
  (`lib/agent/cmo-research.ts`) bọc kết quả trong `{ untrusted_data }` và system prompt của CMO dặn bỏ qua lệnh trong đó
  — tốt, nhưng prompt chỉ là kiểm soát mềm. Không có gì ghi lại rằng lượt này đã đọc chữ không tin cậy trước khi ghi.
- Góc sản phẩm: vì Post và Sales là "bản nháp bạn duyệt rồi tự đăng", một ký ức bị đầu độc không tự đăng gì cả. Nó
  làm điều tệ hơn cho retention: âm thầm bẻ cong mọi bản nháp về sau (một tên đối thủ phải né, một link phải chèn, một
  giọng văn), và founder sẽ đổ lỗi cho sản phẩm.

### 5. MCP: spec 2026-07-28, gắn audience, và toxic flow

- **Spec 2026-07-28** (ra ngày 28/07/2026): lõi stateless — bỏ `initialize`/session id, capability nằm trong `_meta`,
  header `Mcp-Method`/`Mcp-Name` trên Streamable HTTP; Dynamic Client Registration bị deprecate để thay bằng Client ID
  Metadata Documents; client phải kiểm `iss` theo RFC 9207; request từ server về client (elicitation, sampling) chuyển
  sang multi-round-trip. Thiết kế trong PR #59 đã stateless sẵn, nên việc chuyển chủ yếu là header và discovery.
- **Phần cân nhắc bảo mật về authorization (cùng spec):** server MUST từ chối token không cấp cho chính nó (audience)
  và MUST NOT chuyển tiếp token nhận được sang API phía sau.
- **Khoảng trống của Supabase:** issue supabase/auth #2610 xin hỗ trợ RFC 8707 — hiện `resource` được nhận nhưng bị
  bỏ qua và token mang `aud: "authenticated"`; issue #2820 báo endpoint consent trả 400 khi có gửi `resource`. Issue
  MCP #3413 (mở 04/10/2026, chưa ai trả lời) hỏi việc chuyển token sang PostgREST cùng project (đúng pattern PR #59
  dùng để có RLS) có bị coi là passthrough bị cấm không.
- **Mình (PR #59, `packages/mcp-server/src/oauth.ts`):** `userForAccessToken` nhận token nếu `getUser` của Supabase
  nhận và JWT có `client_id` bất kỳ. Mọi OAuth client mà người dùng đồng ý trên `/oauth/consent` đều có đủ 116 tool,
  kể cả tool tiêu credit, không chia scope. Trang consent có hiện host của redirect (tốt — spec bắt buộc). Bước "báo giá
  → confirm" được server ép, nhưng mã confirm lại đưa cho model, nên một lệnh bị tiêm trong phiên Claude của người
  dùng có thể confirm thay họ ("Never confirm on your own" là prompt, không phải kiểm soát).
- **Toxic flow:** scanner của Invariant/Snyk (`docs/issue-codes.md`, W015–W020) gắn cờ mọi server trả về nội dung
  bên thứ ba không tin cậy (W015) — tức `search_reddit`, `reddit_thread`, tool transcript mạng xã hội và `read_site`
  của mình. PR #59 đã đặt `openWorldHint: true` cho các tool đọc đó (`apps/web/lib/cmo/mcp/cmo.ts`, có assert trong
  `mcp.check.ts`) — đúng tín hiệu cần gửi cho client.
- **Lỗi chiếm tài khoản qua OAuth trong MCP Python SDK** (Cycode, 28/09/2026): client Python SDK bỏ qua kiểm
  issuer/audience ở nhánh discovery dự phòng (vá ở 1.30.0 / 2.2.0). Mình chỉ dùng TypeScript SDK làm *server* nên
  không bị ảnh hưởng; đây là lời nhắc về loại lỗi "chỉ kiểm khi kẻ tấn công cung cấp trường đó".

### 6. ffmpeg trên worker: không cần làm gì

- Các CVE mùa hè 2026 gồm vòng lặp vô hạn ở demuxer RTP/ASF (CVE-2026-64834, 07/2026, DoS, cần luồng RTP được dựng sẵn)
  và ghi ngoài vùng nhớ ở `vf_swaprect` (CVE-2026-65706; trang nguồn không tải được, chi tiết chưa kiểm chứng).
  **Mình:** `packages/engine/opencmo/media/ffmpeg.py` đọc media của người dùng với `-protocol_whitelist file` và
  allowlist demuxer (`USER_MEDIA_FORMATS`) không có RTP/ASF, còn filter graph do mình dựng chứ không phải người dùng.
  Gói `ffmpeg` của Debian trên `debian_slim` nhận bản vá bảo mật khi build lại image.

## Repo đáng học

| Repo | Học được gì | File nên đọc | Licence | Copy hay chỉ học |
|---|---|---|---|---|
| [google-research/camel-prompt-injection](https://github.com/google-research/camel-prompt-injection) (commit cuối 2025-06-20, **cũ hơn 6 tháng**) | Theo dõi capability/taint: mỗi giá trị mang theo nguồn gốc; policy engine từ chối mọi tool thay đổi trạng thái nếu tham số phụ thuộc giá trị không tin cậy (`base_security_policy`, `SecurityPolicyEngine.check_policy`), tool không có side effect thì được allowlist. Bản rút gọn cho mình: một cờ "tainted" mỗi lượt, bật khi có lần đọc dữ liệu lạ, kiểm trước mọi tool `isCmoWrite`. | `src/camel/security_policy.py`, `src/camel/capabilities/sources.py`, `src/camel/capabilities/capabilities.py` | Apache-2.0 | Chỉ học (cả interpreter vượt xa nhu cầu; bản của mình ~30 dòng tự viết) |
| [meta-llama/PurpleLlama — LlamaFirewall](https://github.com/meta-llama/PurpleLlama/tree/main/LlamaFirewall) (2026-10-12) | `AlignmentCheckScanner`: một model thứ hai đọc tin nhắn gốc của người dùng cùng hành động agent định làm và trả `{observation, thought, conclusion}`; kết quả dương chuyển thành `HUMAN_IN_THE_LOOP_REQUIRED`, lỗi thì mặc định chặn. `HiddenASCIIScanner`: phát hiện/giải mã ký tự Unicode tag U+E0000–E007F dùng để giấu lệnh vô hình. | `src/llamafirewall/scanners/experimental/alignmentcheck_scanner.py`, `src/llamafirewall/scanners/hidden_ascii_scanner.py`, `scanners/custom_check_scanner.py` | MIT (thư mục LlamaFirewall; gốc repo là licence Llama) | Được copy code LlamaFirewall kèm notice; mình chỉ cần ý tưởng (một lần gọi "checker" rẻ cho tool ghi sau lần đọc dữ liệu lạ) |
| [protectai/llm-guard](https://github.com/protectai/llm-guard) (2026-07-09) | Scanner `InvisibleText`: bỏ ký tự thuộc nhóm Unicode `Cf` (format), `Co` (private use), `Cn` (chưa gán). Lưu ý cho mình: `Cf` gồm cả ZWJ (U+200D) mà chuỗi emoji cần — giữ ZWJ giữa các emoji. | `llm_guard/input_scanners/invisible_text.py`, `ban_substrings.py` | MIT | Chỉ học — bản TS chỉ là một regex trên `\p{Cf}\p{Co}\p{Cn}` mình tự viết |
| [modelcontextprotocol/typescript-sdk](https://github.com/modelcontextprotocol/typescript-sdk) (2026-10-13) | `verifyBearerToken` với `expectedResource`: verifier phải điền `AuthInfo.resource` (từ `aud`), so sánh sau khi bỏ fragment/dấu `/` cuối, từ chối token không có `expiresAt`, `requiredScopes` → `403 insufficient_scope` với challenge dựng bằng `buildWwwAuthenticateHeader` (escape dấu nháy và ký tự không in được). Cho thấy hình dạng verifier của mình nên trả về, kể cả khi Supabase chưa điền được `resource`. | `packages/server/src/server/middleware/bearerAuth.ts`, `examples/bearer-auth/server.ts`, `packages/server-legacy/src/auth/middleware/bearerAuth.ts` (nhánh v1 mà PR #59 pin ở 1.31.0) | Đang chuyển MIT → Apache-2.0 (hỗn hợp) | Chỉ học (dùng SDK làm dependency, không chép vào repo) |
| [invariantlabs-ai/mcp-scan](https://github.com/invariantlabs-ai/mcp-scan) (nay là "Snyk Agent Scan", 2026-10-15) | Mô hình rủi ro mà người dùng có ý thức bảo mật sẽ chạy với server mình: `McpServerRiskIndexes` chấm `prompt_injection_tool_desc`, `untrusted_content`, `private_data`, `destructive_capabilities`; mã W015–W020 mô tả từng loại. Phân tích do API của Snyk làm (cần `SNYK_TOKEN`; mô tả tool rời khỏi máy). | `src/agent_scan/models/api/v20260710.py`, `docs/issue-codes.md` (Toxic Flows), `src/agent_scan/verify_api.py` | Apache-2.0 | Chỉ học; có thể chạy một lần với URL MCP staging (trên máy dev, không trong CI) |
| [supabase/splinter](https://github.com/supabase/splinter) (2026-09-29) | SQL đứng sau `supabase db lint`: `0024` chuẩn hoá biểu thức policy để bắt `USING (true)` trên UPDATE/DELETE/ALL và thiếu `WITH CHECK` trên INSERT; `0028`/`0029` liệt kê hàm `SECURITY DEFINER` mà `anon`/`authenticated` gọi được qua `/rest/v1/rpc`. | `lints/0024_rls_policy_always_true.sql`, `lints/0028_anon_security_definer_function_executable.sql`, `lints/0029_…`, `lints/0013_rls_disabled_in_public.sql` | Không có file licence trong repo (badge README trỏ tới LICENSE không tồn tại) | Chỉ học — dùng qua Supabase CLI mình đang chạy |

## Khuyến nghị

Xếp theo lượng rủi ro gỡ được trên mỗi ngày công. Không mục nào thêm tính năng người dùng thấy được, nên không mục
nào đụng tới landing page.

1. **Chặn tool ghi của CMO sau khi đã đọc dữ liệu lạ (làm trước khi PR #59 tới tay người dùng).** Chi phí **S–M**
   (1 ngày). Cải thiện: **rủi ro, retention** (bản nháp thôi trôi theo những lý do founder chưa từng nói).
   - Trong `apps/web/lib/agent/scope.ts` / `loop.ts`, bật cờ `tainted` cho lượt đó khi bất kỳ tool nào trong
     `RESEARCH_TOOLS` hoặc `read_site` trả kết quả (cả `get_run_result` của run research). Đây là policy của CaMeL
     rút gọn còn một bit.
   - Khi tainted, `remember`, `update_document` và `set_week_goal` không ghi thẳng: chúng tạo thẻ Approvals ("CMO
     muốn ghi nhớ: …") để founder chấp nhận — đúng pattern assist-never-act như với bài đăng. `create_task` có thể giữ
     ghi thẳng (nó chỉ xếp job của mình vào hàng đợi) nhưng `brief` nên hiện trên thẻ nó đã tạo sẵn.
   - Lưu ký ức do agent viết với loại riêng (ví dụ `agent`) thay vì `user`, để `139_cmo_memory_tiers` xếp chúng dưới
     ghi chú founder tự gõ và UI bộ nhớ hiện được nguồn gốc. Migration mới + pgTAP test.
   - Áp cùng cổng chặn trong `apps/web/lib/cmo/mcp/cmo.ts` để đường MCP không lách được.
   - Thuộc: track CMO (`docs/architecture/ai-cmo.md`) và là việc tiếp theo của PR #59.

2. **Gom việc làm sạch chữ không tin cậy vào một helper.** Chi phí **S** (nửa ngày). Cải thiện: **rủi ro**, và chất
   lượng onboarding (**activation**: chữ SEO bị giấu không còn làm bẩn document sản phẩm).
   - File mới `apps/web/lib/cmo/untrusted.ts` (code tự viết): bỏ ký tự Unicode tag U+E0000–E007F, ký tự đảo chiều
     bidi (U+202A–202E, U+2066–2069), ký tự zero-width trừ ZWJ trong chuỗi emoji, và code point private-use/chưa gán
     (ý tưởng từ llm-guard và LlamaFirewall); cùng một hàm `escapeForTag()` vô hiệu `<`/`>` trong chữ được bọc.
   - Dùng nó trong `extractPage` của `site.ts`, trong bộ chuẩn hoá của `social/reddit.ts` / `social/scrapecreators.ts`,
     và trong `threadBlock` của `sales-scan.ts`.
   - Trong `extractPage`, bỏ phần tử có `hidden`, `aria-hidden="true"`, inline `display:none`,
     `visibility:hidden`, `font-size:0`/`opacity:0`, và `<textarea>` trước khi lấy chữ (làm bằng regex như code hiện
     tại; không cần thư viện DOM).
   - Tuỳ chọn: thêm hậu tố ngẫu nhiên theo từng lần gọi vào thẻ bọc (`<thread_3f9a …>`) để ranh giới giả không khớp.
   - Thêm ca kiểm vào các test `*.check.ts` hiện có, với một trang và một thread mang từng mánh.

3. **Gắn quyền MCP vào bản ghi consent của mình và chia scope.** Chi phí **M** (2–3 ngày, trong phần việc Session A
   của PR #59). Cải thiện: **rủi ro**, và gián tiếp **doanh thu** — một mô hình quyền rõ ràng nhiều khả năng sẽ quan
   trọng khi lên danh mục connector và khi bán cho team (ý kiến).
   - Vì Supabase bỏ qua `resource` (issue auth #2610/#2820), giữ bảng `mcp_grants` riêng do `/api/v1/oauth/consent`
     ghi (user, `client_id`, scope, thời điểm tạo/thu hồi) và cho `packages/mcp-server/src/oauth.ts` từ chối token
     có `client_id` không còn grant hiệu lực. Settings → Connected apps đã có sẵn chỗ thu hồi.
   - Cho ba scope trên màn consent: đọc, sửa, tiêu credit. Ép theo từng tool qua annotation sẵn có (`readOnlyHint`)
     cộng một dấu "tốn credit"; trả `403 insufficient_scope` theo định dạng challenge của SDK.
   - Với việc tiêu credit, ưu tiên elicitation của MCP (người dùng xác nhận trên UI của client, không qua model) khi
     client hỗ trợ; giữ mã confirm có chữ ký làm phương án dự phòng. Kiểm claude.ai có hỗ trợ elicitation chưa trước khi
     làm (chưa kiểm chứng).
   - Ghi quyết định về passthrough (chuyển token Supabase của người dùng sang PostgREST để có RLS) vào
     `docs/mcp-on-modal-plan.md` và theo dõi issue MCP #3413.

4. **Cho bước lint database làm CI fail khi có warning bảo mật.** Chi phí **S** (một giờ). Cải thiện: **rủi ro**.
   Xác nhận exit code của `supabase db lint --level warning` với bản CLI đang pin, thêm tuỳ chọn fail-on nếu nó chỉ
   báo; xử lý các hit `0028/0029` sẵn có (phần lớn RPC của mình được thiết kế cho `authenticated` gọi, nên nhiều khả
   năng cần allowlist trong workflow chứ không phải sửa code). Thuộc: CI.

5. **Lên kế hoạch chuyển sang MCP 2026-07-28, chưa làm vội.** Chi phí **M**, xếp sau khi PR #59 merge. Thêm một mục
   ngắn vào `docs/mcp-on-modal-plan.md`: header `Mcp-Method`/`Mcp-Name`, `server/discover`, capability trong `_meta`,
   CIMD thay DCR (phụ thuộc Supabase có hỗ trợ không), và nâng `PROTOCOL_VERSION` trong
   `apps/web/lib/mcp/server.ts` (`2025-06-18`). Cải thiện: **rủi ro** bị gãy khi client bỏ phiên bản cũ.

6. **Chạy Snyk Agent Scan một lần với MCP staging** trước khi công bố connector. Chi phí **S**. Sẽ có W015 (nội
   dung không tin cậy) trên các tool research; cách trả lời là khuyến nghị 1–2 cùng mô tả tool rõ ràng, không phải
   bỏ tool. Lưu ý scanner gửi metadata của tool sang Snyk.

7. **Next.js, CVE Supabase Auth, ffmpeg: không làm gì đợt này.** Cứ để Dependabot (PR #60) chạy đều; kiểm lại nếu
   sau này thêm `images.remotePatterns`, AVIF, hoặc host trên Windows.

Ngoài phạm vi, ghi lại cho owner: `packages/mcp-server/package.json` trong PR #59 khai báo
`"license": "AGPL-3.0-only"` trong khi repo đã đóng mã nguồn từ 2026-10-16; có lẽ nên là `UNLICENSED`/private.

## Nguồn

Tất cả đọc ngày 2026-10-17 (giờ Asia/Ho_Chi_Minh).

- Next.js, July 2026 Security Release (đăng 2026-07-20): https://nextjs.org/blog/july-2026-security-release
- Next.js, September 2026 Security Release (đăng 2026-09-30): https://nextjs.org/blog/september-2026-security-release
- The Hacker News, Next.js vá lỗi nghiêm trọng AVIF và Windows (2026-08-27): https://thehackernews.com/2026/08/nextjs-patches-critical-avif-and.html
- TechCrunch, khách hàng Supabase lộ dữ liệu (2026-09-25): https://techcrunch.com/2026/09/25/some-supabase-customers-are-publicly-exposing-reams-of-peoples-data-to-the-web/
- BleepingComputer, hơn 16.000 database Supabase bị lộ (09/2026): https://www.bleepingcomputer.com/news/security/misconfigured-supabase-apps-expose-data-in-over-16-000-databases/
- SentinelOne, CVE-2026-31813 Supabase Auth (2026-03-13, cũ hơn 6 tháng): https://www.sentinelone.com/vulnerability-database/cve-2026-31813/
- Unit 42, Prompt injection gián tiếp qua web ngoài thực tế (2026-03-03, cũ hơn 6 tháng): https://unit42.paloaltonetworks.com/ai-agent-prompt-injection/
- arXiv 2607.06595, When Agents Remember Too Much: Memory Poisoning Attacks on LLM Agents (2026-07-06): https://arxiv.org/html/2607.06595v1
- WorkOS, Memory and context poisoning (2026, nguồn mức ý kiến): https://workos.com/blog/ai-agent-memory-poisoning
- MCP blog, The 2026-07-28 Specification (2026-07-28): https://blog.modelcontextprotocol.io/posts/2026-07-28/
- Spec MCP 2026-07-28, Authorization security considerations: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/security-considerations
- supabase/auth issue #2610, RFC 8707 resource indicators: https://github.com/supabase/auth/issues/2610
- supabase/auth issue #2820, consent trả 400 khi gửi `resource`: https://github.com/supabase/auth/issues/2820
- modelcontextprotocol issue #3413, passthrough token sang API cùng project (mở 2026-10-04): https://github.com/modelcontextprotocol/modelcontextprotocol/issues/3413
- Cycode, MCP Python SDK OAuth account takeover (2026-09-28): https://cycode.com/blog/mcp-python-sdk-oauth-account-takeover/
- AgentMelt, MCP security in 2026: attacks and defenses (2026-07-15, cập nhật 2026-09-17; các sự cố là của 2025, cũ hơn 6 tháng): https://agentmelt.com/blog/mcp-security-2026-attacks-and-defenses/
- CraftedSignal, ffmpeg DoS CVE-2026-64834 (2026-07-22): https://feed.craftedsignal.io/briefs/2026-07-ffmpeg-dos-cve-2026-64834/
- Vulert, ffmpeg vf_swaprect CVE-2026-65706 (trang không tải được; chỉ dẫn từ kết quả tìm kiếm): https://vulert.com/vuln-db/ffmpeg-versions-3-0-through-8-1-2-contain-an-out-of-bounds-write-vulnerability-in-the-vf-swaprect-vi---
- Repo (code đọc ở commit của bản clone ngày 2026-10-17): https://github.com/google-research/camel-prompt-injection · https://github.com/meta-llama/PurpleLlama · https://github.com/protectai/llm-guard · https://github.com/modelcontextprotocol/typescript-sdk · https://github.com/invariantlabs-ai/mcp-scan · https://github.com/supabase/splinter
