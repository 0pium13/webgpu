/**
 * HTDemucs v4 (Meta AI Research, MIT) 4-source separation — drums, bass,
 * other, vocals — DOM-free so the same code runs in stems.worker.ts (normal
 * path) and on the main thread (fallback when a worker can't start).
 *
 * Model: monteslu/htdemucs-web-onnx, an fp16 export (convolutions kept fp32)
 * cut into 21 pieces run in manifest order over a name→tensor map. Piece 0 is
 * the input-normalisation prologue: on WebGPU with ORT 1.23 it outputs NaN in
 * fp16, so it always runs on wasm (tiny); pieces 1–20 run on WebGPU with
 * outputs kept as GPU buffers between pieces.
 *
 * Long audio is cut into 343,980-sample segments (7.8s) with 25% overlap.
 * Each finished stretch is handed to `onChunk` as soon as no later segment
 * overlaps it, so memory stays bounded by one segment, not the song.
 */
import { loadOrt, fetchModelBytes } from "./ortRuntime";
import { ortWebgpuUsable } from "./gpuBackend";
import { registerModel } from "./modelRegistry";
import { prepareSegment, addIspec, SEGMENT, BINS, FRAMES } from "./stemsDsp";

export { SAMPLE_RATE } from "./stemsDsp";

const REVISION = "a4a57cc0cf707e5b9a3e6ad3c2c4b21fcbe608c1";
const REPO = `https://huggingface.co/monteslu/htdemucs-web-onnx/resolve/${REVISION}/`;
/** Sum of the 21 pieces at REVISION — progress denominator before every content-length is known. */
const MODEL_BYTES = 125_881_245;
export const MODEL_SIZE = "126MB";

export const STRIDE = Math.floor(SEGMENT * 0.75);
const OVERLAP = SEGMENT - STRIDE;

/** Model source order: 0 drums, 1 bass, 2 other, 3 vocals. */
export type StemId = "vocals" | "instrumental" | "drums" | "bass" | "other";
export type StemMode = "karaoke" | "four";

export const MODE_TRACKS: Record<StemMode, { id: StemId; sources: number[] }[]> = {
  karaoke: [
    { id: "instrumental", sources: [0, 1, 2] },
    { id: "vocals", sources: [3] },
  ],
  four: [
    { id: "vocals", sources: [3] },
    { id: "drums", sources: [0] },
    { id: "bass", sources: [1] },
    { id: "other", sources: [2] },
  ],
};

export function segmentCount(samples: number): number {
  return samples <= SEGMENT ? 1 : Math.ceil((samples - SEGMENT) / STRIDE) + 1;
}

export type StemDevice = "webgpu" | "wasm";

export interface SeparateCallbacks {
  /** model download, bytes */
  onLoad?: (loaded: number, total: number) => void;
  /** all 21 sessions created */
  onReady?: (device: StemDevice) => void;
  onSegment?: (done: number, total: number) => void;
  /** final audio for [offset, offset + len): channels = per track [L, R] */
  onChunk: (offset: number, channels: Float32Array<ArrayBuffer>[]) => void;
  isCancelled?: () => boolean;
}

export const CANCELLED = "stems:cancelled";

type Piece = { file: string; inputs: string[]; outputs: string[] };

// the slice of onnxruntime-web used here (it's loaded untyped from the CDN)
type OrtTensor = { dispose?: () => void; getData: () => Promise<Float32Array> };
type OrtSession = { run(feeds: Record<string, OrtTensor>): Promise<Record<string, OrtTensor>>; release(): Promise<void> };
type Ort = {
  Tensor: new (type: "float32", data: Float32Array, dims: number[]) => OrtTensor;
  InferenceSession: { create(model: Uint8Array, options: object): Promise<OrtSession> };
};

interface Engine {
  ort: Ort;
  device: StemDevice;
  pieces: Piece[];
  sessions: OrtSession[];
  /** index of the last piece that reads each tensor — dispose after it */
  lastUse: Map<string, number>;
  freq: string;
  time: string;
  release(): Promise<void>;
}

