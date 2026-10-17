# G-08 · Quản trị nhiệm vụ & thẻ nhân vật (Bầu trời của Đóm)

Màn **Quản trị › Nhiệm vụ** (`/admin/missions`, quyền `templates.manage` + phiên quản trị A-05) cho nhân sự sửa câu chữ mẫu nhiệm vụ và tạm dừng thẻ nhân vật. Migration `039_missions_admin.sql` (chỉ thêm).

## Sửa được gì

| Loại | Sửa được | Ghi chú |
| --- | --- | --- |
| Hằng ngày (`base`) | — | Luôn bật; câu chữ nằm trong ứng dụng (`src/lib/missions.ts`). |
| Chủ đề trong app (`themed`) | Bật/tắt | Tắt thì rời vòng xoay chủ đề ngay (có thể đổi nhiệm vụ chủ đề của hôm nay). |
| Thói quen tốt (`habit`), Việc tốt (`kindness`) | Tên, câu bố mẹ xác nhận, lời Đóm khen, câu hỏi trò chuyện, bật/tắt | Truyện gắn kèm (`story_tag`) không đổi ở đây. |
| Cả nhà (`family`) | Tên, câu bố mẹ xác nhận, lời khen, số truyện/tuần (1–7) | Luôn bật (tắt sẽ làm hỏng “đọc cùng nhau”). |

Luật câu chữ (DB là nơi quyết định, giao diện báo trước khi gửi):

- Độ dài theo CHECK của migration 036: tên 2–60, câu bố mẹ 2–120, lời khen 2–160, câu hỏi 2–200 ký tự.
- Không dùng “giỏi, thông minh, xuất sắc, thiên tài, liền, liên tục, liên tiếp, thua, phạt” (CHECK `mission_templates_process_praise`).
- Việc tốt chỉ được **cảm ơn bằng lời**: lời khen phải bắt đầu bằng “Cảm ơn” (luật 9).

## Thẻ nhân vật

Bé nghe hết một truyện thư viện (`kc-lib:*`) lần đầu thì nhận 1 thẻ. **Tạm dừng** chỉ ngừng tặng thẻ mới (trigger `reward_ledger_sticker_paused` bỏ qua dòng thẻ, `missions_complete_listen` không đổi); thẻ đã có **không bị lấy lại** (luật 3). Sao và nhiệm vụ vẫn tính bình thường.

## An toàn thay đổi

- RPC `admin_update_mission_template(id, expected_version, patch, reason)` và `admin_set_mission_sticker(story, enabled, expected, reason)`: `has_permission('templates.manage')` (gồm kiểm tra phiên quản trị/MFA), lý do 10–500 ký tự (`admin_action_reason`), khoá lạc quan (sai phiên bản → `40001`, giao diện tải lại và giữ bản đang gõ).
- Mỗi thay đổi thật ghi **đúng 1 dòng nhật ký** qua trigger (`mission_template.update`, `mission_sticker.update`) kèm trước/sau + lý do; lưu lại giá trị cũ không ghi gì.
- Client không ghi thẳng bảng (không có GRANT); `mission_sticker_settings` bật RLS, không cấp quyền cho anon/authenticated.
- `admin_missions_catalog()` chỉ trả số tổng (lần xong 28 ngày, số thẻ đã tặng), không có gia đình/bé.

## Kiểm thử

- DB: `tests/db/missions-admin.test.ts` (quyền, lý do, phiên bản, trường theo loại, từ cấm/độ dài/cảm ơn, đúng 1 audit, tạm dừng thẻ không lấy lại thẻ cũ, nhiệm vụ chủ đề tắt rời vòng xoay). Đỏ khi bỏ trigger.
- Unit: `tests/unit/missions-admin.test.ts` (luật client khớp migration 036/039, patch chỉ gồm trường đổi, thông báo lỗi).
- E2E: `tests/e2e/admin-missions.spec.ts` (chặn trước khi gửi và đưa con trỏ tới lỗi đầu tiên, lưu có phiên bản mới, huỷ không gửi, vùng bấm ≥ 44 px, không cuộn ngang 360/390/1280, axe AA, gia đình 404) + `admin-kit-visual` + `admin.spec` (biên tập thấy mục Nhiệm vụ).
- Tràn ngang đo bằng `scrollWidth ≤ documentElement.clientWidth`: khi giả lập điện thoại `innerWidth` phình theo nội dung nên không dùng được.

## Giới hạn

- Câu chữ nhiệm vụ hằng ngày/chủ đề vẫn nằm trong ứng dụng; chưa thêm/xoá mẫu, chưa đổi truyện gắn kèm, chưa chọn ảnh thẻ riêng (thẻ dùng ảnh truyện).
- Đổi câu chữ áp dụng ngay cho cả lịch sử hiển thị (không lưu bản cũ cho từng lần xác nhận); bản cũ nằm trong nhật ký.
- Theo tài khoản cho tới T10.
