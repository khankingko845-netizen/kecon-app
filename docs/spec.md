# 📐 Spec KểCon v1 (G1)

_Nguồn Notion: https://app.notion.com/p/7b892253ab1c49ae8ab8e3231e7767f7_

> 🧭 Trạng thái: **Bản nháp G1 — chờ duyệt**. Viết theo skill kham-pha-yeu-cau. Dựa trên README + source code nhánh mặc định và nghiên cứu bên ngoài. Các giả định được đánh dấu rõ — cần chốt trước khi sang G2.

## 0. Brief (G0)

| Anh/chị đã nói (repo/README) | Em đang giả định |
| --- | --- |
| App mobile-first kể truyện AI cho gia đình Việt, đọc bằng giọng người thân | Thị trường đầu tiên: gia đình **trong nước**; Việt kiều là giai đoạn sau |
| Stack Next.js + Supabase + ElevenLabs + nhiều LLM | Giữ nguyên stack; không viết lại từ đầu |
| Đã có rất nhiều tính năng | v1 = **MVP thu hẹp**: các tính năng ngoài vòng lõi ẩn sau feature flag, không xoá |
| Có gói cước nhưng chưa có thanh toán | Beta trên web/PWA trước (thanh toán VietQR), sau đó lên store |
| — | Bé 2–8 tuổi; người dùng tài khoản là người lớn, bé không tự đăng ký |

**Thành công nghĩa là:** gia đình dùng KểCon thành thói quen trước giờ ngủ (≥ 3 tối/tuần) và bé được nghe giọng người thân kể cả khi họ vắng nhà.

## 1. Vấn đề

- Bố mẹ đi làm về muộn, đi công tác, hoặc mệt — không phải tối nào cũng kể truyện được, nhưng không muốn giao bé cho video/YouTube.
- Ông bà ở xa muốn gần cháu nhưng ngại công nghệ.
- App truyện hiện có chỉ có giọng đọc người lạ; truyện AI chung chung thiếu văn hoá Việt và bố mẹ lo nội dung không an toàn.

## 2. Giải pháp

Mỗi tối, bé nghe một câu chuyện **bằng giọng bố/mẹ/ông/bà**, có tên bé trong truyện, kèm âm thanh nền dịu nhẹ và hẹn giờ ngủ. Nguồn truyện: kho cổ tích Việt đã biên tập hoặc truyện AI đã qua lớp an toàn và bố mẹ duyệt. Người thân ở xa góp giọng chỉ bằng một link gửi qua Zalo.

## 3. Người dùng & bối cảnh

| Vai trò | Bối cảnh | Nhu cầu chính |
| --- | --- | --- |
| **Chủ hộ** (bố/mẹ 25–40, đô thị) | Dùng điện thoại 20:00–21:30, vừa dỗ con ngủ | Mở là có truyện hay trong 1 chạm; yên tâm về nội dung |
| **Thành viên** (bố/mẹ còn lại) | Được mời vào hộ | Dùng chung thư viện, giọng, hồ sơ bé |
| **Người góp giọng** (ông bà, cô chú) | Ít dùng app, quen Zalo | Ghi âm không cần tài khoản, biết giọng mình được dùng thế nào |
| **Bé** (2–8) | Nghe, không tự thao tác nhiều | Giao diện đơn giản, không thoát ra ngoài được |
| **Biên tập viên / Admin** | Nội bộ | Biên tập kho cổ tích, xử lý báo cáo nội dung, cấp gói thủ công |

## 4. Phạm vi v1

| Trong v1 (bật) | Có sẵn nhưng ẩn sau flag | Chưa làm |
| --- | --- | --- |
| Hộ gia đình, hồ sơ bé, mời thành viên | Gamification, thử thách, huy hiệu | Marketplace, truyện cộng tác |
| Ghi giọng + đồng ý + link ghi âm cho ông bà | Truyện từ hình vẽ, scan sách, expert review | Voice-to-voice với nhân vật, AR, GPS |
| Kho cổ tích Việt (30 truyện) | Truyện phân nhánh, vocab quiz | Zalo Mini App, thẻ QR/NFC |
| Tạo truyện AI + lớp an toàn + bố mẹ duyệt | Đa ngôn ngữ ngoài tiếng Việt | Chế độ Việt kiều/song ngữ |
| Trình phát + ambient + ru ngủ hẹn giờ | Upload file/URL, story editor nâng cao (chỉ admin) | White-label |
| Chế độ bé + cổng phụ huynh (PIN) | Minh hoạ AI từng trang | — |
| Gói Free/Premium + thanh toán VietQR | Push notification cho bé | — |

## 5. Luồng chính

