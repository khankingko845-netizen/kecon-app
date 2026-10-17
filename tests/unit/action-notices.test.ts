import {expect,it} from "vitest";
import {enqueueNotice,noticeDuration,MAX_NOTICES,type Notice} from "@/lib/action-notices";
it("bounds queue without mutating prior array",()=>{const old:Notice[]=Array.from({length:5},(_,i)=>({id:String(i),type:"info",message:String(i)}));const next=enqueueNotice(old,{id:"x",type:"success",message:"Đã lưu"});expect(next).toHaveLength(MAX_NOTICES);expect(old).toHaveLength(5);expect(next.at(-1)?.id).toBe("x");});
it("deduplicates repeated active outcomes, preserving different states",()=>{const q:Notice[]=[{id:"1",type:"success",message:"Lưu"},{id:"2",type:"error",message:"Lưu"}];expect(enqueueNotice(q,{id:"1",type:"success",message:"Lưu"})).toHaveLength(2);});
it("errors stay longer; loading is not auto-dismissed; explicit persistent notices work",()=>{expect(noticeDuration("error")).toBeGreaterThan(noticeDuration("success"));expect(noticeDuration("loading")).toBe(0);expect(noticeDuration("success",0)).toBe(0);expect(noticeDuration("info",123)).toBe(123);});
it("plain message is not reinterpreted or persisted",()=>{const message="<script>secret</script>";expect(enqueueNotice([],{id:"1",type:"error",message})[0].message).toBe(message);});
