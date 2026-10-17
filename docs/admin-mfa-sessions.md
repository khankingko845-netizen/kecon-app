# A-05 · MFA và phiên quản trị

Migration `025_admin_mfa_sessions.sql`. Không lưu TOTP secret/mã xác thực trong bảng phiên hoặc audit; GoTrue quản lý enrollment/challenge/verify và rate limit.

## Chính sách

- Vai trò có quyền ghi (super_admin, admin, ops, editor, moderator) phải có JWT `aal2`, bằng chứng TOTP và yếu tố TOTP đã verified.
- support/analyst hiện chỉ đọc: không bắt buộc TOTP, nhưng vẫn có phiên quản trị và timeout.
- Phiên ràng buộc `auth.sessions.id` và user từ JWT được PostgREST xác thực. Server sở hữu `last_activity`, không nhận thời gian/user/session ID từ client.
- Mở phiên cần bằng chứng xác thực trong 5 phút gần nhất. Sau 30 phút không hoạt động hoặc bấm Khoá quản trị, token MFA cũ không tự mở lại phiên: cần TOTP mới; tài khoản chỉ đọc cần đăng nhập lại.
- Quyền RBAC không đổi; `has_permission()` và `is_admin()` cùng kiểm tra phiên. Bao phủ API dùng guard và PostgREST/RPC trực tiếp, kể cả policy admin cũ. Trigger chặn owner-policy sửa truyện nền tảng và raw-role đổi gói khi phiên bị khoá.
- Không có background heartbeat. pointerdown/keydown/wheel gia hạn có throttle; timer/visibility/focus chỉ đọc trạng thái. Khi hết phiên, màn admin được tháo khỏi UI. Reload/refresh token không gia hạn.
- Xoá/đổi trạng thái yếu tố MFA đã verified thu hồi mọi phiên quản trị, kể cả khi JWT cũ chưa hết hạn và tài khoản còn yếu tố khác.
- Không thay đổi phiên gia đình/app bé khi timeout quản trị. Đăng nhập lại là lựa chọn tường minh, không phải yêu cầu logout toàn bộ thiết bị.

## Giao diện

`/admin` hoặc URL admin hợp quyền → Xác thực quản trị. Thiết lập bằng QR/khoá thủ công → mã 6 chữ số → mở quản trị. Có chọn giữa các TOTP verified, huỷ thiết lập chưa verified, mã sai/lỗi kết nối rõ ràng, không log mã/secret. QR chỉ ở client, không qua image optimizer. Mất thiết bị phải xác minh danh tính qua người vận hành; không có bypass/recovery code tự chế.

## Deploy / khôi phục

1. Sao lưu DB trước 025; thử migration trong transaction rollback.
2. Supabase GoTrue phải bật TOTP enrollment và verification. `supabase-stack.sh` đặt hai flag có thể tái tạo; deploy kiểm tra env thật và restart `kecon-supabase` nếu cần. Restart giữ DB/volumes/khóa JWT; không dùng reset hoặc stop --no-backup. Có gián đoạn API staging ngắn khi restart.
3. Kiểm tra bằng tài khoản QA riêng: AAL1 bị chặn, enrollment/verify thật tạo AAL2, mở phiên được, idle 31 phút chặn UI/API/RLS, xác thực lại mở được. Dọn tài khoản/factor/phiên QA, không enroll/xoá yếu tố của người dùng thật.
4. Các tài khoản nhân sự thật cần tự thiết lập TOTP ở lần vào tiếp theo. Không tự đăng ký yếu tố thay họ.
5. Khôi phục mất thiết bị: người vận hành xác minh danh tính ngoài hệ thống, dùng GoTrue Admin API thu hồi yếu tố của đúng tài khoản và ghi audit qua kênh vận hành tin cậy. Tài khoản phải thiết lập lại; không hạ chính sách AAL2.
6. Rollback code đơn thuần vẫn bị RLS MFA chặn. Không tắt MFA để chữa lỗi UI; fix forward hoặc khôi phục bản sao lưu đã xác minh trong cửa sổ bảo trì được phê duyệt. Các bản sao lưu chứa dữ liệu nhạy cảm, không tải công khai.

## Kiểm thử

Test DB AAL1/AAL2, phiên giả/người khác, bằng chứng cũ, timeout, touch không hồi sinh, RLS trực tiếp, owner-policy, thu hồi yếu tố và phân quyền read-only. Test unit schema/fail-closed/API codes; E2E enrollment/mã sai/AAL2/API/idle/reverify/manual lock + axe.

Fixture `asUser` chuẩn bị phiên MFA hợp lệ chỉ cho staff để giữ test RBAC cũ. Negative security tests dùng `asRole` và claims tường minh, không qua fixture mở quyền. Mock E2E không thay thế kiểm chứng GoTrue/DB thật; không có cờ mock trong production.