**Happy path (lần đầu, ≤ 3 phút):** Đăng ký → đồng ý chính sách (phụ huynh) → tạo hồ sơ bé (tên, tuổi) → nghe ngay một truyện cổ tích bằng giọng mặc định → gợi ý “Ghi giọng của bạn” hoặc “Mời ông bà góp giọng”.

**Luồng phụ:**

1. *Mời ông bà:* Chủ hộ tạo link → gửi Zalo → ông bà mở web, nghe giải thích, đọc câu đồng ý + ~25 câu mẫu → chủ hộ nhận thông báo “Giọng Bà Nội đã sẵn sàng”.
2. *Truyện AI:* Chọn chủ đề/bài học → AI viết → lớp an toàn → bố mẹ xem nhanh, sửa/duyệt → render audio → vào thư viện của bé.
3. *Giờ ngủ:* Mở app → “Tối nay nghe gì?” → chọn truyện + giọng → chế độ bé + hẹn giờ → màn hình tối, âm giảm dần.

## 6. User stories

**Hộ gia đình & hồ sơ**

1. Là chủ hộ, tôi muốn tạo hộ gia đình khi đăng ký, để mọi dữ liệu thuộc về cả nhà.
2. Là chủ hộ, tôi muốn mời bố/mẹ còn lại bằng link, để cả hai dùng chung thư viện và giọng.
3. Là phụ huynh, tôi muốn tạo nhiều hồ sơ bé (tên gọi, năm sinh, sở thích), để truyện hợp với từng bé.
4. Là phụ huynh, tôi muốn xuất hoặc xoá toàn bộ dữ liệu của hộ, để kiểm soát quyền riêng tư.

**Giọng nói & đồng ý**

5. Là phụ huynh, tôi muốn ghi giọng mình trong app với hướng dẫn từng câu, để có giọng clone tốt ngay lần đầu.
6. Là chủ hộ, tôi muốn tạo link ghi âm cho ông bà, để họ góp giọng mà không cần cài app.
7. Là người góp giọng, tôi muốn biết giọng mình dùng vào đâu và chủ động đồng ý bằng lời nói, để yên tâm.
8. Là người góp giọng, tôi muốn rút lại đồng ý bất cứ lúc nào, để giọng mình bị xoá.
9. Là phụ huynh, tôi muốn nghe thử và biết điểm chất lượng giọng, để ghi lại nếu cần.

**Truyện**

10. Là phụ huynh, tôi muốn duyệt kho cổ tích Việt theo độ tuổi và bài học, để có truyện hay ngay.
11. Là phụ huynh, tôi muốn tạo truyện AI có tên bé theo chủ đề/tình huống (sợ tối, đi học ngày đầu), để giúp bé vượt qua việc thật.
12. Là phụ huynh, tôi muốn đọc nhanh, sửa câu chữ và duyệt truyện AI trước khi bé nghe, để yên tâm nội dung.
13. Là phụ huynh, tôi muốn báo cáo một truyện/đoạn không phù hợp, để hệ thống sửa.
14. Là biên tập viên, tôi muốn soạn, duyệt và xuất bản truyện cổ tích với audio render sẵn, để kho luôn sẵn sàng.

**Nghe truyện**

15. Là phụ huynh, tôi muốn chọn giọng đọc cho từng truyện, để tối nay bé nghe giọng bà.
16. Là bé, tôi muốn nghe truyện liền mạch không chờ tải giữa các trang, để không bị ngắt.
17. Là phụ huynh, tôi muốn hẹn giờ ngủ và âm giảm dần, màn hình tối, để bé dễ ngủ.
18. Là phụ huynh, tôi muốn nghe tiếp khi khoá màn hình và điều khiển từ màn hình khoá, để không phải cầm máy.
19. Là phụ huynh, tôi muốn tải truyện để nghe offline, để dùng khi đi xa.

**An toàn & kiểm soát**

20. Là phụ huynh, tôi muốn bật chế độ bé và chỉ thoát được bằng PIN, để bé không vào cài đặt/mua hàng.
21. Là phụ huynh, tôi muốn đặt giới hạn thời gian nghe/ngày, để cân bằng thói quen.
22. Là phụ huynh, tôi muốn mọi giao dịch và link ra ngoài đều qua cổng phụ huynh, để bé không tự bấm.

**Gói & thanh toán**

23. Là phụ huynh, tôi muốn dùng miễn phí kho cổ tích và vài truyện AI/tháng, để thử trước khi trả tiền.
24. Là phụ huynh, tôi muốn nâng Premium bằng VietQR/ví điện tử và được kích hoạt ngay, để không phải liên hệ admin.
25. Là phụ huynh, tôi muốn biết còn bao nhiêu lượt và khi nào hết hạn, để không bị bất ngờ.
26. Là con cái, tôi muốn mua gói quà cho ông bà/gia đình khác, để tặng dịp Tết. *(nếu kịp)*

