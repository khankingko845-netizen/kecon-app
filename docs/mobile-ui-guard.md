# Mobile UI guard (PR #55)

`tests/e2e/mobile-ui.spec.ts` opens the main kid and parent screens at 360×640
(the smallest common Android phone) and fails with a list of offenders when:

| Rule | Why |
| --- | --- |
| The page scrolls sideways (`scrollWidth > innerWidth + 1`) | Sideways scrolling hides controls and feels broken on phones. |
| A visible control has no accessible name (`aria-label`, `aria-labelledby`, text, `<label>`, placeholder, `title` or image `alt`) | Screen readers would announce just "button". |
| A visible control is smaller than 44×44 px | Apple HIG / WCAG 2.5.5 target size; small fingers. |
| Visible text is smaller than 12 px | Readability for parents on small screens. |

Exemptions are deliberate and few:

- Range sliders (`input[type=range]`) — the track is the target.
- A checkbox/radio inside a `<label>` is measured by its label.
- Elements under `aria-hidden="true"` or `inert`, and 1-px sr-only inputs.

Screens covered: Trang chủ, Thư viện, Giọng đọc, Tạo truyện, Bầu trời của Đóm,
Bố mẹ, Tuần của bé, Hồ sơ gia đình, Kiểm soát phụ huynh, Thống kê của bé,
Thông báo, Gói cước, and the story player (title is the page `h1`; the voice +
topic line stays on one row and truncates a long voice name).

Not covered (yet): Bộ sưu tập (only shown for the 9–12 age band), Tải về (no
entry point in the current menus), screens behind flags that are off on staging
(Vẽ truyện, Đố vui từ vựng, Chuyên gia).

To keep the visual size of a small icon while giving it a 44 px target, wrap
the icon in an `aria-hidden` span and give the button `h-11 w-11` with negative
margins (`-my-1.5 -mr-1.5`) so the row height doesn't change.
