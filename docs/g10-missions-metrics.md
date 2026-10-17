# G-10 · Số liệu tuần + giới hạn an toàn cho "Bầu trời của Đóm"

Màn quản trị **Thống kê** (`/admin/analytics`, quyền `analytics.view`) có thêm
khối **"Bầu trời của Đóm · số liệu tuần"** để nhóm xem vòng lặp nhiệm vụ có
giúp các gia đình nghe đều đặn hơn không, và các giới hạn an toàn có giữ được
không.

## Nguồn

- RPC `missions_weekly_summary(p_weeks 1–12)` (migration 038), `SECURITY DEFINER`,
  chỉ trả **số tổng hợp** — không có id gia đình, bé, truyện hay thiết bị.
- API `GET /api/admin/missions-metrics?weeks=8` → `requirePermission("analytics.view")`,
  ghi nhật ký `missions_metrics.view`, `Cache-Control: private, no-store`.
- Tuần theo giờ Việt Nam (`Asia/Ho_Chi_Minh`), bắt đầu thứ Hai; tuần hiện tại
  đánh dấu "đang chạy".
- Chỉ tính tài khoản gia đình (`profiles.role = 'user'`); không tính nhân viên và
  tài khoản thử `@kecon.test`. Theo tài khoản cho tới khi có hộ gia đình (T10).

## Chỉ số

| Nhóm | Chỉ số | Cách đếm |
| --- | --- | --- |
| Vòng lặp | Gia đình nghe | Có ≥ 1 truyện được tính (nghe đủ thời gian) trong tuần |
| | Tối TB, phân bố 1–7 tối | Số ngày khác nhau có truyện được tính; **ẩn phân bố khi < 5 gia đình** (`small_sample`) |
| | Bắt đầu → nghe hết (%) | Bộ đếm theo ngày `missions_listen_daily` (xem dưới) |
| | Nhiệm vụ nghe | `child_missions` loại base/themed |
| | Thói quen (số nhà) | `child_missions` loại `habit` (bố mẹ xác nhận) |
| | Cảm ơn việc tốt | `child_missions` loại `kindness` |
| | Đọc cùng (đạt 3/3) | `family_reads` theo tuần; đạt = có chòm sao gia đình trong sổ thưởng |
| Giới hạn an toàn | Nghe quá nhanh | Bấm xong sớm hơn thời gian tối thiểu → không có sao; đếm 1 lần/phiên |
| | Hết hạn | Phiên mở quá 6 giờ |
| | Trong giờ ngủ | Truyện được tính bắt đầu trong giờ ngủ bố mẹ đặt (cài đặt **hiện tại**, giờ VN) |
| | Tối ≥ 3 truyện | Số tối của một gia đình có ≥ 3 truyện / tổng số tối có nghe |
| | Phút / tối | Ước tính từ lúc bấm nghe tới lúc nghe xong, tối đa 60 phút mỗi truyện |
| | Nhắc: gửi / lỗi / bỏ qua, tắt nhắc | `parent_notification_log`; "tắt nhắc" = đang tắt và đổi trong tuần |

## Vì sao có bảng đếm `missions_listen_daily`

Phiên nghe chưa xong bị xoá sau 7 ngày (migration 034, tối thiểu hoá dữ liệu),
nên không thể tính tỉ lệ nghe hết của tuần cũ từ `listen_sessions`. Migration 038
thêm trigger đếm **theo ngày** (không có id người dùng) lúc phiên bắt đầu / được
tính / hết hạn / quá nhanh, và cột `listen_sessions.too_fast_at` để chỉ đếm một
lần. Ngày trước 038 được hồi điền từ dữ liệu còn lại và đánh dấu `backfilled`:
bảng hiện dấu `*`, "quá nhanh" là "chưa đo".

## Chưa đo được

- Phút dùng app/ngày và ngày vượt giới hạn: đếm trên máy của bé (localStorage,
  T19), không gửi lên máy chủ; bảng `daily_usage` cũ không còn được ghi.
- Giờ ngủ dùng cài đặt hiện tại, không có lịch sử thay đổi.