**Admin**

27. Là admin, tôi muốn xem chi phí AI theo hộ/truyện/ngày, để kiểm soát biên lợi nhuận.
28. Là admin, tôi muốn xử lý hàng chờ báo cáo nội dung, để phản hồi trong 24 giờ.
29. Là admin, tôi muốn bật/tắt tính năng bằng flag, để mở dần cho từng nhóm.

## 7. Tiêu chí chấp nhận (story trọng yếu)

**#3 Hồ sơ bé**

- [ ] Một hộ có 1–5 hồ sơ bé; tuổi tính từ năm sinh, không lưu ngày sinh đầy đủ.
- [ ] Chỉ thành viên của hộ đọc/sửa được (test RLS với 2 hộ khác nhau).

**#6–8 Link ghi âm & đồng ý giọng**

- [ ] Link dùng 1 lần, hết hạn sau 7 ngày, chủ hộ thu hồi được.
- [ ] Người góp giọng phải đọc câu đồng ý; bản ghi câu đồng ý + thời điểm + phiên bản văn bản được lưu trước khi gọi dịch vụ clone.
- [ ] Thiếu bản ghi đồng ý → API clone trả lỗi, không gọi ElevenLabs.
- [ ] Rút đồng ý → xoá voice tại ElevenLabs, xoá file ghi âm, vô hiệu audio cache của giọng đó trong ≤ 24 giờ.
- [ ] Trang ghi âm dùng được trên Zalo in-app browser (Android + iOS), chữ ≥ 18px, nút lớn.

**#11–12 Truyện AI an toàn**

- [ ] Input (chủ đề, mô tả tự do) và output đều qua moderation; bị gắn cờ → không hiển thị, báo lý do thân thiện.
- [ ] Output vi phạm danh sách chủ đề cấm (bạo lực chi tiết, kinh dị, tình dục, chất gây nghiện, thông tin cá nhân thật) → tự viết lại tối đa 1 lần, sau đó từ chối.
- [ ] Độ dài câu trung bình và số trang nằm trong ngưỡng theo nhóm tuổi (2–3, 4–5, 6–8).
- [ ] Truyện AI mới ở trạng thái “Chờ duyệt”, không xuất hiện ở chế độ bé cho tới khi phụ huynh duyệt.

**#16 Nghe liền mạch**

- [ ] Audio cả truyện được render trước khi phát; chuyển trang không ngắt quá 300ms trên 4G.
- [ ] Render lại chỉ khi nội dung trang hoặc giọng đổi (cache theo phiên bản trang + giọng).

**#20 Chế độ bé**

- [ ] PIN 4–6 số, kiểm tra ở server, hash một chiều; sai 5 lần khoá 15 phút.
- [ ] Ở chế độ bé không truy cập được cài đặt, thanh toán, link ngoài, tạo truyện.

**#24 Thanh toán**

- [ ] Gói chỉ được kích hoạt qua webhook đã xác minh chữ ký; client không tự ghi được quyền lợi.
- [ ] Webhook xử lý idempotent (gọi lặp không cộng dồn gói).
- [ ] Kích hoạt ≤ 1 phút sau khi chuyển khoản thành công.

## 8. Quyết định triển khai

### Module (ưu tiên module sâu, interface nhỏ)

| Module | Trách nhiệm | Interface chính |
| --- | --- | --- |
| **Household** | Hộ, thành viên, vai trò, lời mời; là ranh giới RLS | tạo hộ, mời, chấp nhận, rời hộ |
| **Consent** | Lưu mọi đồng ý (chính sách phụ huynh, đồng ý giọng) có phiên bản | ghi đồng ý, kiểm tra đồng ý hiệu lực, rút đồng ý |
| **VoiceStudio** | Ghi âm, chấm chất lượng, clone, xoá; link ghi âm khách | tạo link, nộp mẫu, trạng thái giọng, xoá giọng |
| **StoryForge** | Sinh truyện qua LLM provider dùng chung + SafetyGate | `generate(brief) → bản nháp đã kiểm duyệt hoặc lỗi có lý do` |
| **SafetyGate** | Moderation input/output, chủ đề cấm, ngưỡng theo tuổi | `check(text, ageBand) → pass / rewrite / reject` |
| **AudioRender** | Render & cache audio theo (trang, phiên bản, giọng); hàng đợi, retry | `ensureRendered(story, voice) → danh sách URL` |
| **Playback** | Trình phát, ambient, ru ngủ, media session, offline | phát/dừng/hẹn giờ |
| **Entitlements** | Nguồn sự thật duy nhất về gói, lượt còn lại; nhận sự kiện từ mọi cổng thanh toán | `can(household, action)`, `consume`, `grant(event)` |
| **ParentalGate** | PIN, chế độ bé, giới hạn thời gian | xác minh PIN, trạng thái khoá |

