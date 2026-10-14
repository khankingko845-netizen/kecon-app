# Font tự host (Nunito · Baloo 2 · Be Vietnam Pro)

Từ PR #60 app **không còn tải font từ Google Fonts** — kể cả lúc build. Trước đó `next/font/google`
tải CSS + file font từ `fonts.googleapis.com` mỗi lần `next build`; khi Google trả lỗi/giới hạn,
build CI đỏ với `Cannot read properties of null (reading '1')` và phải chạy lại (PR #48, #57, #58…).

## Gồm những gì

| File | Vai trò |
| --- | --- |
| `public/fonts/*.woff2` (21 file, 424 KB) | Đúng các file `next/font/google` đã tải (cùng subset `cyrillic-ext/cyrillic/vietnamese/latin-ext/latin`, `devanagari` của Baloo 2). Tên có 8 ký tự đầu SHA-256 của nội dung. |
| `public/fonts/OFL-*.txt` | Giấy phép SIL Open Font License 1.1 của từng họ font (bắt buộc đi kèm khi phân phối). |
| `src/app/fonts.css` | 52 `@font-face` chép nguyên thứ tự + `unicode-range` + font dự phòng đã chỉnh số đo (Arial) như next/font sinh ra, và biến `--font-nunito`, `--font-baloo`, `--font-be-vietnam` ở `:root`. |
| `src/app/layout.tsx` | `<link rel="preload">` 4 file màn bé vẽ trước (Nunito + Baloo 2, latin + vietnamese) — giống next/font. Be Vietnam Pro (chỉ màn bố mẹ/quản trị) không preload (UI-12). |
| `next.config.ts` | `/fonts/*` → `Cache-Control: public, max-age=31536000, immutable` (an toàn vì tên file đổi khi nội dung đổi). |
| `public/sw.js` | `/fonts/*.woff2` cache-first như `/_next/static/`. |

Kiểm chứng khi chuyển: ảnh chụp 360×640 của màn giới thiệu, Trang chủ, player, màn bố mẹ **trùng từng điểm ảnh**
với bản cũ; cùng danh sách font được tải; 24 → 24 request font, 0 request tới Google.

## Đổi font / thêm độ đậm

1. Tải CSS từ Google Fonts (CSS2 API, User-Agent trình duyệt hiện đại để nhận woff2) cho họ + độ đậm cần.
2. Tải từng file `src: url(...)`, đặt tên `<họ>-<subset>[-<độ đậm>].<sha256 8 ký tự>.woff2` vào `public/fonts/`.
3. Thêm `@font-face` tương ứng vào `src/app/fonts.css` — **giữ thứ tự** (khi `unicode-range` chồng nhau, quy tắc khai báo sau thắng).
4. Nếu là file màn bé cần sớm, thêm vào `PRELOADED_FONTS` trong `layout.tsx`.
5. `tests/unit/self-hosted-fonts.test.ts` kiểm tra: không ai import `next/font/google`, mọi file tồn tại + đúng WOFF2 + hash khớp tên,
   không có file thừa, đủ độ đậm + subset tiếng Việt, preload trỏ đúng file. `tests/e2e/self-hosted-fonts.spec.ts` kiểm tra HTML có preload,
   header cache 1 năm, trình duyệt thực sự dùng Nunito/Baloo 2 cho chữ có dấu và không gọi Google.
