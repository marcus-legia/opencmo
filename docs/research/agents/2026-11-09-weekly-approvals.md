# AI agent & automation: ít thẻ duyệt hơn mỗi tuần mà không duyệt cho có  (2026-11-09)

## TL;DR

- Một tuần của OpenCMO hiện có khoảng 15–20 thẻ (`docs/architecture/workflow.md` §3), trong khi sketch của chủ chỉ có
  hai lần duyệt: duyệt chữ, rồi duyệt thứ đã làm ra.
- Buffer, công cụ lên lịch lớn nhất, duyệt **từng bài một**. Duyệt xong là bài vào ngay slot kế tiếp của queue, không
  hỏi giờ lần nữa. Trong các nguồn đọc được, mình không thấy Buffer có nút "duyệt tất cả". Typefully không thấy có bước
  duyệt riêng.
- Các bài viết về agent có người duyệt đều nhắc cùng một rủi ro: hàng chờ dài thì người duyệt **bấm cho qua mà không
  đọc**. Cách chữa họ đưa ra là gộp ở mức kế hoạch và chỉ chặn ở bước không đảo ngược được. Đây là ý kiến của người
  làm nghề, chưa có nghiên cứu đối chứng.
- Chỗ thừa lớn nhất của mình là **thẻ giờ đăng**, tách riêng khỏi thẻ bài. Gộp hai thẻ này là bỏ được khoảng 5–8 thẻ
  một tuần, mà founder vẫn duyệt đủ chữ, giờ và tài khoản.

## Phát hiện

1. **Buffer: duyệt là vào queue.** Bài nháp nằm ở tab Approvals. Bấm Approve thì bài vào slot kế tiếp của queue, hoặc
   vào giờ đã đặt trước. Người có toàn quyền chuyển nháp vào queue được mà không cần ai gửi duyệt. Chức năng hàng
   loạt trong các trang hỗ trợ mình đọc chỉ có xoá và tải lên, không có duyệt. Help center có một câu hỏi "duyệt mọi
   bản nháp ở một chỗ", nhưng đoạn trích không có câu trả lời: chưa kiểm được.
   Ý nghĩa với mình: **một quyết định cho cả chữ lẫn giờ** là chuẩn của ngành. Còn mình hỏi giờ bằng một thẻ thứ hai.
2. **Typefully** có API để tạo nháp, lên lịch và xếp queue. Các mẫu Zapier và Pipedream tạo nháp hàng tuần rồi xếp
   vào slot. Mình không thấy bước duyệt riêng: người dùng tự là người duyệt khi mở nháp.
3. **Mệt mỏi vì duyệt.** Các nguồn thực hành (Gravitee, BMC, Waxell, tianpan.co, kunalganglani.com) gặp nhau ở mấy ý:
   - chặn theo rủi ro, không theo số lượng;
   - gộp ở mức kế hoạch;
   - đo độ trễ khi duyệt và tỉ lệ sửa của từng người, coi một loạt duyệt tức thì là dấu hiệu vòng duyệt đã hỏng;
   - mỗi yêu cầu duyệt phải tự giải thích được.

   Mình đã có đúng dữ liệu để đo việc này: `cmo_draft_outcomes` ghi bản được chọn, độ giống và kiểu sửa.
4. **Code của mình.** Hai chỗ dẫn tới số thẻ hiện nay:
   - Duyệt một bài post làm ra slot ở trạng thái `proposed`, rồi một thẻ `schedule` riêng (`schedule_propose` →
     `approval_raise('schedule_slot')`).
   - Bài đăng nhiều nền tảng có một thẻ giờ cho **mỗi** nền tảng.

   Phần còn lại đã gộp sẵn: kế hoạch là một thẻ, shorts là một lô, slideshow là một thẻ, script là một thẻ.

## Repo đáng học

| Repo | Học được gì | File nên đọc | Licence | Copy hay chỉ học |
|---|---|---|---|---|
| (lượt này không đọc code repo nào; nguồn là tài liệu sản phẩm và bài viết) | | | | |

## Gắn vào OpenCMO

