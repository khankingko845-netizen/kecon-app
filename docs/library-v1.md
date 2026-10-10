# Kho truyện nền tảng v1 — 12 truyện cổ tích, dân gian Việt Nam (T18)

Gói `content/library/v1/*.json` là **bản kể lại bằng lời mới** của 12 truyện cổ tích, truyền thuyết người Việt cho trẻ 3–9 tuổi.
Mỗi tệp là một truyện đã biên tập (không sinh lại bằng AI cho từng gia đình), được kiểm tra tự động bởi
`src/lib/library-pack.ts` + `tests/unit/library-pack.test.ts`, rồi nhập vào DB dưới dạng **truyện nền tảng** (`is_platform_content`).

## Chuẩn biên tập

**Nguồn gốc & pháp lý.** Văn học dân gian thuộc loại hình được bảo hộ theo Điều 23 Luật SHTT; Nghị định 17/2023/NĐ-CP yêu cầu khi sử dụng phải
*dẫn chiếu xuất xứ* (nguồn gốc, cộng đồng/địa phương) và *giữ giá trị đích thực* của tác phẩm. Vì vậy mỗi truyện có trường bắt buộc `origin`
(nguồn gốc) và `adaptation` (những gì đã đổi so với bản dân gian, để người duyệt thấy rõ). Truyện được viết lại bằng lời riêng: **không chép văn bản
sách giáo khoa** hay bản in có tác giả; không dùng truyện mầm non hiện đại có tác giả (còn bản quyền).

**Phù hợp lứa tuổi 3–8.** Giữ cốt truyện, mô-típ và bài học, nhưng làm mềm chi tiết đáng sợ:
không chết chóc, máu me, trừng phạt ghê rợn (ví dụ người anh trong *Ăn khế trả vàng* chỉ mất túi vàng rồi biết lỗi; cảnh đánh giặc chỉ kể giặc thua chạy).
Bộ lọc `BLOCKED_PHRASES` chặn các từ như *giết, chết, máu, chém, ăn thịt, rượu…* (so khớp nguyên âm tiết, nên "ngủ" không bị nhầm).
Cha mẹ nhân vật qua đời được lược bỏ khi không cần cho cốt truyện.

**Độ dài theo nhóm tuổi** (`LENGTH_PLAN`, cùng chuẩn với trình tạo truyện):
nhóm 3-5 *vừa* = 8 trang × 55–75 chữ, đọc chậm rãi (~110 chữ/phút, ≈ 4–5 phút);
nhóm 6-8 *ngắn* = 8 trang × 60–80 chữ, đọc vừa phải (~130 chữ/phút, ≈ 4 phút). Mỗi trang được phép vượt tối đa 10 chữ; không trang nào dưới mức tối thiểu.

**Định dạng.** Mỗi dòng là `[narrator]…[/narrator]` hoặc `[character:Tên]…[/character]` (tên phải có trong `characters`, mọi nhân vật đều có lời);
lời thoại trên ít nhất một nửa số trang; văn bản NFC. Tranh: dùng tranh cảnh có sẵn (`scene`), **không dùng `castle`** (lâu đài kiểu châu Âu) —
cảnh cung vua dùng `village`/`home`. Âm nền/hiệu ứng chỉ lấy trong danh sách của app.

## 12 truyện

