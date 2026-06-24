"use client";

import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { CheckCircle2, AlertCircle, Info, X, Loader2 } from "lucide-react";

type ToastType = "success" | "error" | "info" | "loading";

interface Toast {
 id: string;
 type: ToastType;
 message: string;
 duration?: number;
}

interface ToastContextValue {
 toast: (type: ToastType, message: string, duration?: number) => string;
 dismiss: (id: string) => void;
 // Custom modal helpers
 showPrompt: (title: string, placeholder?: string, defaultValue?: string) => Promise<string | null>;
 showConfirm: (title: string, description?: string) => Promise<boolean>;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
 const ctx = useContext(ToastContext);
 if (!ctx) throw new Error("useToast must be used within ToastProvider");
 return ctx;
}

// Modal state
interface ModalState {
 type: "prompt" | "confirm";
 title: string;
 description?: string;
 placeholder?: string;
 defaultValue?: string;
 resolve: (value: string | boolean | null) => void;
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
 const [toasts, setToasts] = useState<Toast[]>([]);
 const [modal, setModal] = useState<ModalState | null>(null);
 const [inputValue, setInputValue] = useState("");

 const dismiss = useCallback((id: string) => {
 setToasts((prev) => prev.filter((t) => t.id !== id));
 }, []);

 const toast = useCallback((type: ToastType, message: string, duration = 3000) => {
 const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
 setToasts((prev) => [...prev.slice(-4), { id, type, message, duration }]);
 if (type !== "loading" && duration > 0) {
 setTimeout(() => dismiss(id), duration);
 }
 return id;
 }, [dismiss]);

 const showPrompt = useCallback((title: string, placeholder?: string, defaultValue?: string): Promise<string | null> => {
 return new Promise((resolve) => {
 setInputValue(defaultValue || "");
 setModal({ type: "prompt", title, placeholder, defaultValue, resolve: resolve as (v: string | boolean | null) => void });
 });
 }, []);

 const showConfirm = useCallback((title: string, description?: string): Promise<boolean> => {
 return new Promise((resolve) => {
 setModal({ type: "confirm", title, description, resolve: resolve as (v: string | boolean | null) => void });
 });
 }, []);

 const closeModal = useCallback((result: string | boolean | null) => {
 modal?.resolve(result);
 setModal(null);
 setInputValue("");
 }, [modal]);

 const icons: Record<ToastType, React.ReactNode> = {
 success: <CheckCircle2 size={18} className="text-emerald-400 shrink-0" />,
 error: <AlertCircle size={18} className="text-red-400 shrink-0" />,
 info: <Info size={18} className="text-blue-400 shrink-0" />,
 loading: <Loader2 size={18} className="text-violet-400 shrink-0 animate-spin" />,
 };

 const bgColors: Record<ToastType, string> = {
 success: "bg-emerald-900/90 border-emerald-700/50",
 error: "bg-red-900/90 border-red-700/50",
 info: "bg-blue-900/90 border-blue-700/50",
 loading: "bg-violet-900/90 border-violet-700/50",
 };

 return (
 <ToastContext.Provider value={{ toast, dismiss, showPrompt, showConfirm }}>
 {children}

 {/* Toast container */}
 <div className="fixed top-0 left-0 right-0 z-[100] pointer-events-none flex flex-col items-center pt-14 gap-2 px-4">
 {toasts.map((t, i) => (
 <div
 key={t.id}
 className={`pointer-events-auto max-w-[380px] w-full px-4 py-3 rounded-2xl border backdrop-blur-md flex items-center gap-2.5 shadow-xl animate-[slideDown_0.3s_ease] ${bgColors[t.type]}`}
 style={{ animationDelay: `${i * 50}ms` }}
 >
 {icons[t.type]}
 <span className="text-[13px] font-semibold text-white flex-1">{t.message}</span>
 {t.type !== "loading" && (
 <button onClick={() => dismiss(t.id)} className="text-white/40 hover:text-white/70">
 <X size={14} />
 </button>
 )}
 </div>
 ))}
 </div>

 {/* Custom Modal */}
 {modal && (
 <div className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm px-6 animate-[fadeIn_0.2s_ease]">
 <div className="w-full max-w-[340px] bg-white dark:bg-[#1A1030] rounded-3xl p-6 shadow-2xl animate-[scaleIn_0.25s_ease]">
 <h3 className="text-[16px] font-black text-txt dark:text-white tracking-tight mb-2">
 {modal.title}
 </h3>
 {modal.description && (
 <p className="text-[13px] text-txt-secondary dark:text-white/60 mb-4">{modal.description}</p>
 )}

 {modal.type === "prompt" && (
 <input
 autoFocus
 type="text"
 value={inputValue}
 onChange={(e) => setInputValue(e.target.value)}
 placeholder={modal.placeholder || ""}
 onKeyDown={(e) => { if (e.key === "Enter") closeModal(inputValue || null); }}
 className="w-full px-4 py-3 rounded-xl border-[1.5px] border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5 text-[15px] font-medium text-txt dark:text-white outline-none focus:border-accent mb-4"
 />
 )}

 <div className="flex gap-2.5">
 <button
 onClick={() => closeModal(modal.type === "confirm" ? false : null)}
 className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-white/10 text-[14px] font-bold text-txt-secondary dark:text-white/60 active:scale-[0.97] transition-transform"
 >
 Huỷ
 </button>
 <button
 onClick={() => closeModal(modal.type === "confirm" ? true : (inputValue || null))}
 className="flex-1 py-3 rounded-xl bg-gradient-to-r from-accent to-pink-500 text-white text-[14px] font-bold active:scale-[0.97] transition-transform"
 >
 {modal.type === "confirm" ? "Đồng Ý" : "Xác Nhận"}
 </button>
 </div>
 </div>
 </div>
 )}
 </ToastContext.Provider>
 );
}
