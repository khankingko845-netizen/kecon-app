"use client";

import { useState, useEffect, useCallback } from "react";
import {
 Save, Loader2, Check, Eye, EyeOff, ExternalLink,
 Mic, Brain, Image, RefreshCw, Plug, AlertCircle, ChevronDown,
 Plus, Trash2, X, Search,
} from "lucide-react";
import TopBar from "@/components/ui/TopBar";
import {
 getAppSettings,
 updateAppSettings,
 type AppSettingRow,
} from "@/lib/db";

interface AdminSettingsProps {
 onBack: () => void;
}

/* ──────────────── types ──────────────── */
interface VoiceOption {
 voice_id: string;
 name: string;
 category: string;
 language: string;
 source?: "own" | "library";
 public_owner_id?: string;
}

interface DefaultVoiceRow {
 id: string;
 voice_id: string;
 name: string;
 language: string;
 description: string | null;
 preview_url: string | null;
 gender: string | null;
 sort_order: number;
 is_active: boolean;
}

interface TestResult {
 ok: boolean;
 models?: string[];
 voices?: VoiceOption[];
 error?: string;
}

/* ──────────────── tiny helpers ──────────────── */

const AI_PROVIDERS = [
 { id: "openai", label: "OpenAI", color: "#10A37F" },
 { id: "gemini", label: "Gemini", color: "#4285F4" },
 { id: "anthropic", label: "Claude", color: "#D97706" },
 { id: "custom", label: "Custom", color: "#6B7280" },
] as const;

const LANGUAGES = [
 { code: "vi", label: "🇻🇳 Tiếng Việt", filter: "vietnamese" },
 { code: "en", label: "🇺🇸 English", filter: "english" },
 { code: "ja", label: "🇯🇵 日本語", filter: "japanese" },
] as const;

function SectionIcon({ icon: Icon, color }: { icon: typeof Mic; color: string }) {
 return (
 <div
 className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
 style={{ background: color, color: "#fff" }}
 >
 <Icon size={14} />
 </div>
 );
}

function SecretInput({
 value,
 onChange,
 placeholder,
}: {
 value: string;
 onChange: (v: string) => void;
 placeholder: string;
}) {
 const [show, setShow] = useState(false);
 return (
 <div className="flex gap-2">
 <input
 type={show ? "text" : "password"}
 value={value}
 onChange={(e) => onChange(e.target.value)}
 placeholder={placeholder}
 className="flex-1 px-3.5 py-3 rounded-xl border border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-sm font-mono outline-none focus:border-accent transition-colors"
 />
 <button
 type="button"
 onClick={() => setShow(!show)}
 className="px-3 py-3 rounded-xl border border-gray-200 dark:border-white/10 text-txt-secondary dark:text-white/50 hover:bg-gray-50 dark:bg-white/[0.04] transition-colors"
 >
 {show ? <EyeOff size={16} /> : <Eye size={16} />}
 </button>
 </div>
 );
}

function TestButton({
 loading,
 result,
 onClick,
}: {
 loading: boolean;
 result: TestResult | null;
 onClick: () => void;
}) {
 return (
 <div className="flex items-center gap-2.5 flex-wrap">
 <button
 type="button"
 onClick={onClick}
 disabled={loading}
 className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-gray-200 dark:border-white/10 text-[13px] font-bold text-txt-secondary dark:text-white/50 hover:bg-gray-50 dark:bg-white/[0.04] active:scale-[0.97] transition-all disabled:opacity-50"
 >
 {loading ? (
 <Loader2 size={14} className="animate-spin" />
 ) : (
 <Plug size={14} />
 )}
 Test Kết Nối
 </button>
 {result && (
 <span
 className={`text-[12px] font-semibold ${
 result.ok ? "text-emerald-600" : "text-red-500"
 }`}
 >
 {result.ok
 ? `✅ Kết nối thành công${
 result.models
 ? ` · ${result.models.length} models`
 : result.voices
 ? ` · ${result.voices.length} voices`
 : ""
 }`
 : `❌ ${result.error || "Kết nối thất bại"}`}
 </span>
 )}
 </div>
 );
}

