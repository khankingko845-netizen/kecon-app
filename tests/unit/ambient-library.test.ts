import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import { createHash, webcrypto } from "node:crypto";
import { AMBIENT_CACHE, AMBIENT_TRACKS, ambientResponse, cachedAmbientTypes, downloadAmbientLibrary } from "@/lib/ambient-library";
class Cache {
  values = new Map<string,Response>(); refuse=false;
  async match(url:string) { return this.values.get(url)?.clone(); }
  async put(url:string,r:Response) { if(this.refuse)throw Error("QuotaExceededError");this.values.set(url,r.clone()); }
  async delete(url:string) { return this.values.delete(url); }
}
let cache:Cache;
const bytes=(url:string)=>new Uint8Array(fs.readFileSync(new URL("../../public"+url,import.meta.url)));
const ok=(url:string)=>new Response(bytes(url),{headers:{"Content-Type":"audio/mpeg"}});
beforeEach(()=>{cache=new Cache();vi.stubGlobal("crypto",webcrypto);vi.stubGlobal("caches",{open:vi.fn(async(name:string)=>{expect(name).toBe(AMBIENT_CACHE);return cache;})});vi.stubGlobal("fetch",vi.fn(async(url:string)=>ok(url)));});
afterEach(()=>vi.unstubAllGlobals());
describe("licensed ambient library",()=>{
 it("ships eight local, unique, attributed CC0 assets with exact integrity hashes",()=>{
  expect(AMBIENT_TRACKS).toHaveLength(8);expect(new Set(AMBIENT_TRACKS.map(t=>t.id)).size).toBe(8);
  for(const t of AMBIENT_TRACKS){expect(t.url).toMatch(/^\/audio\/ambient\/v1\/[a-z]+\.mp3$/);expect(t.license).toBe("CC0 1.0");expect(t.author).not.toBe("");expect(t.source).toMatch(/^https:\/\/opengameart.org\/content\//);const b=bytes(t.url);expect(b.byteLength).toBe(t.bytes);expect(createHash("sha256").update(b).digest("hex")).toBe(t.sha256);expect(t.duration).toBeGreaterThan(8);}
  expect(AMBIENT_TRACKS.find(t=>t.id==="lullaby")?.kind).toBe("music");expect(AMBIENT_TRACKS.reduce((n,t)=>n+t.bytes,0)).toBeLessThan(3_000_000);
 });
 it("caches verified clips and plays cache without any network",async()=>{
  const first=await ambientResponse("rain");expect(first.status).toBe(200);expect(fetch).toHaveBeenCalledOnce();
  vi.mocked(fetch).mockRejectedValue(new Error("offline"));const second=await ambientResponse("rain");expect(second.status).toBe(200);expect(fetch).toHaveBeenCalledOnce();expect(await cachedAmbientTypes()).toEqual(["rain"]);
 });
 it("rejects HTML and partial responses, never caches failed files",async()=>{
  vi.mocked(fetch).mockResolvedValueOnce(new Response("login",{headers:{"Content-Type":"text/html"}}));await expect(ambientResponse("rain")).rejects.toThrow("Không tải");
  vi.mocked(fetch).mockResolvedValueOnce(new Response(bytes(AMBIENT_TRACKS[0].url),{status:206,headers:{"Content-Type":"audio/mpeg"}}));await expect(ambientResponse("rain")).rejects.toThrow("Không tải");expect(cache.values.size).toBe(0);
 });
 it("repairs poisoned or truncated cache, rejects same-size corrupt data",async()=>{
  const t=AMBIENT_TRACKS[0];const b=bytes(t.url);b[100]^=1;cache.values.set(t.url,new Response(b,{headers:{"Content-Type":"audio/mpeg"}}));
  expect(await cachedAmbientTypes()).toEqual([]);await ambientResponse("rain");expect(fetch).toHaveBeenCalledOnce();expect(await cachedAmbientTypes()).toEqual(["rain"]);
  cache.values.clear();vi.mocked(fetch).mockResolvedValueOnce(new Response(b,{headers:{"Content-Type":"audio/mpeg"}}));await expect(ambientResponse("rain")).rejects.toThrow("Không tải");
 });
 it("downloads all eight and reports offline readiness only after verifying the cache",async()=>{
  const progress=vi.fn();expect(await downloadAmbientLibrary(progress)).toHaveLength(8);expect(progress).toHaveBeenLastCalledWith(8);
  vi.mocked(fetch).mockRejectedValue(new Error("offline"));for(const t of AMBIENT_TRACKS)expect((await ambientResponse(t.id)).status).toBe(200);expect(fetch).toHaveBeenCalledTimes(8);
 });
 it("can play online if caching fails but never claims full offline availability",async()=>{
  cache.refuse=true;expect((await ambientResponse("rain")).status).toBe(200);
  await expect(downloadAmbientLibrary(vi.fn())).rejects.toThrow("Chưa lưu đủ");expect(await cachedAmbientTypes()).toEqual([]);
 });
 it("partial failure settles other workers; later retry keeps valid clips",async()=>{
  vi.mocked(fetch).mockImplementation(async(url)=>{if(String(url).endsWith("waves.mp3"))throw Error("offline");return ok(String(url));});
  const progress=vi.fn();await expect(downloadAmbientLibrary(progress)).rejects.toThrow("offline");const count=progress.mock.calls.length;await Promise.resolve();expect(progress).toHaveBeenCalledTimes(count);
  vi.mocked(fetch).mockImplementation(async(url)=>ok(String(url)));expect(await downloadAmbientLibrary(vi.fn())).toHaveLength(8);
 });
 it("cancellation or unavailable CacheStorage never claims a download",async()=>{
  const c=new AbortController();c.abort();await expect(downloadAmbientLibrary(vi.fn(),c.signal)).rejects.toHaveProperty("name","AbortError");expect(fetch).not.toHaveBeenCalled();
  vi.stubGlobal("caches",undefined);await expect(downloadAmbientLibrary(vi.fn())).rejects.toThrow("chưa hỗ trợ");expect(await cachedAmbientTypes()).toEqual([]);
 });
});
