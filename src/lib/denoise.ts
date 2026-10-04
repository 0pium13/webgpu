/**
 * DeepFilterNet3 speech enhancement, DOM-free so the same code runs in
 * denoise.worker.ts (normal path) and on the main thread (fallback).
 *
 * The ONNX graph is only the network; everything around it — STFT, feature
 * normalisation, ERB mask + deep-filter application, overlap-add synthesis —
 * is libDF's DSP reimplemented here. Long files stream through in chunks with
 * left context (GRU warm-up) and right context (the model's 2-frame
 * lookahead), so memory stays flat no matter the duration.
 */
import { createSession, loadOrt } from "./ortRuntime";
import { registerModel } from "./modelRegistry";
import { RealFFT } from "./fft";

export const DENOISE_MODEL_URL =
  "https://huggingface.co/soniqo/DeepFilterNet3-ONNX/resolve/63d8ba442ba900143c468b798e94a04009b2f0c9/deepfilter.onnx";
export const DENOISE_MODEL_SIZE = "8.6MB";
export const SAMPLE_RATE = 48000;

const HOP = 480;
const WIN = 960;
const BINS = 481;
const NB_ERB = 32;
const NB_DF = 96;
const DF_ORDER = 5;
const DF_LOOKAHEAD = 2;
const ALPHA = 0.99;
// libDF erb_fb(48000, 960, 32, min 2 bins) — sums to 481
const ERB_WIDTHS = [
  2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,
  5, 5, 7, 7, 8, 10, 12, 13, 15, 18, 20, 24, 28, 31, 37, 42, 50, 56, 67,
];

/**
 * Model frames per inference call, plus context either side. The GRUs never
 * fully re-converge after a seam (each costs ~0.1 dB), but activations cost
 * ~0.14 MB/frame — so desktops take 32 s chunks (a 30 s reel stays one exact
 * pass), phones 16 s.
 */
const MOBILE = typeof navigator !== "undefined" && /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const CHUNK_FRAMES = MOBILE ? 1600 : 3200;
const LEFT_CONTEXT = 300;
const RIGHT_CONTEXT = 4;

const WINDOW = (() => {
  const w = new Float32Array(WIN);
  for (let i = 0; i < WIN; i++) {
    const s = Math.sin((0.5 * Math.PI * (i + 0.5)) / HOP);
    w[i] = Math.sin(0.5 * Math.PI * s * s);
  }
  return w;
})();

const BAND_OF = (() => {
  const b = new Uint8Array(BINS);
  let f = 0;
  ERB_WIDTHS.forEach((w, i) => { for (let j = 0; j < w; j++) b[f++] = i; });
  return b;
})();

export type DenoiseProgress =
  | { stage: "download"; loaded: number; total: number }
  | { stage: "process"; done: number; total: number };

/** Receives finished output: `samples` belong at `offset` in channel `channel`. */
export type ChunkSink = (channel: number, offset: number, samples: Float32Array) => void;

type OrtTensor = { data: unknown; dispose?: () => void };
type Ort = { Tensor: new (type: "float32", data: Float32Array, dims: number[]) => OrtTensor };
type OrtSession = { run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>; release(): Promise<void> };

let sessionPromise: Promise<{ ort: Ort; session: OrtSession }> | null = null;
registerModel(["/noise-remover"], () => {
  const p = sessionPromise;
  sessionPromise = null;
  return p?.then((s) => s.session);
});

export function loadDenoiser(onProgress?: (loaded: number, total: number) => void) {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const ort: Ort = await loadOrt();
    // wasm on purpose: this graph is small and GRU-heavy — measured as fast as
    // WebGPU for normal clips, with no shader compile and no Safari caveats
    const session: OrtSession = await createSession(ort, DENOISE_MODEL_URL, onProgress, ["wasm"]);
    return { ort, session };
  })();
  sessionPromise.catch(() => { sessionPromise = null; });
  return sessionPromise;
}

