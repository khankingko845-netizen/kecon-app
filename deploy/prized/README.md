# Staging trên máy prized.dev (Ubuntu 24.04)

Một máy chạy **toàn bộ** KểCon: Supabase tự host (Supabase CLI + Docker, áp dụng `supabase/migrations`),
Next.js (`next start`), Caddy và Cloudflare quick tunnel. Máy không mở cổng inbound nên app ra
Internet qua tunnel (`https://<ngẫu-nhiên>.trycloudflare.com`). Đây là bước đầu của **T02** (môi trường staging).

```
Trình duyệt ──https──▶ Cloudflare tunnel ──▶ Caddy 127.0.0.1:8080
                                              ├─ /auth/v1 /rest/v1 /storage/v1 /realtime/v1 /graphql/v1 ─▶ Supabase Kong :54321
                                              └─ còn lại ─▶ Next.js 127.0.0.1:3000
```

## Thành phần

| Unit systemd | Việc |
| --- | --- |
| `kecon-supabase` | `supabase-stack.sh`: sinh `jwt_secret` + publishable/secret key **ngẫu nhiên** (`/srv/kecon/shared/supabase.secrets`, chmod 600), tắt Studio/Analytics/Edge, `supabase start` |
| `kecon-tunnel` | `cloudflared tunnel --url http://127.0.0.1:8080` (metrics `127.0.0.1:20241/quicktunnel` trả hostname) |
| `kecon-proxy` | Caddy theo `Caddyfile` — app và Supabase API chung một origin |
| `kecon-web` | `run-web.sh`: chờ URL tunnel, copy `.next-template` → `.next`, thay placeholder `kecon-public-origin.invalid` / `kecon-anon-key-placeholder`, rồi `next start` |
| `kecon-urlwatch.timer` | Mỗi phút: tunnel đổi URL (khởi động lại máy) → restart `kecon-web` |
| `kecon-backup.timer` | 03:15 giờ VN mỗi ngày (máy tạm dừng thì chạy bù khi thức): `backup/kecon_backup.py --verify-restore` → repo GitHub riêng tư `kecon-backup` (xem dưới) |

Unit dùng `User=@KECON_USER@`: `install-units.sh` (bootstrap/deploy gọi) thay bằng **chủ sở hữu `/srv/kecon`**
— tức user đã chạy `setup-server.sh` (vd. `doppel`, `longca`) — nên máy mới với tên user khác không phải sửa unit.

`NEXT_PUBLIC_*` bị inline lúc build nên bản build dùng placeholder; đổi URL tunnel hay xoay khoá anon **không cần build lại**.

## Lệnh

```bash
# 1 lần, từ user sẽ chạy app (sudo): Node 24, Supabase CLI, cloudflared, Caddy, git/gpg,
# swap 4 GB nếu RAM ≤ 6 GB, nhóm docker, /srv/kecon thuộc user đó. Xong thì đăng nhập lại (nhóm docker).
sudo bash deploy/prized/setup-server.sh

# máy dev: đóng gói + đẩy lên
SHA=$(git rev-parse --short HEAD)
git archive --format=tar.gz -o /tmp/kecon-$SHA.tar.gz HEAD
scp /tmp/kecon-$SHA.tar.gz <máy>@ssh.prized.dev:/tmp/

# trên máy staging — lần đầu
mkdir -p /srv/kecon/releases/$SHA && tar -xzf /tmp/kecon-$SHA.tar.gz -C /srv/kecon/releases/$SHA
bash /srv/kecon/releases/$SHA/deploy/prized/bootstrap.sh /tmp/kecon-$SHA.tar.gz $SHA
# các lần sau (build, migration up, giữ 3 release, restart web)
bash /srv/kecon/current/deploy/prized/deploy.sh /tmp/kecon-$SHA.tar.gz $SHA

cat /srv/kecon/shared/public-url                 # URL công khai hiện tại
bash /srv/kecon/current/deploy/prized/make-admin.sh email@cua.ban   # nâng tài khoản lên admin
journalctl -u kecon-web -f                        # log app
```

## Cấu hình

- `/srv/kecon/shared/app.env` (chmod 600): `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (sinh từ jwt_secret riêng)
  và key nhà cung cấp AI `ELEVENLABS_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `ANTHROPIC_API_KEY` — điền rồi
  `sudo systemctl restart kecon-web` (không cần build lại). Admin cũng có thể nhập key trong *Cài đặt hệ thống*.
- Đăng ký không cần xác nhận email (`enable_confirmations = false`); email (quên mật khẩu…) chỉ vào Inbucket nội bộ.
- Khoá mặc định công khai của Supabase CLI **không** có quyền service role (đã kiểm tra: chỉ được như anon).

## Sao lưu GitHub (hằng ngày)

`backup/kecon_backup.py` đẩy lên repo **riêng tư** `khankingko845-netizen/kecon-backup`: nhánh `main` có truyện
đọc được (README + `story.json`), tranh + audio gốc, ghi âm bố mẹ và cấu hình máy chủ (**mã hoá** AES-256);
nhánh `db-snapshots` có `pg_dump` toàn bộ DB (**mã hoá**, 7 ngày + 4 tuần + 6 tháng). Mỗi lần chạy giải mã bản
DB mới nhất, khôi phục thử vào database tạm và so số dòng. Cách khôi phục: README trong repo backup.

```bash
B=/srv/kecon/backup-github; mkdir -p $B && chmod 700 $B && umask 077
openssl rand -base64 32 > $B/passphrase    # mật khẩu mã hoá — GIỮ MỘT BẢN Ở NGOÀI MÁY CHỦ, mất là không giải mã được
# quyền đẩy (chọn 1): token fine-grained chỉ repo kecon-backup, Contents: Read and write …
cat > $B/github-token                      # dán token, Ctrl-D (không đưa token vào lệnh/lịch sử shell)
# … hoặc khoá SSH deploy key có quyền ghi: $B/deploy_key
python3 /srv/kecon/current/deploy/prized/backup/kecon_backup.py --verify-restore   # chạy thử lần đầu
sudo systemctl enable --now kecon-backup.timer   # deploy.sh tự bật khi đã có passphrase + quyền đẩy
cat $B/last-run.json                             # kết quả lần chạy gần nhất (exit 3 = đẩy lỗi, 4 = khôi phục thử lỗi)
```

## Giới hạn (staging)

- URL `trycloudflare.com` đổi khi máy/tunnel khởi động lại và không có SLA → production cần domain riêng
  (Cloudflare named tunnel hoặc mở cổng 443 + Caddy TLS).
- Postgres/Supabase chạy trên cùng máy; sao lưu ra ngoài **1 lần/ngày** (sự cố có thể mất tối đa ~1 ngày dữ liệu).
- Máy prized.dev dùng credit miễn phí: hết credit là máy dừng và **không đánh thức được** (tháng 10/2026 mất máy `lime`
  cùng toàn bộ dữ liệu vì khi đó chưa có bản sao lưu ngoài máy). Theo dõi credit; dữ liệu khôi phục từ repo backup.
