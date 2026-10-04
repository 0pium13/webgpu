"use client";

/**
 * Audio plumbing for the stem splitter: decode any audio/video file to
 * 44.1kHz stereo, 16-bit stereo WAV export, a ZIP of all stems, and a
 * sample-locked multitrack player (every stem starts on the same audio-clock
 * tick, so solo/mute never drifts out of time).
 */
import { SAMPLE_RATE } from "./stems";

/** Duration from the container header, without decoding (null if the browser can't tell). */
export function probeDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const el = document.createElement("audio");
    const url = URL.createObjectURL(file);
    const done = (v: number | null) => {
      clearTimeout(timer);
      el.removeAttribute("src");
      el.load();
      URL.revokeObjectURL(url);
      resolve(v);
    };
    const timer = setTimeout(() => done(null), 6000);
    el.preload = "metadata";
    el.onloadedmetadata = () => done(Number.isFinite(el.duration) ? el.duration : null);
    el.onerror = () => done(null);
    el.src = url;
  });
}

async function decodeBytes(bytes: ArrayBuffer): Promise<AudioBuffer> {
  // decodeAudioData resamples to the context rate — 44.1kHz is what HTDemucs was trained on
  return new OfflineAudioContext(2, 1, SAMPLE_RATE).decodeAudioData(bytes);
}

/** ffmpeg.wasm route for containers/codecs the browser can't decode itself (MKV, AVI, WMA…). */
async function decodeWithFfmpeg(file: File): Promise<AudioBuffer> {
  const { getFFmpeg, fileToUint8 } = await import("./ffmpeg");
  const ff = await getFFmpeg();
  const ext = (file.name.match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? ".bin").toLowerCase();
  await ff.writeFile(`in${ext}`, await fileToUint8(file));
  await ff.exec(["-i", `in${ext}`, "-vn", "-ac", "2", "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le", "-y", "stems-in.wav"]);
  const wav: Uint8Array | null = await ff.readFile("stems-in.wav").catch(() => null);
  if (!wav?.byteLength) throw new Error("Couldn't find an audio track in this file.");
  return decodeBytes(wav.slice().buffer as ArrayBuffer);
}

async function toStereo(b: AudioBuffer): Promise<AudioBuffer> {
  if (b.numberOfChannels === 2 && b.sampleRate === SAMPLE_RATE) return b;
  if (b.numberOfChannels === 1) {
    const out = new AudioBuffer({ numberOfChannels: 2, length: b.length, sampleRate: SAMPLE_RATE });
    const mono = b.getChannelData(0);
    out.copyToChannel(mono, 0);
    out.copyToChannel(mono, 1);
    return out;
  }
  // surround → standard speaker downmix
  const ctx = new OfflineAudioContext(2, Math.ceil(b.duration * SAMPLE_RATE), SAMPLE_RATE);
  const src = ctx.createBufferSource();
  src.buffer = b;
  src.connect(ctx.destination);
  src.start();
  return ctx.startRendering();
}

/** Any audio or video file → 44.1kHz stereo AudioBuffer (mono duplicated to both sides). */
export async function decodeToStereo(file: File, onFfmpeg?: () => void): Promise<AudioBuffer> {
  let decoded: AudioBuffer;
  try {
    decoded = await decodeBytes(await file.arrayBuffer());
  } catch {
    onFfmpeg?.();
    decoded = await decodeWithFfmpeg(file);
  }
  if (!decoded.length) throw new Error("This file has no audio.");
  return toStereo(decoded);
}

/**
 * Waveform envelope: mean |sample| per bucket (both channels), accumulated
 * chunk by chunk into `levels` (zeroed, `bins` long) for audio `total` samples
 * long. Mean rather than peak: loud masters peak at full scale everywhere,
 * which would draw as a solid block.
 */
export function accumulateLevels(levels: Float32Array, total: number, l: Float32Array, r: Float32Array, offset: number) {
  const bins = levels.length;
  const k = bins / (2 * total);
  for (let i = 0; i < l.length; i++) {
    const b = Math.min(bins - 1, Math.floor(((offset + i) * bins) / total));
    levels[b] += (Math.abs(l[i]) + Math.abs(r[i])) * k;
  }
}