/**
 * Per-channel streaming state: analysis (STFT + features) runs ahead of the
 * model, synthesis trails behind it. Frames live in a sliding buffer.
 */
class ChannelStream {
  private readonly x: Float32Array;
  readonly frames: number;
  private readonly fft: RealFFT;
  private readonly cap: number;
  private bufStart = 0;
  private bufLen = 0;
  private readonly specRe: Float32Array;
  private readonly specIm: Float32Array;
  private readonly erbFeat: Float32Array;
  private readonly dfRe: Float32Array;
  private readonly dfIm: Float32Array;
  private readonly erbState = new Float32Array(NB_ERB);
  private readonly unitState = new Float32Array(NB_DF);
  private readonly frame = new Float64Array(WIN);
  private readonly synth = new Float32Array(WIN);
  private readonly synthMem = new Float32Array(HOP);
  private readonly yRe = new Float32Array(BINS);
  private readonly yIm = new Float32Array(BINS);

  constructor(x: Float32Array, fft: RealFFT, cap: number) {
    this.x = x;
    this.fft = fft;
    this.cap = cap;
    // one 960-sample tail so the last real samples get full overlap-add
    this.frames = Math.ceil((x.length + WIN) / HOP);
    this.specRe = new Float32Array(cap * BINS);
    this.specIm = new Float32Array(cap * BINS);
    this.erbFeat = new Float32Array(cap * NB_ERB);
    this.dfRe = new Float32Array(cap * NB_DF);
    this.dfIm = new Float32Array(cap * NB_DF);
    for (let i = 0; i < NB_ERB; i++) this.erbState[i] = -60 + (i * (-90 - -60)) / (NB_ERB - 1);
    for (let i = 0; i < NB_DF; i++) this.unitState[i] = 0.001 + (i * (0.0001 - 0.001)) / (NB_DF - 1);
  }

  /** Make frames [s, e) resident (computing new ones in order, dropping old ones). */
  ensure(s: number, e: number) {
    const drop = s - this.bufStart;
    if (drop > 0) {
      const keep = Math.max(0, this.bufLen - drop);
      if (keep > 0) {
        this.specRe.copyWithin(0, drop * BINS, this.bufLen * BINS);
        this.specIm.copyWithin(0, drop * BINS, this.bufLen * BINS);
        this.erbFeat.copyWithin(0, drop * NB_ERB, this.bufLen * NB_ERB);
        this.dfRe.copyWithin(0, drop * NB_DF, this.bufLen * NB_DF);
        this.dfIm.copyWithin(0, drop * NB_DF, this.bufLen * NB_DF);
      }
      this.bufStart = s;
      this.bufLen = keep;
    }
    while (this.bufStart + this.bufLen < e) {
      if (this.bufLen >= this.cap) throw new Error("denoise: frame buffer overflow");
      this.analyse(this.bufStart + this.bufLen, this.bufLen);
      this.bufLen++;
    }
  }

  private analyse(t: number, slot: number) {
    const { x, frame } = this;
    const n = x.length;
    const base = (t - 1) * HOP;
    for (let i = 0; i < WIN; i++) {
      const j = base + i;
      frame[i] = j >= 0 && j < n ? x[j] * WINDOW[i] : 0;
    }
    const so = slot * BINS;
    const re = this.specRe.subarray(so, so + BINS);
    const im = this.specIm.subarray(so, so + BINS);
    this.fft.forward(frame, re, im, 1 / WIN);

    const eo = slot * NB_ERB;
    let f = 0;
    for (let b = 0; b < NB_ERB; b++) {
      const w = ERB_WIDTHS[b];
      let e = 0;
      for (let j = 0; j < w; j++, f++) e += re[f] * re[f] + im[f] * im[f];
      const v = 10 * Math.log10(e / w + 1e-10);
      const st = v * (1 - ALPHA) + this.erbState[b] * ALPHA;
      this.erbState[b] = st;
      this.erbFeat[eo + b] = (v - st) / 40;
    }
    const d = slot * NB_DF;
    for (let k = 0; k < NB_DF; k++) {
      const mag = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      const st = mag * (1 - ALPHA) + this.unitState[k] * ALPHA;
      this.unitState[k] = st;
      const inv = 1 / Math.sqrt(st);
      this.dfRe[d + k] = re[k] * inv;
      this.dfIm[d + k] = im[k] * inv;
    }
  }

