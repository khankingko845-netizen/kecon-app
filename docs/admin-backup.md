# Admin › Sao lưu

Migration `040_admin_backup.sql`, trang `/admin/backup`, worker `deploy/prized/backup/kecon_backup.py --tick`.
Bổ sung (không xoá gì): quyền `backups.manage`, bảng `backup_settings` / `backup_requests` / `backup_runs` / `backup_worker`
(RLS bật, không policy, `REVOKE ALL`: chỉ đọc/ghi qua RPC), 2 trigger audit.

## Nguyên tắc

- **Web không chạy gì trên máy chủ.** Nhân sự chỉ ghi dòng vào DB (cài đặt, yêu cầu "Sao lưu ngay", token). Máy chủ
  tự hỏi DB mỗi 2 phút (`kecon-backup.timer` → `--tick`, psql trong container DB) rồi chạy và báo kết quả về.
- Quyền `backups.manage`: super_admin + admin, luôn sau phiên TOTP A-05. Đổi token cần thêm `secrets.manage`.
- **Không có trên web:** repo sao lưu (`KECON_BACKUP_REPO`), mật khẩu mã hoá (`passphrase`), deploy key — đổi được từ
  trang web nghĩa là lấy được dữ liệu ra ngoài. Chúng chỉ nằm trên máy chủ (file chmod 600 trong `/srv/kecon/backup-github`).
- Không bao giờ lộ token: Vault giữ giá trị, bảng chỉ có 4 ký tự cuối + loại + ngày lưu; lỗi git/GitHub được lọc token
  trước khi ghi vào `backup_runs.error`.

## Trang quản trị

- **Trạng thái:** lần thành công gần nhất, lần chạy tới (giờ VN), máy chủ sao lưu (nhịp tim, bản release, repo, cách đẩy,
  token còn bao nhiêu ngày). Có lượt đang chạy thì hiện bước hiện tại (`aria-live`) và tự tải lại mỗi 5 giây, bình thường 60 giây.
- **Cảnh báo đỏ** (cả ở Tổng quan quản trị): máy chủ im lặng > 10 phút hoặc chưa báo lần nào, thiếu passphrase, lần gần nhất
  lỗi, chưa có / quá 36 giờ chưa có bản thành công, token sai / hết hạn / không có quyền đẩy. **Vàng:** token hết hạn trong
  ≤ 14 ngày, token classic, chưa kiểm tra được token.
- **Sao lưu ngay:** lý do 10–500 ký tự, tối đa 1 yêu cầu đang mở và 3 yêu cầu/giờ; yêu cầu chờ quá 6 giờ (máy chủ tắt) hết hạn.
  Máy chủ nhận ở lượt kế tiếp (≤ 2 phút), ưu tiên trước lịch hằng ngày.
- **Lịch & số bản giữ lại:** giờ chạy hằng ngày (giờ VN) + số bản theo ngày (3–30) / tuần (0–12) / tháng (0–24); lưu kèm lý do,
  khoá phiên bản (2 người cùng sửa → người sau được báo, không ghi đè). Giảm số bản mà làm mất bản chụp đang có thì trang liệt kê
  các bản sẽ **xoá vĩnh viễn** (nhánh `db-snapshots` bị ghi đè) và bắt tick xác nhận. Ước tính số bản + dung lượng khi đủ lịch sử.
- **Token GitHub:** dán token mới → server kiểm tra với GitHub **trước khi lưu** (đúng định dạng, còn hiệu lực, có quyền ghi repo
  sao lưu mà máy chủ báo, đọc ngày hết hạn) → lưu vào Vault. Token sai thì không lưu gì. Máy chủ chép sang `github-token`
  (chmod 600) ở lượt kế tiếp và kiểm tra lại; từ đó bản trong Vault được ưu tiên.
- **Bản chụp DB** đang giữ (giờ chụp, dung lượng) và **lịch sử chạy** (loại, kết quả, thời lượng, số truyện/file, commit, lỗi).

## Lịch chạy