/** 16-bit PCM stereo WAV. */
export function encodeWavStereo(buf: AudioBuffer): Blob {
  const n = buf.length;
  const l = buf.getChannelData(0);
  const r = buf.numberOfChannels > 1 ? buf.getChannelData(1) : l;
  const bytes = n * 4;
  const out = new ArrayBuffer(44 + bytes);
  const v = new DataView(out);
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); v.setUint32(4, 36 + bytes, true); ws(8, "WAVE");
  ws(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 2, true);
  v.setUint32(24, buf.sampleRate, true); v.setUint32(28, buf.sampleRate * 4, true);
  v.setUint16(32, 4, true); v.setUint16(34, 16, true);
  ws(36, "data"); v.setUint32(40, bytes, true);
  const pcm = new Int16Array(out, 44, n * 2); // every browser is little-endian, as WAV is
  for (let i = 0; i < n; i++) {
    const a = l[i] < -1 ? -1 : l[i] > 1 ? 1 : l[i];
    const b = r[i] < -1 ? -1 : r[i] > 1 ? 1 : r[i];
    pcm[2 * i] = a < 0 ? a * 0x8000 : a * 0x7fff;
    pcm[2 * i + 1] = b < 0 ? b * 0x8000 : b * 0x7fff;
  }
  return new Blob([out], { type: "audio/wav" });
}

/** WAVs barely compress, so STORE: instant to build, same size as DEFLATE would give. */
export async function zipFiles(files: { name: string; blob: Blob }[], onProgress?: (pct: number) => void): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.blob);
  return zip.generateAsync({ type: "blob", compression: "STORE" }, (m) => onProgress?.(m.percent));
}

export function saveBlob(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 60_000);
}

/** Multitrack player: one AudioBufferSourceNode per track, all started on the same tick. */
export class StemPlayer {
  private ctx: AudioContext | null = null;
  private gains: GainNode[] = [];
  private sources: AudioBufferSourceNode[] = [];
  private levels: number[];
  private startedAt = 0;
  private offset = 0;
  playing = false;
  onEnded: (() => void) | null = null;

  constructor(private buffers: AudioBuffer[]) {
    this.levels = buffers.map(() => 1);
  }

  get duration() {
    return this.buffers[0]?.duration ?? 0;
  }

  position(): number {
    if (!this.playing || !this.ctx) return this.offset;
    return Math.min(this.duration, this.offset + Math.max(0, this.ctx.currentTime - this.startedAt));
  }

  setLevel(i: number, level: number) {
    this.levels[i] = level;
    const g = this.gains[i];
    if (g && this.ctx) g.gain.setTargetAtTime(level, this.ctx.currentTime, 0.012);
  }

  async play() {
    if (this.playing) return;
    if (!this.ctx) {
      this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: "playback" });
      this.gains = this.buffers.map((_, i) => {
        const g = this.ctx!.createGain();
        g.gain.value = this.levels[i];
        g.connect(this.ctx!.destination);
        return g;
      });
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
    if (this.offset >= this.duration - 0.01) this.offset = 0;
    const when = this.ctx.currentTime + 0.04;
    this.sources = this.buffers.map((b, i) => {
      const s = this.ctx!.createBufferSource();
      s.buffer = b;
      s.connect(this.gains[i]);
      s.start(when, this.offset);
      return s;
    });
    const first = this.sources[0];
    first.onended = () => {
      if (this.sources[0] !== first || !this.playing) return;
      this.stopSources();
      this.playing = false;
      this.offset = 0;
      this.onEnded?.();
    };
    this.startedAt = when;
    this.playing = true;
  }

  pause() {
    if (!this.playing) return;
    this.offset = this.position();
    this.playing = false;
    this.stopSources();
  }

  seek(t: number) {
    const was = this.playing;
    if (was) this.pause();
    this.offset = Math.max(0, Math.min(this.duration, t));
    if (was) void this.play();
  }

  private stopSources() {
    for (const s of this.sources) {
      s.onended = null;
      try { s.stop(); } catch { /* never started */ }
      s.disconnect();
    }
    this.sources = [];
  }

  dispose() {
    this.stopSources();
    this.playing = false;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
