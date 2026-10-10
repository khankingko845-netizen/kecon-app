"use client";
import { ambientResponse, MAX_AMBIENT_LAYERS, type AmbientType } from "@/lib/ambient-library";
export type { AmbientType } from "@/lib/ambient-library";
interface Layer { source: AudioBufferSourceNode; gain: GainNode }
interface PendingLayer { controller: AbortController; promise: Promise<void> }
const clamp = (n: number) => Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
const cancelled = () => new DOMException("Đã dừng âm nền.", "AbortError");
/** Licensed recorded files. No oscillator/noise fallback. */
export class AmbientEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private masterVolume = 1;
  private layers = new Map<AmbientType, Layer>();
  private pending = new Map<AmbientType, PendingLayer>();
  private volumes = new Map<AmbientType, number>();
  private buffers = new Map<AmbientType, AudioBuffer>();
  private retiring = new Map<Layer, ReturnType<typeof setTimeout>>();
  private disposed = false;
  /** Call inside a user gesture, before fetching (Safari autoplay policy). */
  async unlock(): Promise<void> {
    if (this.disposed) return Promise.reject(cancelled());
    if (!this.ctx) {
      const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return Promise.reject(new Error("Trình duyệt chưa hỗ trợ phát âm nền."));
      this.ctx = new Ctor(); this.master = this.ctx.createGain();
      this.master.gain.value = this.masterVolume; this.master.connect(this.ctx.destination);
    }
    return this.ctx.state === "suspended" ? this.ctx.resume() : Promise.resolve();
  }
  play(type: AmbientType): Promise<void> {
    if (this.disposed) return Promise.reject(cancelled());
    if (this.layers.has(type)) return Promise.resolve();
    const existing = this.pending.get(type); if (existing) return existing.promise;
    if (this.layers.size + this.pending.size >= MAX_AMBIENT_LAYERS)
      return Promise.reject(new Error("Tối đa 3 âm nền cùng lúc. Tắt một âm trước khi thêm."));
    const controller = new AbortController();
    const unlocked = this.unlock();
    const entry: PendingLayer = { controller, promise: Promise.resolve() };
    this.pending.set(type, entry);
    entry.promise = (async () => {
      await unlocked;
      const ctx = this.ctx;
      if (!ctx || this.disposed || controller.signal.aborted) throw cancelled();
      let buffer = this.buffers.get(type);
      if (!buffer) {
        const response = await ambientResponse(type, controller.signal);
        buffer = await ctx.decodeAudioData(await response.arrayBuffer());
        if (!buffer.duration) throw new Error("File âm nền chưa phát được.");
        if (!controller.signal.aborted && !this.disposed) this.buffers.set(type, buffer);
      }
      if (controller.signal.aborted || this.disposed || this.pending.get(type) !== entry) throw cancelled();
      const source = ctx.createBufferSource(); source.buffer = buffer; source.loop = true;
      const gain = ctx.createGain(); gain.gain.value = 0;
      gain.gain.setTargetAtTime(this.volumes.get(type) ?? 0.18, ctx.currentTime, 0.45);
      source.connect(gain).connect(this.master!);
      this.layers.set(type, { source, gain }); source.start();
    })().catch(error => {
      if ((error as Error).name === "AbortError") throw error;
      throw new Error(`Không phát được âm nền. ${(error as Error).message || "Thử lại khi có mạng."}`);
    }).finally(() => { if (this.pending.get(type) === entry) this.pending.delete(type); });
    return entry.promise;
  }
  toggle(type: AmbientType, on: boolean): Promise<void> {
    if (on) return this.play(type); this.stopLayer(type); return Promise.resolve();
  }
  private release(layer: Layer) {
    try { layer.source.stop(); } catch { /* already stopped */ }
    layer.source.disconnect(); layer.gain.disconnect();
  }
  stopLayer(type: AmbientType) {
    this.pending.get(type)?.controller.abort(); this.pending.delete(type);
    const layer = this.layers.get(type); if (!layer) return;
    this.layers.delete(type);
    if (this.ctx) layer.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.25);
    const timer = setTimeout(() => { this.retiring.delete(layer); this.release(layer); }, 1000);
    this.retiring.set(layer, timer);
  }
  setVolume(type: AmbientType, value: number) {
    const volume = clamp(value); this.volumes.set(type, volume);
    if (this.ctx) this.layers.get(type)?.gain.gain.setTargetAtTime(volume, this.ctx.currentTime, 0.1);
  }
  setMaster(value: number) {
    this.masterVolume = clamp(value);
    if (this.ctx) this.master?.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.15);
  }
  isPlaying(type: AmbientType): boolean { return this.layers.has(type); }
  isPending(type: AmbientType): boolean { return this.pending.has(type); }
  stopAll() {
    [...new Set([...this.layers.keys(), ...this.pending.keys()])].forEach(type => this.stopLayer(type));
  }
  dispose() {
    this.disposed = true; this.pending.forEach(entry => entry.controller.abort()); this.pending.clear();
    this.layers.forEach(layer => this.release(layer)); this.layers.clear();
    this.retiring.forEach((timer, layer) => { clearTimeout(timer); this.release(layer); }); this.retiring.clear();
    this.buffers.clear(); void this.ctx?.close().catch(() => {}); this.ctx = null; this.master = null;
  }
}
