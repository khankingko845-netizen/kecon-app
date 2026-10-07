# Ảnh gia đình & ưu tiên giọng theo ngôn ngữ

## Ảnh gia đình

Bố mẹ → Hồ sơ gia đình → **Tải ảnh gia đình** → xem trước → **Lưu**. JPG/PNG/WebP tối đa 5 MiB; không nhận SVG, ảnh động, ảnh lỗi hoặc ảnh vượt 25 triệu pixel. Máy chủ đọc byte thực, xoay theo EXIF, cắt giữa thành 512×512 WebP và bỏ metadata (bao gồm vị trí). Chọn một Đóm rồi lưu để trở lại mascot.

- Bucket `family-avatars` **private**, WebP tối đa 1 MiB sau xử lý; RLS theo thư mục `auth.uid()`.
- `POST /api/profile/avatar`: xác thực, chặn cross-site, giới hạn toàn bộ stream multipart trước khi parse, trả đường dẫn ứng dụng, không trả URL công khai.
- `GET /api/profile/avatar/:id`: xác thực, chỉ đọc object của chính tài khoản, `private, no-store`, `nosniff`.
- `DELETE`: chỉ object của chính tài khoản; từ chối ảnh còn được hồ sơ tham chiếu. UI dọn upload khi lưu hồ sơ lỗi, dọn ảnh cũ sau khi đổi thành công.
- URL lưu trong `profiles.avatar_url` không hết hạn như signed URL. Dữ liệu mascot/ảnh HTTPS cũ được giữ; ảnh lỗi có fallback Đóm.
- Đây vẫn là ranh giới theo tài khoản v1; **chưa có chia sẻ ảnh cho nhiều thành viên hộ (T08)**. Dọn ảnh cũ là best-effort, chưa có job thu gom orphan định kỳ.

## Ngôn ngữ & thứ tự giọng

Admin → Cài đặt hệ thống → Giọng mặc định → **Thêm giọng** ở Tiếng Việt/English/日本語. Danh sách được tải khi mở, không bắt buộc bấm Test Kết Nối trước.

- Chuẩn hoá `Vietnamese`/`vi`/`vi-VN`, `English`/`en-US`, `Japanese`/`ja`; đọc cả `labels.language` và `verified_languages`.
- Nhận các category `cloned`, `professional`, `generated`, `premade`…; metadata thiếu không bị suy thành English. Giọng chưa có nhãn nằm trong nhóm riêng, có thể ẩn và phải kiểm tra trước khi gán.
- Voice Library lỗi/thiếu quyền được hiện thành cảnh báo, không bị nuốt và không làm mất giọng tài khoản đã đọc được.
- Metadata native/verified dùng để lọc, **không bảo đảm chất lượng tiếng Việt hoặc khả năng của mọi model**. Catalog đang lấy một tài khoản key đủ quyền từ pool, không phải hợp nhất toàn bộ tài khoản ElevenLabs.
- Thêm key hoặc thấy “21 voices” chỉ là kết nối/catalog; **không tự thêm 21 giọng vào danh sách mặc định**.
- Nút ↑/↓ sắp xếp trong từng ngôn ngữ, lưu ngay qua `PATCH /api/voice/defaults` → RPC `reorder_default_voices`. Yêu cầu `voices.manage`, danh sách đủ/không trùng/cùng ngôn ngữ, atomic và ghi audit; danh sách stale trả 409.
- Tự chọn: **clone gia đình sẵn sàng → giọng mặc định active đứng đầu đúng ngôn ngữ**. Clone dùng model đa ngôn ngữ; chưa có metadata native-language riêng cho clone gia đình.
- Lựa chọn chủ động (hoặc giọng đã nhớ của truyện) đứng trước tự chọn. Tạo truyện dùng một lựa chọn duy nhất: `voiceId` gia đình hoặc `narratorVoiceId`, không điền cả hai. Đổi ngôn ngữ tải lựa chọn tự động mới và nhận dạng giọng nói dùng locale đang chọn.
- Player giữ narrator đã chọn, picker không trộn giọng hệ thống ngôn ngữ khác. Fallback legacy của Player vẫn còn khi không có bất kỳ giọng nào; chưa thay cơ chế AudioRender/cache ở T16.

## Triển khai / kiểm thử

Migration `023_family_avatar_voice_priority.sql`; sao lưu DB trước triển khai. Giữ bucket private khi rollback, không xoá ảnh khách hàng. Có thể rollback app rồi drop riêng RPC reorder; không chuyển bucket public.

```sh
npx tsc --noEmit
npx vitest run
npx eslint src tests
CI=1 PLAYWRIGHT_CHROMIUM_PATH=$(which chromium) npx playwright test --retries=0
```

Test bao phủ giới hạn stream/format/metadata, quyền đọc ảnh theo tài khoản, dọn ảnh khi lỗi, save/reload/đổi mascot; alias/verified/category/unknown/cảnh báo catalog, rank từng locale và audit/rollback RPC; clone tự chọn/explicit narrator/Player/lọc locale.

Không triển khai SafetyGate, luồng duyệt truyện, idempotency/quota hoặc AudioRender v2 trong thay đổi này. Xem `story-creation-v2-review.md` cho phạm vi còn lại.
