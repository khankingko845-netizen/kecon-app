import {it,expect,vi,beforeEach} from "vitest";
import {NextRequest} from "next/server";
import {CLOSED_FEATURE_FLAGS} from "@/lib/feature-flags";
const m=vi.hoisted(()=>({rpc:vi.fn(),user:vi.fn()}));
vi.mock("@/lib/supabase/server",()=>({createClient:async()=>({rpc:m.rpc,auth:{getUser:m.user}})}));
import {withAiContext,aiContext} from "@/lib/ai-metering";
import {guardMeasuredFeature,canOpenServerFeatureScreen} from "@/lib/feature-flags-server";
const db=()=>({rpc:m.rpc,auth:{getUser:m.user}}) as never;
const req=(b:unknown={})=>new NextRequest("https://local/api/test",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(b)});
beforeEach(()=>{vi.clearAllMocks();m.user.mockResolvedValue({data:{user:{id:"family"}}});m.rpc.mockImplementation(async(name:string)=>({data:name==="public_feature_flags"?CLOSED_FEATURE_FLAGS:false,error:null}));});
it("all optional paid APIs stop before handler/quota/meter/provider even with BYO",async()=>{
 for(const feature of ["story.from-drawing","story.scan","story.expert-review","story.vocabulary","story.translate","story.illustrate","story.illustrate-batch","voice.ambient"]){
  const handler=vi.fn(async()=>Response.json({ok:true}));
  expect((await withAiContext(feature,handler)(req({apiKey:"private-test-byo"}))).status).toBe(404);expect(handler).not.toHaveBeenCalled();
 }
 expect(m.rpc.mock.calls.every(([name])=>name==="public_feature_flags")).toBe(true);
});
it("core Vietnamese work still runs; explicitly non-vi is blocked",async()=>{
 const handler=vi.fn(async()=>Response.json({feature:aiContext.getStore()?.feature}));
 expect((await withAiContext("story.generate",handler)(req({language:"vi"}))).status).toBe(200);
 expect((await withAiContext("voice.tts",handler)(req({language:"ja"}))).status).toBe(404);expect(handler).toHaveBeenCalledTimes(1);
});
it("unavailable catalog returns sanitized 503, not fallback-on",async()=>{
 m.rpc.mockResolvedValue({data:null,error:{message:"private-internal"}});
 const handler=vi.fn();const r=await withAiContext("story.scan",handler)(req());expect(r.status).toBe(503);expect(await r.text()).not.toContain("private-internal");expect(handler).not.toHaveBeenCalled();
});
it("only verified voices.manage may preview a foreign-language catalog, not translate or TTS",async()=>{
 m.rpc.mockImplementation(async(name:string)=>({data:name==="has_permission"?true:CLOSED_FEATURE_FLAGS,error:null}));
 expect(await guardMeasuredFeature(db(),"voice.preview",{language:"en"})).toBeNull();
 expect((await guardMeasuredFeature(db(),"voice.tts",{language:"en"}))?.status).toBe(404);
 expect((await guardMeasuredFeature(db(),"story.translate",{language:"en"}))?.status).toBe(404);
});
it("advanced routes require permission as well as a switch; visitors denied",async()=>{
 m.rpc.mockImplementation(async(name:string)=>({data:name==="public_feature_flags"?{...CLOSED_FEATURE_FLAGS,advanced_authoring:true}:false,error:null}));
 expect(await canOpenServerFeatureScreen(db(),"editor")).toBe(false);
 m.rpc.mockImplementation(async(name:string)=>({data:name==="public_feature_flags"?{...CLOSED_FEATURE_FLAGS,advanced_authoring:true}:true,error:null}));
 expect(await canOpenServerFeatureScreen(db(),"editor")).toBe(true);
 m.user.mockResolvedValue({data:{user:null}});expect(await canOpenServerFeatureScreen(db(),"editor")).toBe(false);
});
it("multipart requests use the same gate without consuming the handler body",async()=>{
 const form=new FormData();form.set("language","en");form.set("apiKey","byo-private");const handler=vi.fn();
 expect((await withAiContext("story.scan",handler)(new NextRequest("https://local/api/test",{method:"POST",body:form}))).status).toBe(404);expect(handler).not.toHaveBeenCalled();
});
it("cross-site and unauthenticated requests never read a catalog",async()=>{
 const handler=vi.fn();expect((await withAiContext("story.scan",handler)(new NextRequest("https://local/x",{method:"POST",headers:{"sec-fetch-site":"cross-site"}}))).status).toBe(403);
 m.user.mockResolvedValue({data:{user:null}});expect((await withAiContext("story.scan",handler)(req())).status).toBe(401);expect(m.rpc).not.toHaveBeenCalled();expect(handler).not.toHaveBeenCalled();
});
