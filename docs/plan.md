# 🗺️ Kế hoạch triển khai KểCon v1 (G2–G6)

_Nguồn Notion: https://app.notion.com/p/3ed4dea8214e473bbd09fa4916d0b044_

> 📌 Chia theo skill thiet-ke-kien-truc: mỗi ticket là một lát cắt dọc (schema → API → UI → test), demo được độc lập, có quan hệ **Bị chặn bởi**. Ticket không có blocker bắt đầu ngay. Tổng thời gian ước tính **~12 tuần** cho 1–2 dev + AI agent. Spec nguồn: trang Spec KểCon v1 (G1).

## Lộ trình tổng quan

| Milestone | Tuần | Mục tiêu | Gate |
| --- | --- | --- | --- |
| **M0 — Nền tảng** | 1–2 | Repo sạch, lỗ hổng nghiêm trọng đã vá, có đo lường | G2 |
| **M1 — Gia đình & đồng ý** | 3–4 | Hộ, hồ sơ bé, giọng có đồng ý, link cho ông bà | G3 |
| **M2 — Truyện an toàn & nghe hay** | 4–7 | SafetyGate, duyệt truyện, kho cổ tích, render audio, chế độ bé, onboarding | G3–G4 |
| **M3 — Kiếm tiền** | 7–9 | Entitlements, thanh toán VietQR, paywall | G4 |
| **M4 — Beta & phát hành** | 9–12 | App store, tuân thủ, closed beta, retro | G5–G6 |

## Ticket

### M0 — Nền tảng

| # | Ticket | Vai trò | Bị chặn bởi | Tiêu chí chấp nhận chính |
| --- | --- | --- | --- | --- |
| T01 | Hợp nhất nhánh `devin/...` vào `main`, đặt `main` mặc định, branch protection + CI bắt buộc | 🏗️ Architect | — | PR vào `main` phải xanh lint/typecheck/test/build/E2E |
| T02 | Migration qua Supabase CLI + môi trường staging; ghi chú số 014 bị thiếu | 🏗️ Architect | T01 | `db push` tái tạo staging từ 0; test DB chạy trên cùng bộ migration |
| T03 | PIN phụ huynh: hash + xác minh phía server, khoá sau 5 lần sai; chuyển dữ liệu `btoa` cũ (buộc đặt lại PIN) | 💻 Dev | T02 | Không còn PIN dạng giải ngược được trong DB; test lockout |
| T04 | LLM provider dùng chung (gom ~8 route), Zod cho mọi body API, Gemini key qua header | 💻 Dev | T01 | Không còn `?key=`; route trả 400 khi body sai schema; test provider bằng adapter giả |
| T05 | Xử lý BYO-key: tắt cho user thường (chỉ admin), xoá key khỏi `localStorage`; thêm CSP | 💻 Dev | T04 | Không còn key trong storage client; CSP không phá app (E2E smoke xanh) |
| T06 | Feature flags trong `app_settings`  • ẩn tính năng ngoài v1 | 💻 Dev | T02 | Admin bật/tắt được; màn hình bị tắt không truy cập được cả qua URL |
| T07 | Đo lường first-party (sự kiện funnel) + `ai_cost_ledger` ghi chi phí mọi lần gọi AI | 💻 Dev | T04 | Dashboard admin hiện chi phí/ngày và funnel onboarding |

### M1 — Gia đình & đồng ý

