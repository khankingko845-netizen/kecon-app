# 📖 KểCon — Phân tích repo, ý tưởng bổ sung & kế hoạch

_Nguồn Notion: https://app.notion.com/p/fb69727cdab14e179032e69d0373db2f_

> 📌 Nguồn: README của repo [kecon-app](https://github.com/khankingko845-netizen/kecon-app) (57 commit, nhánh mặc định `devin/1779900590-phase1-supabase-auth`), source code (đã clone và đọc) và nghiên cứu thị trường. Kế hoạch bám theo các gate G0–G6 của bộ DevSkill. Chi tiết: Spec KểCon v1 (G1) và Kế hoạch triển khai (G2–G6) ở cuối trang.

## 1. Tóm tắt hiện trạng

**KểCon**: app mobile-first kể truyện AI cho gia đình Việt — AI viết truyện theo tên/tuổi bé, đọc bằng giọng người thân đã clone (ElevenLabs), kèm hiệu ứng âm thanh/hình ảnh.

| Hạng mục | Hiện trạng |
| --- | --- |
| Stack | Next.js 16, React 19, TS, Tailwind 4, Supabase (Auth/Postgres/RLS/Storage), ElevenLabs, OpenAI/Gemini/Claude/Custom |
| Tính năng lõi | Tạo truyện AI, clone giọng, StoryPlayer (TTS + particle + ambient 3 lớp), ru ngủ, truyện phân nhánh, thư viện, upload txt/docx/pdf/URL |
| Đã làm thêm | Editor, Voice Legacy (cây gia đình), gợi ý, admin (dashboard/truyện/user/analytics), push, đa ngôn ngữ, chia sẻ, rating, minh hoạ DALL·E, gói cước, offline, gamification, parental controls |
| Chất lượng | Vitest (unit + test migration bằng PGlite), Playwright E2E smoke, CI lint → typecheck → test → build |
| Bảo mật | Key chỉ ở server, RLS, migration 016 (chặn leo thang quyền, `consume_usage()` rate limit + hạn mức), chặn SSRF cho Base URL tùy chỉnh, COPPA banner, xuất/xoá dữ liệu |

### Điểm mạnh

- Định vị cảm xúc rất rõ: *“giọng người thân”* + *“Voice Legacy”* — khác biệt so với app truyện cổ tích Việt hiện có (chủ yếu kho truyện + giọng đọc cố định).
- Nền kỹ thuật nghiêm túc: proxy server-side, RLS, rate limit fail-closed, CI, test DB.
- BYO-key giúp power user tự chịu chi phí AI.

### Rủi ro & khoảng trống

1. **Phình scope trước khi có người dùng thật** — gần như toàn bộ roadmap ngắn/trung hạn đã đánh ✅, nhưng chưa thấy số liệu người dùng/retention. Nguy cơ nhiều tính năng nông, khó bảo trì.
2. **Repo chưa gọn**: nhánh mặc định là nhánh feature của Devin; README có bảng rate limit bị lặp/mâu thuẫn (illustration 20 vs 10), cây thư mục ghi “migrations 001-004” trong khi đã có 016.
3. **Migration chạy tay qua SQL Editor** — dễ lệch giữa môi trường; nên dùng Supabase CLI (`supabase db push`).
4. **Âm thanh nền tổng hợp bằng oscillator** — khó đạt cảm giác “sống động”; trải nghiệm nghe là lõi của sản phẩm.
5. **Chi phí đơn vị** (TTS + clone + LLM + ảnh) chưa có mô hình unit economics; gói free 5 truyện/tháng có thể lỗ nếu mỗi truyện đều có TTS giọng clone + minh hoạ.
6. **An toàn nội dung cho trẻ** — chưa thấy lớp kiểm duyệt output AI (chủ đề cấm, từ vựng theo tuổi) trước khi bé nghe; upload từ URL/file cũng cần lọc.
7. **Đồng ý clone giọng** — cần chứng minh chính chủ giọng đồng ý (ông bà ghi âm hộ, giọng người khác).
8. **Pháp lý VN**: Luật Bảo vệ dữ liệu cá nhân 91/2025/QH15 có hiệu lực 01/01/2026; COPPA hiện chỉ là banner, chưa phải quy trình đồng ý/lưu trữ dữ liệu hoàn chỉnh.

### Kết quả đọc source code (clone nhánh mặc định)

Quy mô: ~100 file trong `src/`, 30+ màn hình, 19 API route, 15 migration, 11 file test. File lớn nhất: `db.ts` (2.046 dòng), `StoryPlayer.tsx` (1.669), `AdminSettings.tsx` (1.117), `StoryEditor.tsx` (1.097).

| Mức độ | Phát hiện | Đề xuất |
| --- | --- | --- |
| 🔴 Cao | Mã PIN phụ huynh lưu bằng `btoa(pin)` (Base64, không phải hash) — giải ngược được ngay | Hash + so sánh ở server (bcrypt/argon2 hoặc `crypt()` trong Postgres), giới hạn số lần nhập sai |
| 🔴 Cao | API key BYO (ElevenLabs, LLM) lưu trong `localStorage` dạng rõ — lộ nếu có XSS | Ghi rõ rủi ro cho user, hoặc lưu mã hoá phía server; thêm CSP chặt |
| 🟠 Trung bình | Đồng ý COPPA chỉ lưu `localStorage` trên thiết bị, không có bản ghi phía server | Bảng `consents` (ai, lúc nào, phiên bản chính sách) |
| 🟠 Trung bình | Route clone giọng không có bước xác nhận đồng ý của chủ giọng | Thêm câu xác nhận đọc to + lưu bằng chứng trước khi gọi ElevenLabs |
| 🟠 Trung bình | README ghi dùng Zod nhưng không route nào import Zod; input API chưa validate theo schema | Schema Zod cho mọi body API |
| 🟠 Trung bình | Prompt tạo truyện chỉ dặn “ngôn ngữ phù hợp độ tuổi”; không có bước kiểm duyệt output (moderation queue chỉ dành cho admin) | Lớp lọc output + danh sách chủ đề cấm + phụ huynh duyệt |
| 🟡 Thấp | Gemini API key truyền qua query string `?key=` ở 7 chỗ — dễ lọt vào log | Dùng header `x-goog-api-key` |
| 🟡 Thấp | Code gọi LLM lặp lại ở ~8 route (translate, vocabulary, personalize, scan…) | Gom về một module provider dùng chung |
| 🟡 Thấp | Thiếu migration `014`; `db.ts` quá lớn | Ghi chú/giữ số thứ tự; tách `db.ts` theo domain |
| ℹ️ | Thanh toán chưa tích hợp — nâng gói đang chờ admin cấp (đã được RLS/migration 016 chặn tự nâng gói) | Cổng thanh toán + webhook ghi `user_subscriptions` phía server |
| ℹ️ | `main` gần như trống so với nhánh `devin/...` (khác 501 file) | Merge vào `main` và đặt làm nhánh mặc định |

Điểm tốt đã xác nhận: các route AI/TTS đều có kiểm tra đăng nhập + `guardUsage`; route gửi push kiểm tra quyền admin; Service Worker không cache `/api/`.

## 2. Nghiên cứu thị trường

| Đối thủ / xu hướng | Điểm đáng học |
| --- | --- |
| StoryBee | Clone giọng bố mẹ “để bé nghe khi bố mẹ đi công tác”, nội dung tự điều chỉnh theo tuổi 3–12, lồng ghép từ vựng/cảm xúc |
| Oscar Stories | Bán theo subscription **hoặc gói xu** (1 xu = 1 truyện có minh hoạ + giọng đọc), có iOS/Android/web |
| Fabler (Resemble AI) | Clone giọng chỉ cần đọc ~25 câu — onboarding giọng nhanh là then chốt |
| [Bedtimestory.ai](http://Bedtimestory.ai) | Cho thành viên gia đình làm nhân vật, chọn art style |
| App cổ tích VN (MISA, Truyện Thiếu Nhi…) | Kho truyện có sẵn, bài học nhân cách, hát ru hẹn giờ — chưa có giọng người thân |
| Yoto / Toniebox | Xu hướng **screen-free**: thẻ/tượng vật lý kích hoạt audio, cho phép ghi âm giọng riêng |
| ElevenLabs | Hỗ trợ tiếng Việt; Eleven v3 có audio tag cảm xúc (thì thầm, cười…); chính sách cấm clone giọng khi không có đồng ý |
| Thanh toán VN | Google Play tại VN nhận MoMo, ZaloPay, ShopeePay, VTC Pay, trừ tiền nhà mạng |
| Pháp lý | COPPA 2025: đồng ý opt-in, giới hạn thời gian lưu dữ liệu, dữ liệu giọng nói là rủi ro; FTC lo ngại push notification kéo trẻ online. Luật 91/2025: xử lý dữ liệu trẻ em cần người đại diện đồng ý, trẻ từ đủ 7 tuổi cần thêm đồng ý của trẻ trong một số trường hợp |

**Kết luận:** Clone giọng + truyện AI đã thành tính năng phổ biến trên thế giới. Lợi thế bền vững của KểCon nằm ở **văn hoá Việt + gia đình nhiều thế hệ + kênh phân phối Việt (Zalo, ví điện tử) + Việt kiều muốn con giữ tiếng Việt**.

## 3. Ý tưởng bổ sung

### Ưu tiên cao (khớp lõi, tác động lớn)

1. **Ông bà ghi âm qua link Zalo, không cần cài app** — trang web ghi âm một chạm, hướng dẫn đọc ~25 câu, câu đầu tiên là lời tự xác nhận đồng ý. Giải quyết cùng lúc onboarding giọng và bằng chứng đồng ý.
2. **Kho cổ tích Việt chuẩn hoá** (Tấm Cám, Sọ Dừa, Thánh Gióng, Cây khế…) do admin biên tập, có bài học và bản “nhẹ nhàng cho bé nhỏ”. Giá trị ngay khi chưa cần AI, chi phí thấp, SEO tốt.
3. **Lớp an toàn nội dung**: moderation output LLM + checklist chủ đề cấm + kiểm tra độ khó từ vựng theo tuổi; phụ huynh duyệt/nghe trước truyện AI.
4. **Giọng đọc giàu cảm xúc**: dùng audio tag của Eleven v3 (thì thầm ở trang cuối bản ru ngủ, giọng nhân vật), để LLM tự chèn tag khi sinh truyện.
5. **Âm thanh nền thật**: thay oscillator bằng thư viện SFX/ambient có license hoặc sinh bằng API sound effects, cache vào Storage.
6. **Unit economics & kiểm soát chi phí**: dashboard chi phí/truyện; pre-generate + cache audio cho truyện nền tảng; gói free dùng giọng mặc định, giọng clone là premium.
7. **Thanh toán Việt**: in-app billing (MoMo/ZaloPay qua Google Play) + gói xu theo truyện bên cạnh subscription; **gói quà** (con cái mua cho ông bà/cháu).

### Trung bình (tăng trưởng & khác biệt)

8. **Chế độ Việt kiều / song ngữ** — truyện song song Việt–Anh (hoặc Nhật/Hàn), highlight từ vựng, bé nhắc lại theo giọng ông bà → “giữ tiếng Việt cho con”.
9. **Chia sẻ Zalo / Zalo Mini App** — kênh lan toả chính ở VN; “quà truyện” gửi cháu nhân sinh nhật/Tết.
10. **Truyện theo dịp văn hoá**: Tết, Trung thu, Rằm, ngày đầu đi học, có em bé — truyện giúp bé vượt qua tình huống thật (sợ bóng tối, đi nha sĩ).
11. **“Kể cùng bé” (Duet)** — bố mẹ đọc trang lẻ, giọng clone đọc trang chẵn; ghi lại giọng bé vào “Time capsule”.
12. **Screen-free**: chế độ chỉ audio + thẻ truyện in QR/NFC (học Yoto/Toniebox) — phù hợp phụ huynh lo thời gian màn hình.

### Cần thận trọng

- **Push notification**: hướng tới phụ huynh (nhắc giờ ngủ), không dùng streak/XP để kéo trẻ ở lại lâu.
- **Voice-to-voice với nhân vật, AR, GPS**: để sau khi có retention; rủi ro dữ liệu trẻ (giọng bé, vị trí, camera) rất cao.
- **Marketplace / collaborative stories**: cần moderation và bản quyền, chưa nên làm sớm.

## 4. Kế hoạch theo gate

> 🎯 Nguyên tắc: **thu hẹp → đo → mở rộng**. Giữ các tính năng đã có sau feature flag, dồn lực vào vòng lõi: *ghi giọng người thân → chọn/tạo truyện → bé nghe trước giờ ngủ → quay lại tối hôm sau*.

### Giai đoạn 0 — Ổn định nền (1–2 tuần) · G0–G1

- [ ] 🔍 BA: chốt persona chính (bố mẹ đô thị 25–40 tuổi có con 2–8 tuổi? Việt kiều? ông bà?), viết spec vòng lõi + tiêu chí chấp nhận
- [ ] 🏗️ Architect: merge nhánh `devin/...` về `main`, đặt `main` làm mặc định, bật branch protection
- [ ] Chuyển migration sang Supabase CLI, tách môi trường dev/staging/prod
- [ ] Sửa README (bảng rate limit trùng, cây thư mục, danh sách migration)
- [ ] Kiểm kê tính năng: giữ / ẩn sau flag / bỏ — đặc biệt gamification, marketplace-ready, đa ngôn ngữ
- [ ] 🧪 QA: audit bảo mật RLS + migration 016, thêm E2E cho vòng lõi
- [ ] 🔴 Sửa ngay: hash PIN phụ huynh phía server, xử lý API key BYO trong `localStorage`
- [ ] Thêm Zod validate cho mọi API route, chuyển Gemini key sang header, gom code gọi LLM về một module
- [ ] Thiết lập đo lường: sự kiện funnel, chi phí AI theo user/truyện

### Giai đoạn 1 — Sẵn sàng ra mắt (4–6 tuần) · G2–G4

- [ ] 🎨 UX/UI: thiết kế lại onboarding (≤ 3 phút tới truyện đầu tiên), màn Home tập trung “Tối nay nghe gì?”
- [ ] Luồng đồng ý clone giọng: câu xác nhận đọc to, lưu bằng chứng, xoá giọng 1 chạm, chỉ dùng trong gia đình
- [ ] Link ghi âm cho ông bà qua Zalo (web, không cần tài khoản)
- [ ] Lớp an toàn nội dung AI + phụ huynh duyệt trước
- [ ] Kho 30–50 truyện cổ tích Việt biên tập sẵn, audio pre-generate
- [ ] Nâng audio: Eleven v3 audio tag + ambient thật; kiểm tra chất lượng giọng clone tiếng Việt (3 miền)
- [ ] Tuân thủ: chính sách quyền riêng theo Luật 91/2025 + COPPA, thời hạn lưu dữ liệu giọng, đồng ý người đại diện
- [ ] Mô hình giá: free (giọng mặc định + kho cổ tích) / premium (giọng clone, truyện AI) / gói xu; đảm bảo biên lợi nhuận dương

### Giai đoạn 2 — Beta & phát hành (3–4 tuần) · G5–G6

- [ ] 🚀 Release: closed beta 50–100 gia đình (nhóm phụ huynh Facebook/Zalo), phỏng vấn 10 gia đình
- [ ] Đóng gói Capacitor (iOS/Android) để có in-app billing + background audio + lên store
- [ ] Tích hợp thanh toán (Google Play billing có MoMo/ZaloPay; App Store)
- [ ] Retro: đánh giá KPI, quyết định tính năng nào bật lại

### Giai đoạn 3 — Tăng trưởng (sau ra mắt)

- Chế độ Việt kiều/song ngữ, Zalo Mini App & “quà truyện”, truyện theo dịp Tết/Trung thu
- Duet mode + Time capsule giọng bé
- Screen-free: thẻ QR/NFC, chế độ chỉ audio
- Sau đó mới xem xét: marketplace, white-label cho trường/NXB, voice-to-voice

## 5. Chỉ số thành công

| Chỉ số | Mục tiêu beta (đề xuất) |
| --- | --- |
| Từ đăng ký → nghe truyện đầu tiên | ≥ 70%, ≤ 3 phút |
| Tỷ lệ gia đình có ≥ 1 giọng người thân | ≥ 40% |
| Gia đình nghe ≥ 3 tối/tuần (tuần 4) | ≥ 30% |
| Tỷ lệ nghe hết truyện | ≥ 60% |
| Chuyển đổi free → trả phí | 3–5% |
| Chi phí AI / user trả phí / tháng | ≤ 30% giá gói |

## 6. Câu hỏi cần chốt

1. Thị trường đầu tiên: gia đình trong nước hay Việt kiều? (ảnh hưởng giá, thanh toán, ngôn ngữ)
2. Ngân sách AI hàng tháng và giá gói premium dự kiến?
3. Ra mắt dạng web/PWA trước hay lên store ngay?
4. Ai biên tập kho cổ tích và duyệt nội dung?
5. Tính năng nào trong số đã làm bạn muốn giữ bằng mọi giá?

## Nguồn tham khảo

- [StoryBee](https://storybee.app/) · [Oscar Stories — Pricing](https://oscarstories.com/pricing) · [Fabler × Resemble AI](https://www.resemble.ai/resources/how-fabler-and-resemble-ai-transformed-bedtime-for-thousands-of-children) · [Bedtimestory.ai](https://www.bedtimestory.ai/)
- [Nghe truyện cổ tích cùng MISA](https://apps.apple.com/vn/app/nghe-truy%E1%BB%87n-c%E1%BB%95-t%C3%ADch-c%C3%B9ng-misa/id6744005728?l=vi) · [Truyện Thiếu Nhi – Cổ Tích](https://apps.apple.com/us/app/truy%E1%BB%87n-thi%E1%BA%BFu-nhi-c%E1%BB%95-t%C3%ADch/id6741099492?l=vi) · [Toniebox Lite](https://us.tonies.com/products/toniebox-lite-my-story-set)
- [ElevenLabs — Vietnamese TTS](https://elevenlabs.io/text-to-speech/vietnamese) · [ElevenLabs TTS / Eleven v3](https://elevenlabs.io/text-to-speech) · [ElevenLabs Prohibited Use Policy](https://elevenlabs.io/use-policy)
- [Google Play — phương thức thanh toán tại VN](https://support.google.com/googleplay/answer/2651410?hl=en&co=GENIE.CountryCode%3DVN)
- [FTC — sửa đổi COPPA 2025](https://www.ftc.gov/news-events/news/press-releases/2025/01/ftc-finalizes-changes-childrens-privacy-rule-limiting-companies-ability-monetize-kids-data) · [Tóm tắt sửa đổi COPPA](https://www.moritthock.com/wp-content/uploads/2025/02/MHH-Alert-Final-COPPA-Rule-Changes.pdf) · [Luật 91/2025/QH15](https://chinhphu.vn/?classid=1&docid=214590&pageid=27160&typegroupid=3) · [Điều khoản dữ liệu trẻ em](https://luatvietnam.vn/dan-su/luat-bao-ve-du-lieu-ca-nhan-2025-so-91-2025-qh15-405135-d1.html)

- [Kế hoạch triển khai KểCon v1 (G2–G6)](https://app.notion.com/p/3ed4dea8214e473bbd09fa4916d0b044)

- [Spec KểCon v1 (G1)](https://app.notion.com/p/7b892253ab1c49ae8ab8e3231e7767f7)