- Mốc = lần gần nhất của giờ đã đặt ≤ hiện tại (Asia/Ho_Chi_Minh). Mốc xong khi có một lượt **thành công** bắt đầu sau mốc
  (lịch, "Sao lưu ngay" hay chạy tay trên máy chủ đều tính).
- Lượt theo lịch lỗi → thử lại sau 30 phút, tối đa 3 lần mỗi mốc. Máy chủ tắt đúng giờ → chạy khi bật lại (trước mốc kế tiếp).
- Đổi giờ: các mốc trước lúc đổi không tính là "bị lỡ" — giờ mới đã qua hôm nay thì chạy từ ngày mai, không chạy bù bất ngờ.
- Lượt đang chạy mà máy chủ khởi động lại / tiến trình bị dừng → lượt kế tiếp đóng nó là lỗi "Bị gián đoạn".
- Kiểm tra token: trước mỗi lượt chạy, khi token đổi và mỗi 6 giờ.

## Audit

| Hành động | Ghi khi |
| --- | --- |
| `backup.settings_update` | trigger trên `backup_settings` (giờ / số bản thay đổi, kèm lý do, trước → sau) |
| `backup.token_set` | trigger trên `backup_settings` khi token đổi (chỉ loại + 4 ký tự cuối) |
| `backup.token_check` | API `/api/admin/backup/token`, **trước** khi gọi GitHub (loại + 4 ký tự cuối + lý do) — cả khi token bị từ chối |
| `backup.run_request` | trigger trên `backup_requests` ("Sao lưu ngay", kèm lý do) |

## Deploy / khôi phục

1. Sao lưu DB trước 040; thử 040 trong `BEGIN … ROLLBACK` trên staging.
2. `deploy.sh` chạy migration rồi **luôn** `enable` + `restart kecon-backup.timer` (timer 2 phút, `AccuracySec=15s`).
   Tick vẫn chạy khi máy chủ thiếu cấu hình: thiếu passphrase → không sao lưu, trang báo đỏ; thiếu token / deploy key →
   bản chụp chỉ nằm trên máy chủ, lượt chạy báo "đẩy lên GitHub lỗi".
3. Lượt tick đầu tiên chép `last-run.json` của job hằng ngày cũ thành một dòng lịch sử ("trên máy chủ"), nên nếu hôm nay đã
   sao lưu thì không chạy lại ngay.
4. Kiểm tra bằng tài khoản QA riêng (TOTP): trang hiển thị đúng, token giả bị từ chối và không lưu, lưu token thật → máy chủ
   chuyển sang bản Vault, "Sao lưu ngay" → thành công + đã đẩy. Dọn tài khoản QA, trả cài đặt về như cũ.
5. Rollback code: bảng/RPC 040 vô hại với bản cũ (bản cũ chạy timer 03:15 không `--tick`). Không xoá bảng để chữa lỗi UI.

Chạy tay trên máy chủ vẫn được: `kecon_backup.py --verify-restore` (ghi lịch sử loại "trên máy chủ"), `--no-push` để thử
(không ghi lịch sử, không tính là bản sao lưu của ngày).

## Kiểm thử

DB (`tests/db/admin-backup.test.ts`): quyền + TOTP, RLS chặn đọc/ghi trực tiếp, lịch (mốc, đổi giờ, thử lại, giờ VN), yêu cầu
(1 mở, 3/giờ, hết hạn), poll/progress/finish, lượt bị gián đoạn, nhập lịch sử cũ, chế độ cli/peek, token trong Vault, kết quả
kiểm tra token chỉ giữ trường đã biết, audit. Unit: thư viện (`admin-backup.test.ts`: cảnh báo, giữ bản — cùng quy tắc với
Python, định dạng), API token (`admin-backup-route.test.ts`), deploy + worker (`deploy-prized.test.ts`). E2E
`admin-backup.spec.ts` (mock): trạng thái + axe, "Sao lưu ngay", giảm số bản phải xác nhận xoá, token bị từ chối rồi lưu được.
