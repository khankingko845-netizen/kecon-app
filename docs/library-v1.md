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

**Cập nhật đợt 2 (T18):** đã thêm 3 giọng trong `default_voices` (sort 6–8): **Bin — bé trai lém lỉnh**, **Hiền — bà hiền hậu**,
**Kim — chị gái dịu dàng**. `castVoices` có thêm luật: vai `woman` có mô tả “công chúa / nàng / cô gái / tiên nữ…” ưu tiên giọng nữ trẻ
(Kim), vai mẹ/bà tiên ưu tiên giọng ấm (Tâm); giọng trẻ em không bao giờ đọc vai người lớn. Kết quả trên 12 truyện v1:
Tích Chu, Gióng, Em Bé → Bin; Bà → Hiền; Mị Nương, Chị Hai → Kim. Truyện đã nhập được gán lại bằng `--recast` (bên dưới).

Giới hạn còn lại: chỉ **một** giọng bé trai và **một** giọng bé gái → mỗi truyện chỉ nên có tối đa một bé trai và một bé gái có lời
(xem `docs/library-v2.md`); Thanh (ông) đôi khi đọc vai nam thứ hai trẻ hơn (Thủy Tinh, Lý Thông). Bin là giọng thư viện gốc tiếng Hindi
(“heavy kid cartoon”), Hiền là giọng thiết kế bằng AI — đều đã thử tiếng Việt bằng STT nhưng **cần người nghe duyệt**.

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

```bash
# Sau khi thêm/đổi giọng mặc định: gán lại giọng nhân vật cho truyện đã nhập (chỉ đổi vai có giọng khác, audit 'story.update')
node --import ./scripts/ts-paths.mjs scripts/library-import.ts --pack v1 --recast --voices voices.json > recast.sql

# Dựng sẵn audio (nhân sự có stories.write + phiên MFA admin; TTS qua /api/voice/tts như trình phát; cần ffmpeg)
KC_SITE_URL=… KC_SUPABASE_URL=… KC_SUPABASE_ANON_KEY=… KC_SESSION_FILE=staff-session.json \
  node --import ./scripts/ts-paths.mjs scripts/library-prerender.ts --pack v1 [--slug tich-chu] [--dry-run] [--max-chars 30000]
```

- `src/lib/library-audio.ts` tính đúng các đoạn đọc và `audio_key` như `StoryPlayer` (người kể mặc định, giọng nhân vật, tốc độ, model),
  nên trang đã có file khớp khoá sẽ được phát lại thay vì gọi TTS. Đổi giọng nhân vật → khoá đổi → trang được dựng lại ở lần chạy sau.
- **Đã dựng trên staging:** 12 truyện / 96 trang, **27.393 ký tự TTS** (282 lượt gọi, ~37 phút audio). Kiểm tra trình duyệt: phát *Tích Chu*
  không có POST TTS nào, chỉ tải file đã lưu.

### Phát âm tiếng Việt: dùng Eleven v3

- Phụ huynh báo *Chiếc bình hoa của bà* đọc "Bo" thành "Bồ/Bố". Chuyển audio đã dựng (Flash v2.5) qua speech-to-text (scribe_v1, vi)
  và so với chữ gốc: 36 chỗ lệch trong 8 trang, chủ yếu thanh điệu — "Bo" → "Bố/Bồ" ở hầu hết các lần, "dặn" → "dần", "vỡ" → "vợ",
  "chợ" → "trở", "cắm tạm" → "cầm tấm".
- Cùng một đoạn, cùng giọng Viên: Flash v2.5 (kể cả stability 0,85) và Turbo v2.5 đều sai "Bo/dặn/chợ/cắm tạm"; **Eleven v3** khớp
  từng chữ (giọng Tâm cũng vậy). 8 giọng tiếng Việt đang dùng đều đọc đúng trên v3 (chỉ lệch "bà/mà", "nhé/nha" ở mức nhận dạng).
- Vì vậy `modelForLanguage` chuyển tiếng Việt sang `eleven_v3` khi model trong Cài đặt không hỗ trợ tiếng Việt (Flash/Turbo v2.5 chọn
  tường minh vẫn được giữ). v3 tốn gấp đôi credit/ký tự so với Flash và chậm hơn một chút (câu ngắn ~0,8 s qua `/stream`).
- `audio_key` có model nên toàn bộ audio thư viện cũ (Flash) tự thành "cần dựng lại": chạy lại `library-prerender.ts --pack v1|v2|v3`.

## Tranh minh hoạ (vẽ một lần cho mọi gia đình)

- Mỗi truyện trong gói có `art: { style, setting }` (phong cách nhà `clay` + một câu bối cảnh **tiếng Anh**: thời đại, vùng miền,
  trang phục, nhà cửa) và mỗi nhân vật có `look` (ngoại hình tiếng Anh, giữ nguyên giữa các trang; nhân vật lặp lại ở v3 dùng đúng một mô tả).
  `appearance` tiếng Việt vẫn giữ làm ghi chú biên tập. Kiểm tra gói báo lỗi nếu thiếu `look` hoặc `look`/`setting` có chữ tiếng Việt.