let enginePromise: Promise<Engine> | null = null;
let loadListener: ((loaded: number, total: number) => void) | undefined;
registerModel(["/vocal-remover"], () => { const p = enginePromise; enginePromise = null; return p; });

async function buildEngine(device: StemDevice): Promise<Engine> {
  const ort: Ort = await loadOrt();
  const manifestBytes = (await fetchModelBytes(REPO + "htdemucs_split_manifest.json", undefined, false)).buf;
  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes));
  const pieces: Piece[] = manifest.pieces;

  const got = new Array<number>(pieces.length).fill(0);
  let lastSent = 0;
  const report = () => {
    const loaded = got.reduce((a, b) => a + b, 0);
    const now = Date.now();
    if (now - lastSent < 80 && loaded < MODEL_BYTES) return;
    lastSent = now;
    loadListener?.(Math.min(loaded, MODEL_BYTES), MODEL_BYTES);
  };

  const options = (i: number) =>
    i === 0 || device === "wasm"
      ? { executionProviders: ["wasm"], graphOptimizationLevel: "all" }
      : { executionProviders: ["webgpu"], graphOptimizationLevel: "all", preferredOutputLocation: "gpu-buffer" };

  const sessions: OrtSession[] = new Array(pieces.length);
  const release = async () => {
    for (const s of sessions) await s?.release?.().catch(() => {});
  };

  // downloads run 4 wide; session creation is serialised behind them
  let created = Promise.resolve();
  let next = 0;
  const fetchOne = async (i: number) => {
    const url = REPO + pieces[i].file;
    const { buf, fromCache } = await fetchModelBytes(url, (l) => { got[i] = l; report(); }, false);
    const create = async () => {
      try {
        sessions[i] = await ort.InferenceSession.create(buf, options(i));
      } catch (e) {
        if (!fromCache) throw e;
        // cached bytes wouldn't load — assume corruption, refetch once
        const fresh = await fetchModelBytes(url, undefined, true);
        sessions[i] = await ort.InferenceSession.create(fresh.buf, options(i));
      }
    };
    const mine = created.then(create);
    created = mine.catch(() => {});
    await mine;
  };
  try {
    await Promise.all(Array.from({ length: 4 }, async () => {
      while (next < pieces.length) await fetchOne(next++);
    }));
  } catch (e) {
    await release();
    throw e;
  }

  const lastUse = new Map<string, number>();
  pieces.forEach((p, i) => p.inputs.forEach((n) => lastUse.set(n, i)));
  return {
    ort, device, pieces, sessions, lastUse,
    freq: manifest.outputs?.freq ?? "x",
    time: manifest.outputs?.time ?? "xt",
    release,
  };
}

function loadEngine(forceWasm = false): Promise<Engine> {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    const gpu = !forceWasm && (await ortWebgpuUsable());
    if (!gpu) return buildEngine("wasm");
    try {
      return await buildEngine("webgpu");
    } catch (e) {
      console.warn("[stems] webgpu sessions failed, using wasm", e);
      return buildEngine("wasm");
    }
  })();
  enginePromise.catch(() => { enginePromise = null; });
  return enginePromise;
}

/** Swap a misbehaving WebGPU engine for a wasm one (NaN output, lost device). */
async function downgrade(engine: Engine): Promise<Engine> {
  if (enginePromise) {
    const cur = await enginePromise.catch(() => null);
    if (cur === engine) enginePromise = null;
  }
  void engine.release();
  return loadEngine(true);
}

function hasNonFinite(a: Float32Array): boolean {
  for (let i = 0; i < a.length; i++) if (!Number.isFinite(a[i])) return true;
  return false;
}

