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

- Thời gian nghe ở mini chưa ghi vào phiên nghe (play sessions) của bố mẹ.
- Kích thước màn kiểm bằng Chromium giả lập, chưa thử iPhone/Safari thật.
