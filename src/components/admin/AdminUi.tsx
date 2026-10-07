"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { ArrowLeft, X } from "@/components/ui/icons";
export function AdminHeader({
  title,
  onBack,
  children,
  rightElement,
}: {
  title: string;
  onBack?: () => void;
  children?: ReactNode;
  rightElement?: ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-4 border-b border-gray-200 px-5 py-6">
      <div className="flex min-w-0 items-center gap-3">
        {onBack && (
          <button
            onClick={onBack}
            aria-label="Về Tổng quan"
            className="admin-button"
          >
            <ArrowLeft size={18} />
          </button>
        )}
        <h1 className="min-w-0 text-2xl font-bold leading-tight">{title}</h1>
      </div>
      {rightElement ?? children}
    </header>
  );
}
export function AdminTable({
  caption,
  headers,
  children,
}: {
  caption: string;
  headers: string[];
  children: ReactNode;
}) {
  return (
    <div
      className="overflow-x-auto rounded-xl border border-gray-200 bg-white"
      tabIndex={0}
      aria-label={caption}
    >
      <p className="p-3 text-sm text-ink-2 md:hidden">
        Vuốt ngang bảng để xem đủ các cột.
      </p>
      <table className="admin-table w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            {headers.map((h) => (
              <th scope="col" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export function AdminDrawer({
  title,
  open,
  onClose,
  children,
}: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    if (open && !ref.current?.open) ref.current?.showModal();
    else if (!open && ref.current?.open) ref.current?.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="admin-dialog admin-drawer"
      aria-labelledby={id}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header className="flex items-start justify-between gap-4 border-b border-gray-200 p-5">
        <h2 id={id} className="text-xl font-bold">
          {title}
        </h2>
        <button
          className="admin-button"
          aria-label="Đóng chi tiết"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </header>
      <div className="space-y-4 p-5">{children}</div>
    </dialog>
  );
}
export function AdminFilters({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label}
      className="flex flex-wrap items-end gap-4 rounded-xl border border-gray-200 bg-white p-4"
    >
      {children}
    </section>
  );
}
