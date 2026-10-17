# Kho truyện nền tảng v2 — 18 truyện cổ tích, dân gian, ngụ ngôn (T18 đợt 2)

Gói `content/library/v2/*.json`, cùng chuẩn biên tập và công cụ với v1 (`docs/library-v1.md`): kể lại bằng lời mới, ghi `origin` + `adaptation`,
làm mềm chi tiết đáng sợ, không chép sách giáo khoa hay bản in có tác giả. Kiểm tra tự động: `tests/unit/library-pack.test.ts`
(mỗi truyện qua bộ kiểm tra biên tập + cổng chất lượng của trình tạo truyện; slug/tên không trùng giữa v1–v3).

Phân bố: 5 Cổ tích · 5 Động vật · 4 Dân gian · 3 Học chơi · 1 Phiêu lưu. Nhóm 3-5 *vừa* (8 trang × 55–75 chữ, đọc chậm) cho truyện ngụ ngôn/con vật;
nhóm 6-8 *ngắn* (8 trang × 60–80 chữ) cho truyện cổ tích dài hơn (Tấm Cám, Thạch Sanh, Sọ Dừa, Con Rồng cháu Tiên…).

## 18 truyện

| Truyện | Slug | Tab | Nhóm | Điều chỉnh chính (xem đủ trong JSON) |
|---|---|---|---|---|
| Bịt mắt xem voi | `bit-mat-xem-voi` | Học chơi | 3-5 · 8 trang | Thay năm ông thầy bói khiếm thị bằng các bạn nhỏ chơi trò bịt mắt, tránh trêu chọc người khuyết tật. |
| Cóc kiện Trời | `coc-kien-troi` | Dân gian | 6-8 · 8 trang | Gà và Chó nhà Trời chỉ bị đuổi chạy, không bị hại; Thiên Lôi bị ong và cua làm cho chạy mất theo lối hài hước. |
| Con Rồng cháu Tiên | `con-rong-chau-tien` | Dân gian | 6-8 · 8 trang | Lược bỏ các trận đánh yêu quái (Ngư Tinh, Hồ Tinh, Mộc Tinh) cho phù hợp lứa tuổi. |
| Đeo nhạc cho mèo | `dao-nhac-cho-meo` | Động vật | 3-5 · 8 trang | Không có cảnh mèo bắt chuột; Mèo Mướp chỉ đi tuần canh bếp. |
| Ếch ngồi đáy giếng | `ech-ngoi-day-gieng` | Động vật | 3-5 · 8 trang | Bản gốc: ếch nghênh ngang bị trâu giẫm bẹp. Bản này: Chim Sáo nhắc, Ếch kịp tránh, xin lỗi Bác Trâu và học cách khiêm tốn. |
| Nàng tiên Ốc | `nang-tien-oc` | Cổ tích | 3-5 · 8 trang | Bà lão cất vỏ ốc vào hộp làm kỷ niệm thay vì đập vỡ vỏ ốc. |
| Ông Táo về trời | `ong-tao-ve-troi` | Học chơi | 6-8 · 8 trang | Không kể truyền thuyết 'hai ông một bà' (chuyện vợ chồng tái hợp và cái chết của ba người) vì không hợp lứa tuổi. |
| Quạ và Công | `qua-va-cong` | Động vật | 3-5 · 8 trang | Quạ không bị chê cười; cuối truyện Quạ tự nhận lỗi nóng vội và vẫn là bạn của Công. |
| Rùa và Thỏ | `rua-va-tho` | Động vật | 3-5 · 8 trang | Thêm nhân vật Bác Cú làm trọng tài và đoạn kết hai bạn đi dạo cùng nhau. |
| Sọ Dừa | `so-dua` | Cổ tích | 6-8 · 8 trang | Thay bản 'Sọ Dừa' 5 trang cũ trong thư viện bằng bản biên tập mới, đủ lời thoại cho từng nhân vật. |
| Sự tích cây vú sữa | `su-tich-cay-vu-sua` | Cổ tích | 3-5 · 8 trang | Người mẹ không hoá thành cây: mẹ trồng cây vú sữa rồi đi tìm con, cuối truyện mẹ trở về. |
| Sự tích hạt lúa | `su-tich-hat-lua` | Học chơi | 3-5 · 8 trang | Thêm nhân vật Bé Cốm và phần học về các bước trồng lúa: cày, bừa, gieo mạ, cấy, gặt, phơi, xay giã. |
| Sự tích hồ Ba Bể | `su-tich-ho-ba-be` | Dân gian | 6-8 · 8 trang | Không có người thiệt mạng: hai mẹ con dùng thuyền vỏ trấu cứu cả làng, dân làng biết lỗi. |
| Sự tích hoa cúc trắng | `su-tich-hoa-cuc-trang` | Cổ tích | 3-5 · 8 trang | Không nói đến cái chết: mỗi cánh hoa là một năm mẹ khoẻ mạnh; cuối truyện mẹ khỏi ốm. |
| Sư Tử và Chuột Nhắt | `su-tu-va-chuot-nhat` | Động vật | 3-5 · 8 trang | Không có thợ săn: Sư Tử vướng vào một tấm lưới cũ bị bỏ quên trong rừng. |
| Tấm Cám | `tam-cam` | Cổ tích | 6-8 · 8 trang | Chỉ kể phần đầu đến khi Tấm thành hoàng hậu; bỏ phần sau (Tấm bị hại, hoá thân và kết cục trả thù). |
| Thạch Sanh | `thach-sanh` | Phiêu lưu | 6-8 · 8 trang | Chằn tinh và đại bàng bị đánh bại rồi bỏ chạy; Thạch Sanh lần theo lông vũ rơi thay cho dấu vết trong bản gốc. |
| Thần Trụ Trời | `than-tru-troi` | Dân gian | 6-8 · 8 trang | Thêm Chim Én và Ông Mặt Trời có lời thoại để câu chuyện sinh động cho trẻ. |