function ModelSelect({
 value,
 onChange,
 models,
 placeholder,
 allowFreeText,
}: {
 value: string;
 onChange: (v: string) => void;
 models: string[];
 placeholder: string;
 allowFreeText?: boolean;
}) {
 if (models.length === 0 && allowFreeText) {
 return (
 <input
 type="text"
 value={value}
 onChange={(e) => onChange(e.target.value)}
 placeholder={placeholder}
 className="w-full px-3.5 py-3 rounded-xl border border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-sm font-mono outline-none focus:border-accent transition-colors"
 />
 );
 }
 if (models.length === 0) {
 return (
 <div className="px-3.5 py-3 rounded-xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/[0.04] text-sm text-txt-secondary dark:text-white/50">
 Nhấn &quot;Test Kết Nối&quot; để tải danh sách models
 </div>
 );
 }
 return (
 <div className="relative">
 <select
 value={value}
 onChange={(e) => onChange(e.target.value)}
 className="w-full px-3.5 py-3 rounded-xl border border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-sm font-semibold outline-none focus:border-accent transition-colors appearance-none pr-10"
 >
 <option value="">— Chọn model —</option>
 {models.map((m) => (
 <option key={m} value={m}>
 {m}
 </option>
 ))}
 </select>
 <ChevronDown
 size={16}
 className="absolute right-3 top-1/2 -translate-y-1/2 text-txt-secondary dark:text-white/50 pointer-events-none"
 />
 </div>
 );
}

