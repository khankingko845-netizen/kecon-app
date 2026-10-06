# KểCon — Nền tảng kể truyện AI cho gia đình Việt

<p align="center">
  <strong>Tạo truyện cá nhân hóa bằng AI, đọc bằng giọng người thân, với hiệu ứng âm thanh & hình ảnh sống động</strong>
</p>

---

## Mục lục

- [Giới thiệu](#giới-thiệu)
- [Tech Stack](#tech-stack)
- [Kiến trúc hệ thống](#kiến-trúc-hệ-thống)
- [Chức năng đã triển khai](#chức-năng-đã-triển-khai)
- [Cài đặt & Chạy](#cài-đặt--chạy)
- [Biến môi trường](#biến-môi-trường)
- [Database & Migrations](#database--migrations)
- [Cấu trúc thư mục](#cấu-trúc-thư-mục)
- [Tài khoản test](#tài-khoản-test)
- [API Routes (Server-side Proxy)](#api-routes-server-side-proxy)
- [Roadmap & Ý tưởng phát triển](#roadmap--ý-tưởng-phát-triển)
- [License](#license)

---

## Giới thiệu

**KểCon** là ứng dụng mobile-first giúp các gia đình Việt Nam tạo và nghe truyện kể cho bé, với:

- **AI tạo cốt truyện** tự động theo chủ đề, tuổi, tên bé
- **Clone giọng nói** người thân (bố, mẹ, ông, bà) qua ElevenLabs — bé nghe truyện bằng giọng gia đình
- **Hiệu ứng âm thanh môi trường** (mưa, gió, tiếng chim, nhạc cổ tích…) tự động khớp ngữ cảnh
- **Hiệu ứng hình ảnh** (tuyết rơi, sao lấp lánh, đom đóm, lá bay…) theo từng trang truyện
- **Truyện phân nhánh** (choose-your-own-adventure) — bé tự chọn hướng đi
- **Chế độ ru ngủ** với hẹn giờ, giảm âm dần, màn hình tối
- **Module quản trị** toàn diện cho admin

---

## Tech Stack

| Layer | Công nghệ |
|---|---|
| **Frontend** | Next.js 16, React 19, TypeScript 5, Tailwind CSS 4 |
| **Backend** | Next.js API Routes (server-side proxy) |
| **Database** | Supabase (PostgreSQL) + Row Level Security |
| **Auth** | Supabase Auth (email/password + Google OAuth) |
| **Storage** | Supabase Storage (audio files, TTS cache) |
| **Voice AI** | ElevenLabs (voice cloning + Text-to-Speech) |
| **Story AI** | OpenAI / Google Gemini / Anthropic Claude / Custom (OpenAI-compatible) |
| **Icons** | Lucide React |
| **File Parsing** | mammoth (DOCX), pdfjs-dist (PDF) |
| **Validation** | Zod |

---

## Kiến trúc hệ thống

```
┌──────────────────────────────────────────────────┐
│                   Client (React)                  │
│  AppShell → Screens → auth-context / data-context │
│              ↕ BYO-key Settings UI                │
└──────────┬──────────────────────┬────────────────┘
           │                      │
    Supabase SDK            fetch /api/*
    (Auth/DB/Storage)             │
           │               ┌─────┴─────┐
           ▼               │ API Routes │ ← API keys server-side
    ┌──────────┐           │ (proxy)    │
    │ Supabase │           └─────┬─────┘
    │ Cloud    │                 │
    │ - Auth   │          ┌──────┴──────┐
    │ - PgSQL  │          │ External AI │
    │ - Storage│          │ ElevenLabs  │
    │ - RLS    │          │ OpenAI/etc  │
    └──────────┘          └─────────────┘
```

**Nguyên tắc bảo mật:** Tất cả API key ngoại (ElevenLabs, OpenAI, Gemini, Claude) chỉ tồn tại ở server-side (API Routes). Client không bao giờ nhìn thấy key — chỉ gọi `/api/*` proxy.

---

## Chức năng đã triển khai

### 1. Xác thực & Phân quyền
- Đăng nhập / Đăng ký bằng email + mật khẩu
- Google OAuth (callback route)
- Tự động tạo profile khi đăng ký (trigger SQL)
- Phân quyền theo quyền hạn (Admin v2 · A-02, migration `019_admin_rbac.sql`): vai trò `user` + 7 vai trò nhân sự (bảng dưới). Quyền nằm ở DB (`admin_roles`, `admin_permissions`, `admin_role_permissions`); RLS và API route cùng gọi `has_permission('…')`; `src/lib/admin-permissions.ts` là bản sao cho UI (test DB so khớp hai bên)
- `is_admin()` giữ nghĩa cũ (`admin`/`super_admin`) cho các policy cũ — vai trò hẹp không đi qua nó
- Trang quản trị là route riêng `/admin` (Admin v2 · A-01): guard phía server (`src/lib/admin-guard.ts`) — chưa đăng nhập / user thường nhận 404 kể cả gõ URL; mục không có quyền cũng 404 và không hiện trên thanh bên

| Vai trò | Quyền | Ghi chú |
|---|---|---|
| `super_admin` · Super admin | tất cả | Người duy nhất đổi được vai trò (không tự đổi vai trò của mình) |
| `admin` · Admin (đầy đủ) | tất cả trừ `roles.manage` | Vai trò cũ — giữ nguyên những gì làm được trước A-02 |
| `ops` · Vận hành | `dashboard.view`, `analytics.view`, `settings.read`, `settings.write`, `voices.manage`, `notifications.send` | Sửa cài đặt **không bí mật**; không đọc / đặt API key |
| `editor` · Biên tập | `dashboard.view`, `stories.read`, `stories.write`, `categories.manage`, `templates.manage` | Chỉ truyện nền tảng (`is_platform_content`), không đụng truyện riêng của gia đình |
| `moderator` · Kiểm duyệt | `dashboard.view`, `stories.read`, `moderation.manage` | Xem truyện nền tảng, hàng chờ kiểm duyệt |
| `support` · Hỗ trợ | `dashboard.view`, `users.read` | Xem danh sách tài khoản, không sửa |
| `analyst` · Phân tích | `dashboard.view`, `analytics.view` | Chỉ số liệu tổng hợp (`admin_usage_summary()`) |

API key (`app_settings.is_secret`) chỉ `secrets.manage` (super_admin, admin) đọc / ghi được. Chỉ người có `stories.write` mới gắn / bỏ cờ truyện nền tảng (trigger `stories_guard_platform_content`). Rate limit ×5 / không giới hạn gói vẫn chỉ áp dụng cho `admin`/`super_admin`.

### 2. Trang Chủ (Home)
- Hiển thị tên gia đình, voice profiles, truyện gần đây
- Quick actions: tạo truyện, ghi âm, thư viện
- Gợi ý AI cá nhân hóa (theo tuổi bé, truyện đã nghe, thời gian trong ngày)
- Không còn ô "Quản trị" trên Trang chủ của bé — admin mở "Trang quản trị" trong tab Bố mẹ (sau cổng phụ huynh) hoặc vào thẳng `/admin`

### 3. Ghi Âm & Clone Giọng Nói
- Ghi âm mic trực tiếp trên trình duyệt (MediaRecorder API)
- Upload lên Supabase Storage
- Gửi ElevenLabs API để clone giọng → tạo voice profile
- Danh sách voice profiles với quality score, nút nghe thử

### 4. Tạo Truyện bằng AI
- Chọn chủ đề (cổ tích, phiêu lưu, ru ngủ, động vật, giáo dục, tùy chỉnh)
- Nhập tên bé, độ tuổi, chọn giọng đọc
- 4 AI providers: **OpenAI**, **Google Gemini**, **Anthropic Claude**, **Custom** (OpenAI-compatible)
  - Custom: nhập Base URL + API key + model → dùng OpenRouter, Groq, Together, LM Studio, Ollama…
- AI tạo truyện 8-12 trang với `sceneDescription` cho từng trang
- Lưu vào Supabase (stories + story_pages)

### 5. Story Editor (Viết & Chỉnh sửa truyện)
- Rich text editor cho từng trang
- Thêm / xoá / sắp xếp trang (drag & drop)
- Metadata: thể loại, mô tả, độ tuổi mục tiêu
- Gán hiệu ứng particle cho từng trang (tuyết, mưa, sao, đom đóm, lá, cánh hoa, bong bóng)
- Gán ambient sound cho từng trang
- Tạo lựa chọn phân nhánh (branching choices) → truyện tương tác
- Xuất bản / Lưu nháp

### 6. Upload Truyện
- Upload từ văn bản tự do (paste text)
- Upload file **.txt**, **.docx**, **.pdf** — parse thật (mammoth + pdfjs-dist)
- Upload từ URL (fetch & extract text)
- AI tự tách trang, tạo sceneDescription, gắn tags
- 5-bước pipeline: Upload → Phân tích → Chia trang → Gắn metadata → Xác nhận

### 7. Trình Đọc Truyện (StoryPlayer)
- Đọc từng trang với ElevenLabs TTS (bằng giọng đã clone)
- Controls: play/pause, skip, seek bar, tự động chuyển trang
- **Hiệu ứng hình ảnh particle** khớp ngữ cảnh (mưa, tuyết, sao, đom đóm, lá rơi, cánh hoa, bong bóng)
  - Ưu tiên: hiệu ứng gán sẵn từ editor > AI tự động phân tích sceneDescription > mặc định
- **Ambient audio** (Web Audio API 3 lớp: Voice + Ambient + SFX)
  - Oscillator-based ambient sounds (mưa, gió, đại dương, đêm, lửa trại, suối, công viên)
  - Volume mixer cho từng lớp
- Tracking play session (thời gian nghe, tỷ lệ hoàn thành)

### 8. Chế Độ Ru Ngủ (Lullaby)
- Màn hình tối, hiệu ứng sao lấp lánh
- Sound mixer: Mưa / Đại dương / Gió / Đêm
- Hẹn giờ thông minh (15/30/45/60 phút)
- Giảm âm dần khi gần hết giờ

### 9. Truyện Phân Nhánh (Adventure)
- Choose-your-own-adventure: bé chọn hướng đi tại các điểm rẽ
- Dữ liệu thật từ `story_pages.choices` (JSONB)
- Lịch sử đường đi, quay lại, đọc lại
- Migration `003_branching.sql`: thêm `choices` + `is_branching`

### 10. Voice Legacy (Cây gia đình giọng nói)
- Kết nối thật với bảng `family_members` trên Supabase
- Thêm / xoá thành viên gia đình
- Hiển thị cây gia đình theo thế hệ
- Đếm số truyện đã kể theo giọng mỗi thành viên
- Lưu giữ kỷ niệm giọng nói qua các thế hệ

### 11. Thư Viện Truyện (Library)
- Grid 2 cột, filter theo thể loại
- Tìm kiếm theo tên truyện
- Hiển thị trạng thái (nháp / đã xuất bản / đang nghe)
- Nhấn vào truyện → mở Player hoặc Editor

### 12. Gợi Ý Thông Minh (Recommendations)
- Content-based filtering (thể loại + tags tương tự)
- Context-aware: gợi ý ru ngủ buổi tối, phiêu lưu buổi sáng
- Trending: truyện được nghe nhiều nhất
- Gợi ý cho bé theo tuổi
- Gợi ý cho gia đình (truyện chưa ai nghe)

### 13. Module Quản Trị (Admin) — Chỉ vai trò nhân sự

Route riêng `/admin` (desktop-first, thanh bên; điện thoại/tablet có thanh mục ngang). Mỗi mục một URL: `/admin` (Tổng quan), `/admin/stories`, `/admin/users`, `/admin/analytics`, `/admin/categories`, `/admin/templates`, `/admin/settings` — map trong `src/lib/admin-routes.ts`. Server kiểm tra phiên + quyền (`my_admin_permissions()`) ở mọi request (`src/app/admin/[[...section]]/page.tsx`): không phải nhân sự hoặc thiếu quyền của mục (`admin-routes.ts` → `permission`) → 404 thường (không lộ tiêu đề / nội dung). Thanh bên chỉ hiện mục mình có quyền. E2E: `tests/e2e/admin.spec.ts`; RLS từng vai trò: `tests/db/admin-rbac.test.ts`.

#### 13a. Admin Dashboard
- 6 KPIs real-time: tổng truyện, đã xuất bản, lượt nghe, yêu thích, giọng nói, nháp
- Biểu đồ phân bố thể loại
- Gợi ý AI "content gaps" — thể loại nào cần thêm truyện
- Hàng chờ kiểm duyệt (moderation queue)
- Nút "Tạo truyện mới" → modal chọn: Viết tay / AI tạo / Upload file

#### 13b. Quản Lý Truyện (AdminStories)
- Danh sách tất cả truyện với search + filter (trạng thái / thể loại)
- Bulk actions: xuất bản / gỡ / xoá hàng loạt
- Per-row: sửa / xem trước / lưu template / xuất bản / xoá
- Soft delete (thùng rác) + khôi phục
- Story templates: lưu truyện làm template, tạo truyện mới từ template

#### 13c. Quản Lý Người Dùng (AdminUsers)
- Danh sách users + tìm kiếm
- Badge + ô chọn vai trò (Người dùng / 7 vai trò nhân sự)
- Đổi vai trò (chỉ `roles.manage` = super_admin; DB chặn cả khi gọi API trực tiếp)
- Số truyện + voice profiles mỗi user

#### 13d. Thống Kê (AdminAnalytics)
- Tỷ lệ hoàn thành trung bình
- Tổng phiên nghe
- Đăng ký mới 7 ngày
- Top 10 truyện được nghe nhiều nhất (bar chart)
- Lượt nghe theo thể loại (bar chart)

### 14. Cài Đặt (Settings)
- Cấu hình ElevenLabs API key + model (Multilingual v2, Turbo v2.5, Flash v2.5)
- Chọn AI Provider: OpenAI / Gemini / Anthropic / **Custom (OpenAI-compatible)**
  - Custom: nhập Base URL, API key, tên model
- Link trực tiếp đến trang lấy API key mỗi provider
- Trạng thái kết nối
- Nút Đăng Xuất

### 15. Tuân Thủ & Bảo Mật
- COPPA consent banner (yêu cầu xác nhận phụ huynh trước khi dùng)
- GDPR: xuất dữ liệu cá nhân (JSON), nút xoá tài khoản
- Service Worker cho offline caching
- Tất cả API keys server-side only
- Row Level Security trên toàn bộ bảng

---

## Cài đặt & Chạy

### Yêu cầu
- Node.js >= 18
- npm >= 9
- Supabase project (free tier đủ dùng)

### Bước 1: Clone repo

```bash
git clone https://github.com/khankingko845-netizen/kecon-app.git
cd kecon-app
```

### Bước 2: Cài dependencies

```bash
npm install
```

### Bước 3: Tạo file biến môi trường

```bash
cp .env.local.example .env.local
```

Chỉnh sửa `.env.local` với thông tin Supabase project của bạn (xem mục [Biến môi trường](#biến-môi-trường)).

### Bước 4: Chạy database migrations

Vào Supabase Dashboard → SQL Editor → chạy lần lượt **tất cả** file trong `supabase/migrations/` theo thứ tự số (001 → 016).

> ⚠️ `016_security_hardening.sql` là bản vá bảo mật bắt buộc (chặn leo thang quyền, hạn mức phía server). Dự án đang chạy cần áp dụng ngay.

### Bước 5: Chạy dev server

```bash
npm run dev
```

Mở [http://localhost:3000](http://localhost:3000).

### Build production

```bash
npm run build
npm start
```

### Kiểm thử & chất lượng code

| Lệnh | Nội dung |
|---|---|
| `npm run lint` | ESLint (Next.js + React Compiler rules) |
| `npm run typecheck` | TypeScript `tsc --noEmit` |
| `npm test` | Vitest: unit test `tests/unit` + test migration Supabase bằng PGlite `tests/db` (không cần Supabase thật) |
| `npm run test:e2e` | Playwright smoke test `tests/e2e` (tự build + start app ở port 3100 với Supabase giả) |

Lần đầu chạy E2E: `npx playwright install chromium` (hoặc đặt `PLAYWRIGHT_CHROMIUM_PATH` trỏ tới Chromium có sẵn).

**CI:** GitHub Actions (`.github/workflows/ci.yml`) chạy lint → typecheck → test → build, sau đó E2E smoke cho mọi push và pull request. CI dùng biến môi trường giả, không cần secret.

---

## Biến môi trường

Tạo file `.env.local` (không commit lên git):

```env
# Bắt buộc — Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key

# Bắt buộc — URL redirect auth
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Khuyến nghị — Service role key (CHỈ server-side, không có tiền tố NEXT_PUBLIC_)
# Cho phép API route đọc API key admin cấu hình trong Cài Đặt Hệ Thống cho mọi user.
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key

# Tuỳ chọn — API keys cho AI (server-side only)
ELEVENLABS_API_KEY=your-elevenlabs-key
OPENAI_API_KEY=your-openai-key
GEMINI_API_KEY=your-gemini-key
ANTHROPIC_API_KEY=your-anthropic-key
```

> **Bảo mật:** Không bao giờ đưa `SUPABASE_SERVICE_ROLE_KEY` vào code client hoặc biến `NEXT_PUBLIC_*`.

> **Lưu ý:** Nếu không có API keys ngoại, app vẫn chạy — các tính năng AI sẽ hiện "Chưa cấu hình". User cũng có thể nhập key riêng trong Cài Đặt (BYO-key model).

---

## Database & Migrations

### Migrations (chạy theo thứ tự số):

| File | Nội dung |
|---|---|
| `001_initial_schema.sql` | 9 bảng chính, RLS policies, triggers, function `is_admin()` |
| `002_storage_and_functions.sql` | Storage buckets, helper functions |
| `003_branching.sql` | Thêm `story_pages.choices` + `stories.is_branching` |
| `004_admin_upgrade.sql` | `is_platform_content`, `deleted_at`, bảng `story_templates`, RLS admin |
| `005` → `015` | Rating/chia sẻ/yêu thích, push + gói cước, app settings, giọng mặc định, nhân vật, offline/gamification/parental, thông báo, danh mục & template |
| `016_security_hardening.sql` | Bảo vệ cột `role`/`current_plan`, khoá bộ đếm `usage_limits`, hàm `consume_usage()` (rate limit + hạn mức gói phía server) |
| `017` → `018` | PIN phụ huynh bcrypt phía server, khoá sau 5 lần sai, đặt lại PIN bằng mật khẩu |
| `019_admin_rbac.sql` | RBAC: `admin_roles` / `admin_permissions` / `admin_role_permissions`, `has_permission()`, `my_admin_permissions()`, `admin_usage_summary()`, policy cho vai trò hẹp, API key chỉ `secrets.manage`, chuyển `admin`/`super_admin` cũ |

### Bảng chính:
- `profiles` — User profiles (display_name, role, child_name, child_age...)
- `voice_profiles` — Giọng nói đã clone (elevenlabs_voice_id, quality_score...)
- `stories` — Truyện (title, category, is_published, is_platform_content, deleted_at...)
- `story_pages` — Trang truyện (content, scene_description, particle_effect, choices...)
- `story_templates` — Templates truyện cho admin
- `family_members` — Thành viên gia đình (voice legacy)
- `audio_cache` — Cache TTS audio URLs
- `play_sessions` — Phiên nghe (duration, completion_percentage)
- `usage_tracking` — Theo dõi sử dụng API

---

## Cấu trúc thư mục

```
kecon-app/
├── src/
│   ├── app/
│   │   ├── page.tsx                    # Entry point → AppShell
│   │   ├── layout.tsx                  # Root layout + providers
│   │   ├── globals.css                 # Tailwind 4 styles
│   │   ├── actions/auth.ts             # Server action: signOut
│   │   ├── auth/callback/route.ts      # Google OAuth callback
│   │   └── api/
│   │       ├── voice/clone/route.ts    # Proxy: ElevenLabs voice clone
│   │       ├── voice/tts/route.ts      # Proxy: ElevenLabs TTS
│   │       ├── voice/list/route.ts     # Proxy: list voices
│   │       ├── story/generate/route.ts # Proxy: AI story generation
│   │       └── story/illustrate/route.ts # Proxy: AI illustration
│   ├── components/
│   │   ├── AppShell.tsx                # SPA router + navigation + admin gating
│   │   ├── ComplianceLayer.tsx         # COPPA/GDPR wrapper
│   │   └── screens/
│   │       ├── Home.tsx                # Trang chủ
│   │       ├── Login.tsx               # Đăng nhập
│   │       ├── Signup.tsx              # Đăng ký
│   │       ├── Onboarding.tsx          # Giới thiệu app
│   │       ├── VoiceRecording.tsx      # Ghi âm giọng
│   │       ├── VoiceProfiles.tsx       # Quản lý giọng nói
│   │       ├── VoiceLegacy.tsx         # Cây gia đình giọng nói
│   │       ├── CreateStory.tsx         # Tạo truyện AI
│   │       ├── UploadStory.tsx         # Upload truyện (txt/docx/pdf/url)
│   │       ├── StoryEditor.tsx         # Editor truyện
│   │       ├── StoryPlayer.tsx         # Đọc truyện + particles + ambient
│   │       ├── Library.tsx             # Thư viện truyện
│   │       ├── Adventure.tsx           # Truyện phân nhánh
│   │       ├── Lullaby.tsx             # Chế độ ru ngủ
│   │       ├── Settings.tsx            # Cài đặt + API keys
│   │       ├── AdminDashboard.tsx      # Admin: KPIs + tạo truyện
│   │       ├── AdminStories.tsx        # Admin: quản lý truyện
│   │       ├── AdminUsers.tsx          # Admin: quản lý users
│   │       └── AdminAnalytics.tsx      # Admin: thống kê
│   └── lib/
│       ├── db.ts                       # Data access layer (Supabase queries)
│       ├── api-client.ts              # LLM/TTS/image generation interface
│       ├── auth-context.tsx           # Auth provider (session, profile, isAdmin)
│       ├── data-context.tsx           # Global state (stories, voices)
│       ├── settings-context.tsx       # Settings provider (API keys)
│       ├── audio-engine.ts            # Web Audio API ambient sounds
│       ├── scene-effects.ts           # Particle effect mapping
│       ├── recommendations.ts         # AI recommendation engine
│       ├── story-ai.ts               # AI story generation logic
│       ├── elevenlabs.ts             # ElevenLabs API wrapper
│       ├── file-parser.ts            # DOCX/PDF/TXT parser
│       ├── data.ts                   # Mock/seed data
│       ├── types.ts                  # TypeScript types (Screen, Story, etc.)
│       └── supabase/                 # Supabase client (browser + server)
├── supabase/
│   └── migrations/                   # SQL migrations (001-004)
├── public/
│   └── sw.js                         # Service Worker (offline cache)
├── .env.local.example                # Template biến môi trường
├── next.config.ts                    # Next.js config
├── tailwind.config.ts                # Tailwind config
├── tsconfig.json                     # TypeScript config
└── package.json
```

---

## Tài khoản test

Không lưu thông tin đăng nhập trong repo. Để tạo super admin cho môi trường của bạn: đăng ký tài khoản trong app, sau đó chạy trong Supabase SQL Editor:

```sql
UPDATE public.profiles SET role = 'super_admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'you@example.com');
```

> Đăng nhập tài khoản super admin → tab **Bố mẹ** (qua cổng phụ huynh) → **Trang quản trị**, hoặc vào thẳng `/admin`. Gán vai trò hẹp cho nhân sự khác ở `/admin/users`.

---

## Hạn mức & Rate limit (phía server)

Mọi API route gọi AI/TTS đều đi qua `guardUsage()` (`src/lib/usage-guard.ts`) → RPC `consume_usage()`:

| Loại | Rate limit (đơn vị / phút) | Hạn mức theo gói |
|---|---|---|
| `story` (tạo truyện AI, truyện từ hình vẽ) | 5 | `subscription_plans.story_limit` / tháng |
| `voice_clone` | 3 | `subscription_plans.voice_clone_limit` (số giọng hiện có hoặc số lần clone trong tháng, lấy số lớn hơn) |
| `tts` (đọc truyện, âm thanh nền) — 1 đơn vị / 1.000 ký tự, tối đa 10.000 ký tự/lần | 60 | — |
| `illustration` — 1 đơn vị / ảnh, tối đa 20 trang/batch | 20 | — |
| `ai` (dịch, từ vựng, cá nhân hoá, scan; đánh giá chuyên gia = số chuyên gia) | 20 | — |

- Người dùng dùng **API key riêng (BYO)** không bị tính hạn mức gói, chỉ áp dụng rate limit.
- Admin được rate limit ×5 và không giới hạn gói.
- Gói được xác định từ `user_subscriptions` còn hạn; nếu đã từng có subscription nhưng hết hạn → `free`; nếu chưa từng có → `profiles.current_plan` (chỉ admin sửa được).
- Base URL tuỳ chỉnh từ client chỉ được dùng khi client gửi kèm API key riêng, phải là địa chỉ công khai (kiểm tra cả DNS) và không theo redirect.
- Nếu chưa chạy migration 016, request dùng key nền tảng trả **503** (fail-closed). Có thể tạm đặt `USAGE_GUARD_FAIL_OPEN=1` trong lúc chuyển đổi.

---|---|---|
| `story` (tạo truyện AI, truyện từ hình vẽ) | 5 | `subscription_plans.story_limit` / tháng |
| `voice_clone` | 3 | `subscription_plans.voice_clone_limit` (tổng số giọng) |
| `tts` (đọc truyện, âm thanh nền) | 60 | — |
| `illustration` | 10 | — |
| `ai` (dịch, từ vựng, cá nhân hoá, chuyên gia, scan) | 20 | — |

- Người dùng dùng **API key riêng (BYO)** không bị tính hạn mức gói, chỉ áp dụng rate limit.
- Admin được rate limit ×5 và không giới hạn gói.
- Base URL tuỳ chỉnh từ client chỉ được dùng khi client gửi kèm API key riêng, và không được trỏ tới địa chỉ nội bộ.

---

## AI Agent Skills

Repo kèm bộ skill cho AI agent (Claude Code, Codex, Cursor, Notion AI…) trong `.agents/skills/`. Xem bản đồ vai trò → skill tại `.agents/skills/ROLES.md`.

---

## API Routes (Server-side Proxy)

Tất cả external API calls đi qua Next.js API Routes để giữ key an toàn:

| Route | Mô tả |
|---|---|
| `POST /api/voice/clone` | Clone giọng nói qua ElevenLabs |
| `POST /api/voice/tts` | Text-to-Speech qua ElevenLabs |
| `GET /api/voice/list` | Danh sách voices từ ElevenLabs |
| `POST /api/story/generate` | Tạo truyện bằng AI (OpenAI/Gemini/Claude/Custom) |
| `POST /api/story/illustrate` | Tạo minh hoạ AI (DALL·E) |

---

## Roadmap & Ý tưởng phát triển

### Ngắn hạn (1-3 tháng)

- [x] **Push notifications** — nhắc bé nghe truyện trước giờ ngủ, truyện mới từ admin ✅
- [x] **Multi-language** — hỗ trợ tiếng Anh, tiếng Nhật (cho gia đình Việt kiều) ✅
- [x] **Chia sẻ truyện** — chia sẻ truyện giữa các gia đình, link public ✅
- [x] **Rating & review** — bố mẹ đánh giá truyện, comment ✅
- [x] **AI illustration thật** — DALL·E 3 tạo ảnh minh hoạ cho từng trang ✅
- [x] **Subscription model** — gói miễn phí (5 truyện/tháng) + premium (không giới hạn) ✅
- [x] **Batch voice generation** — pre-generate TTS cho toàn bộ truyện, không cần chờ khi đọc ✅

### Trung hạn (3-6 tháng)

- [ ] **Mobile app** — wrap React thành native app bằng Capacitor / React Native
- [x] **Offline mode nâng cao** — download truyện + audio để đọc không cần Internet ✅
- [ ] **Collaborative stories** — nhiều user cùng viết 1 truyện
- [ ] **Story marketplace** — admin/creator đăng truyện, user mua bằng xu
- [x] **Gamification** — huy hiệu (12), streak, XP/Level, thử thách đọc ✅
- [x] **Parental controls nâng cao** — PIN, giới hạn thời gian, giờ ngủ, chặn thể loại, độ tuổi ✅
- [x] **Analytics cho phụ huynh** — dashboard theo dõi thói quen nghe của bé ✅
- [ ] **AI voice enhancement** — cải thiện chất lượng giọng clone (noise reduction, emotion tuning)

### Dài hạn (6-12 tháng)

- [ ] **AI tạo truyện theo hình vẽ** — bé vẽ tranh → AI tạo truyện từ bức vẽ
- [ ] **Interactive AR** — hiệu ứng 3D/AR khi đọc truyện (dùng camera)
- [ ] **Voice-to-voice conversation** — bé nói chuyện với nhân vật trong truyện (real-time AI)
- [ ] **Multi-device sync** — đồng bộ tiến trình nghe giữa điện thoại và tablet
- [ ] **Smart TV app** — đọc truyện trên TV lớn cho cả gia đình
- [ ] **Educational mode** — truyện dạy ABC, số đếm, tiếng Anh, STEM concepts
- [ ] **Community features** — forum bố mẹ chia sẻ kinh nghiệm dạy con qua truyện
- [ ] **White-label** — cho phép trường học, NXB sử dụng engine của KểCon

### Ý tưởng sáng tạo

- **"Giọng nói vượt thời gian"** — Ông bà ghi âm giọng nói, lưu giữ cho cháu chắt nghe sau này
- **"Truyện theo cảm xúc"** — bé chọn cảm xúc (vui/buồn/sợ/phấn khích) → AI tạo truyện phù hợp
- **"Truyện theo thời tiết"** — app đọc thời tiết thật → tạo truyện có mưa/nắng/tuyết thật
- **"Truyện theo ảnh"** — chụp ảnh thú cưng, đồ chơi → AI tạo truyện với nhân vật đó
- **"Duet mode"** — bố mẹ đọc 1 phần, AI đọc phần còn lại (reading together)
- **"Truyện theo nhạc"** — chọn bài nhạc → AI tạo truyện theo mood bài nhạc
- **"Time capsule"** — ghi âm giọng bé đọc truyện hôm nay, mở lại sau 10 năm
- **"Truyện theo vị trí"** — GPS detect (ở biển, ở núi, ở nhà) → truyện phù hợp địa điểm

---

## License

Private repository. All rights reserved.

---

<p align="center">
  <em>KểCon — Mỗi câu chuyện, mỗi giọng nói, là một kỷ niệm gia đình</em>
</p>