| # | Truyện | Mục | Tuổi | Nhóm / độ dài / nhịp | Bài học | Điều chỉnh so với bản dân gian |
|---|---|---|---|---|---|---|
| 1 | Tích Chu | Cổ tích | 3–6 | 3-5 / medium / calm | Thương yêu, quan tâm ông bà ngay khi ông bà cần mình. | Không nhắc chuyện cha mẹ Tích Chu qua đời; mở đầu bằng tình thương của bà. Giữ nguyên mô-típ bà hoá chim, bà tiên chỉ đường và nước suối tiên. |
| 2 | Chú Cuội cung trăng | Ru ngủ | 3–7 | 3-5 / medium / calm | Giữ lời dặn và giúp đỡ mọi người bằng điều mình có. | Không có cảnh Cuội làm hại hổ con; thay bằng hổ con bị ngã trầy chân. Vợ Cuội quên lời dặn, đổ nước rửa rau vào gốc cây (thay chi tiết thô trong bản gốc). Không dùng dị bản 'Cuội nói dối'. |
| 3 | Ba chiếc rìu | Cổ tích | 3–7 | 3-5 / medium / calm | Thật thà, không tham của người khác. | Kể lại bằng lời văn mới cho trẻ nhỏ, ba lần thử lặp lại để bé dễ đoán. |
| 4 | Câu chuyện bó đũa | Cổ tích | 4–7 | 3-5 / medium / calm | Anh chị em đoàn kết, nhường nhịn thì sẽ mạnh mẽ. | Người cha già nhưng khoẻ, không có chi tiết ốm nặng. Lời văn và câu đố được viết mới, không theo bản sách giáo khoa. |
| 5 | Cây tre trăm đốt | Cổ tích | 4–8 | 3-5 / medium / calm | Phải giữ lời hứa; người hiền lành, chăm chỉ sẽ được giúp đỡ. | Giữ nguyên câu thần chú dân gian 'khắc nhập, khắc xuất'. Phần phú ông bị dính vào tre kể theo hướng hài hước, không bêu riếu. |
| 6 | Ăn khế trả vàng | Cổ tích | 4–8 | 6-8 / short / normal | Sống hiền lành, biết đủ thì được hạnh phúc; tham lam sẽ mất tất cả. | Không nhắc cha mẹ qua đời; hai anh em lớn lên rồi chia nhà ở riêng. Kết thúc nhẹ nhàng: túi vàng rơi xuống biển, người anh được chim đưa về, biết lỗi và xin lỗi em (bản gốc: người anh rơi xuống biển). Giữ câu thần chú 'Ăn một quả, trả cục vàng, may túi ba gang, mang đi mà đựng'. |
| 7 | Bánh chưng bánh giầy | Dân gian | 4–8 | 6-8 / short / normal | Quý trọng hạt gạo, công sức lao động và nhớ ơn tổ tiên. | Không nhắc chuyện mẹ Lang Liêu bị vua ghẻ lạnh, qua đời sớm. Lời thần trong mộng do người kể chuyện đọc; Lang Liêu tự nghĩ ra hình bánh vuông, bánh tròn. Cảnh cung vua dùng tranh làng quê/trong nhà (chưa có tranh cung điện Việt). |
| 8 | Thánh Gióng | Dân gian | 5–9 | 6-8 / short / normal | Yêu quê hương; khi đất nước cần, mọi người cùng chung tay. | Cảnh đánh giặc ngắn, không mô tả thương vong; giặc thua và bỏ chạy. Lời kể diễn đạt lại bằng câu ngắn cho trẻ, không chép văn bản sách giáo khoa. |
| 9 | Sơn Tinh, Thủy Tinh | Dân gian | 5–9 | 6-8 / short / normal | Kiên trì, đoàn kết thì vượt qua được thiên tai. | Cuộc giao tranh kể như thiên nhiên (mưa, nước dâng, núi mọc cao), không có cảnh thương vong. Diễn đạt lại phép lạ của hai vị thần bằng lời riêng; giữ danh sách sính lễ truyền thống. Thêm kết nối hiện đại: đắp đê, trồng cây giữ đất. |
| 10 | Sự tích Hồ Gươm | Dân gian | 5–9 | 6-8 / short / normal | Biết ơn và giữ lời hứa; đoàn kết để giữ gìn đất nước. | Không mô tả cảnh chiến trận; chỉ kể nghĩa quân thắng và giặc rút về nước. Diễn đạt lại bằng lời riêng, câu ngắn cho trẻ; giữ chi tiết chữ 'Thuận Thiên', chuôi gươm trên cây đa, Rùa Vàng đòi gươm. |
| 11 | Sự tích dưa hấu | Cổ tích | 5–9 | 6-8 / short / normal | Chăm chỉ, tự lực thì ở đâu cũng sống tốt; biết nhận ra lỗi của mình. | Câu nói của An Tiêm diễn đạt cho trẻ dễ hiểu (bản gốc: 'Của biếu là của lo, của cho là của nợ'). Nhấn mạnh tinh thần tự lực và vua biết nhận lỗi; nhắc địa danh theo lời kể dân gian (Nga Sơn, Thanh Hoá). |
| 12 | Em bé thông minh | Cổ tích | 5–9 | 6-8 / short / normal | Nhanh trí, bình tĩnh và dùng sự thông minh để giúp mọi người. | Không nhắc chuyện mẹ cậu bé qua đời; không có cảnh mổ trâu. Lược bớt thử thách con chim sẻ để truyện gọn cho trẻ. Giữ bài đồng dao 'Tang tình tang… bắt con kiến càng' (văn vần dân gian). |