/* ──────────────── Default Voices Manager ──────────────── */
function DefaultVoicesManager({
 availableVoices,
 defaultVoices,
 onAdd,
 onRemove,
 loading,
}: {
 availableVoices: VoiceOption[];
 defaultVoices: DefaultVoiceRow[];
 onAdd: (voice: { voice_id: string; name: string; language: string; gender?: string }) => Promise<void>;
 onRemove: (id: string) => Promise<void>;
 loading: boolean;
}) {
 const [addingForLang, setAddingForLang] = useState<string | null>(null);
 const [searchQuery, setSearchQuery] = useState("");
 const [manualMode, setManualMode] = useState(false);
 const [manualVoiceId, setManualVoiceId] = useState("");
 const [manualName, setManualName] = useState("");
 const [submitting, setSubmitting] = useState(false);
 const [removingId, setRemovingId] = useState<string | null>(null);
 const [lookingUp, setLookingUp] = useState(false);
 const [lookupError, setLookupError] = useState<string | null>(null);

 // Auto-lookup voice info when user enters a voice_id
 async function handleLookupVoice() {
 const id = manualVoiceId.trim();
 if (!id) return;
 setLookingUp(true);
 setLookupError(null);
 try {
 const res = await fetch(`/api/admin/test-provider?voice_id=${encodeURIComponent(id)}`);
 const data = await res.json();
 if (data.ok && data.voice) {
 setManualName(data.voice.name || "");
 // Could auto-detect language from voice info too
 } else {
 setLookupError(data.error || "Không tìm thấy voice");
 }
 } catch {
 setLookupError("Lỗi kết nối");
 } finally {
 setLookingUp(false);
 }
 }

 async function handleAddVoice(v: VoiceOption, lang: string) {
 setSubmitting(true);
 try {
 await onAdd({
 voice_id: v.voice_id,
 name: v.name,
 language: lang,
 });
 setAddingForLang(null);
 setSearchQuery("");
 } finally {
 setSubmitting(false);
 }
 }

 async function handleAddManual(lang: string) {
 if (!manualVoiceId.trim() || !manualName.trim()) return;
 setSubmitting(true);
 try {
 await onAdd({
 voice_id: manualVoiceId.trim(),
 name: manualName.trim(),
 language: lang,
 });
 setAddingForLang(null);
 setManualVoiceId("");
 setManualName("");
 setManualMode(false);
 } finally {
 setSubmitting(false);
 }
 }

 async function handleRemove(id: string) {
 setRemovingId(id);
 try {
 await onRemove(id);
 } finally {
 setRemovingId(null);
 }
 }

 // Filter available voices for the add modal
 const filteredVoices = availableVoices.filter((v) => {
 if (!searchQuery) return true;
 const q = searchQuery.toLowerCase();
 return v.name.toLowerCase().includes(q) || v.voice_id.toLowerCase().includes(q);
 });

 // Group available voices by source
 const currentLangFilter = LANGUAGES.find((l) => l.code === addingForLang)?.filter || "";
 const libraryForLang = filteredVoices.filter(
 (v) =>
 v.source === "library" &&
 v.language.toLowerCase().includes(currentLangFilter.toLowerCase())
 );
 const ownCloned = filteredVoices.filter(
 (v) => v.source === "own" && v.category === "cloned"
 );
 const ownPremade = filteredVoices.filter(
 (v) => v.source === "own" && v.category === "premade"
 );

 return (
 <div className="space-y-4 pt-1">
 <p className="text-[12px] font-bold text-txt-secondary dark:text-white/50 uppercase tracking-widest">
 Giọng mặc định cho người dùng
 </p>
 <p className="text-[11px] text-txt-secondary dark:text-white/50 -mt-2 leading-relaxed">
 Người dùng không clone voice sẽ chọn từ danh sách này.
 Thêm nhiều giọng cho mỗi ngôn ngữ.
 </p>

 {LANGUAGES.map((lang) => {
 const voicesForLang = defaultVoices.filter((v) => v.language === lang.code);

 return (
 <div key={lang.code} className="rounded-xl border border-gray-200 dark:border-white/10 overflow-hidden">
 {/* Language header */}
 <div className="flex items-center justify-between px-3.5 py-2.5 bg-gray-50 dark:bg-white/[0.04]">
 <span className="text-[13px] font-bold">{lang.label}</span>
 <span className="text-[11px] text-txt-secondary dark:text-white/50 font-semibold">
 {voicesForLang.length} giọng
 </span>
 </div>

 {/* Voice list */}
 {voicesForLang.length > 0 ? (
 <div className="divide-y divide-gray-100 dark:divide-white/[0.06]">
 {voicesForLang.map((v) => (
 <div
 key={v.id}
 className="flex items-center gap-3 px-3.5 py-2.5"
 >
 <div className="flex-1 min-w-0">
 <p className="text-[13px] font-semibold truncate">{v.name}</p>
 <p className="text-[11px] text-txt-secondary dark:text-white/50 font-mono truncate">
 {v.voice_id}
 </p>
 </div>
 <button
 type="button"
 onClick={() => handleRemove(v.id)}
 disabled={removingId === v.id}
 className="p-1.5 rounded-lg text-red-400 hover:bg-red-50 hover:text-red-600 transition-colors disabled:opacity-50"
 >
 {removingId === v.id ? (
 <Loader2 size={14} className="animate-spin" />
 ) : (
 <Trash2 size={14} />
 )}
 </button>
 </div>
 ))}
 </div>
 ) : (
 <div className="px-3.5 py-3 text-[12px] text-txt-secondary dark:text-white/50 italic">
 Chưa có giọng mặc định nào
 </div>
 )}

 {/* Add button */}
 <div className="px-3.5 py-2.5 border-t border-gray-100 dark:border-white/[0.06]">
 <button
 type="button"
 onClick={() => {
 setAddingForLang(lang.code);
 setSearchQuery("");
 setManualMode(false);
 }}
 disabled={loading || availableVoices.length === 0}
 className="inline-flex items-center gap-1.5 text-accent text-[12px] font-bold hover:underline disabled:opacity-50"
 >
 <Plus size={13} />
 Thêm giọng
 </button>
 {availableVoices.length === 0 && (
 <span className="text-[11px] text-txt-secondary dark:text-white/50 ml-2">
 (Test Kết Nối ElevenLabs trước)
 </span>
 )}
 </div>
 </div>
 );
 })}

 {/* ─── Add Voice Modal ─── */}
 {addingForLang && (
 <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
 <div className="bg-white dark:bg-white/[0.04] w-full max-w-md max-h-[80vh] rounded-t-2xl sm:rounded-2xl flex flex-col">
 {/* Modal header */}
 <div className="flex items-center justify-between px-4 py-3 border-b">
 <h4 className="text-[15px] font-bold">
 Thêm giọng · {LANGUAGES.find((l) => l.code === addingForLang)?.label}
 </h4>
 <button
 type="button"
 onClick={() => setAddingForLang(null)}
 className="p-1.5 rounded-lg hover:bg-gray-100 dark:bg-white/[0.06] transition-colors"
 >
 <X size={18} />
 </button>
 </div>

 {/* Search / Manual toggle */}
 <div className="px-4 py-3 border-b space-y-2">
 {!manualMode ? (
 <>
 <div className="relative">
 <Search
 size={14}
 className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-white/30"
 />
 <input
 type="text"
 value={searchQuery}
 onChange={(e) => setSearchQuery(e.target.value)}
 placeholder="Tìm voice theo tên hoặc ID..."
 className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-sm outline-none focus:border-accent transition-colors"
 autoFocus
 />
 </div>
 <button
 type="button"
 onClick={() => setManualMode(true)}
 className="text-[11px] text-accent font-semibold"
 >
 Nhập voice_id thủ công →
 </button>
 </>
 ) : (
 <div className="space-y-2">
 <div className="flex gap-2">
 <input
 type="text"
 value={manualVoiceId}
 onChange={(e) => { setManualVoiceId(e.target.value); setLookupError(null); }}
 placeholder="Voice ID (vd: pNInz6obpgDQGcFmaJgB)"
 className="flex-1 px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-sm font-mono outline-none focus:border-accent transition-colors"
 autoFocus
 />
 <button
 type="button"
 onClick={handleLookupVoice}
 disabled={lookingUp || !manualVoiceId.trim()}
 className="px-3 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-accent text-[12px] font-bold hover:bg-accent/5 disabled:opacity-50 transition-colors whitespace-nowrap"
 >
 {lookingUp ? (
 <Loader2 size={14} className="animate-spin" />
 ) : (
 <Search size={14} />
 )}
 </button>
 </div>
 {lookupError && (
 <p className="text-[11px] text-red-500 font-medium flex items-center gap-1">
 <AlertCircle size={11} /> {lookupError}
 </p>
 )}
 <input
 type="text"
 value={manualName}
 onChange={(e) => setManualName(e.target.value)}
 placeholder={lookingUp ? "Đang tìm..." : "Tên hiển thị (nhập ID rồi nhấn 🔍)"}
 className="w-full px-3.5 py-2.5 rounded-xl border border-gray-200 dark:border-white/10 text-sm outline-none focus:border-accent transition-colors"
 />
 <div className="flex items-center justify-between">
 <button
 type="button"
 onClick={() => { setManualMode(false); setLookupError(null); }}
 className="text-[11px] text-accent font-semibold"
 >
 ← Chọn từ danh sách
 </button>
 <button
 type="button"
 onClick={() => handleAddManual(addingForLang)}
 disabled={submitting || !manualVoiceId.trim() || !manualName.trim()}
 className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white text-[12px] font-bold disabled:opacity-50"
 >
 {submitting ? (
 <Loader2 size={12} className="animate-spin" />
 ) : (
 <Plus size={12} />
 )}
 Thêm
 </button>
 </div>
 <a
 href={`https://elevenlabs.io/community?language=${addingForLang}`}
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-1.5 text-accent text-[11px] font-semibold"
 >
 Tìm voice trên ElevenLabs <ExternalLink size={11} />
 </a>
 </div>
 )}
 </div>

 {/* Voice list (scrollable) */}
 {!manualMode && (
 <div className="flex-1 overflow-y-auto divide-y divide-gray-100 dark:divide-white/[0.06]">
 {/* Library voices for this language */}
 {libraryForLang.length > 0 && (
 <div>
 <div className="px-4 py-2 bg-amber-50 text-[11px] font-bold text-amber-700 uppercase tracking-wider sticky top-0">
 ⭐ Chuyên {LANGUAGES.find((l) => l.code === addingForLang)?.label}
 </div>
 {libraryForLang.map((v) => (
 <VoiceRow
 key={v.voice_id}
 voice={v}
 onAdd={() => handleAddVoice(v, addingForLang)}
 submitting={submitting}
 alreadyAdded={defaultVoices.some(
 (d) => d.voice_id === v.voice_id && d.language === addingForLang
 )}
 />
 ))}
 </div>
 )}

 {/* User's cloned voices */}
 {ownCloned.length > 0 && (
 <div>
 <div className="px-4 py-2 bg-purple-50 text-[11px] font-bold text-purple-700 uppercase tracking-wider sticky top-0">
 🎙️ Voice clone
 </div>
 {ownCloned.map((v) => (
 <VoiceRow
 key={v.voice_id}
 voice={v}
 onAdd={() => handleAddVoice(v, addingForLang)}
 submitting={submitting}
 alreadyAdded={defaultVoices.some(
 (d) => d.voice_id === v.voice_id && d.language === addingForLang
 )}
 />
 ))}
 </div>
 )}

 {/* Premade voices */}
 {ownPremade.length > 0 && (
 <div>
 <div className="px-4 py-2 bg-gray-50 dark:bg-white/[0.04] text-[11px] font-bold text-gray-500 dark:text-white/40 uppercase tracking-wider sticky top-0">
 🌐 Premade
 </div>
 {ownPremade.map((v) => (
 <VoiceRow
 key={v.voice_id}
 voice={v}
 onAdd={() => handleAddVoice(v, addingForLang)}
 submitting={submitting}
 alreadyAdded={defaultVoices.some(
 (d) => d.voice_id === v.voice_id && d.language === addingForLang
 )}
 />
 ))}
 </div>
 )}

 {filteredVoices.length === 0 && (
 <div className="px-4 py-8 text-center text-[13px] text-txt-secondary dark:text-white/50">
 Không tìm thấy voice nào
 </div>
 )}
 </div>
 )}
 </div>
 </div>
 )}
 </div>
 );
}