| # | Ticket | Vai trò | Bị chặn bởi | Tiêu chí chấp nhận chính |
| --- | --- | --- | --- | --- |
| T08 | Hộ gia đình + `is_household_member()`  • RLS mới; chuyển mỗi user cũ thành 1 hộ (expand–contract) | 🏗️ Architect + 💻 Dev | T02 | Test PGlite: 2 hộ không thấy dữ liệu nhau trên mọi bảng |
| T09 | Mời thành viên bằng link (hết hạn, thu hồi) | 💻 Dev | T08 | Người được mời thấy thư viện/giọng chung; link hết hạn bị từ chối |
| T10 | Hồ sơ bé (1–5/hộ) thay `profiles.child_name/child_age`; cập nhật mọi nơi đọc | 💻 Dev | T08 | Tạo truyện/gợi ý dùng hồ sơ bé được chọn; cột cũ được bỏ ở bước contract |
| T11 | Consent phía server (chính sách phụ huynh, có phiên bản) thay banner `localStorage` | 💻 Dev | T08 | Không dùng app khi chưa có bản ghi đồng ý; đổi phiên bản chính sách → hỏi lại |
| T12 | Đồng ý giọng: câu xác nhận nói to, lưu bằng chứng; clone bị chặn nếu thiếu; rút đồng ý → xoá voice ElevenLabs + file + cache | 💻 Dev + 🧪 QA | T11 | Theo tiêu chí #6–8 trong spec |
| T13 | Link ghi âm cho ông bà (web, không cần tài khoản), tối ưu Zalo in-app browser | 🎨 UX/UI + 💻 Dev | T09, T12 | E2E viewport mobile; thử thật trên Zalo Android + iOS; chủ hộ nhận thông báo khi giọng sẵn sàng |

### M2 — Truyện an toàn & nghe hay

| # | Ticket | Vai trò | Bị chặn bởi | Tiêu chí chấp nhận chính |
| --- | --- | --- | --- | --- |
| T14 | SafetyGate: moderation input/output, chủ đề cấm, ngưỡng theo tuổi, tự viết lại 1 lần | 💻 Dev + 🧪 QA | T04 | Bộ mẫu ≥ 50 đoạn tiếng Việt (sạch/vi phạm) đạt ≥ 95% đúng |
| T15 | Luồng duyệt: truyện AI → “Chờ duyệt” → phụ huynh sửa/duyệt; báo cáo nội dung + hàng chờ admin | 💻 Dev | T14, T10 | Truyện chưa duyệt không xuất hiện ở chế độ bé |
| T16 | AudioRender: render cả truyện, cache theo (trang, revision, giọng), retry, chọn model (Flash cho nghe thử, Multilingual/v3 cho bản cuối) + audio tag ru ngủ | 💻 Dev | T04, T07 | Chuyển trang ≤ 300ms; sửa 1 trang chỉ render lại trang đó |
| T17 | Ambient thật: thư viện file có license thay oscillator, giữ mixer 3 lớp | 🎨 UX/UI + 💻 Dev | — | ≥ 8 âm nền; file được cache offline |
| T18 | Kho cổ tích Việt: quy trình biên tập → duyệt → xuất bản; 30 truyện đầu tiên có audio giọng mặc định | 🔍 BA + Biên tập | T06, T16 | 30 truyện phát được ngay, gắn tuổi + bài học |
| T19 | Chế độ bé + cổng phụ huynh cho cài đặt/thanh toán/link ngoài; giới hạn thời gian/ngày | 🎨 UX/UI + 💻 Dev | T03, T10 | E2E: không thoát được khi không có PIN |
| T20 | Onboarding mới ≤ 3 phút + Home “Tối nay nghe gì?” | 🎨 UX/UI + 💻 Dev | T09, T10, T11, T18 | E2E đăng ký → nghe truyện đầu tiên; test 5 phụ huynh thật |

### M3 — Kiếm tiền

| # | Ticket | Vai trò | Bị chặn bởi | Tiêu chí chấp nhận chính |
| --- | --- | --- | --- | --- |
| T21 | Entitlements theo hộ: Free/Premium/xu, dựng trên `consume_usage()`, hiển thị lượt còn lại | 🏗️ Architect + 💻 Dev | T07, T08 | Client không tự cấp quyền; test consume/grant idempotent |
| T22 | Thanh toán web qua payOS/VietQR: checkout + webhook ký số → grant | 💻 Dev | T21 | Sandbox: kích hoạt ≤ 1 phút; webhook lặp không cộng dồn |
| T23 | Paywall + so sánh gói, sau cổng phụ huynh | 🎨 UX/UI + 💻 Dev | T21, T19 | Paywall hiện đúng lúc hết lượt; không hiện ở chế độ bé |

### M4 — Beta & phát hành

