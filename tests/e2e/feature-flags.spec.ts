import {test,expect,type BrowserContext} from "@playwright/test";
import {signInAsMockFamily,MOCK_ADMIN_USER_ID,MOCK_EDITOR_USER_ID} from "./support/fixtures";
import {FEATURE_KEYS} from "../../src/lib/feature-flags";
test.describe.configure({mode:"serial"});
let admin:BrowserContext;
async function set(name:string,enabled:boolean){
 const flags=(await (await admin.request.get("/api/features")).json()).flags;
 const r=await admin.request.post("/api/admin/features",{data:{name,enabled,expected:flags[name],reason:"Kiểm thử tích hợp cờ T06"}});expect(r.status()).toBe(200);
}
test.beforeAll(async({browser,baseURL})=>{
 admin=await browser.newContext({baseURL});await signInAsMockFamily(admin,baseURL!,{userId:MOCK_ADMIN_USER_ID});
 for(const key of FEATURE_KEYS)await set(key,key==="advanced_authoring");
});
test.afterAll(async()=>{if(admin){for(const key of FEATURE_KEYS)await set(key,true);await admin.close();}});
test("v1 core stays available; optional links, direct URL/query and paid API are closed",async({page,context,baseURL})=>{
 await signInAsMockFamily(context,baseURL!);await page.goto("/");await expect(page.getByTestId("home-explore")).toBeVisible();
 await expect(page.getByRole("button",{name:"Vẽ truyện",exact:true})).toHaveCount(0);
 for(const url of ["/draw-story","/scan-book","/achievements","/editor","/upload","/?screen=vocab-quiz","/unknown-feature"]){expect((await page.goto(url))?.status(),url).toBe(404);}
 for(const path of ["story/from-drawing","story/scan","story/expert-review","story/vocabulary","story/translate","story/illustrate","story/illustrate-batch","voice/ambient"]){expect((await context.request.post("/api/"+path,{data:{apiKey:"test-byo-never-provider"}})).status(),path).toBe(404);}
 expect((await context.request.post("/api/voice/tts",{data:{language:"en"}})).status()).toBe(404);
 expect((await context.request.post("/api/push/subscribe",{data:{}})).status()).toBe(404);
 // No quota/provider despite malformed core request; validation remains active.
 expect((await context.request.post("/api/story/generate",{data:{}})).status()).toBe(400);
});
test("admin toggles with a reason; an open optional screen closes after refresh",async({page,context,baseURL})=>{
 const settings=await admin.newPage();await settings.goto("/admin/settings");const toggle=settings.getByRole("switch",{name:"Thử thách & huy hiệu"});await expect(toggle).toHaveAttribute("aria-checked","false");
 await toggle.click();const dialog=settings.getByRole("dialog");await expect(dialog).toBeVisible();await expect(dialog.getByRole("button",{name:"Bật tính năng",exact:true})).toBeDisabled();
 await dialog.getByRole("textbox",{name:"Lý do thao tác"}).fill("Kiểm thử T06 bật gamification");await dialog.getByRole("button",{name:"Bật tính năng",exact:true}).click();await expect(toggle).toHaveAttribute("aria-checked","true");
 await signInAsMockFamily(context,baseURL!);expect((await page.goto("/achievements"))?.status()).toBe(200);
 await expect(page.getByText("Tính năng đang tắt",{exact:true})).toHaveCount(0);
 await set("gamification",false);await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await expect(page.getByRole("heading",{name:"Tính năng đang tắt"})).toBeVisible();await settings.close();
});
test("flag does not grant staff capabilities; family/editor/AAL1 cannot manage",async({browser,baseURL})=>{
 for(const options of [{},{userId:MOCK_EDITOR_USER_ID},{userId:MOCK_ADMIN_USER_ID,adminReady:false}]){
  const c=await browser.newContext({baseURL});await signInAsMockFamily(c,baseURL!,options);
  expect((await c.request.post("/api/admin/features",{data:{name:"gamification",enabled:true,expected:false,reason:"Kiểm thử không cấp quyền"}})).status()).toBe(403);
  if(!options.userId)expect((await c.request.get("/editor")).status()).toBe(404);await c.close();
 }
});
test("stale expected values conflict; ordinary flags cannot be injected",async()=>{
 await set("story_drawing",true);
 const r=await admin.request.post("/api/admin/features",{data:{name:"story_drawing",enabled:false,expected:false,reason:"Kiểm thử xung đột cờ T06"}});expect(r.status()).toBe(409);
 expect((await admin.request.post("/api/admin/features",{data:{name:"openai_api_key",enabled:true,expected:false,reason:"Không cho key giả vào cờ"}})).status()).toBe(400);
 await set("story_drawing",false);
});
