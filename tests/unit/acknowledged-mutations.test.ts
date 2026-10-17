import {beforeEach,expect,it,vi} from "vitest";
const m=vi.hoisted(()=>({createClient:vi.fn()}));vi.mock("@/lib/supabase/client",()=>({createClient:m.createClient}));
import {updateVoiceProfile,deleteVoiceProfile,updateStory,updateStoryPage,deleteStoryPage,restoreStory,updateStoryCharacter,deleteStoryCharacter,updateStoryNarrator,upsertStoryCategory,upsertStoryTemplate,toggleStoryTemplateActive,bulkPublishStories,toggleFavorite,syncPageOrder} from "@/lib/db";
type Result={data:unknown;error:unknown};let results:Result[];let selects:string[];
beforeEach(()=>{results=[];selects=[];m.createClient.mockImplementation(()=>({auth:{getUser:async()=>({data:{user:{id:"owner"}}})},from:()=>{const q={select:(s:string)=>{selects.push(s);return q;},update:()=>q,delete:()=>q,insert:()=>q,upsert:()=>q,eq:()=>q,in:()=>q,maybeSingle:()=>q,then:(resolve:(x:Result)=>unknown,reject:(e:unknown)=>unknown)=>Promise.resolve(results.shift()??{data:[{id:"one"}],error:null}).then(resolve,reject)};return q;}}));});
const operations=[()=>updateVoiceProfile("one",{name:"Mới"}),()=>deleteVoiceProfile("one"),()=>updateStory("one",{title:"Mới"}),()=>updateStoryPage("one",{content:"Mới"}),()=>deleteStoryPage("one"),()=>restoreStory("one"),()=>updateStoryCharacter("one",{name:"Mới"}),()=>deleteStoryCharacter("one"),()=>updateStoryNarrator("one","voice","Giọng"),()=>upsertStoryCategory({id:"one",label:"Mới"}),()=>upsertStoryTemplate({title:"Mới",category:"animal",pages:[]}),()=>toggleStoryTemplateActive("one",false)];
for(const [i,operation]of operations.entries()){
 it(`mutation ${i} waits for row acknowledgement`,async()=>{await operation();expect(selects).toContain("id");});
 it(`mutation ${i} rejects server errors`,async()=>{results=[{data:null,error:Error("denied")}];await expect(operation()).rejects.toThrow("denied");});
 it(`mutation ${i} rejects zero affected rows`,async()=>{results=[{data:[],error:null}];await expect(operation()).rejects.toThrow();});
}
it("bulk publication cannot claim complete success for missing rows",async()=>{await expect(bulkPublishStories(["one","two"],true)).rejects.toThrow("Chưa cập nhật đủ");});
it("bulk publication counts unique ids",async()=>{await expect(bulkPublishStories(["one","one"],true)).resolves.toBeUndefined();});
it("page ordering propagates failed writes",async()=>{results=[{data:null,error:Error("denied")}];await expect(syncPageOrder([{id:"one",page_number:2}])).rejects.toThrow("denied");});
it("favorite read failure does not initiate a toggle",async()=>{results=[{data:null,error:Error("read failed")}];await expect(toggleFavorite("story")).rejects.toThrow("read failed");expect(selects).toHaveLength(1);});
it("favorite insert/delete both require acknowledgement",async()=>{results=[{data:null,error:null},{data:[],error:null}];await expect(toggleFavorite("story")).rejects.toThrow();results=[{data:{id:"fav"},error:null},{data:[],error:null}];await expect(toggleFavorite("story")).rejects.toThrow();});
it("favorite returns committed state",async()=>{results=[{data:null,error:null},{data:[{id:"fav"}],error:null}];expect(await toggleFavorite("story")).toBe(true);results=[{data:{id:"fav"},error:null},{data:[{id:"fav"}],error:null}];expect(await toggleFavorite("story")).toBe(false);});
