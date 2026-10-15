/**
 * Spleeter (Deezer, MIT) source separation — vocals + accompaniment, or
 * vocals, drums, bass, other — DOM-free so the same code runs in
 * stems.worker.ts (normal path) and on the main thread (fallback when a
 * worker can't start).
 *
 * One small U-Net per stem (fp16 weights, fp32 I/O): it takes |STFT| of a
 * 512-frame split and returns that stem's magnitude; stemsDsp.ts turns the
 * set into ratio masks on the mixture STFT. Karaoke uses sherpa-onnx's 2-stem
 * export, "4 stems" the Best-Practice 4-stem export (2-stem graph with ELU).
 *
 * The song is processed one split (~11.9s) at a time and each finished
 * stretch is handed to `onChunk`, so memory stays bounded by one split.
 */
import { loadOrt, fetchModelBytes } from "./ortRuntime";
import { ortWebgpuUsable } from "./gpuBackend";
import { registerModel } from "./modelRegistry";
import { analyzeChunk, ratioMasks, TrackSynth, chunkCount, T } from "./stemsDsp";

export { SAMPLE_RATE } from "./stemsDsp";

const NET_BINS = 1024;
const TWO = "https://huggingface.co/csukuangfj/sherpa-onnx-spleeter-2stems-fp16/resolve/93ba771920ade509f8cbd6825b1a90856c797e08/";
const FOUR = "https://huggingface.co/Best-Practice/spleeter-4stems-onnx/resolve/486643021f18a4d057d282fff1d11b89a30e9887/";

export type StemId = "vocals" | "instrumental" | "drums" | "bass" | "other";
export type StemMode = "karaoke" | "four";
export type StemDevice = "webgpu" | "wasm";

/** One net per source, in this order; `bytes` is the progress denominator before content-lengths arrive. */
const MODELS: Record<StemMode, { files: string[]; bytes: number }> = {
  karaoke: {
    files: [`${TWO}vocals.fp16.onnx`, `${TWO}accompaniment.fp16.onnx`],
    bytes: 39_362_041,
  },
  four: {
    files: ["vocals", "drums", "bass", "other"].map((s) => `${FOUR}${s}.fp16.onnx`),
    bytes: 78_856_560,
  },
};
export const MODEL_SIZE: Record<StemMode, string> = { karaoke: "39MB", four: "79MB" };

export const MODE_TRACKS: Record<StemMode, { id: StemId; sources: number[] }[]> = {
  karaoke: [
    { id: "instrumental", sources: [1] },
    { id: "vocals", sources: [0] },
  ],
  four: [
    { id: "vocals", sources: [0] },
    { id: "drums", sources: [1] },
    { id: "bass", sources: [2] },
    { id: "other", sources: [3] },
  ],
};

export interface SeparateCallbacks {
  /** model download, bytes */
  onLoad?: (loaded: number, total: number) => void;
  /** every stem's session created */
  onReady?: (device: StemDevice) => void;
  onSegment?: (done: number, total: number) => void;
  /** final audio for [offset, offset + len): channels = per track [L, R] */
  onChunk: (offset: number, channels: Float32Array<ArrayBuffer>[]) => void;
  isCancelled?: () => boolean;
}

export const CANCELLED = "stems:cancelled";

// the slice of onnxruntime-web used here (it's loaded untyped from the CDN)
type OrtTensor = { data: Float32Array };
type OrtSession = { run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>; release(): Promise<void> };
type Ort = {
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => OrtTensor;
  InferenceSession: { create(model: Uint8Array, options: object): Promise<OrtSession> };
};

interface Engine {
  ort: Ort;
  device: StemDevice;
  sessions: OrtSession[];
  release(): Promise<void>;
}

const engines: Partial<Record<StemMode, Promise<Engine>>> = {};
let loadListener: ((loaded: number, total: number) => void) | undefined;
registerModel(["/vocal-remover"], () => {
  const all = Object.values(engines).map((p) => p!.catch(() => null));
  for (const k of Object.keys(engines) as StemMode[]) delete engines[k];
  return all.length ? Promise.all(all) : null;
});