Mở rộng từ code hiện có: `consume_usage()` (migration 016) trở thành nền của Entitlements; `audio_cache` thành nền của AudioRender; ~8 route gọi LLM gom về StoryForge.

### Thay đổi schema (expand → migrate → contract)

- **Mới:** `households`, `household_members` (vai trò: owner/member), `household_invites`, `child_profiles`, `consents`, `voice_capture_links`, `content_reports`, `payment_events`, `ai_cost_ledger`.
- **Sửa:** thêm `household_id` cho `stories`, `voice_profiles`, `family_members`, `user_subscriptions`, `play_sessions`; `story_pages` thêm `revision`; truyện thêm trạng thái `draft / pending_review / approved / published`.
- **Chuyển dữ liệu:** mỗi user hiện có → 1 hộ; `profiles.child_name/child_age` → `child_profiles`. Bỏ cột cũ sau khi mọi nơi đã đọc dạng mới.
- **RLS:** mọi bảng có `household_id` dùng chung một hàm `is_household_member()`; có test PGlite cho từng bảng.

### API mới / thay đổi

| Endpoint | Quyền | Màn hình dùng |
| --- | --- | --- |
| `POST /api/household/invite`, `POST /api/household/join` | owner / người có token | Cài đặt hộ, Onboarding |
| `POST /api/voice/capture-link`, `GET/POST /api/voice/capture/[token]` | owner / khách có token | Giọng nói, trang ghi âm khách |
| `POST /api/voice/clone` (sửa: bắt buộc consent) | thành viên hộ | Ghi âm |
| `DELETE /api/voice/[id]` | owner hoặc chủ giọng | Giọng nói |
| `POST /api/story/generate` (sửa: qua SafetyGate, trả trạng thái pending_review) | thành viên hộ | Tạo truyện |
| `POST /api/story/[id]/approve`, `POST /api/report` | thành viên hộ | Duyệt truyện, Player |
| `POST /api/audio/render` | thành viên hộ | Player, Tải về |
| `POST /api/parental/pin`, `POST /api/parental/verify` | thành viên hộ | Cổng phụ huynh |
| `POST /api/billing/checkout`, `POST /api/billing/webhook` | thành viên hộ / cổng thanh toán (ký số) | Gói cước |

Mọi body request validate bằng Zod; mọi route gọi AI đi qua Entitlements + ghi `ai_cost_ledger`.

### Phi chức năng

- **Hiệu năng:** truyện cổ tích phát trong ≤ 2 giây; truyện AI mới sẵn sàng ≤ 60 giây (viết + kiểm duyệt); render audio chạy nền.
- **Chi phí:** ước tính thô một truyện 8–12 trang ≈ 3.000–4.000 ký tự; Flash v2.5 rẻ hơn ~50% mỗi ký tự so với Multilingual v2 → dùng Flash cho bản nháp/nghe thử, Multilingual/v3 cho bản cuối. Mục tiêu chi phí AI ≤ 30% giá gói.
- **Bảo mật:** PIN hash một chiều phía server; key BYO không lưu dạng rõ ở client (hoặc tắt BYO cho người dùng thường trong v1); CSP chặt; Gemini key qua header.
- **Quyền riêng:** không dùng SDK phân tích/quảng cáo bên thứ ba (để đủ điều kiện Kids Category của Apple và Families policy của Google Play) — dùng phân tích first-party; không gửi tên bé cho bên thứ ba ngoài prompt LLM cần thiết; có thời hạn lưu file ghi âm gốc.
- **Nền tảng:** Web/PWA cho beta; Capacitor cho store, cần background audio (iOS audio background mode, Android mediaPlayback foreground service) + media session để điều khiển từ màn hình khoá.

### ADR cần viết

1. **Hộ gia đình là ranh giới tenant** (thay vì user) — khó đảo ngược, ảnh hưởng mọi RLS.
2. **Render trước cả truyện** thay vì TTS từng trang khi phát — đổi chi phí lấy độ mượt + offline.
3. **Thanh toán: web VietQR trước, IAP sau** — trong app iOS, nội dung số thường phải mua qua In-App Purchase; Entitlements nhận sự kiện từ cả hai nguồn.