## Giọng đọc (tự phân vai khi nhập)

Người kể = giọng mặc định đầu bảng (Viên). Nhân vật được `castVoices` chọn từ giọng tiếng Việt đang bật (Yuna bé gái, Tâm cô, Quang chú, Thanh ông).
PR này sửa một lỗi phân vai: trước đây vai *bà* có thể nhận giọng *bé gái*; nay tuổi giọng xét theo khoảng cách trẻ em → người lớn → cao tuổi.

Giới hạn hiện tại (cần thêm giọng trong Admin → Giọng đọc, không cần sửa code):
- **Chưa có giọng bé trai**: Tích Chu, Gióng, Em Bé do giọng chú (Quang) đọc.
- **Chỉ một giọng nữ người lớn**: vai nữ thứ hai trong cùng truyện (Bà Tiên trong *Tích Chu*) nhận giọng bé gái Yuna.
- **Chỉ hai giọng nam**: truyện có 3 vai nam dùng chung giọng Thanh cho hai vai (không cùng trang).
Gợi ý bổ sung: 1 giọng bé trai, 1 giọng bà, 1 giọng nữ trẻ. Truyện đã nhập giữ giọng đã phân; đổi giọng nhân vật trong trang sửa truyện của admin.

## Nhập / gỡ

```bash
# voices.json = các dòng default_voices (language='vi', is_active) dạng JSON
node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --import ./scripts/ts-paths.mjs scripts/library-import.ts \
  --pack v1 --owner <uuid hồ sơ super_admin> --voices voices.json > import.sql
psql -U postgres -v ON_ERROR_STOP=1 < import.sql      # một transaction; chạy lại = không đổi gì

node --import ./scripts/ts-paths.mjs scripts/library-import.ts --pack v1 --rollback > rollback.sql
psql -U postgres -v ON_ERROR_STOP=1 < rollback.sql    # chuyển 12 truyện vào thùng rác (deleted_at), có nhật ký
```

- Mỗi truyện có thẻ `kc-lib:<slug>` → nhập lại bỏ qua truyện đã có (idempotent); gỡ chỉ chạm các dòng nền tảng mang thẻ này.
- Truyện nhập với `source='manual'`, `status='published'`, `is_published`, `is_platform_content`, `locale='vi'`, `cast_voices`, `auto_ambience`.
- Chạy bằng quyền chủ DB nên trigger nhật ký không tự ghi; SQL gọi `audit_write('story.create' | 'story.trash', …, 'system')` cho từng truyện.

## Chưa làm / bước tiếp theo

1. **Duyệt bởi người**: bản kể do AI soạn và tự kiểm tra; cần biên tập viên + giáo viên mầm non/phụ huynh đọc duyệt trước khi lên production.
2. **Âm thanh dựng sẵn**: hiện mỗi lần nghe gọi TTS (tốn hạn mức). Nên dựng sẵn audio cho 12 truyện (~96 trang, ~6.200 chữ) bằng tài khoản nhân sự.
3. **Tranh riêng**: đang dùng tranh cảnh có sẵn (không đặc thù từng truyện). Có thể thêm route admin vẽ tranh AI cho truyện nền tảng.
4. **Đợt 2** (ứng viên): Con Rồng cháu Tiên, Tấm Cám (bản nhẹ nhàng), Thạch Sanh (bản nhẹ), Sọ Dừa (nâng cấp bản 5 trang), Cóc kiện trời,
   Đeo nhạc cho mèo, Quạ và Công, Ếch ngồi đáy giếng, Sự tích cây vú sữa… — xem trang nghiên cứu trên Notion.