/** One segment through all 21 pieces → [freq branch x, time branch xt] on the CPU. */
async function runPieces(engine: Engine, mix: Float32Array, mag: Float32Array, isCancelled?: () => boolean) {
  const { ort, pieces, sessions, lastUse } = engine;
  const map = new Map<string, OrtTensor>([
    ["mix", new ort.Tensor("float32", mix, [1, 2, SEGMENT])],
    ["mag", new ort.Tensor("float32", mag, [1, 4, BINS, FRAMES])],
  ]);
  try {
    for (let i = 0; i < pieces.length; i++) {
      if (isCancelled?.()) throw new Error(CANCELLED);
      const p = pieces[i];
      const feeds: Record<string, OrtTensor> = {};
      for (const n of p.inputs) feeds[n] = map.get(n)!;
      const out = await sessions[i].run(feeds);
      for (const n of Object.keys(out)) map.set(n, out[n]);
      for (const n of p.inputs) {
        if (lastUse.get(n) !== i) continue;
        map.get(n)?.dispose?.();
        map.delete(n);
      }
    }
    const x = await map.get(engine.freq)!.getData();
    const xt = await map.get(engine.time)!.getData();
    return { x, xt };
  } finally {
    for (const t of map.values()) t?.dispose?.();
  }
}

// one separation at a time: ORT must never have two run() calls in flight
let lock: Promise<void> = Promise.resolve();

/**
 * Separate a 44.1kHz stereo signal. Tracks per `mode` (MODE_TRACKS); each is
 * the time branch plus the iSTFT of the frequency branch, overlap-added with
 * a linear crossfade across segment overlaps.
 */
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
    let engine = await loadEngine();
    loadListener = undefined;
    if (cb.isCancelled?.()) throw new Error(CANCELLED);
    cb.onReady?.(engine.device);

    const tracks = MODE_TRACKS[mode];
    const total = left.length;
    const starts = [0];
    while (starts[starts.length - 1] + SEGMENT < total) starts.push(starts[starts.length - 1] + STRIDE);

    const segL = new Float32Array(SEGMENT);
    const segR = new Float32Array(SEGMENT);
    let tail: Float32Array<ArrayBuffer>[] | null = null;

    for (let k = 0; k < starts.length; k++) {
      if (cb.isCancelled?.()) throw new Error(CANCELLED);
      const s = starts[k];
      const n = Math.min(SEGMENT, total - s);
      segL.fill(0).set(left.subarray(s, s + n));
      segR.fill(0).set(right.subarray(s, s + n));
      const { mix, mag } = prepareSegment(segL, segR);

      let res: { x: Float32Array; xt: Float32Array } | null = null;
      try {
        res = await runPieces(engine, mix, mag, cb.isCancelled);
      } catch (e) {
        if (engine.device === "wasm" || (e as Error)?.message === CANCELLED) throw e;
        console.warn("[stems] WebGPU run failed, rerunning on wasm", e);
      }
      if (engine.device === "webgpu" && (!res || hasNonFinite(res.xt) || hasNonFinite(res.x))) {
        if (res) console.warn("[stems] non-finite WebGPU output, rerunning on wasm");
        engine = await downgrade(engine);
        cb.onReady?.(engine.device);
        res = await runPieces(engine, mix, mag, cb.isCancelled);
      }
      if (!res) throw new Error("separation failed");

      const out: Float32Array<ArrayBuffer>[] = [];
      for (const tr of tracks) {
        const L = new Float32Array(SEGMENT);
        const R = new Float32Array(SEGMENT);
        for (const src of tr.sources) {
          const o = src * 2 * SEGMENT;
          for (let i = 0; i < SEGMENT; i++) {
            L[i] += res.xt[o + i];
            R[i] += res.xt[o + SEGMENT + i];
          }
        }
        addIspec(res.x, tr.sources, L, R);
        out.push(L, R);
      }

      if (tail) {
        for (let c = 0; c < out.length; c++) {
          const a = tail[c], b = out[c];
          for (let i = 0; i < OVERLAP; i++) {
            const w = (i + 0.5) / OVERLAP;
            b[i] = a[i] * (1 - w) + b[i] * w;
          }
        }
      }
      const last = k === starts.length - 1;
      const len = last ? n : STRIDE;
      tail = last ? null : out.map((a) => a.slice(STRIDE, SEGMENT));
      cb.onChunk(s, out.map((a) => (len === SEGMENT ? a : a.slice(0, len))));
      cb.onSegment?.(k + 1, starts.length);
    }
    return { device: engine.device };
  } finally {
    loadListener = undefined;
    unlock();
  }
}