## 9. Kiểm thử

- **DB (PGlite):** RLS theo hộ (2 hộ không thấy nhau), consent bắt buộc trước clone, Entitlements consume/grant idempotent, PIN lockout.
- **Unit:** SafetyGate (bộ mẫu truyện sạch/vi phạm tiếng Việt), ngưỡng độ tuổi, khoá cache AudioRender, xác minh chữ ký webhook.
- **E2E (Playwright):** onboarding ≤ 3 phút, link ghi âm khách (mobile viewport), tạo → duyệt → phát truyện AI, chế độ bé không thoát được khi không có PIN, thanh toán sandbox.
- Chỉ test hành vi qua interface của module; mock dịch vụ ngoài tại seam provider.

## 10. Ngoài phạm vi v1

Marketplace, truyện cộng tác, voice-to-voice, AR, GPS, Smart TV, white-label, Zalo Mini App, thẻ QR/NFC, chế độ song ngữ, push notification nhắm tới bé.

## 11. Câu hỏi mở

1. Xác nhận thị trường đầu tiên là trong nước? → Đề xuất: **có**.
2. Giá Premium? → Đề xuất thử 2 mức: ~79k và ~129k đồng/tháng, gói năm giảm ~35%; quyết sau khi có số liệu chi phí thật.
3. Free có được clone 1 giọng không? → Đề xuất: **có 1 giọng, giới hạn 3 truyện/tháng bằng giọng đó** — đây là khoảnh khắc “wow”.
4. Giữ BYO-key cho người dùng thường? → Đề xuất: **tắt trong v1** (giảm rủi ro bảo mật + hỗ trợ), chỉ admin.
5. Đăng store theo danh mục Kids hay Parenting? → Đề xuất: **Parenting/Gia đình** (người dùng là phụ huynh), vẫn tuân thủ Families policy.
6. Ai biên tập 30 truyện cổ tích đầu tiên và có cần chuyên gia giáo dục mầm non duyệt không?
7. Nhà cung cấp LLM mặc định cho truyện tiếng Việt? → Đề xuất chạy bộ đánh giá nhỏ (20 brief × 3 provider) trước khi chọn.

## 12. Glossary

- **Hộ (Household):** đơn vị sở hữu mọi dữ liệu; có 1 chủ hộ và các thành viên.
- **Chủ hộ:** người lớn tạo hộ, quản lý thành viên, thanh toán.
- **Thành viên:** người lớn có tài khoản trong hộ.
- **Người góp giọng:** người ghi âm qua link, có thể không có tài khoản.
- **Hồ sơ bé:** thông tin một đứa trẻ trong hộ; bé không phải người dùng có tài khoản.
- **Giọng (Voice):** giọng clone của một người cụ thể, gắn với một bản ghi đồng ý còn hiệu lực.
- **Đồng ý giọng:** lời xác nhận nói to của chính chủ giọng, có phiên bản văn bản.
- **Truyện nền tảng:** truyện do biên tập viên xuất bản cho mọi hộ.
- **Truyện của hộ:** truyện AI hoặc tự viết, chỉ hộ đó thấy.
- **Chế độ bé:** giao diện phát truyện bị khoá, thoát cần PIN.
- **Quyền lợi (Entitlement):** điều một hộ được làm theo gói và lượt còn lại.

## Nguồn nghiên cứu bổ sung

- [Apple App Review Guidelines — Kids Category](https://developer.apple.com/app-store/review/guidelines/) · [Apple: parental gate trong Kids Category](https://developer.apple.com/news?id=091202019a)
- [Google Play Families policies](https://support.google.com/googleplay/android-developer/answer/9893335/designing-apps-for-children-and-families?hl=en-GB) · [Google Play AI-Generated Content policy](https://support.google.com/googleplay/android-developer/answer/14094294?hl=en)
- [OpenAI Moderation (miễn phí, hỗ trợ đa ngôn ngữ)](https://developers.openai.com/api/docs/guides/moderation)
- [ElevenLabs Pricing](https://elevenlabs.io/pricing) · [So sánh Flash v2.5 vs Multilingual v2](https://www.cekura.ai/blogs/elevenlabs-pricing)
- [VietQR API](https://doc.vietqr.vn/doc/api-vietqr-callback/api-vietqr-host2host/integrated-document-for-payment-service-vietqr) · [payOS Node SDK](https://www.npmjs.com/package/@payos/node)
- [Capacitor: phát audio nền](https://capgo.app/blog/how-to-play-audio-in-the-background-in-capacitor/) · [Capacitor Media Session](https://capawesome.io/docs/sdks/capacitor/media-session/)
