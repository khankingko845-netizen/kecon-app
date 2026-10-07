"use client";
import {useState} from "react";
import {FEATURES,type FeatureKey} from "@/lib/feature-flags";
import {useFeatureFlags} from "@/lib/feature-flags-context";
import {useAdminConfirm} from "@/components/admin/AdminConfirm";
export default function FeatureFlagSettings(){
 const {flags,canManage,error:loadError,refresh}=useFeatureFlags();
 const confirm=useAdminConfirm(); const [busy,setBusy]=useState<FeatureKey|null>(null); const [error,setError]=useState("");
 const toggle=async(key:FeatureKey,label:string)=>{
  const expected=flags[key];
  const reason=await confirm({title:`${expected?"Tắt":"Bật"} ${label}?`,description:"Thay đổi dùng chung, có nhật ký. Bật cờ không cấp thêm quyền. Server chặn request mới ngay; màn đang mở cập nhật trong tối đa một phút khi trực tuyến.",confirmLabel:expected?"Tắt tính năng":"Bật tính năng"});
  if(!reason)return;setBusy(key);setError("");
  try {
   const r=await fetch("/api/admin/features",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({name:key,enabled:!expected,expected,reason})});
   if(!r.ok) throw Error(r.status===409?"Cờ đã được người khác đổi. Đã tải lại; kiểm tra trước khi thử lại.":"Không đổi được cờ; kiểm tra quyền và phiên quản trị.");
  } catch(e){setError(e instanceof Error?e.message:"Không đổi được cờ");}
  finally{await refresh();setBusy(null);}
 };
 return <section aria-labelledby="feature-flags-title" className="rounded-xl border border-gray-200 bg-white p-5">
 <h2 id="feature-flags-title" className="text-lg font-bold text-ink">Phạm vi tính năng v1</h2>
 <p className="mt-2 text-sm text-ink-2">Công tắc dùng chung. Không xoá dữ liệu cũ. Phần trăm rollout và danh sách hộ beta chưa thuộc T06.</p>
 {(error||loadError)&&<p role="alert" className="mt-3 text-red-800">{error||loadError}</p>}
 <ul className="mt-4 divide-y divide-gray-100">{FEATURES.map(f=><li key={f.key} className="flex flex-wrap items-center justify-between gap-3 py-3">
 <div><h3 className="font-semibold text-ink">{f.label}</h3><p className="max-w-xl text-sm text-ink-2">{f.description}</p></div>
 <button role="switch" aria-checked={flags[f.key]} aria-label={f.label} disabled={!canManage||busy!==null} className="admin-button" onClick={()=>void toggle(f.key,f.label)}>{busy===f.key?"Đang lưu…":flags[f.key]?"Đang bật":"Đang tắt"}</button>
 </li>)}</ul></section>;
}