  /** Model inputs for resident frames [s, e). */
  features(s: number, e: number) {
    const o = s - this.bufStart, len = e - s;
    const erb = this.erbFeat.slice(o * NB_ERB, (o + len) * NB_ERB);
    const spec = new Float32Array(2 * len * NB_DF);
    spec.set(this.dfRe.subarray(o * NB_DF, (o + len) * NB_DF), 0);
    spec.set(this.dfIm.subarray(o * NB_DF, (o + len) * NB_DF), len * NB_DF);
    return { erb, spec };
  }

  /**
   * Enhance + synthesise frames [a, b) given model outputs for window [s, ·)
   * of `tl` frames. Returns the output samples, already de-delayed, for
   * final positions [max(0, (a-1)·HOP), min(n, (b-1)·HOP)).
   */
  synthesise(a: number, b: number, s: number, tl: number, mask: Float32Array, coefs: Float32Array) {
    const n = this.x.length;
    const outStart = Math.max(0, (a - 1) * HOP);
    const outEnd = Math.min(n, (b - 1) * HOP);
    const out = new Float32Array(Math.max(0, outEnd - outStart));
    const { yRe, yIm, synth, synthMem, specRe, specIm } = this;
    for (let t = a; t < b; t++) {
      const lt = t - s;
      const slot = t - this.bufStart;
      const so = slot * BINS;
      for (let f = 0; f < BINS; f++) {
        const g = mask[lt * NB_ERB + BAND_OF[f]];
        yRe[f] = specRe[so + f] * g;
        yIm[f] = specIm[so + f] * g;
      }
      // deep filter on the low bins, from the untouched noisy spectrum
      for (let f = 0; f < NB_DF; f++) {
        let accR = 0, accI = 0;
        for (let q = 0; q < DF_ORDER; q++) {
          const tf = t - DF_LOOKAHEAD + q;
          if (tf < 0 || tf >= this.frames) continue;
          const xo = (tf - this.bufStart) * BINS + f;
          const xr = specRe[xo], xi = specIm[xo];
          const co = ((q * tl + lt) * NB_DF + f) * 2;
          const cr = coefs[co], ci = coefs[co + 1];
          accR += xr * cr - xi * ci;
          accI += xr * ci + xi * cr;
        }
        yRe[f] = accR;
        yIm[f] = accI;
      }
      // DC + 50 Hz bins: the network barely touches mains hum (measured ~18 dB
      // vs ~45 dB for broadband noise in pauses); voice has nothing down here
      yRe[0] = yIm[0] = yRe[1] = yIm[1] = 0;
      this.fft.inverse(yRe, yIm, synth);
      const p0 = (t - 1) * HOP; // final position of this frame's first output sample
      for (let i = 0; i < HOP; i++) {
        const v = synth[i] * WINDOW[i] + synthMem[i];
        const p = p0 + i;
        if (p >= outStart && p < outEnd) out[p - outStart] = v;
      }
      for (let i = 0; i < HOP; i++) synthMem[i] = synth[HOP + i] * WINDOW[HOP + i];
    }
    return { offset: outStart, samples: out };
  }
}

export interface DenoiseOptions {
  chunkFrames?: number;
  leftContext?: number;
  /** Called between chunks — the main-thread fallback yields to the UI here. */
  between?: () => Promise<void>;
}

