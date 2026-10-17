import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { AmbientEngine } from "@/lib/audio-engine";
import { ambientResponse } from "@/lib/ambient-library";
vi.mock("@/lib/ambient-library", async original => ({ ...await original<object>(), ambientResponse: vi.fn() }));
class Gain {
  gain = { value: 1, setTargetAtTime: vi.fn() };
  connect = vi.fn((other: unknown) => other); disconnect = vi.fn();
}
class Source {
  buffer: unknown; loop = false; start = vi.fn(); stop = vi.fn();
  connect = vi.fn((other: unknown) => other); disconnect = vi.fn();
}
class Context {
  static instances: Context[] = [];
  state = "suspended"; currentTime = 5; destination = {}; gains: Gain[] = []; sources: Source[] = [];
  constructor() { Context.instances.push(this); }
  resume = vi.fn(async () => { this.state = "running"; });
  close = vi.fn(async () => { this.state = "closed"; });
  decodeAudioData = vi.fn(async () => ({ duration: 12 }));
  createGain() { const g = new Gain(); this.gains.push(g); return g; }
  createBufferSource() { const s = new Source(); this.sources.push(s); return s; }
}
const response = () => new Response(new Uint8Array([1,2,3]), { headers: { "Content-Type":"audio/mpeg" } });
function deferred<T>() { let resolve!: (value:T)=>void; const promise = new Promise<T>(r=>{resolve=r;}); return { promise, resolve }; }
beforeEach(() => { Context.instances=[]; vi.clearAllMocks(); vi.stubGlobal("window", { AudioContext: Context }); vi.mocked(ambientResponse).mockImplementation(async()=>response()); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("recorded ambient engine", () => {
  it("plays one looping decoded recording, deduplicates requests and retains ducking set before initialization", async () => {
    const e=new AmbientEngine();e.setMaster(0.35);e.setVolume("rain",0.2);
    const first=e.play("rain");expect(e.play("rain")).toBe(first);await first;
    const c=Context.instances[0];expect(c.resume).toHaveBeenCalledOnce();expect(c.gains[0].gain.value).toBe(0.35);
    expect(c.sources).toHaveLength(1);expect(c.sources[0].loop).toBe(true);expect(c.sources[0].start).toHaveBeenCalledOnce();
    expect(c.gains[1].gain.setTargetAtTime).toHaveBeenCalledWith(0.2,5,0.45);expect(e.isPlaying("rain")).toBe(true);
    await e.play("rain");expect(ambientResponse).toHaveBeenCalledOnce();e.dispose();expect(c.sources[0].stop).toHaveBeenCalledOnce();
  });
  it("stopping while fetching prevents a late recording from starting", async () => {
    const d=deferred<Response>();vi.mocked(ambientResponse).mockReturnValueOnce(d.promise);
    const e=new AmbientEngine();const result=e.play("rain").catch(err=>err.name);await Promise.resolve();
    e.stopLayer("rain");d.resolve(response());expect(await result).toBe("AbortError");
    expect(Context.instances[0].sources).toHaveLength(0);expect(e.isPending("rain")).toBe(false);e.dispose();
  });
  it("dispose during decode prevents late playback and cannot recreate a context", async () => {
    const d=deferred<{duration:number}>();const e=new AmbientEngine();await e.unlock();
    Context.instances[0].decodeAudioData.mockReturnValueOnce(d.promise);
    const result=e.play("wind").catch(err=>err.name);
    await vi.waitFor(()=>expect(Context.instances[0].decodeAudioData).toHaveBeenCalled());e.dispose();d.resolve({duration:12});
    expect(await result).toBe("AbortError");await expect(e.play("rain")).rejects.toHaveProperty("name","AbortError");expect(Context.instances).toHaveLength(1);
  });
  it("caps all pending and playing layers at three, releases stopped slots", async () => {
    const d=deferred<Response>();vi.mocked(ambientResponse).mockImplementation(()=>d.promise.then(r=>r.clone()));
    const e=new AmbientEngine();const ps=[e.play("rain"),e.play("waves"),e.play("wind")];
    await expect(e.play("fire")).rejects.toThrow("Tối đa 3");d.resolve(response());await Promise.all(ps);
    expect(Context.instances[0].sources).toHaveLength(3);e.stopLayer("rain");await e.play("fire");e.dispose();
  });
  it("load errors are visible, never synthesized, and can be retried", async () => {
    vi.mocked(ambientResponse).mockRejectedValueOnce(new Error("missing file"));const e=new AmbientEngine();
    await expect(e.play("forest")).rejects.toThrow("missing file");expect(e.isPlaying("forest")).toBe(false);expect(e.isPending("forest")).toBe(false);
    expect(Context.instances[0].sources).toHaveLength(0);await e.play("forest");expect(e.isPlaying("forest")).toBe(true);e.dispose();
  });
  it("fades, clamps volumes, and cancels delayed cleanup on dispose", async () => {
    vi.useFakeTimers();const e=new AmbientEngine();await e.play("rain");const c=Context.instances[0];
    e.setVolume("rain",2);expect(c.gains[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(1,5,0.1);
    e.setVolume("rain",NaN);expect(c.gains[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(0,5,0.1);
    e.setMaster(-2);expect(c.gains[0].gain.setTargetAtTime).toHaveBeenLastCalledWith(0,5,0.15);
    e.stopAll();expect(c.gains[1].gain.setTargetAtTime).toHaveBeenLastCalledWith(0,5,0.25);
    expect(c.sources[0].stop).not.toHaveBeenCalled();e.dispose();vi.runAllTimers();expect(c.sources[0].stop).toHaveBeenCalledOnce();expect(c.close).toHaveBeenCalledOnce();
  });
});
