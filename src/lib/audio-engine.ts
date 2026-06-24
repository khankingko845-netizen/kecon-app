"use client";

// Lightweight Web Audio ambient engine. All sounds are synthesized on the fly
// (filtered noise / oscillators) so the app needs no external audio assets and
// works fully offline. Used by the Lullaby screen and the player Sound Mixer.

export type AmbientType =
  | "rain"
  | "waves"
  | "wind"
  | "fire"
  | "night"
  | "lullaby"
  | "forest";

function makeNoiseBuffer(ctx: AudioContext, color: "white" | "brown"): AudioBuffer {
  const length = ctx.sampleRate * 2;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (color === "brown") {
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    } else {
      data[i] = white;
    }
  }
  return buffer;
}

interface Layer {
  nodes: AudioNode[];
  gain: GainNode;
  stop: () => void;
}

export class AmbientEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private layers = new Map<AmbientType, Layer>();
  private volumes = new Map<AmbientType, number>();

  private ensureCtx(): AudioContext {
    if (!this.ctx) {
      const Ctor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 1;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return this.ctx;
  }

  private buildLayer(type: AmbientType, ctx: AudioContext, out: GainNode): Layer {
    const nodes: AudioNode[] = [];
    const now = ctx.currentTime;

    const startNoise = (color: "white" | "brown") => {
      const src = ctx.createBufferSource();
      src.buffer = makeNoiseBuffer(ctx, color);
      src.loop = true;
      nodes.push(src);
      return src;
    };

    switch (type) {
      case "rain": {
        const src = startNoise("white");
        const hp = ctx.createBiquadFilter();
        hp.type = "highpass";
        hp.frequency.value = 1000;
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 6000;
        src.connect(hp).connect(lp).connect(out);
        src.start();
        break;
      }
      case "waves": {
        const src = startNoise("brown");
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 600;
        const swell = ctx.createGain();
        swell.gain.value = 0.5;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.12;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.4;
        lfo.connect(lfoGain).connect(swell.gain);
        lfo.start();
        nodes.push(lfo);
        src.connect(lp).connect(swell).connect(out);
        src.start();
        break;
      }
      case "wind": {
        const src = startNoise("white");
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 500;
        bp.Q.value = 0.7;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.08;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 300;
        lfo.connect(lfoGain).connect(bp.frequency);
        lfo.start();
        nodes.push(lfo);
        src.connect(bp).connect(out);
        src.start();
        break;
      }
      case "fire": {
        const src = startNoise("brown");
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 1200;
        src.connect(lp).connect(out);
        src.start();
        break;
      }
      case "forest": {
        const src = startNoise("white");
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = 2500;
        bp.Q.value = 2;
        const g = ctx.createGain();
        g.gain.value = 0.15;
        src.connect(bp).connect(g).connect(out);
        src.start();
        break;
      }
      case "night": {
        // Cricket-like chirps via amplitude-modulated high oscillator.
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = 4200;
        const am = ctx.createGain();
        am.gain.value = 0;
        const lfo = ctx.createOscillator();
        lfo.type = "square";
        lfo.frequency.value = 8;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 0.06;
        lfo.connect(lfoGain).connect(am.gain);
        lfo.start();
        osc.connect(am).connect(out);
        osc.start();
        nodes.push(osc, lfo);
        break;
      }
      case "lullaby": {
        // Soft repeating arpeggio (pentatonic) with gentle envelope.
        const notes = [523.25, 587.33, 659.25, 783.99, 880.0];
        const g = ctx.createGain();
        g.gain.value = 0.0;
        g.connect(out);
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.connect(g);
        osc.start();
        nodes.push(osc);
        let i = 0;
        const tick = () => {
          if (!this.layers.has("lullaby")) return;
          const t = ctx.currentTime;
          osc.frequency.setValueAtTime(notes[i % notes.length], t);
          g.gain.cancelScheduledValues(t);
          g.gain.setValueAtTime(0.0001, t);
          g.gain.exponentialRampToValueAtTime(0.5, t + 0.05);
          g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
          i++;
        };
        tick();
        const interval = setInterval(tick, 1000);
        nodes.push({
          // wrap interval cleanup in a dummy node-like object
          disconnect: () => clearInterval(interval),
        } as unknown as AudioNode);
        break;
      }
    }

    void now;
    const gain = out;
    return {
      nodes,
      gain,
      stop: () => {
        nodes.forEach((n) => {
          try {
            if ("stop" in n && typeof (n as OscillatorNode).stop === "function") {
              (n as OscillatorNode).stop();
            }
            n.disconnect();
          } catch {
            /* ignore */
          }
        });
      },
    };
  }

  toggle(type: AmbientType, on: boolean) {
    if (on) this.play(type);
    else this.stopLayer(type);
  }

  play(type: AmbientType) {
    if (this.layers.has(type)) return;
    const ctx = this.ensureCtx();
    const gain = ctx.createGain();
    gain.gain.value = this.volumes.get(type) ?? 0.6;
    gain.connect(this.master!);
    const layer = this.buildLayer(type, ctx, gain);
    layer.gain = gain;
    this.layers.set(type, layer);
  }

  stopLayer(type: AmbientType) {
    const layer = this.layers.get(type);
    if (!layer) return;
    layer.stop();
    try {
      layer.gain.disconnect();
    } catch {
      /* ignore */
    }
    this.layers.delete(type);
  }

  setVolume(type: AmbientType, value: number) {
    this.volumes.set(type, value);
    const layer = this.layers.get(type);
    if (layer && this.ctx) {
      layer.gain.gain.setTargetAtTime(value, this.ctx.currentTime, 0.05);
    }
  }

  setMaster(value: number) {
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(value, this.ctx.currentTime, 0.05);
    }
  }

  isPlaying(type: AmbientType): boolean {
    return this.layers.has(type);
  }

  stopAll() {
    Array.from(this.layers.keys()).forEach((t) => this.stopLayer(t));
  }

  dispose() {
    this.stopAll();
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
      this.master = null;
    }
  }
}
