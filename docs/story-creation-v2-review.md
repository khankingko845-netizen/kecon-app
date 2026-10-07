# Rà soát & đề xuất nâng cấp Tạo truyện v2

Ngày rà soát: 06/10/2026 (America/Los_Angeles). Baseline: `aa3a27c`.
Trạng thái: **Đề xuất, chưa triển khai module v2**. Đây là review research + source code, không phải kết quả test khả dụng với trẻ hoặc benchmark model.

## Kết luận

Wizard có nền tảng tốt (Đóm, tile hình lớn, nhập giọng nói, nhóm tuổi, provider dùng chung), nhưng **chưa hoàn thành vòng tạo → an toàn → bố mẹ duyệt → nghe**. Ưu tiên tính đúng/an toàn trước minh hoạ, truyện phân nhánh hay thêm model.

Research UI đề xuất Nhân vật → Bối cảnh → Bài học → Độ dài. Code thực tế đang là Chủ đề → Nhân vật → Giọng kể/tuổi/ngôn ngữ → Tổng kết. Không nên đánh dấu UI-09 hoàn tất toàn bộ ý tưởng: đã có wizard 4 bước, nhưng bối cảnh/bài học chỉ nhập tự do và chưa có chọn độ dài.

## 1. Những phần có sẵn

- `CreateStory.tsx`: 6 chủ đề, 6 nhóm nhân vật, nhập ý tưởng bằng Web Speech API, tuổi 3–5 / 6–8 / 9–12, giọng nhà mình/giọng mặc định, tóm tắt trước tạo.
- `story-ai.ts`: prompt tiếng Việt, markup người kể/nhân vật, Zod kiểm tra hình dạng output cơ bản.
- `llm.ts` + `llm-config.ts`: adapter provider dùng chung, JSON mode, timeout 90 giây; platform dùng cấu hình admin (đã sửa ở PR #23).
- `POST /api/story/generate`: xác thực, Zod input, chặn BYO với user thường, kiểm tra rate/quota phía DB, lưu truyện/trang/nhân vật.

## 2. Khoảng trống và rủi ro đã kiểm chứng bằng code

| Ưu tiên | Phát hiện | Bằng chứng / hệ quả |
| --- | --- | --- |
| P0 | Chưa có SafetyGate input/output trong route tạo | Prompt yêu cầu phù hợp trẻ không phải bộ kiểm duyệt; cần policy tiếng Việt và lọc thông tin cá nhân |
| P0 | Truyện mới `draft` nhưng UI mở Player ngay | `CreateStory.handleGenerate` điều hướng sang player; `useKidStories` chỉ lọc thể loại/tuổi, không lọc trạng thái duyệt. Chưa đáp ứng T15 |
| P0 | Lưu nhiều bảng không atomic | Truyện → trang → nhân vật là các insert rời; lỗi trang có thể để lại truyện rỗng; lỗi nhân vật chưa được kiểm tra |
| P1 | Hạn mức tiêu thụ trước khi generate thành công | `guardUsage` gọi `consume_usage` trước LLM; route chưa có reservation/refund. Retry có thể tạo truyện/trừ lượt lặp |
| P1 | Output chưa kiểm tra số trang, độ dài câu, markup/nhân vật | Zod chỉ yêu cầu ≥1 trang, cho phép text rỗng; số trang theo tuổi mới nằm trong prompt |
| P1 | Chưa có lựa chọn bài học/bối cảnh/thời lượng rõ ràng | Giới hạn tuổi có `minutes` nhưng prompt hiện dùng pages/tone, chưa ràng buộc lượng chữ tương ứng |
| P1 | Lựa chọn giọng có thể mâu thuẫn | `effectiveVoice` tự lấy giọng gia đình đầu tiên kể cả khi chọn narrator; effect auto-select mặc định có thể điền lại narrator khi vừa chọn giọng gia đình. Cần một nguồn sự thật duy nhất |
| P1 | Đổi ngôn ngữ truyện chưa đổi language của nhận dạng | Hook speech đọc `settings.language`, không đọc `storyLocale` đang chọn |
| P1 | Progress hiện tại là timer, không phải tiến độ server | Chạm 92% rồi chờ; không có job ID, resume sau mất mạng/tải lại hay trạng thái thật |
| P2 | Chưa có dữ liệu để chọn model “hay nhất” | Không suy ra chất lượng từ một lần smoke; cần đánh giá mù nội dung tiếng Việt, latency, token/chi phí |

Không sửa các rủi ro của module tạo truyện trong PR avatar: giữ phạm vi rõ, cần ticket/test riêng.

## 3. Luồng v2 đề xuất

### Hai lối vào

**Đóm kể giúp**: chọn tình huống (“Sợ bóng tối”, “Ngày đầu đi học”, “Biết chia sẻ”) → dùng hồ sơ bé + giọng mặc định → xem brief → tạo. Mục tiêu ít thao tác, không biến tạo truyện thành điền form.

**Bé cùng sáng tác**: giữ 4 bước dễ hiểu, mỗi bước có Đóm hỏi một câu:

1. **Nhân vật**: bé hoặc bạn thú; nickname không bắt buộc, tránh thu thập tên đầy đủ.
2. **Bối cảnh**: rừng, biển, làng quê, vũ trụ; chọn tile hoặc nói ý tưởng, luôn có fallback gõ khi trình duyệt không hỗ trợ.
3. **Bài học/cảm xúc**: chia sẻ, dũng cảm, tử tế, bình tĩnh; phụ huynh có thể thêm tình huống thực tế.
4. **Xem lại & tạo**: tuổi lấy từ hồ sơ, chọn độ dài 3/5/8 phút theo tuổi, giọng ở phần tuỳ chỉnh của bố mẹ; không nhét quá nhiều lựa chọn cho bé 3–5.

Sau khi tạo: **Bản nháp cho bố mẹ** → đọc nhanh/sửa → duyệt qua cổng phụ huynh → render audio → hiện trong thư viện bé. Không phát nội dung chưa duyệt, kể cả truy cập thẳng story ID.

Mục tiêu thời lượng là ngân sách từ theo ngôn ngữ/tốc độ đọc, không đảm bảo số phút chỉ bằng số trang. Đo lại sau TTS.

## 4. Thiết kế kỹ thuật đề xuất

`StoryBrief → SafetyGate(input) → StoryForge → schema/quality checks → SafetyGate(output) → pending_review → approve → AudioRender → published`

- **StoryBrief có cấu trúc**: ageBand, locale, character, setting, lesson, durationPreset, extraIdea, narratorSelection. Giọng là union `family | default | none`, không lưu 2 lựa chọn cạnh tranh.
- **Output có schema**: trang không rỗng, số trang hợp nhóm tuổi, nhân vật nhất quán, markup hợp lệ, kết thúc nhẹ nhàng, nội dung phù hợp mục đích ru ngủ. Dùng Structured Outputs khi provider/model thực sự hỗ trợ; Custom/CometAPI cần capability test, không mặc định tương thích toàn bộ OpenAI.
- **SafetyGate**: moderation input/output + policy dành cho trẻ và tiếng Việt. Moderation tổng quát không thay thế bộ tiêu chí theo tuổi hoặc phụ huynh duyệt. Vi phạm output → viết lại tối đa 1 lần rồi từ chối; dịch vụ kiểm duyệt lỗi → giữ bản nháp riêng, không công bố.
- **Persistence**: RPC/transaction lưu story + pages + characters; idempotency key theo request, owner/household xác minh server. Không đổi RLS tenant sang household trước T08.
- **Quota**: reserve → commit thành công / release khi lỗi theo chính sách; mọi retry phải idempotent. Ghi token/chi phí và reason, không log raw prompt chứa dữ liệu bé.
- **Trạng thái**: SSE/poll theo job ID `queued/writing/checking/pending_review/rendering/ready/failed`; có resume/retry. Không gửi phần truyện chưa qua kiểm duyệt tới màn bé khi streaming.
- **Audio**: render nền sau duyệt, cache theo trang/revision/giọng; chỉnh một trang chỉ vô hiệu cache trang đó.

## 5. Ticket đề xuất (không phải lịch đã cam kết)

| Ticket | Phạm vi | Gate chấp nhận |
| --- | --- | --- |
| S-01 / T14 | SafetyGate + quality contract | Ít nhất 50 mẫu tiếng Việt sạch/vi phạm; báo riêng false negative/positive, không chỉ một tỷ lệ tổng |
| S-02 / T15 | Chờ duyệt, sửa, approve, chặn draft | Kiểm tra API/RLS và tất cả màn bé; URL trực tiếp không vượt duyệt; UI v2 dùng thống nhất nhóm tuổi đã chốt |
| S-03 | Persistence atomic + idempotency/quota | Lỗi giữa chừng không để truyện/trang mồ côi; double tap/retry không trừ thêm hoặc tạo trùng |
| S-04 | Wizard brief v2 + sửa chọn giọng/locale | 3–5/6–8/9–12; browser không có speech vẫn hoàn thành; thử 3 bé + 3 phụ huynh thật |
| S-05 / T16 | Job/resume + AudioRender | Reload/mất mạng vẫn tìm lại job; 1 trang sửa → chỉ render lại 1 trang; chuyển trang ≤300ms là mục tiêu cần đo |
| S-06 / T07 | Eval model + analytics first-party | 20 brief tiếng Việt × 3 model được admin duyệt; so mù chất lượng, p50/p95, lỗi, token/chi phí trước đổi mặc định |

Thứ tự: S-01 → S-02; S-03 triển khai song song sau khi chốt contract. S-04 dựa trên contract, S-05 theo nền AudioRender; S-06 chạy xuyên suốt. Không hứa thời gian trước khi chốt scope và nguồn lực.

## 6. Điểm research cũ cần cập nhật

- Spec G1 còn nhóm tuổi 2–3 / 4–5 / 6–8, trong khi product/UI hiện dùng 3–5 / 6–8 / 9–12. Lấy quyết định mới làm chuẩn cho v2; ghi rõ chính sách bé dưới 3.
- Spec “chế độ bé không tạo truyện” khác ý tưởng “bé cùng sáng tác”. Đề xuất phân biệt: bé chọn ý tưởng, bố mẹ xác nhận tạo/duyệt; cần chốt trước triển khai.
- UI-09 đã hoàn thành wizard về giao diện, chưa hoàn thành chọn bối cảnh/bài học/độ dài và vòng duyệt nội dung.
- Dùng thông số mascot/engagement của bên thứ ba như định hướng, không dùng làm số liệu chứng minh cho KểCon.

## Nguồn đã rà soát

- [Research UI mobile](https://app.notion.com/p/ae7dfb31d3ff4ce0a2326e3295554f14), [Spec G1](https://app.notion.com/p/7b892253ab1c49ae8ab8e3231e7767f7), [Plan G2–G6](https://app.notion.com/p/3ed4dea8214e473bbd09fa4916d0b044).
- Source baseline `aa3a27c`: `CreateStory.tsx`, `story-ai.ts`, `llm.ts`, `llm-config.ts`, `api/story/generate/route.ts`, `usage-guard.ts`, `content-filter.ts`, `parental-controls-context.tsx`, `db.ts`, `age-bands.ts`.
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs): JSON mode đảm bảo JSON hợp lệ nhưng không bảo đảm khớp schema; xử lý refusal/incomplete riêng.
- [OpenAI Moderation](https://developers.openai.com/api/docs/guides/moderation): endpoint miễn phí, flags/categories/scores là tín hiệu cho policy; không mặc định có credential/quyền moderation chỉ vì CometAPI tạo truyện được.

Chưa có: test với trẻ thật, benchmark đa model, kiểm thử SafetyGate tiếng Việt hoặc xác minh Structured Outputs/Moderation qua CometAPI. Các gate ở trên là yêu cầu đề xuất, không phải kết quả đã đạt.
