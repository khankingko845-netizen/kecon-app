"use client";

import { useState, useCallback, useEffect, useRef, createContext, useContext } from "react";
import { CheckCircle2, AlertCircle, Info, X, Loader2 } from "@/components/ui/icons";
import { useFeedback } from "@/lib/feedback-context";

import { enqueueNotice, noticeDuration, type NoticeType } from "@/lib/action-notices";
type ToastType = NoticeType;

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

 const queue = useRef<Toast[]>([]);
 const timers = useRef(new Map<string, {timer: ReturnType<typeof setTimeout> | null; remaining: number; started: number}>());
 const sequence = useRef(0);
 const paused = useRef(new Set<string>());
 const dismiss = useCallback((id: string) => {
 const current = timers.current.get(id); if (current?.timer) clearTimeout(current.timer);
 timers.current.delete(id); paused.current.delete(id);
 queue.current = queue.current.filter(t => t.id !== id); setToasts(queue.current);
 }, []);
 const startTimer = useCallback((id: string) => {
 const t = timers.current.get(id); if (!t || t.timer || t.remaining <= 0 || paused.current.has(id)) return;
 t.started = Date.now(); t.timer = setTimeout(() => dismiss(id), t.remaining);
 }, [dismiss]);
 const pauseTimer = useCallback((id: string) => {
 paused.current.add(id); const t=timers.current.get(id);
 if(t?.timer){clearTimeout(t.timer); t.timer=null; t.remaining=Math.max(1,t.remaining-(Date.now()-t.started));}
 }, []);
 const resumeTimer = useCallback((id: string) => { paused.current.delete(id); startTimer(id); }, [startTimer]);
 useEffect(() => {
 const owned = timers.current;
 return () => { for(const t of owned.values()) if(t.timer) clearTimeout(t.timer); owned.clear(); };
 }, []);

 const { cue } = useFeedback();

 const toast = useCallback((type: ToastType, message: string, duration?: number) => {
 const duplicate = queue.current.find(t=>t.type===type && t.message===message);
 const id = duplicate?.id ?? `toast-${++sequence.current}`;
 const next = enqueueNotice(queue.current, {id,type,message,duration:noticeDuration(type,duration)});
 for(const t of queue.current) if(!next.some(n=>n.id===t.id)) dismiss(t.id);
 const old = timers.current.get(id); if(old?.timer) clearTimeout(old.timer);
 queue.current=next; setToasts(next);
 const ms=noticeDuration(type,duration);
 if(ms>0){timers.current.set(id,{timer:null,remaining:ms,started:Date.now()});startTimer(id);}
 else timers.current.delete(id);
 if(!duplicate){ if(type==='success') cue('success'); else if(type==='error') cue('oops'); }
 return id;
 }, [cue,dismiss,startTimer]);

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
 <div role="region" aria-label="Thông báo thao tác" className="fixed left-0 right-0 z-[140] pointer-events-none flex flex-col items-center gap-2 px-4" style={{bottom:"calc(6rem + env(safe-area-inset-bottom))"}}>
 {toasts.map((t) => (
 <div
 key={t.id}
 className={`pointer-events-none max-w-[380px] w-full px-4 py-3 rounded-2xl border backdrop-blur-md flex items-center gap-2.5 shadow-xl motion-safe:animate-[slideDown_0.3s_ease] ${bgColors[t.type]}`}
 role={t.type === "error" ? "alert" : "status"}
 aria-atomic="true" data-toast-type={t.type}
 onMouseEnter={()=>pauseTimer(t.id)} onMouseLeave={e=>{if(!e.currentTarget.contains(document.activeElement))resumeTimer(t.id);}}
 onFocus={()=>pauseTimer(t.id)} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget)&&!e.currentTarget.matches(":hover"))resumeTimer(t.id);}}
 >
 {icons[t.type]}
 <span className="text-sm font-semibold text-white flex-1 min-w-0 break-words">{t.message}</span>
 <button type="button" aria-label="Đóng thông báo" onClick={() => dismiss(t.id)} className="pointer-events-auto min-h-11 min-w-11 flex items-center justify-center text-white/90 hover:text-white focus-visible:outline-2 focus-visible:outline-white">
 <X size={14} />
 </button>
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