| # | Ticket | Vai trò | Bị chặn bởi | Tiêu chí chấp nhận chính |
| --- | --- | --- | --- | --- |
| T24 | Closed beta web/PWA 50–100 gia đình + dashboard KPI | 🚀 Release + 🔍 BA | T07, T20, T22 | KPI beta đo được hằng ngày; phỏng vấn 10 gia đình |
| T25 | Đóng gói Capacitor: background audio, media session màn hình khoá, tải offline | 💻 Dev | T16 | Khoá màn hình 30 phút vẫn phát; điều khiển từ màn hình khoá |
| T26 | In-app purchase (Google Play Billing, StoreKit) map vào Entitlements | 💻 Dev | T21, T25 | Mua sandbox trên 2 nền tảng cấp đúng quyền |
| T27 | Tuân thủ: chính sách quyền riêng theo Luật 91/2025 + COPPA, khai báo Families/Kids, job xoá file ghi âm quá hạn | 🚀 Release + 🔍 BA | T11, T12 | Checklist store đạt; job xoá có test |
| T28 | Phát hành store + retro G6 (cập nhật skill/quy trình) | 🚀 Release | T24, T26, T27 | App duyệt trên 2 store; biên bản retro |

## Thứ tự & song song

- **Bắt đầu ngay (không blocker):** T01, T17.
- **Đường găng (critical path):** T01 → T02 → T08 → T09/T10/T11 → T12 → T13; song song T04 → T14 → T15 và T04 → T16 → T18 → T20 → T24.
- **Chạy song song được:** nhóm bảo mật (T03, T05) với nhóm hộ gia đình (T08–T11); âm thanh (T16, T17) với an toàn nội dung (T14, T15); biên tập nội dung cổ tích bắt đầu từ tuần 1, không chờ code.

## Trọng tâm review

| Tình huống dễ làm hỏng sản phẩm | Ticket sở hữu test |
| --- | --- |
| Mất mạng giữa lúc phát truyện / giữa lúc ông bà đang ghi âm | T16, T13 |
| Hai phụ huynh sửa cùng một truyện cùng lúc (cần `revision`) | T15 |
| Tên bé hoặc mô tả tự do chứa nội dung xấu / prompt injection | T14 |
| Webhook thanh toán đến lặp, đến trễ, hoặc sai thứ tự | T22 |
| Chủ hộ rời hộ / xoá tài khoản khi còn thành viên và gói đang chạy | T08, T21 |

## Định nghĩa “Xong” (mọi ticket)

- [ ] Test mới đỏ trước, xanh sau (TDD theo skill lap-trinh-tdd)
- [ ] CI xanh: lint, typecheck, unit, DB, build, E2E
- [ ] Review hai trục: chuẩn code + đúng spec (skill kiem-thu-qa), có bằng chứng chạy thật
- [ ] Migration rollback được; RLS có test
- [ ] Không secret trong code/log; README/ADR cập nhật nếu đổi hành vi

## Rủi ro kế hoạch

| Rủi ro | Giảm thiểu |
| --- | --- |
| Chất lượng clone giọng tiếng Việt (đặc biệt giọng ông bà, giọng địa phương) không đạt | Thử sớm ở tuần 1 với 10 giọng thật; ngưỡng chất lượng + hướng dẫn ghi lại |
| Chi phí TTS vượt dự kiến | `ai_cost_ledger` từ M0; cache mạnh; giới hạn render theo gói |
| Migration hộ gia đình làm hỏng dữ liệu cũ | Expand–contract, chạy thử trên bản sao staging trước |
| Store từ chối vì chính sách trẻ em / AI | T27 làm sớm; chọn danh mục Parenting; không SDK bên thứ ba |
| Biên tập kho cổ tích chậm | Bắt đầu tuần 1, song song với code |

## Cần anh/chị xác nhận

1. Độ mịn ticket đã hợp lý chưa? Cần gộp/tách ticket nào?
2. Quan hệ chặn đã đúng chưa?
3. Các câu hỏi mở trong Spec (thị trường, giá, BYO-key, danh mục store).
