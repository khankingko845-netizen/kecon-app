"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { adminAccess, type AdminAccess } from "@/lib/admin-session";
interface Factor {
  id: string;
  friendly_name?: string;
}
interface Enrollment {
  id: string;
  qr: string;
  secret: string;
}
export default function AdminMfaGate({ access }: { access: AdminAccess }) {
  const router = useRouter();
  const [factors, setFactors] = useState<Factor[]>([]);
  const [unfinished, setUnfinished] = useState<Factor[]>([]);
  const [selected, setSelected] = useState("");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    createClient()
      .auth.mfa.listFactors()
      .then(({ data, error }) => {
        if (!live) return;
        if (error) {
          setError("Chưa tải được phương thức xác thực. Vui lòng thử lại.");
        } else {
          const verified = (data?.totp ?? []).filter(
            (f) => f.status === "verified",
          );
          setUnfinished(
            (data?.all ?? []).filter(
              (f) => f.factor_type === "totp" && f.status === "unverified",
            ),
          );
          setFactors(verified);
          setSelected(verified[0]?.id ?? "");
        }
        setLoaded(true);
      })
      .catch(() => {
        if (live) {
          setError("Chưa tải được phương thức xác thực.");
          setLoaded(true);
        }
      });
    return () => {
      live = false;
    };
  }, []);
  async function enroll() {
    setBusy(true);
    setError("");
    try {
      const { data, error } = await createClient().auth.mfa.enroll({
        factorType: "totp",
        issuer: "KeCon",
        friendlyName: `KeCon Admin ${crypto.randomUUID().slice(0, 8)}`,
      });
      if (error || !data) throw Error();
      setEnrollment({
        id: data.id,
        qr: data.totp.qr_code,
        secret: data.totp.secret,
      });
      setCode("");
    } catch {
      setError(
        "Không thiết lập được MFA. Thử lại hoặc liên hệ người quản lý hệ thống.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function cancel(id = enrollment?.id) {
    if (!id) return;
    setBusy(true);
    try {
      const { error } = await createClient().auth.mfa.unenroll({
        factorId: id,
      });
      if (error) throw Error();
      setUnfinished((prev) => prev.filter((f) => f.id !== id));
      if (enrollment?.id === id) setEnrollment(null);
      setCode("");
    } catch {
      setError("Chưa huỷ được thiết lập. Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  }
  async function open() {
    setBusy(true);
    setError("");
    try {
      const result = await adminAccess(createClient(), "open_admin_session");
      if (result.state !== "ready") throw Error();
      setCode("");
      setEnrollment(null);
      router.refresh();
    } catch {
      setError(
        access.requires_mfa
          ? "Phiên chưa được xác thực. Nhập mã mới từ ứng dụng xác thực."
          : "Cần đăng nhập lại để mở phiên quản trị mới.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function verify(event: React.FormEvent) {
    event.preventDefault();
    const factorId = enrollment?.id || selected;
    if (!factorId || !/^\d{6}$/.test(code)) {
      setError("Nhập mã xác thực gồm 6 chữ số.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const { error } = await createClient().auth.mfa.challengeAndVerify({
        factorId,
        code,
      });
      setCode("");
      if (error) {
        setError("Mã không đúng hoặc đã hết hạn. Dùng mã mới để thử lại.");
        return;
      }
      const result = await adminAccess(createClient(), "open_admin_session");
      if (result.state !== "ready") {
        setError(
          "MFA đã xác minh nhưng chưa mở được phiên quản trị. Vui lòng thử lại.",
        );
        return;
      }
      setEnrollment(null);
      router.refresh();
    } catch {
      setError("Không kết nối được máy chủ xác thực. Vui lòng thử lại.");
    } finally {
      setBusy(false);
    }
  }
  async function loginAgain() {
    setBusy(true);
    await createClient().auth.signOut({ scope: "local" });
    window.location.assign("/");
  }
  return (
    <main className="min-h-screen bg-parent-bg px-5 py-12 font-parent text-ink">
      <section
        className="mx-auto max-w-lg rounded-3xl border border-gray-200 bg-white p-6 shadow-sm"
        aria-labelledby="admin-mfa-title"
      >
        <h1 id="admin-mfa-title" className="text-2xl font-bold">
          Xác thực quản trị
        </h1>
        <p className="mt-3 text-ink-2">
          {access.state === "session_expired"
            ? "Phiên quản trị đã khoá sau 30 phút không hoạt động. Xác thực lại để tiếp tục."
            : access.requires_mfa
              ? "Tài khoản có quyền ghi cần xác thực hai lớp trước khi mở quản trị."
              : "Mở phiên quản trị chỉ đọc. Phiên khoá sau 30 phút không hoạt động."}
        </p>
        <p className="mt-3 text-sm text-ink-2">
          Dùng Google Authenticator, Microsoft Authenticator hoặc ứng dụng TOTP
          tương thích. Không gửi mã hay khoá thiết lập vào chat.
        </p>
        {error && (
          <p
            role="alert"
            aria-label="Lỗi xác thực quản trị"
            className="mt-4 rounded-xl bg-red-50 p-3 text-red-800"
          >
            {error}
          </p>
        )}
        {!loaded && (
          <p role="status" className="mt-4">
            Đang tải phương thức xác thực…
          </p>
        )}
        {access.state === "unavailable" && (
          <button
            onClick={() => router.refresh()}
            className="mt-4 min-h-11 rounded-xl border px-4"
          >
            Thử tải lại
          </button>
        )}
        {loaded && unfinished.length > 0 && !enrollment && (
          <div className="mt-4">
            <p>Thiết lập chưa hoàn tất có thể được huỷ để bắt đầu lại.</p>
            {unfinished.map((f) => (
              <button
                key={f.id}
                disabled={busy}
                onClick={() => cancel(f.id)}
                className="mt-2 min-h-11 rounded-xl border px-4"
              >
                Huỷ thiết lập chưa hoàn tất: {f.friendly_name || "TOTP"}
              </button>
            ))}
          </div>
        )}
        {loaded &&
          access.requires_mfa &&
          !enrollment &&
          factors.length === 0 && (
            <button
              disabled={busy}
              onClick={enroll}
              className="mt-5 min-h-11 rounded-xl bg-brand px-5 font-semibold text-white"
            >
              Thiết lập MFA bằng TOTP
            </button>
          )}
        {enrollment && (
          <div className="mt-5">
            <p>Quét QR bằng ứng dụng xác thực, rồi nhập mã 6 chữ số.</p>
            {/* eslint-disable-next-line @next/next/no-img-element -- GoTrue returns a private data-URI QR, never sent to image optimization. */}
            <img
              src={enrollment.qr}
              alt="Mã QR thiết lập TOTP riêng của tài khoản"
              width={220}
              height={220}
              className="mx-auto my-4"
            />
            <details>
              <summary className="min-h-11 cursor-pointer py-3 font-semibold">
                Khoá thiết lập thủ công
              </summary>
              <code className="block break-all rounded-xl bg-gray-100 p-3">
                {enrollment.secret}
              </code>
            </details>
          </div>
        )}
        {loaded &&
          access.requires_mfa &&
          (enrollment || factors.length > 0) && (
            <form onSubmit={verify} className="mt-5 space-y-4">
              {!enrollment && factors.length > 1 && (
                <label className="block">
                  Phương thức TOTP
                  <select
                    value={selected}
                    onChange={(e) => setSelected(e.target.value)}
                    className="mt-2 block min-h-11 w-full rounded-xl border p-3"
                  >
                    {factors.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.friendly_name || "Ứng dụng xác thực"}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <label className="block font-semibold" htmlFor="admin-totp-code">
                Mã xác thực 6 chữ số
              </label>
              <input
                id="admin-totp-code"
                name="totp"
                autoComplete="one-time-code"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                disabled={busy}
                className="min-h-12 w-full rounded-xl border border-gray-300 p-3 text-xl"
              />
              <button
                type="submit"
                disabled={busy}
                className="min-h-11 rounded-xl bg-brand px-5 font-semibold text-white"
              >
                {busy ? "Đang xác thực…" : "Xác thực và mở quản trị"}
              </button>
              {enrollment && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => cancel()}
                  className="ml-3 min-h-11 rounded-xl border px-4"
                >
                  Huỷ thiết lập
                </button>
              )}
            </form>
          )}
        {loaded && !access.requires_mfa && (
          <button
            disabled={busy}
            onClick={open}
            className="mt-5 min-h-11 rounded-xl bg-brand px-5 font-semibold text-white"
          >
            Mở phiên quản trị
          </button>
        )}
        <div className="mt-6 flex flex-wrap gap-4">
          <Link
            href="/"
            className="inline-flex min-h-11 items-center underline"
          >
            Về app KểCon
          </Link>
          <button
            onClick={loginAgain}
            disabled={busy}
            className="min-h-11 underline"
          >
            Đăng nhập lại
          </button>
        </div>
        <p className="mt-4 text-sm text-ink-2">
          Mất thiết bị xác thực: liên hệ người quản lý hệ thống để xác minh danh
          tính và khôi phục. Không có nút bỏ qua MFA.
        </p>
      </section>
    </main>
  );
}