function VoiceRow({
 voice,
 onAdd,
 submitting,
 alreadyAdded,
}: {
 voice: VoiceOption;
 onAdd: () => void;
 submitting: boolean;
 alreadyAdded: boolean;
}) {
 return (
 <div className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 dark:bg-white/[0.04] transition-colors">
 <div className="flex-1 min-w-0">
 <p className="text-[13px] font-semibold truncate">{voice.name}</p>
 <p className="text-[11px] text-txt-secondary dark:text-white/50">
 {voice.category}{voice.language ? ` · ${voice.language}` : ""}
 </p>
 </div>
 {alreadyAdded ? (
 <span className="text-[11px] text-emerald-600 font-semibold">✓ Đã thêm</span>
 ) : (
 <button
 type="button"
 onClick={onAdd}
 disabled={submitting}
 className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-accent/10 text-accent text-[11px] font-bold hover:bg-accent/20 transition-colors disabled:opacity-50"
 >
 {submitting ? (
 <Loader2 size={11} className="animate-spin" />
 ) : (
 <Plus size={11} />
 )}
 Thêm
 </button>
 )}
 </div>
 );
}

/* ──────────────── main component ──────────────── */
export default function AdminSettings({ onBack }: AdminSettingsProps) {
 const [settings, setSettings] = useState<Record<string, string>>({});
 const [original, setOriginal] = useState<Record<string, string>>({});
 const [loading, setLoading] = useState(true);
 const [saving, setSaving] = useState(false);
 const [saved, setSaved] = useState(false);
 const [error, setError] = useState<string | null>(null);

 // Test results & fetched data
 const [elevenTest, setElevenTest] = useState<TestResult | null>(null);
 const [elevenTesting, setElevenTesting] = useState(false);
 const [voices, setVoices] = useState<VoiceOption[]>([]);

 // Default voices from DB
 const [defaultVoices, setDefaultVoices] = useState<DefaultVoiceRow[]>([]);

 const [aiTest, setAiTest] = useState<TestResult | null>(null);
 const [aiTesting, setAiTesting] = useState(false);
 const [aiModels, setAiModels] = useState<string[]>([]);

 const [dalleTest, setDalleTest] = useState<TestResult | null>(null);
 const [dalleTesting, setDalleTesting] = useState(false);

 const selectedProvider = settings["default_ai_provider"] || "openai";

 // ── load settings + default voices ──
 const load = useCallback(async () => {
 setLoading(true);
 try {
 const [rows, dvRes] = await Promise.all([
 getAppSettings(),
 fetch("/api/voice/defaults").then((r) => r.json()),
 ]);
 const map: Record<string, string> = {};
 rows.forEach((r: AppSettingRow) => {
 map[r.key] = r.value;
 });
 setSettings(map);
 setOriginal(map);
 if (dvRes.voices) {
 setDefaultVoices(dvRes.voices);
 }
 } catch (err) {
 setError(err instanceof Error ? err.message : "Không thể tải cài đặt");
 } finally {
 setLoading(false);
 }
 }, []);

 useEffect(() => {
 load();
 }, [load]);

 const handleChange = (key: string, value: string) => {
 setSettings((prev) => ({ ...prev, [key]: value }));
 setSaved(false);
 };

 const hasChanges = Object.keys(settings).some(
 (k) => settings[k] !== (original[k] ?? "")
 );

 // ── Default Voice CRUD ──
 async function handleAddDefaultVoice(voice: {
 voice_id: string;
 name: string;
 language: string;
 gender?: string;
 }) {
 const res = await fetch("/api/voice/defaults", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify(voice),
 });
 const data = await res.json();
 if (data.voice) {
 setDefaultVoices((prev) => [...prev, data.voice]);
 } else if (data.error) {
 throw new Error(data.error);
 }
 }

 async function handleRemoveDefaultVoice(id: string) {
 const res = await fetch(`/api/voice/defaults?id=${id}`, {
 method: "DELETE",
 });
 const data = await res.json();
 if (data.ok) {
 setDefaultVoices((prev) => prev.filter((v) => v.id !== id));
 }
 }

 // ── test provider ──
 async function testProvider(
 provider: string,
 apiKey: string,
 baseUrl?: string
 ): Promise<TestResult> {
 const res = await fetch("/api/admin/test-provider", {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ provider, apiKey, baseUrl }),
 });
 return res.json();
 }

 async function handleTestElevenLabs() {
 const key = settings["elevenlabs_api_key"];
 if (!key) {
 setElevenTest({ ok: false, error: "Nhập API key trước" });
 return;
 }
 setElevenTesting(true);
 setElevenTest(null);
 try {
 const result = await testProvider("elevenlabs", key);
 setElevenTest(result);
 if (result.ok && result.voices) {
 setVoices(result.voices);
 }
 } catch {
 setElevenTest({ ok: false, error: "Lỗi kết nối" });
 } finally {
 setElevenTesting(false);
 }
 }

 async function handleTestAI() {
 const providerKeyMap: Record<string, string> = {
 openai: "openai_api_key",
 gemini: "gemini_api_key",
 anthropic: "anthropic_api_key",
 custom: "custom_provider_key",
 };
 const key = settings[providerKeyMap[selectedProvider] || ""];
 if (!key) {
 setAiTest({ ok: false, error: "Nhập API key trước" });
 return;
 }
 setAiTesting(true);
 setAiTest(null);
 try {
 const result = await testProvider(
 selectedProvider,
 key,
 selectedProvider === "custom" ? settings["custom_provider_url"] : undefined
 );
 setAiTest(result);
 if (result.ok && result.models) {
 setAiModels(result.models);
 }
 } catch {
 setAiTest({ ok: false, error: "Lỗi kết nối" });
 } finally {
 setAiTesting(false);
 }
 }

 async function handleTestDalle() {
 const key = settings["dalle_api_key"];
 if (!key) {
 setDalleTest({ ok: false, error: "Nhập API key trước" });
 return;
 }
 setDalleTesting(true);
 setDalleTest(null);
 try {
 const result = await testProvider("dalle", key);
 setDalleTest(result);
 } catch {
 setDalleTest({ ok: false, error: "Lỗi kết nối" });
 } finally {
 setDalleTesting(false);
 }
 }

 // ── save ──
 const handleSave = async () => {
 setSaving(true);
 setError(null);
 try {
 const changed: Record<string, string> = {};
 for (const [k, v] of Object.entries(settings)) {
 if (v !== (original[k] ?? "")) {
 changed[k] = v;
 }
 }
 if (Object.keys(changed).length > 0) {
 await updateAppSettings(changed);
 }
 setOriginal({ ...settings });
 setSaved(true);
 setTimeout(() => setSaved(false), 3000);
 } catch (err) {
 setError(err instanceof Error ? err.message : "Lưu thất bại");
 } finally {
 setSaving(false);
 }
 };

 // ── helper: get AI key field for selected provider ──
 function aiKeyField() {
 const map: Record<string, { key: string; placeholder: string; helpUrl?: string; helpLabel?: string }> = {
 openai: {
 key: "openai_api_key",
 placeholder: "sk-...",
 helpUrl: "https://platform.openai.com/api-keys",
 helpLabel: "Lấy OpenAI Key",
 },
 gemini: {
 key: "gemini_api_key",
 placeholder: "AIza...",
 helpUrl: "https://aistudio.google.com/apikey",
 helpLabel: "Lấy Gemini Key",
 },
 anthropic: {
 key: "anthropic_api_key",
 placeholder: "sk-ant-...",
 helpUrl: "https://console.anthropic.com/settings/keys",
 helpLabel: "Lấy Claude Key",
 },
 custom: { key: "custom_provider_key", placeholder: "API key" },
 };
 return map[selectedProvider] || map.openai;
 }

 // ── render ──
 if (loading) {
 return (
 <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] flex items-center justify-center">
 <Loader2 className="animate-spin text-accent" size={32} />
 </div>
 );
 }

 return (
 <div className="min-h-screen bg-surface dark:bg-[#0A0A0F] pb-32">
 <TopBar title="Cài Đặt Hệ Thống" onBack={onBack} />

 {/* Info banner */}
 <div className="mx-5 mt-4 p-3.5 rounded-2xl bg-blue-50 border border-blue-200">
 <p className="text-[13px] text-blue-800 font-medium leading-relaxed">
 <strong>API Keys hệ thống</strong> — cấu hình tại đây áp dụng cho{" "}
 <em>tất cả người dùng</em>. Người dùng có thể ghi đè bằng key riêng.
 </p>
 </div>

 {/* ═══════════ ELEVENLABS ═══════════ */}
 <div className="flex items-center gap-2.5 px-5 mt-6 mb-2">
 <SectionIcon icon={Mic} color="#7B61FF" />
 <h3 className="text-[13px] font-bold uppercase tracking-widest text-txt-secondary dark:text-white/50">
 Giọng Nói (ElevenLabs)
 </h3>
 </div>
 <div className="bg-white dark:bg-white/[0.04] px-5 py-4 space-y-4">
 {/* API Key */}
 <div>
 <label className="text-[12px] font-bold text-txt-secondary dark:text-white/50 mb-1.5 block">
 API Key
 </label>
 <SecretInput
 value={settings["elevenlabs_api_key"] ?? ""}
 onChange={(v) => handleChange("elevenlabs_api_key", v)}
 placeholder="sk_..."
 />
 <a
 href="https://elevenlabs.io/app/settings/api-keys"
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-1.5 text-accent text-[12px] font-semibold mt-1.5"
 >
 Lấy API Key <ExternalLink size={12} />
 </a>
 </div>

 {/* Test */}
 <TestButton
 loading={elevenTesting}
 result={elevenTest}
 onClick={handleTestElevenLabs}
 />

 {/* Model */}
 <div>
 <label className="text-[12px] font-bold text-txt-secondary dark:text-white/50 mb-1.5 block">
 Model TTS
 </label>
 <div className="relative">
 <select
 value={settings["elevenlabs_model_id"] ?? "eleven_multilingual_v2"}
 onChange={(e) => handleChange("elevenlabs_model_id", e.target.value)}
 className="w-full px-3.5 py-3 rounded-xl border border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-sm font-semibold outline-none focus:border-accent transition-colors appearance-none pr-10"
 >
 <option value="eleven_v3">
 Eleven v3 (mới nhất, chất lượng cao nhất)
 </option>
 <option value="eleven_multilingual_v2">
 Multilingual v2 (ổn định)
 </option>
 <option value="eleven_turbo_v2_5">Turbo v2.5 (nhanh)</option>
 <option value="eleven_flash_v2_5">Flash v2.5 (rẻ nhất)</option>
 </select>
 <ChevronDown
 size={16}
 className="absolute right-3 top-1/2 -translate-y-1/2 text-txt-secondary dark:text-white/50 pointer-events-none"
 />
 </div>
 </div>

 {/* Default voices per language (multi-select) */}
 <DefaultVoicesManager
 availableVoices={voices}
 defaultVoices={defaultVoices}
 onAdd={handleAddDefaultVoice}
 onRemove={handleRemoveDefaultVoice}
 loading={elevenTesting}
 />
 </div>

 {/* ═══════════ AI STORY PROVIDER ═══════════ */}
 <div className="flex items-center gap-2.5 px-5 mt-6 mb-2">
 <SectionIcon icon={Brain} color="#00D68F" />
 <h3 className="text-[13px] font-bold uppercase tracking-widest text-txt-secondary dark:text-white/50">
 AI Tạo Truyện
 </h3>
 </div>
 <div className="bg-white dark:bg-white/[0.04] px-5 py-4 space-y-4">
 {/* Provider selector */}
 <div>
 <label className="text-[12px] font-bold text-txt-secondary dark:text-white/50 mb-1.5 block">
 Provider Mặc Định
 </label>
 <div className="grid grid-cols-4 gap-1.5">
 {AI_PROVIDERS.map((p) => (
 <button
 key={p.id}
 type="button"
 onClick={() => {
 handleChange("default_ai_provider", p.id);
 setAiTest(null);
 setAiModels([]);
 }}
 className={`py-2.5 rounded-xl text-[12px] font-bold border-[1.5px] transition-all ${
 selectedProvider === p.id
 ? "border-accent bg-accent/10 text-accent"
 : "border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-txt-secondary dark:text-white/50"
 }`}
 >
 {p.label}
 </button>
 ))}
 </div>
 </div>

 {/* Custom URL (only for custom provider) */}
 {selectedProvider === "custom" && (
 <div>
 <label className="text-[12px] font-bold text-txt-secondary dark:text-white/50 mb-1.5 block">
 Base URL (OpenAI-compatible)
 </label>
 <input
 type="text"
 value={settings["custom_provider_url"] ?? ""}
 onChange={(e) => handleChange("custom_provider_url", e.target.value)}
 placeholder="https://openrouter.ai/api/v1"
 className="w-full px-3.5 py-3 rounded-xl border border-gray-200 dark:border-white/10 bg-surface dark:bg-white/[0.04] text-sm font-mono outline-none focus:border-accent transition-colors"
 />
 <p className="text-[11px] text-txt-secondary dark:text-white/50 mt-1">
 Hỗ trợ OpenRouter, Groq, Together, LM Studio, Ollama…
 </p>
 </div>
 )}

 {/* API Key for selected provider */}
 <div>
 <label className="text-[12px] font-bold text-txt-secondary dark:text-white/50 mb-1.5 block">
 API Key — {AI_PROVIDERS.find((p) => p.id === selectedProvider)?.label}
 </label>
 <SecretInput
 value={settings[aiKeyField().key] ?? ""}
 onChange={(v) => handleChange(aiKeyField().key, v)}
 placeholder={aiKeyField().placeholder}
 />
 {aiKeyField().helpUrl && (
 <a
 href={aiKeyField().helpUrl}
 target="_blank"
 rel="noopener noreferrer"
 className="inline-flex items-center gap-1.5 text-accent text-[12px] font-semibold mt-1.5"
 >
 {aiKeyField().helpLabel} <ExternalLink size={12} />
 </a>
 )}
 </div>

 {/* Test */}
 <TestButton
 loading={aiTesting}
 result={aiTest}
 onClick={handleTestAI}
 />

 {/* Model selector */}
 <div>
 <label className="text-[12px] font-bold text-txt-secondary dark:text-white/50 mb-1.5 block">
 Model Mặc Định
 </label>
 <ModelSelect
 value={settings["default_ai_model"] ?? ""}
 onChange={(v) => handleChange("default_ai_model", v)}
 models={aiModels}
 placeholder="vd: gpt-4o-mini"
 allowFreeText={selectedProvider === "custom" || aiModels.length === 0}
 />
 {aiModels.length === 0 && (
 <p className="text-[11px] text-txt-secondary dark:text-white/50 mt-1">
 Nhấn &quot;Test Kết Nối&quot; để tải danh sách models từ provider
 </p>
 )}
 </div>
 </div>

 {/* ═══════════ IMAGE / DALLE ═══════════ */}
 <div className="flex items-center gap-2.5 px-5 mt-6 mb-2">
 <SectionIcon icon={Image} color="#FF6B3D" />
 <h3 className="text-[13px] font-bold uppercase tracking-widest text-txt-secondary dark:text-white/50">
 Minh Họa AI (DALL·E)
 </h3>
 </div>
 <div className="bg-white dark:bg-white/[0.04] px-5 py-4 space-y-4">
 <div>
 <label className="text-[12px] font-bold text-txt-secondary dark:text-white/50 mb-1.5 block">
 OpenAI API Key (DALL·E)
 </label>
 <SecretInput
 value={settings["dalle_api_key"] ?? ""}
 onChange={(v) => handleChange("dalle_api_key", v)}
 placeholder="sk-..."
 />
 <p className="text-[11px] text-txt-secondary dark:text-white/50 mt-1">
 Dùng chung key OpenAI. Nếu để trống sẽ fallback sang OpenAI Key ở mục AI.
 </p>
 </div>
 <TestButton
 loading={dalleTesting}
 result={dalleTest}
 onClick={handleTestDalle}
 />
 </div>

 {/* ═══════════ ERROR ═══════════ */}
 {error && (
 <div className="mx-5 mt-4 p-3 rounded-xl bg-red-50 border border-red-200">
 <p className="text-[13px] text-red-700 font-medium">{error}</p>
 </div>
 )}

 {/* ═══════════ SAVE ═══════════ */}
 <div className="px-5 mt-6">
 <button
 type="button"
 onClick={handleSave}
 disabled={saving || !hasChanges}
 className="w-full py-[16px] rounded-[14px] bg-gradient-to-r from-accent-2 to-accent text-white font-bold text-[15px] flex items-center justify-center gap-2 shadow-lg shadow-accent-2/30 disabled:opacity-50 active:scale-[0.98] transition-transform"
 >
 {saving ? (
 <>
 <Loader2 size={18} className="animate-spin" />
 Đang lưu...
 </>
 ) : saved ? (
 <>
 <Check size={18} />
 Đã lưu thành công!
 </>
 ) : (
 <>
 <Save size={18} />
 Lưu Cài Đặt
 </>
 )}
 </button>
 </div>

 <div className="px-5 mt-3 flex items-center gap-2 text-[12px] text-txt-secondary dark:text-white/50">
 <RefreshCw size={12} />
 <span>Thay đổi có hiệu lực ngay, không cần khởi động lại.</span>
 </div>
 </div>
 );
}
