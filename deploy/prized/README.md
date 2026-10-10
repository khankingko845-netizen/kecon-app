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

`NEXT_PUBLIC_*` bị inline lúc build nên bản build dùng placeholder; đổi URL tunnel hay xoay khoá anon **không cần build lại**.

## Lệnh

```bash
# 1 lần (sudo): Node 24, Supabase CLI, cloudflared, Caddy, thư mục /srv/kecon
sudo bash deploy/prized/setup-server.sh

# máy dev: đóng gói + đẩy lên
SHA=$(git rev-parse --short HEAD)
git archive --format=tar.gz -o /tmp/kecon-$SHA.tar.gz HEAD
scp /tmp/kecon-$SHA.tar.gz lime@ssh.prized.dev:/tmp/

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

## Giới hạn (staging)

- URL `trycloudflare.com` đổi khi máy/tunnel khởi động lại và không có SLA → production cần domain riêng
  (Cloudflare named tunnel hoặc mở cổng 443 + Caddy TLS).
- Postgres/Supabase chạy trên cùng máy, chưa có backup tự động (`supabase db dump` theo lịch là bước tiếp theo).
