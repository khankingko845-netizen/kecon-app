import {test,expect} from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {signInAsMockFamily} from "./support/fixtures";
import manifest from "../../public/audio/ambient/v1/manifest.json";
async function openLullaby(page:import("@playwright/test").Page){
 await page.goto("/");await page.getByText("Sóc Nhỏ tìm hạt dẻ").first().click();
 await page.getByRole("button",{name:"Thêm tuỳ chọn",exact:true}).click();
 await page.getByRole("dialog",{name:"Tuỳ chọn truyện"}).getByRole("button",{name:/Ru ngủ/}).click();
 await expect(page.getByRole("heading",{name:"Ru ngủ cùng Đóm"})).toBeVisible();
}
async function monitor(page:import("@playwright/test").Page){
 await page.addInitScript(()=>{
  const state={starts:0,stops:0};Object.assign(window,{ambientQa:state});
  const start=AudioBufferSourceNode.prototype.start,stop=AudioBufferSourceNode.prototype.stop;
  AudioBufferSourceNode.prototype.start=function(...args:Parameters<typeof start>){if(this.loop&&(this.buffer?.duration??0)>8)state.starts++;return start.apply(this,args)};
  AudioBufferSourceNode.prototype.stop=function(...args:Parameters<typeof stop>){if(this.loop&&(this.buffer?.duration??0)>8)state.stops++;return stop.apply(this,args)};
 });
}
const counts=(page:import("@playwright/test").Page)=>page.evaluate(()=> (window as unknown as {ambientQa:{starts:number;stops:number}}).ambientQa);
test.describe("licensed audio offline playback",()=>{
 test.use({serviceWorkers:"allow"});
 test("downloads eight real clips, decodes offline, mixes three and stops on navigation",async({page,context,baseURL})=>{
  await signInAsMockFamily(context,baseURL!);await monitor(page);await openLullaby(page);
  await page.getByRole("button",{name:"Lưu 8 âm nền để nghe offline",exact:true}).click();
  await expect(page.getByRole("button",{name:"8/8 âm nền đã lưu offline",exact:true})).toBeVisible({timeout:30000});
  await page.getByText("Nguồn & giấy phép âm thanh",{exact:true}).click();
  await expect(page.getByRole("link",{name:"CC0 1.0",exact:true})).toHaveCount(8);
  await page.waitForFunction(()=>!!navigator.serviceWorker.controller);
  await context.setOffline(true);
  const decoded=await page.evaluate(async tracks=>{
   const ctx=new OfflineAudioContext(1,1,24000);const results=[];
   for(const t of tracks){const r=await fetch(t.url);if(!r.ok)throw Error(t.id);const b=await ctx.decodeAudioData(await r.arrayBuffer());results.push({id:t.id,duration:b.duration});}
   return results;
  },manifest.tracks);
  expect(decoded).toHaveLength(8);for(const row of decoded)expect(row.duration).toBeGreaterThan(8);
  for(const name of ["Mưa nhẹ","Dế đêm","Dòng suối"]){await page.getByRole("button",{name,exact:true}).click();await expect(page.getByRole("button",{name,exact:true})).toHaveAttribute("aria-pressed","true");}
  await expect.poll(async()=> (await counts(page)).starts).toBe(3);
  await page.getByRole("button",{name:"Gió qua đồng",exact:true}).click();await expect(page.getByRole("alert",{name:"Lỗi phát âm nền",exact:true})).toContainText("Tối đa 3");
  await expect.poll(async()=> (await counts(page)).starts).toBe(3);
  const axe=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21a","wcag21aa"]).analyze();expect(axe.violations).toEqual([]);
  await page.getByRole("button",{name:"Mưa nhẹ",exact:true}).click();await expect.poll(async()=> (await counts(page)).stops).toBe(1);
  await page.getByRole("button",{name:"Gió qua đồng",exact:true}).click();await expect.poll(async()=> (await counts(page)).starts).toBe(4);
  await page.getByRole("button",{name:"Quay lại",exact:true}).click();await expect.poll(async()=> (await counts(page)).stops).toBe(4);
  await context.setOffline(false);
 });
});
test.describe("recording error states",()=>{
 test.use({serviceWorkers:"block"});
 test("missing file reports an error, does not play fake noise, and clears loading",async({page,context,baseURL})=>{
  await signInAsMockFamily(context,baseURL!);await monitor(page);
  await page.route("**/audio/ambient/v1/rain.mp3",r=>r.fulfill({status:404,body:"missing"}));await openLullaby(page);
  await page.getByRole("button",{name:"Mưa nhẹ",exact:true}).click();await expect(page.getByRole("alert",{name:"Lỗi phát âm nền",exact:true})).toContainText("Không tải được");
  await expect(page.getByRole("button",{name:"Mưa nhẹ",exact:true})).toHaveAttribute("aria-pressed","false");
  await expect(page.getByRole("button",{name:"Mưa nhẹ",exact:true})).toHaveAttribute("aria-busy","false");expect((await counts(page)).starts).toBe(0);
 });
});