- **Thẻ bài kèm giờ** (học từ Buffer).
  - Thẻ `post`, và thẻ `shorts_batch`, `slideshow`, `finished_video`, hiện luôn giờ đề xuất (`schedule_pick_time`)
    và tài khoản cho từng nền tảng.
  - "Approve" đặt slot thành `waiting` luôn, không có thẻ `schedule` thứ hai. "Đổi giờ" vẫn mở ra từ chính thẻ đó.
  - Sửa ở: `approval_snapshot_base` (thêm giờ và tài khoản vào snapshot, để hash gồm cả chúng, đúng luật "duyệt chữ,
    giờ và tài khoản"), `schedule_propose`, `approval_decide`, `components/cards/ApprovalCard.tsx`.
  - Chi phí: M.
  - Kiểm: pgTAP (duyệt một bài thì slot `waiting`, không có thẻ `schedule`; đổi giờ trên thẻ thì hash mới) và e2e
    `ui-v2-writer`.
- **Gom thẻ theo ngày trên Dashboard**, mỗi thẻ vẫn bấm riêng.
  - Chỉ sửa UI ở `components/dashboard/**`. Chi phí: S.
  - Không làm "duyệt tất cả": theo các nguồn ở mục 3, đó là đường tắt để duyệt cho có.
- **Đo duyệt cho có.**
  - Thêm vào review tuần (`review-week.ts`): thời gian từ lúc thẻ hiện tới lúc quyết, và tỉ lệ duyệt nguyên văn.
  - Nếu cả hai cao bất thường thì thẻ quá nhiều hoặc quá dễ: giảm số bài một tuần.
  - Chi phí: S.

## Khuyến nghị

1. **Làm "thẻ bài kèm giờ" trước** (M). Mỗi tuần bớt khoảng 5–8 thẻ, tức gần một nửa. Giữ nguyên luật "assist,
   never act": founder vẫn thấy đủ chữ, giờ và tài khoản trong một quyết định. Đây là cải thiện retention: ít việc vặt
   mỗi sáng. Đây là ý kiến của mình, chưa đo. Thuộc plan C4, chủ quyết trước khi làm.
2. **Gom theo ngày trên Dashboard** (S), sau mục 1.
3. **Không làm** duyệt hàng loạt và không tự duyệt bài "tin cậy": rủi ro duyệt cho có, và Creem với nền tảng mạng xã
   hội đều coi đăng thay người dùng là rủi ro.
4. **Đo trước, chỉnh sau** (S): thêm độ trễ duyệt và tỉ lệ duyệt nguyên văn vào review tuần.

## Nguồn

Đọc ngày 2026-11-09.
- Buffer, Managing and approving draft posts: https://support.buffer.com/en-us/articles/managing-and-approving-draft-posts-57li7M8tDA
- Buffer, Saving and scheduling draft posts: https://support.buffer.com/en-us/articles/saving-and-scheduling-draft-posts-CBLXg1yFXp
- Buffer, Collaborate: https://buffer.com/collaborate
- Typefully skill (API): https://lobehub.com/skills/openclaw-skills-typefully
- Zapier, weekly posts with Typefully: https://zapier.com/templates/details/9b7344dc49dd3d70bb6fbf841b50de098c2117331cee0dd12966dd27672b60ac
- Pipedream, Typefully on a schedule: https://pipedream.com/integrations/create-draft-with-typefully-api-on-daily-schedule-from-schedule-api-int_qjs7q5KB
- Gravitee, Human-in-the-loop tasks: https://www.gravitee.io/corpus/gen-1813/task-manager/human-in-the-loop-tasks.html
- BMC, Human approval gates design: https://www.bmc.com/it-solutions/agentic-orchestration/human-approval-gates-design.html
- Waxell, AI agent approval workflows: https://waxell.ai/blog/ai-agent-approval-workflows
- tianpan.co, Approval fatigue: https://tianpan.co/blog/2026/06/25/approval-fatigue-how-human-in-the-loop-gates-decay-into-rubber-stamps
- Kunal Ganglani, HITL tool approval patterns: https://www.kunalganglani.com/blog/tool-approval-patterns-ai-agents
- Code nội bộ: `schedule_propose`, `approval_raise`, `approval_snapshot_base` (`supabase/schema/current.sql`), `docs/architecture/workflow.md` §3.