/**
 * Denoise every channel at 48 kHz. Output streams to `sink` chunk by chunk
 * (full-strength enhancement; mix the original back in for gentler settings —
 * STFT/ISTFT is linear and perfect-reconstruction, so a time-domain mix equals
 * libDF's spectral attenuation limit exactly).
 */
export async function denoiseChannels(
  channels: Float32Array[],
  onProgress: (p: DenoiseProgress) => void,
  sink: ChunkSink,
  opts: DenoiseOptions = {},
): Promise<void> {
  const { ort, session } = await loadDenoiser((loaded, total) => onProgress({ stage: "download", loaded, total }));
  const chunk = opts.chunkFrames ?? CHUNK_FRAMES;
  const left = opts.leftContext ?? LEFT_CONTEXT;
  const fft = new RealFFT(WIN);
  const totalFrames = channels.reduce((acc, x) => acc + Math.ceil((x.length + WIN) / HOP), 0);
  let doneFrames = 0;
  onProgress({ stage: "process", done: 0, total: totalFrames });

  for (let ch = 0; ch < channels.length; ch++) {
    const stream = new ChannelStream(channels[ch], fft, left + chunk + RIGHT_CONTEXT + DF_LOOKAHEAD + 1);
    const T = stream.frames;
    for (let a = 0; a < T; a += chunk) {
      const b = Math.min(T, a + chunk);
      const s = Math.max(0, a - left);
      const e = Math.min(T, b + RIGHT_CONTEXT);
      stream.ensure(s, e);
      const tl = e - s;
      const { erb, spec } = stream.features(s, e);
      const res = await session.run({
        feat_erb: new ort.Tensor("float32", erb, [1, 1, tl, NB_ERB]),
        feat_spec: new ort.Tensor("float32", spec, [1, 2, tl, NB_DF]),
      });
      const mask = res.erb_mask.data as Float32Array;
      const coefs = res.df_coefs.data as Float32Array;
      const { offset, samples } = stream.synthesise(a, b, s, tl, mask, coefs);
      for (const k of Object.keys(res)) res[k].dispose?.();
      if (samples.length) sink(ch, offset, samples);
      doneFrames += b - a;
      onProgress({ stage: "process", done: doneFrames, total: totalFrames });
      if (opts.between) await opts.between();
    }
  }
}

/* ── strength, metering, export ─────────────────────────────────────────── */

export type StrengthId = "light" | "medium" | "strong" | "max";

export const STRENGTHS: { id: StrengthId; label: string; db: number; hint: string }[] = [
  { id: "light", label: "Light", db: 12, hint: "Keeps room tone" },
  { id: "medium", label: "Medium", db: 20, hint: "Natural, most voices" },
  { id: "strong", label: "Strong", db: 30, hint: "Loud fans, traffic" },
  { id: "max", label: "Max", db: 100, hint: "Voice only" },
];

/** Fraction of the original mixed back in for an attenuation limit in dB. */
export const mixFor = (db: number) => (db >= 100 ? 0 : Math.pow(10, -db / 20));

/** clean·(1−lim) + orig·lim, written into a new array. */
export function mixChannel(orig: Float32Array, clean: Float32Array, lim: number): Float32Array {
  const out = new Float32Array(clean.length);
  const a = 1 - lim;
  for (let i = 0; i < out.length; i++) out[i] = clean[i] * a + orig[i] * lim;
  return out;
}

const METER_HOP = 960; // 20 ms

/**
 * Per-20ms energies of the original, the cleaned output and their cross
 * term. Enough to meter — and draw — any strength mix exactly without
 * re-mixing audio: E(mix) = a²·Ec + lim²·Eo + 2·a·lim·Ex, a = 1 − lim.
 * Filled progressively as cleaned chunks arrive.
 */
export class Meter {
  readonly frames: number;
  readonly eo: Float64Array;
  readonly ec: Float64Array;
  readonly ex: Float64Array;
  /** Highest sample index (exclusive) with cleaned audio metered, any channel. */
  cleanedUntil = 0;
  private readonly orig: Float32Array[];
  private readonly n: number;