## Ứng viên bị loại (và lý do)

- **Sự tích cây nêu** — cốt truyện xoay quanh quỷ, đuổi quỷ; khó làm nhẹ mà không mất ý nghĩa.
- **Chử Đồng Tử – Tiên Dung** — chi tiết tắm truồng/khoả thân và cái chết của người cha là trung tâm câu chuyện.
- **Sự tích con khỉ** — nhiều dị bản mâu thuẫn, có chi tiết bạc đãi/hành hạ người ở.
- **Sự tích trầu cau** — tình tay ba và cái chết của cả ba nhân vật, không hợp 3–8 tuổi.
→ Thay bằng *Nàng tiên Ốc*, *Sự tích hoa cúc trắng*, *Sư tử và chuột nhắt*, *Thần Trụ Trời*.

## Sọ Dừa thay bản mẫu cũ (`replaces`)

Staging đã có truyện nền tảng *Sọ Dừa* 5 trang (`source='template'`, không có thẻ `kc-lib:`). Bản v2 8 trang khai báo
`"replaces": {"title": "Sọ Dừa", "reason": "…"}`. Khi nhập, ngay sau khi chèn truyện mới, SQL chuyển vào thùng rác (`deleted_at`) **đúng**
dòng nền tảng cùng tên, *không* mang thẻ `kc-lib:`, và chỉ khi truyện mới có thẻ `kc-lib:so-dua` đã tồn tại; ghi `audit_write('story.trash', …)`
với `after.replaced_by = 'so-dua'`. Chạy lại = không đổi gì. `--rollback` trash các truyện của gói **và khôi phục** dòng đã bị thay
(tìm theo nhật ký `replaced_by`, ghi `story.restore`). Bảng `story_templates` (mẫu tạo truyện) không bị đụng tới.

## Giọng nhân vật (8 giọng tiếng Việt)

Chỉ có **một giọng bé trai (Bin)** và **một giọng bé gái (Yuna)**, nên mỗi truyện chỉ để tối đa một bé trai và một bé gái có lời.
Khi soạn v2 đã sửa theo kiểm tra phân vai: *Bịt mắt xem voi* đổi bạn trai thứ hai (Bờm) thành **chị Mơ** — chị lớn của Tí (giọng Kim);
*Chằn Tinh* (Thạch Sanh) dùng `voiceType: "man"` (giọng Quang trầm, không cùng trang với Thạch Sanh) thay vì nhận giọng bé gái;
*Cây Vú Sữa* dùng `voiceType: "grandma"` (giọng bà Hiền, lời “cháu ơi… ta”). Test khẳng định: mọi vai trẻ em nhận giọng trẻ em,
vai người lớn/cao tuổi không bao giờ nhận giọng trẻ em, vai bà → Hiền. Còn lại: con vật nhỏ (Ong, Mèo Mướp) đọc bằng giọng Yuna.

## Nhập / gỡ / audio

```bash
node --import ./scripts/ts-paths.mjs scripts/library-import.ts --pack v2 --owner <uuid super_admin> --voices voices.json > import-v2.sql
node --import ./scripts/ts-paths.mjs scripts/library-import.ts --pack v2 --rollback > rollback-v2.sql
KC_SITE_URL=… KC_SUPABASE_URL=… KC_SUPABASE_ANON_KEY=… KC_SESSION_FILE=staff-session.json \
  node --import ./scripts/ts-paths.mjs scripts/library-prerender.ts --pack v2 --dry-run   # bỏ --dry-run để dựng
```

- **Staging:** đã nhập 18 truyện (audit 230–248, gồm 1 dòng trash Sọ Dừa cũ); nhập lại = không đổi gì.
- **Audio đã dựng trên staging:** 18 truyện / 144 trang, **43.839 ký tự TTS**, 535 lượt gọi (eleven_flash_v2_5, người kể Viên), ~60,5 phút.
  Trình phát chỉ phát file đã lưu, không gọi TTS khi trẻ nghe.
- **Tranh đã vẽ trên staging:** 144/144 trang + ảnh bìa (phong cách `clay`, xem "Tranh minh hoạ" trong `docs/library-v1.md`).

## Chưa làm

1. Người duyệt (biên tập + giáo viên mầm non) đọc 18 bản kể, đặc biệt Tấm Cám, Thạch Sanh (bản nhẹ), trước khi lên production.
2. ~~Dựng audio v2~~ — đã dựng; còn cần người nghe thử các vai Bin/Hiền/Kim.
3. Duyệt tranh từng trang (đã sửa: Cóc kiện Trời, Thạch Sanh vẽ lại kiểu cung đình Việt; còn: Cóc kiện Trời tr.2 có người tí hon lạ,
   Bó đũa tuổi các con chưa đều, Bịt mắt xem voi mũ người quản tượng thay đổi).
