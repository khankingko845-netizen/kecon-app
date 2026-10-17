"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
export interface ConfirmRequest {
  title: string;
  description: string;
  confirmLabel?: string;
}
const Context = createContext<
  ((request: ConfirmRequest) => Promise<string | null>) | null
>(null);
export function useAdminConfirm() {
  const fn = useContext(Context);
  if (!fn) throw Error("AdminConfirmProvider missing");
  return fn;
}
/** One native modal: focus containment/Escape/inert background are owned by the browser. */
export function AdminConfirmProvider({ children }: { children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const resolver = useRef<((reason: string | null) => void) | null>(null);
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  const [reason, setReason] = useState("");
  const title = useId(),
    description = useId();
  const finish = useCallback((value: string | null) => {
    const resolve = resolver.current;
    resolver.current = null;
    dialog.current?.close();
    setRequest(null);
    setReason("");
    resolve?.(value);
  }, []);
  const confirm = useCallback((next: ConfirmRequest) => {
    resolver.current?.(null);
    setReason("");
    setRequest(next);
    return new Promise<string | null>((resolve) => {
      resolver.current = resolve;
    });
  }, []);
  useEffect(() => {
    if (request && !dialog.current?.open) dialog.current?.showModal();
  }, [request]);
  useEffect(
    () => () => {
      resolver.current?.(null);
    },
    [],
  );
  return (
    <Context.Provider value={confirm}>
      {children}
      <dialog
        ref={dialog}
        className="admin-dialog"
        aria-labelledby={title}
        aria-describedby={description}
        onCancel={(e) => {
          e.preventDefault();
          finish(null);
        }}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (reason.trim().length >= 10 && reason.trim().length <= 500)
              finish(reason.trim());
          }}
          className="space-y-5 p-6"
        >
          <div>
            <h2 id={title} className="text-xl font-bold text-ink">
              {request?.title}
            </h2>
            <p
              id={description}
              className="mt-2 text-sm leading-relaxed text-ink-2"
            >
              {request?.description}
            </p>
          </div>
          <label className="block text-sm font-semibold text-ink">
            Lý do thao tác
            <textarea
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              minLength={10}
              maxLength={500}
              required
              rows={3}
              className="admin-input mt-2 w-full resize-y"
            />
          </label>
          <p className="text-sm text-ink-2">
            10–500 ký tự, lưu trong nhật ký. Không nhập API key, mật khẩu hoặc
            thông tin riêng của bé.
          </p>
          <div className="flex flex-wrap justify-end gap-3">
            <button
              type="button"
              className="admin-button"
              onClick={() => finish(null)}
            >
              Huỷ
            </button>
            <button
              type="submit"
              className="admin-button admin-button-danger"
              disabled={reason.trim().length < 10}
            >
              {request?.confirmLabel || "Xác nhận"}
            </button>
          </div>
        </form>
      </dialog>
    </Context.Provider>
  );
}
