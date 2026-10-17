# Ảnh bìa & thumbnail truyện (PR #49, migration 035)

**Vấn đề:** thẻ truyện ở Thư viện / Trang chủ chỉ hiện biểu tượng chủ đề, dù 40 truyện thư viện đã có ảnh bìa; quản trị không có chỗ chỉnh.

## Hiển thị (client, `src/lib/story-thumb.ts`, `StoryThumb`)
Thứ tự: thumbnail đã dựng (WebP 3:2 trong bucket `illustrations`) → tranh khung cảnh dựng sẵn (`/scenes/v1/thumbs/<id>.webp`, 480×320) → ảnh bìa gốc → biểu tượng chủ đề. Ảnh `loading="lazy"`, khung cố định (không nhảy bố cục), lỗi tải thì thử ảnh kế tiếp.
Dùng ở: Thư viện, Trang chủ (Nghe tiếp, Dành cho bé), Yêu thích, Bộ sưu tập, Quản trị (Truyện, Tổng quan).

## Dựng thumbnail (server, `src/lib/story-thumbnails.ts`, sharp)
- Nguồn: ảnh bìa → tranh trang 1 → (cài đặt) khung cảnh trang 1 hoặc biểu tượng. Chỉ đọc object trong bucket của mình theo path — không tải URL bất kỳ.
- File: `<người tạo>/<truyện>/thumb-<16 hex ngẫu nhiên>.webp`; cột `thumbnail_path` có CHECK đúng thư mục truyện.
- Khi nào: truyện mới (khung cảnh trang 1); vẽ trang 1 → bìa mới (dựng từ cùng ảnh, lưu cùng câu lệnh); gia đình mở Thư viện mà truyện của mình chưa có (`POST /api/story/thumbnails`, ≤12/lần, 1 lần/truyện/phiên); quản trị.
- Đổi ảnh bìa mà không kèm thumbnail → trigger đặt lại "cần dựng" (không để ảnh cũ).

## Quản trị
- **Cài đặt hệ thống → Ảnh bìa & thumbnail:** tự tạo (bật/tắt), khi chưa có tranh (khung cảnh/biểu tượng), kích thước 360/480/640, chất lượng WebP 60–90; độ phủ (truyện nền tảng theo nguồn; truyện gia đình chỉ tổng số); "Tạo thumbnail còn thiếu", "Tạo lại tất cả…" (cần lý do).
- **Quản lý truyện → nút Ảnh bìa (truyện nền tảng):** chọn tranh trang, khung cảnh, tải ảnh (JPG/PNG/WebP ≤5 MB → WebP ≤1200×800), tự động, chỉ biểu tượng; lý do tuỳ chọn.
- Ghi qua RPC `admin_set_story_thumbnails` (quyền `stories.write`, chỉ truyện nền tảng, so khớp path cũ, ghi nhật ký `audit_stories` kèm lý do). Truyện gia đình là riêng tư: quản trị không đổi.
