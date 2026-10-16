"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { backupWarnings, type BackupStatus, type BackupWarning } from "@/lib/admin-backup";
import { XCircle } from "@/components/ui/icons";

/** Admin › Tổng quan: red banner when backups need attention (staff with backups.manage only). */
export default function BackupAlert({ onOpen }: { onOpen: () => void }) {
  const [errors, setErrors] = useState<BackupWarning[]>([]);
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const { data, error } = await createClient().rpc("admin_backup_status");
        if (alive && !error && data) setErrors(backupWarnings(data as BackupStatus).filter((w) => w.level === "error"));
      } catch {
        // The banner is a hint; the Sao lưu page shows the real error.
      }
    })();
    return () => {
      alive = false;
    };
  }, []);
  if (!errors.length) return null;
  return (
    <div role="alert" data-testid="backup-alert" className="mx-5 mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">
      <XCircle size={18} className="shrink-0" aria-hidden />
      <p className="min-w-0 flex-1">
        <strong>Sao lưu cần xử lý:</strong> {errors[0].text}
        {errors.length > 1 ? ` (và ${errors.length - 1} vấn đề khác)` : ""}
      </p>
      <button className="admin-button" onClick={onOpen}>
        Mở Sao lưu
      </button>
    </div>
  );
}