async function buildEngine(mode: StemMode, device: StemDevice): Promise<Engine> {
  const ort: Ort = await loadOrt();
  const { files, bytes } = MODELS[mode];
  const got = files.map(() => 0);
  let lastSent = 0;
  const report = () => {
    const loaded = got.reduce((a, b) => a + b, 0);
    const now = Date.now();
    if (now - lastSent < 80 && loaded < bytes) return;
    lastSent = now;
    loadListener?.(Math.min(loaded, bytes), bytes);
  };
  const options = { executionProviders: [device], graphOptimizationLevel: "all" };
  const sessions: OrtSession[] = [];
  const release = async () => {
    for (const s of sessions) await s?.release().catch(() => {});
  };
  try {
    const bufs = await Promise.all(files.map((url, i) =>
      fetchModelBytes(url, (l) => { got[i] = l; report(); }, false)));
    for (let i = 0; i < files.length; i++) {
      try {
        sessions[i] = await ort.InferenceSession.create(bufs[i].buf, options);
      } catch (e) {
        if (!bufs[i].fromCache) throw e;
        // cached bytes wouldn't load — assume corruption, refetch once
        const fresh = await fetchModelBytes(files[i], undefined, true);
        sessions[i] = await ort.InferenceSession.create(fresh.buf, options);
      }
    }
  } catch (e) {
    await release();
    throw e;
  }
  return { ort, device, sessions, release };
}

function loadEngine(mode: StemMode, forceWasm = false): Promise<Engine> {
  const cached = engines[mode];
  if (cached) return cached;
  const p = (async () => {
    if (forceWasm || !(await ortWebgpuUsable())) return buildEngine(mode, "wasm");
    try {
      return await buildEngine(mode, "webgpu");
    } catch (e) {
      console.warn("[stems] webgpu sessions failed, using wasm", e);
      return buildEngine(mode, "wasm");
    }
  })();
  engines[mode] = p;
  p.catch(() => { if (engines[mode] === p) delete engines[mode]; });
  return p;
}

/** Swap a misbehaving WebGPU engine for a wasm one (NaN output, lost device). */
async function downgrade(mode: StemMode, engine: Engine): Promise<Engine> {
  const cur = await engines[mode]?.catch(() => null);
  if (cur === engine) delete engines[mode];
  void engine.release();
  return loadEngine(mode, true);
}

function hasNonFinite(a: Float32Array): boolean {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return true;
  return false;
}

async function runNets(engine: Engine, mag: Float32Array): Promise<Float32Array[]> {
  const x = new engine.ort.Tensor("float32", mag, [2, 1, T, NET_BINS]);
  const out: Float32Array[] = [];
  for (const s of engine.sessions) out.push((await s.run({ x })).y.data);
  return out;
}

// one separation at a time: ORT must never have two run() calls in flight
let lock: Promise<void> = Promise.resolve();

/** Separate a 44.1kHz stereo signal into the tracks of `mode` (MODE_TRACKS). */
export async function separate(
  left: Float32Array,
  right: Float32Array,
  mode: StemMode,
  cb: SeparateCallbacks
): Promise<{ device: StemDevice }> {
  const prev = lock;
  let unlock!: () => void;
  lock = new Promise((r) => (unlock = r));
  await prev;
  try {
    if (cb.isCancelled?.()) throw new Error(CANCELLED);
    loadListener = cb.onLoad;
    let engine = await loadEngine(mode);
    loadListener = undefined;
    if (cb.isCancelled?.()) throw new Error(CANCELLED);
    cb.onReady?.(engine.device);

    const tracks = MODE_TRACKS[mode];
    const sources = tracks.map((t) => t.sources);
    const synths = tracks.map(() => new TrackSynth());
    const total = left.length;
    const chunks = chunkCount(total);

    for (let c = 0; c < chunks; c++) {
      if (cb.isCancelled?.()) throw new Error(CANCELLED);
      const spec = analyzeChunk(left, right, c, NET_BINS);

      let est: Float32Array[] | null = null;
      try {
        est = await runNets(engine, spec.mag);
      } catch (e) {
        if (engine.device === "wasm") throw e;
        console.warn("[stems] WebGPU run failed, rerunning on wasm", e);
      }
      if (engine.device === "webgpu" && (!est || est.some(hasNonFinite))) {
        if (est) console.warn("[stems] non-finite WebGPU output, rerunning on wasm");
        engine = await downgrade(mode, engine);
        cb.onReady?.(engine.device);
        est = await runNets(engine, spec.mag);
      }
      if (!est) throw new Error("separation failed");

      const masks = ratioMasks(est, sources, NET_BINS);
      let offset = 0;
      const channels: Float32Array<ArrayBuffer>[] = [];
      synths.forEach((s, i) => {
        s.add(spec, masks[i], NET_BINS);
        const { from, l, r } = s.take(c, total);
        offset = from;
        channels.push(l, r);
      });
      cb.onChunk(offset, channels);
      cb.onSegment?.(c + 1, chunks);
    }
    return { device: engine.device };
  } finally {
    loadListener = undefined;
    unlock();
  }
}
