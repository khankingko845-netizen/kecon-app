import Link from "next/link";

/** Every unknown URL — and `/admin` for anyone who isn't an admin (A-01). */
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[430px] flex-col items-center justify-center gap-3 bg-cream px-6 text-center">
      <p className="font-display text-[56px] font-bold leading-none text-brand-ink">404</p>
      <h1 className="font-display text-[24px] font-bold text-ink">Không tìm thấy trang</h1>
      <p className="text-[15px] font-semibold text-ink-2">Trang này không có hoặc đã được chuyển đi.</p>
      <Link
        href="/"
        className="mt-2 inline-flex min-h-[48px] items-center rounded-2xl bg-brand px-5 text-[16px] font-extrabold text-white"
      >
        Về trang chủ
      </Link>
    </main>
  );
}