  constructor(orig: Float32Array[]) {
    this.orig = orig;
    this.n = orig[0].length;
    this.frames = Math.max(1, Math.ceil(this.n / METER_HOP));
    this.eo = new Float64Array(this.frames);
    this.ec = new Float64Array(this.frames);
    this.ex = new Float64Array(this.frames);
    for (const o of orig) {
      for (let i = 0; i < this.n; i++) this.eo[(i / METER_HOP) | 0] += o[i] * o[i];
    }
  }

  add(ch: number, offset: number, clean: Float32Array) {
    const o = this.orig[ch];
    for (let j = 0; j < clean.length; j++) {
      const i = offset + j, f = (i / METER_HOP) | 0, c = clean[j];
      this.ec[f] += c * c;
      this.ex[f] += o[i] * c;
    }
    this.cleanedUntil = Math.max(this.cleanedUntil, offset + clean.length);
  }

  /** Mean-square level of frame range [f0, f1) — original, or the mix at `lim`. */
  level(f0: number, f1: number, lim: number | null): number {
    let e = 0;
    const a = lim === null ? 0 : 1 - lim;
    for (let f = f0; f < f1; f++) {
      e += lim === null ? this.eo[f] : a * a * this.ec[f] + lim * lim * this.eo[f] + 2 * a * lim * this.ex[f];
    }
    return Math.max(0, e) / ((f1 - f0) * METER_HOP * this.orig.length);
  }

  /**
   * Background-noise level before/after (dBFS): mean energy over the
   * quietest 10% of the original's frames — the gaps between words, where
   * only noise lives. Digital-silence frames are ignored.
   */
  noiseFloor(lim: number): { before: number; after: number } {
    const idx: number[] = [];
    for (let i = 0; i < this.frames; i++) if (this.eo[i] > 1e-10 * METER_HOP) idx.push(i);
    if (!idx.length) return { before: -120, after: -120 };
    idx.sort((x, y) => this.eo[x] - this.eo[y]);
    const pick = idx.slice(0, Math.max(1, Math.round(idx.length * 0.1)));
    const a = 1 - lim;
    let before = 0, after = 0;
    for (const i of pick) {
      before += this.eo[i];
      after += Math.max(0, a * a * this.ec[i] + lim * lim * this.eo[i] + 2 * a * lim * this.ex[i]);
    }
    const norm = pick.length * METER_HOP * this.orig.length;
    const db = (e: number) => Math.max(-120, 10 * Math.log10(e / norm + 1e-12));
    return { before: db(before), after: db(after) };
  }
}

/** 16-bit PCM WAV. Peaks over full scale are soft-limited by a global gain. */
export function encodeWav(channels: Float32Array[], sampleRate: number): Blob {
  const nc = channels.length, n = channels[0].length;
  let peak = 0;
  for (const c of channels) for (let i = 0; i < n; i++) { const v = Math.abs(c[i]); if (v > peak) peak = v; }
  const gain = peak > 0.999 ? 0.999 / peak : 1;
  const data = n * nc * 2;
  const buf = new ArrayBuffer(44 + data);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, "RIFF"); v.setUint32(4, 36 + data, true); str(8, "WAVE");
  str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, nc, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * nc * 2, true);
  v.setUint16(32, nc * 2, true); v.setUint16(34, 16, true);
  str(36, "data"); v.setUint32(40, data, true);
  const pcm = new Int16Array(buf, 44, n * nc);
  for (let i = 0, j = 0; i < n; i++) {
    for (let c = 0; c < nc; c++, j++) {
      const s = channels[c][i] * gain;
      pcm[j] = s < 0 ? Math.max(-32768, Math.round(s * 32768)) : Math.min(32767, Math.round(s * 32767));
    }
  }
  return new Blob([buf], { type: "audio/wav" });
}
