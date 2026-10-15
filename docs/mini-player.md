# Trình nghe thu gọn (MiniPlayer) — PR #61

Bé rời trình nghe đầy đủ khi truyện đang đọc → truyện **đọc tiếp** trong thẻ
thu gọn phía trên thanh tab, trang này sang trang khác, tới hết truyện.

## Hành vi

| Tình huống | Kết quả |
| --- | --- |
| Rời trình nghe khi đang đọc | Chính phần tử audio đó chạy tiếp ở mini (không phát lại, không ngắt). |
| Rời trình nghe giữa hai trang | Mini đọc trang kế tiếp. |
| Hết một trang | Nghỉ như trình nghe đầy đủ (`pageGap` theo nhịp kể), rồi trang sau: URL đã biết → audio đã lưu đúng giọng (`audio_key`) → đọc mới (lưu lại cho lần sau). |
| Chế độ liền mạch (một file ghép) | Trang theo mốc thời gian; Trang trước/sau nhảy trong file. |
| Hết truyện | “Hết truyện rồi!”, ghi `complete` + phiên nhiệm vụ G-03 như trình nghe đầy đủ; thẻ chúc mừng gắn trên mini. Nút chính thành “Nghe lại từ đầu”. |
| Bấm tên truyện trên mini | Mở trình nghe đúng trang; cùng giọng/trang/vai → audio chạy tiếp, khác (đổi giọng) → đọc lại trang đó. |
| Hẹn giờ ngủ | Mang theo sang mini và ngược lại; tới giờ thì tạm dừng (kể cả khi trình duyệt hoãn timer — kiểm tra ở `timeupdate`). |
| Mở truyện khác | Truyện ở mini tạm dừng ngay — không bao giờ hai giọng cùng lúc. |
| Màn không có thanh tab (Tạo, ghi âm, Ru ngủ, …) | Truyện tạm dừng (các màn đó có âm thanh/micro riêng); quay lại thấy mini “Nghe tiếp”. |
| Đổi tài khoản / tắt công tắc Giọng đọc truyện | Dừng hẳn. |
| “Nghe tiếp” ở Trang chủ | Mở đúng trang đã nghe tới; thẻ tự cập nhật khi mini sang trang. |
| Lịch sử nghe (PR #62) | Một lượt nghe = một dòng `play_sessions`, một lần đếm `play_count`, phút nghe cộng vào chuỗi ngày đọc một lần — dù nghe ở trình đầy đủ, ở mini hay qua lại giữa hai nơi. |

## Lượt nghe (PR #62)

- Rời trình nghe đầy đủ → ghi dòng của lượt nghe (như trước). Truyện đọc tiếp ở mini →
  **cùng dòng đó** được cập nhật (thời gian, số trang, `completed`) khi hết truyện,
  khi tắt mini, khi mini chuyển sang truyện khác, hoặc khi app vào nền (khoá máy, đổi app).
- Đồng hồ của mini chỉ chạy khi truyện đang đọc/đang sang trang — lúc tạm dừng không tính.
  Dùng `performance.now()` (đơn điệu), không phụ thuộc giờ của máy.
- Bấm mini mở lại truyện → vẫn là lượt nghe đó (không ghi dòng thứ hai, không đếm thêm
  `play_count`, không ghi thêm sự kiện `play`). Hết truyện rồi “Nghe lại từ đầu” → lượt mới.
- Dưới 2 giây không tính (như trước). `completed` = đã nghe đủ mọi trang; `voice_id` = giọng
  gia đình đang đọc (giọng mẫu → để trống, vì DB chỉ nhận giọng của chính gia đình).
- Đổi tài khoản giữa chừng → lượt nghe cũ không ghi vào tài khoản mới.
- Code: `src/lib/listen-log.ts` (`ListenRecord`: lần đầu thêm dòng, sau đó cập nhật theo thứ tự),
  `logPlaySession` / `updatePlaySession` trong `src/lib/db.ts`. Test: `tests/unit/listen-log.test.ts`,
  `tests/unit/background-player.test.ts`, `tests/db/play-sessions.test.ts`, E2E trong `tests/e2e/mini-player.spec.ts`.

## Bố cục

`AppShell` có một dock cố định dưới cùng (`data-testid="bottom-dock"`): MiniPlayer
(60 px, cách nút Tạo nhô lên 26 px) + TabBar. Khi có mini, cuối trang có khoảng
trống 86 px (`mini-player-spacer`) để hàng cuối không bị che. Mọi nút 44×44.

## Code

- `src/lib/background-player.ts` — `BackgroundPlayer` thuần TypeScript (test bằng
  audio giả + đồng hồ tay: `tests/unit/background-player.test.ts`).
- `src/lib/audio-player-context.tsx` — provider (`useSyncExternalStore`, MediaSession).
  Màn chỉ cần biết “có đang phát không” dùng `useAudioPlaying()` / `useAudioControls()`
  (không re-render theo tiến độ); chỉ MiniPlayer dùng `useAudioPlayer()`.
- `src/lib/page-narration.ts` — đọc một trang, dùng chung cho player và mini.
- E2E: `tests/e2e/mini-player.spec.ts` (360×640, 375×667, 412×915).

## Giới hạn

- Lượt nghe được ghi khi rời trình nghe/khi app vào nền; nếu trình duyệt bị tắt đột ngột
  (không kịp vào nền) thì phần nghe sau lần ghi cuối bị mất — giống trình nghe đầy đủ.
- `stories.completion_rate` (thống kê admin) vẫn chưa được tính từ các dòng này.
- Kích thước màn kiểm bằng Chromium giả lập, chưa thử iPhone/Safari thật.
