"use client";

/**
 * Gapless before/after player. Original and cleaned play as two sample-locked
 * Web Audio sources; A/B and strength are just gain moves, so switching is
 * instant mid-sentence and a strength change needs no re-render of audio:
 *   Original → orig·1          Cleaned → clean·(1−lim) + orig·lim
 * A muted <video> can ride along for video files.
 */

export type ABMode = "before" | "after";

export class ABPlayer {
  readonly duration: number;
  playing = false;
  onState: ((playing: boolean) => void) | null = null;

  private ctx: AudioContext | null = null;
  private origBuf: AudioBuffer;
  private cleanBuf: AudioBuffer;
  private gO: GainNode | null = null;
  private gC: GainNode | null = null;
  private srcs: AudioBufferSourceNode[] = [];
  private startedAt = 0;
  private offset = 0;
  private mode: ABMode = "after";
  private lim = 0;
  private raf = 0;
  private video: HTMLVideoElement | null = null;
  private ticks = new Set<(t: number) => void>();

  /** Playhead listener; returns an unsubscribe. */
  subscribe(fn: (t: number) => void): () => void {
    this.ticks.add(fn);
    fn(this.position());
    return () => { this.ticks.delete(fn); };
  }

  private tick(t: number) {
    for (const fn of this.ticks) fn(t);
  }

  constructor(orig: Float32Array[], clean: Float32Array[], sampleRate: number) {
    this.origBuf = toBuffer(orig, sampleRate);
    this.cleanBuf = toBuffer(clean, sampleRate);
    this.duration = this.origBuf.duration;
  }

  attachVideo(v: HTMLVideoElement | null) {
    this.video = v;
    if (v) v.currentTime = this.position();
  }

  position(): number {
    if (!this.playing || !this.ctx) return this.offset;
    return Math.min(this.duration, Math.max(0, this.ctx.currentTime - this.startedAt));
  }

  setMix(mode: ABMode, lim: number) {
    this.mode = mode;
    this.lim = lim;
    this.applyGains(false);
  }

  private applyGains(immediate: boolean) {
    if (!this.ctx || !this.gO || !this.gC) return;
    const o = this.mode === "before" ? 1 : this.lim;
    const c = this.mode === "before" ? 0 : 1 - this.lim;
    const t = this.ctx.currentTime;
    for (const [g, v] of [[this.gO, o], [this.gC, c]] as const) {
      g.gain.cancelScheduledValues(t);
      if (immediate) g.gain.setValueAtTime(v, t);
      else { g.gain.setValueAtTime(g.gain.value, t); g.gain.setTargetAtTime(v, t, 0.012); }
    }
  }

  private ensureCtx(): AudioContext {
    if (this.ctx) return this.ctx;
    // iOS: route Web Audio through the media channel so the silent switch doesn't mute it
    try {
      const s = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
      if (s) s.type = "playback";
    } catch { /* older Safari */ }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx: AudioContext = new Ctx();
    this.gO = ctx.createGain();
    this.gC = ctx.createGain();
    this.gO.connect(ctx.destination);
    this.gC.connect(ctx.destination);
    this.ctx = ctx;
    this.applyGains(true);
    return ctx;
  }

  play() {
    if (this.playing) return;
    const ctx = this.ensureCtx();
    void ctx.resume();
    if (this.offset >= this.duration - 0.05) this.offset = 0;
    const when = ctx.currentTime + 0.03;
    const mk = (buf: AudioBuffer, g: GainNode) => {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.connect(g);
      s.start(when, this.offset);
      return s;
    };
    this.srcs = [mk(this.origBuf, this.gO!), mk(this.cleanBuf, this.gC!)];
    const mine = this.srcs;
    this.srcs[1].onended = () => {
      if (this.srcs !== mine) return; // stopped by pause/seek, not a natural end
      this.stopSources();
      this.playing = false;
      this.offset = 0;
      this.video?.pause();
      this.tick(0);
      this.onState?.(false);
    };
    this.startedAt = when - this.offset;
    this.playing = true;
    if (this.video) {
      this.video.currentTime = this.offset;
      void this.video.play().catch(() => { /* preview only */ });
    }
    this.onState?.(true);
    this.loop();
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.position();
    this.stopSources();
    this.playing = false;
    this.video?.pause();
    cancelAnimationFrame(this.raf);
    this.tick(this.offset);
    this.onState?.(false);
  }

  toggle() {
    if (this.playing) this.pause();
    else this.play();
  }

  seek(t: number) {
    const to = Math.max(0, Math.min(this.duration, t));
    if (this.playing) {
      this.stopSources();
      this.playing = false;
      this.offset = to;
      this.play();
    } else {
      this.offset = to;
      if (this.video) this.video.currentTime = to;
      this.tick(to);
    }
  }

  private stopSources() {
    const old = this.srcs;
    this.srcs = [];
    for (const s of old) { try { s.stop(); } catch { /* not started */ } s.disconnect(); }
  }

  private loop = () => {
    if (!this.playing) return;
    const t = this.position();
    this.tick(t);
    const v = this.video;
    if (v && !v.seeking && Math.abs(v.currentTime - t) > 0.15) v.currentTime = t;
    this.raf = requestAnimationFrame(this.loop);
  };

  dispose() {
    this.pause();
    cancelAnimationFrame(this.raf);
    void this.ctx?.close();
    this.ctx = null;
    this.ticks.clear();
    this.onState = null;
  }
}

function toBuffer(chs: Float32Array[], sampleRate: number): AudioBuffer {
  const buf = new AudioBuffer({ length: chs[0].length, numberOfChannels: chs.length, sampleRate });
  chs.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i));
  return buf;
}
