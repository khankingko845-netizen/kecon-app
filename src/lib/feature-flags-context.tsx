"use client";
import { createContext, useContext, useCallback, useEffect, useState, useRef, useMemo, type ReactNode } from "react";
import { useAuth } from "@/lib/auth-context";
import { CLOSED_FEATURE_FLAGS, parseFeatureFlags, canOpenFeatureScreen, type FeatureFlags, type FeatureKey } from "@/lib/feature-flags";
import type { Screen } from "@/lib/types";
type Snapshot = { owner: string; flags: FeatureFlags; canAuthor: boolean; canManage: boolean; error: string };
const closed = (owner: string, error = ""): Snapshot => ({owner, flags:CLOSED_FEATURE_FLAGS,canAuthor:false,canManage:false,error});
const Context = createContext({ ...closed(""), refresh: async () => {} });
export function FeatureFlagsProvider({children}:{children:ReactNode}) {
 const {user} = useAuth(); const owner=user?.id ?? "visitor";
 const [state,setState]=useState<Snapshot>(()=>closed(""));
 const sequence=useRef(0);
 const refresh=useCallback(async()=>{
  const request=++sequence.current;
  try {
   const response=await fetch("/api/features",{cache:"no-store"});
   if(!response.ok) throw Error("Unavailable");
   const body=await response.json();
   if(request===sequence.current) setState({owner,flags:parseFeatureFlags(body.flags),canAuthor:body.canAuthor===true,canManage:body.canManage===true,error:""});
  } catch {
   if(request===sequence.current) setState(closed(owner,"Không tải được cờ tính năng; tính năng mở rộng đang khoá"));
  }
 },[owner]);
 useEffect(()=>{
  void refresh();
  const focus=()=>void refresh();
  const timer=setInterval(()=>{if(document.visibilityState==="visible")void refresh();},20000);
  window.addEventListener("focus",focus);
  return ()=>{++sequence.current;clearInterval(timer);window.removeEventListener("focus",focus);};
 },[refresh]);
 // Auth changes close optional screens immediately, before the next response; late responses cannot restore old privileges.
 const snapshot=state.owner===owner?state:closed(owner);
 return <Context.Provider value={{...snapshot,refresh}}>{children}</Context.Provider>;
}
export function useFeatureFlags(){
 const s=useContext(Context);
 const enabled=useCallback((key:FeatureKey)=>s.flags[key],[s.flags]);
 const canOpen=useCallback((screen:Screen)=>canOpenFeatureScreen(screen,s.flags,s.canAuthor),[s.flags,s.canAuthor]);
 return useMemo(()=>({...s,enabled,canOpen}),[s,enabled,canOpen]);
}