- Khi nhập: `stories.illustration_style = art.style`, `story_pages.illustration_prompt = "Setting: <setting> Scene: <sceneDescription>"`
  (hoặc `illustration` tiếng Anh nếu trang có), `story_characters.appearance = look`. Truyện đã nhập: đồng bộ bằng `--art`.
- Vẽ qua `/api/story/illustrate-batch` (cùng nhà cung cấp/model/chất lượng trong Cài đặt → AI, chặn hạn mức, sổ chi phí, nhật ký staff);
  file nằm dưới thư mục của chủ truyện (hồ sơ super_admin), trang 1 thành ảnh bìa. Truyện thư viện là `source='manual'` nên trình phát
  **không** tự vẽ khi trẻ đọc — chỉ hiện tranh đã vẽ sẵn, chưa có thì dùng tranh cảnh có sẵn.

```bash
# 1. Đồng bộ chỉ dẫn tranh cho truyện đã nhập (chỉ đổi dòng khác, audit 'story.update'; không chạm chữ/audio/tranh)
node --import ./scripts/ts-paths.mjs scripts/library-import.ts --pack v1 --art > art-v1.sql
psql -U postgres -v ON_ERROR_STOP=1 < art-v1.sql

# 2. Vẽ các trang chưa có tranh (nhân sự có stories.write + phiên MFA admin); chạy lại chỉ vẽ trang còn thiếu
KC_SITE_URL=… KC_SUPABASE_URL=… KC_SUPABASE_ANON_KEY=… KC_SESSION_FILE=staff-session.json \
  node --import ./scripts/ts-paths.mjs scripts/library-illustrate.ts --pack v1 [--slug tich-chu] [--dry-run] [--max-images 120]
# Vẽ lại vài trang chưa đạt sau khi duyệt:
  … scripts/library-illustrate.ts --pack v1 --slug tich-chu --redraw 3,5
```

### Kết quả trên staging

- **40 truyện / 320 trang đều có tranh** + ảnh bìa = tranh trang 1; 0 trang lỗi. File dưới `illustrations/<chủ truyện>/<story>/`.
- Sổ chi phí: **337 lượt vẽ thành công** (6 thử + 316 chính + 15 vẽ lại), custom gateway / `gpt-image-1-mini` chất lượng low, 1536×1024,
  ~60–90 giây/truyện (8 trang, mẻ 4, chạy 2 truyện song song). Bảng giá chưa cài nên `estimated_usd` để trống; theo giá công bố
  của OpenAI (~$0,005–0,006/ảnh low) ước ~$2 — cần đối chiếu hoá đơn thật.
- Vẽ lại sau khi duyệt: Ăn khế trả vàng tr.1–4, Cóc kiện Trời tr.1,2,5,8 (cung điện mái vòm → mái đình chùa), Thạch Sanh tr.1–5,8
  (bối cảnh "Vietnamese palace, no domes", chằn tinh bớt đáng sợ), Sự tích Hồ Gươm tr.5 (cờ hiện đại → thêm "no modern flags or symbols").
  Vua đội vương miện kiểu châu Âu → Vua Hùng đội mũ lông chim Đông Sơn, vua thời sau đội mũ cánh chuồn vàng đen, áo long bào
  (Sơn Tinh – Thủy Tinh, Sự tích dưa hấu, Bánh chưng bánh giầy, Em bé thông minh, Tấm Cám); dưa hấu thêm "no written words" vì chữ AI vẽ sai.
  Vẽ lại trang 1 thì ảnh bìa đi theo nếu bìa đang là tranh trang 1 cũ (bìa tự chọn được giữ).
- Còn cần người duyệt: Thánh Gióng tr.7–8 vẽ Gióng còn bé trên lưng ngựa (nên là tráng sĩ), Cóc kiện Trời tr.2 có người tí hon lạ,
  Bó đũa tuổi các con chưa đều, Bịt mắt xem voi mũ người quản tượng thay đổi; khoảng một nửa số truyện mới được xem qua bảng ghép.

## Chưa làm / bước tiếp theo

1. **Duyệt bởi người**: bản kể do AI soạn và tự kiểm tra; cần biên tập viên + giáo viên mầm non/phụ huynh đọc duyệt (cả nghe thử 3 giọng mới) trước khi lên production.
2. ~~Âm thanh dựng sẵn~~ — đã làm (xem trên).
3. ~~Tranh riêng~~ — có quy trình vẽ tranh AI cho truyện nền tảng (xem "Tranh minh hoạ"); tranh AI vẫn cần người duyệt từng trang.
4. ~~Đợt 2~~ — đã soạn 18 truyện (`docs/library-v2.md`) và bộ 10 truyện thói quen tốt (`docs/library-v3.md`).
