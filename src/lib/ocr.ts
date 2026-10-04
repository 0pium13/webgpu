/**
 * Image → text, Hindi + English, DOM-free so the same code runs in
 * ocr.worker.ts (normal path) and on the main thread (fallback).
 *
 * PP-OCRv5 mobile detector (DB) finds text lines; the PP-OCRv5 Devanagari
 * mobile recognizer (Devanagari + Latin + digits + ₹ in one model) reads
 * them with greedy CTC. ~12.7MB total, Apache-2.0, revisions pinned.
 */
import { loadOrt, fetchModelBytes } from "./ortRuntime";
import { ortWebgpuUsable } from "./gpuBackend";
import { registerModel } from "./modelRegistry";
import {
  dbPostprocess, rectToQuad, scaleQuad, quadSize, rotateQuadCCW, cropToTensor, detTensor, readingOrder,
  type Pixels, type Quad, type OcrRow,
} from "./ocrGeometry";

export type { Quad, OcrRow, Pixels };

const DET_URL =
  "https://huggingface.co/PaddlePaddle/PP-OCRv5_mobile_det_onnx/resolve/e6f4fa85f00e168c862bc462aebca69eef9b3d3d/inference.onnx";
const REC_BASE =
  "https://huggingface.co/xberg-io/paddleocr-onnx-models/resolve/bc5ec866cf0e798e667808dfa51b0ba8ad0dafc8/rec/devanagari";
const REC_URL = `${REC_BASE}/model.onnx`;
const DICT_URL = `${REC_BASE}/dict.txt`;
/** content-length fallbacks so the progress bar is right from the first byte */
const DET_BYTES = 4_826_518;
const REC_BYTES = 7_935_595;
export const OCR_MODEL_MB = 12.7;

/** Decoded source cap — bounds memory for 48MP phone photos. */
const SRC_MAX_SIDE = 4096;
const SRC_MAX_PX = 16_000_000;
/** Detector input: small images are upscaled so the long side is ≥960. */
const DET_MIN_SIDE = 960;
const DET_MAX_PX = 2048 * 2048;
const DET_MAX_SIDE = 4096;
const REC_H = 48;
const REC_MAX_W = 3200;
const REC_BATCH = 8;
/** PaddleOCR's drop_score */
const MIN_SCORE = 0.5;

export type OcrDevice = "webgpu" | "wasm";

export type OcrProgress =
  | { step: "download"; pct: number }
  | { step: "warmup" }
  | { step: "detect" }
  | { step: "boxes"; quads: Quad[]; width: number; height: number }
  | { step: "recognize"; done: number; total: number };

export interface OcrBox { quad: Quad; text: string; score: number }

export interface OcrResult {
  /** coordinate space of every quad (the decoded, size-capped image) */
  width: number;
  height: number;
  boxes: OcrBox[];
  rows: OcrRow[];
  text: string;
  ms: { det: number; rec: number; total: number };
  device: OcrDevice;
}

export interface OcrEngine {
  ort: any;
  det: any;
  rec: any;
  dict: string[];
  device: OcrDevice;
}

let enginePromise: Promise<OcrEngine> | null = null;
let engineWasm = false;
registerModel(["/ocr"], () => {
  const p = enginePromise;
  enginePromise = null;
  return p?.then((e) => ({ det: e.det, rec: e.rec })) ?? null;
});

const now = () => performance.now();

async function openSession(ort: any, buf: Uint8Array, gpu: boolean): Promise<{ s: any; device: OcrDevice }> {
  if (gpu) {
    try {
      return { s: await ort.InferenceSession.create(buf, { executionProviders: ["webgpu"], graphOptimizationLevel: "all" }), device: "webgpu" };
    } catch (e) {
      console.warn("[ocr] webgpu session failed, wasm fallback", e);
    }
  }
  return { s: await ort.InferenceSession.create(buf, { executionProviders: ["wasm"], graphOptimizationLevel: "all" }), device: "wasm" };
}

/**
 * Bytes → session; if cached bytes won't load (corrupt entry), refetch fresh
 * once. Not createSession(): we need to know which EP actually won and keep
 * det + rec on the same one.
 */
async function sessionFor(ort: any, url: string, got: { buf: Uint8Array; fromCache: boolean }, gpu: boolean) {
  try {
    return await openSession(ort, got.buf, gpu);
  } catch (e) {
    if (!got.fromCache) throw e;
    const fresh = await fetchModelBytes(url, undefined, true);
    return openSession(ort, fresh.buf, gpu);
  }
}

export function loadOcr(onProgress: (p: OcrProgress) => void = () => {}, wasmOnly = false): Promise<OcrEngine> {
  if (enginePromise && engineWasm === wasmOnly) return enginePromise;
  engineWasm = wasmOnly;
  enginePromise = (async () => {
    const ort = await loadOrt();
    const gpu = !wasmOnly && (await ortWebgpuUsable());
    const got = { det: 0, rec: 0 };
    const tot = { det: DET_BYTES, rec: REC_BYTES };
    let last = -1;
    const report = (k: "det" | "rec") => (l: number, t: number) => {
      got[k] = l;
      if (t) tot[k] = t;
      const pct = Math.round(((got.det + got.rec) / (tot.det + tot.rec)) * 100);
      if (pct !== last) { last = pct; onProgress({ step: "download", pct }); }
    };
    const [detBytes, recBytes, dictBytes] = await Promise.all([
      fetchModelBytes(DET_URL, report("det"), false),
      fetchModelBytes(REC_URL, report("rec"), false),
      fetchModelBytes(DICT_URL, undefined, false),
    ]);
    const dict = new TextDecoder().decode(dictBytes.buf).split(/\r?\n/);
    while (dict.length && dict[dict.length - 1] === "") dict.pop();
    // sequential: ORT's WebGPU EP rejects a session created while another is
    // still being created. Both on one EP, or every crop pays a GPU↔CPU hop.
    const det = await sessionFor(ort, DET_URL, detBytes, gpu);
    const rec = await sessionFor(ort, REC_URL, recBytes, det.device === "webgpu");
    let detS = det.s;
    const recS = rec.s;
    if (det.device === "webgpu" && rec.device === "wasm") {
      await det.s.release?.();
      detS = (await sessionFor(ort, DET_URL, detBytes, false)).s;
    }
    const device: OcrDevice = rec.device;
    const eng: OcrEngine = { ort, det: detS, rec: recS, dict, device };
    if (device === "webgpu") {
      // first WebGPU run compiles every shader (~1.4s) — pay it now, not on the user's image
      onProgress({ step: "warmup" });
      try {
        await detS.run({ [detS.inputNames[0]]: new ort.Tensor("float32", new Float32Array(3 * 320 * 320), [1, 3, 320, 320]) });
        await recS.run({ [recS.inputNames[0]]: new ort.Tensor("float32", new Float32Array(3 * REC_H * 320), [1, 3, REC_H, 320]) });
      } catch (e) {
        console.warn("[ocr] warmup failed", e);
      }
    }
    return eng;
  })();
  enginePromise.catch(() => { enginePromise = null; });
  return enginePromise;
}

/** Decode a Blob/ImageBitmap to RGBA (size-capped, transparent areas → white). */
export async function toPixels(src: Blob | ImageBitmap): Promise<Pixels> {
  const bmp = src instanceof Blob ? await createImageBitmap(src) : src;
  const s = Math.min(1, SRC_MAX_SIDE / Math.max(bmp.width, bmp.height), Math.sqrt(SRC_MAX_PX / (bmp.width * bmp.height)));
  const w = Math.max(1, Math.round(bmp.width * s)), h = Math.max(1, Math.round(bmp.height * s));
  const canvas: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(w, h)
    : Object.assign(document.createElement("canvas"), { width: w, height: h });
  const ctx = canvas.getContext("2d", { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return ctx.getImageData(0, 0, w, h);
}

function detSize(W: number, H: number): { dw: number; dh: number } {
  let s = Math.max(1, DET_MIN_SIDE / Math.max(W, H));
  if (W * H * s * s > DET_MAX_PX) s = Math.sqrt(DET_MAX_PX / (W * H));
  if (Math.max(W, H) * s > DET_MAX_SIDE) s = DET_MAX_SIDE / Math.max(W, H);
  return {
    dw: Math.max(32, Math.round((W * s) / 32) * 32),
    dh: Math.max(32, Math.round((H * s) / 32) * 32),
  };
}

type Crop = { quad: Quad; outW: number };

/** Detector → rotated boxes in image coordinates, top-to-bottom. */
export async function detect(eng: OcrEngine, px: Pixels): Promise<Quad[]> {
  const { ort, det } = eng;
  const { dw, dh } = detSize(px.width, px.height);
  const input = new ort.Tensor("float32", detTensor(px, dw, dh), [1, 3, dh, dw]);
  const out = await det.run({ [det.inputNames[0]]: input });
  const map = out[det.outputNames[0]];
  const prob = map.data as Float32Array;
  const rects = dbPostprocess(prob, dw, dh);
  map.dispose?.();
  input.dispose?.();
  const sx = px.width / dw, sy = px.height / dh;
  return rects.map(({ rect }) => scaleQuad(rectToQuad(rect), sx, sy, px.width, px.height));
}

function planCrop(quad: Quad): Crop {
  let q = quad;
  let { w, h } = quadSize(q);
  // vertical text line → read it rotated (PaddleOCR's 1.5 ratio rule)
  if (h >= 1.5 * w) { q = rotateQuadCCW(q); [w, h] = [h, w]; }
  const outW = Math.min(REC_MAX_W, Math.max(16, Math.ceil((REC_H * w) / Math.max(1, h) / 8) * 8));
  return { quad: q, outW };
}

const DEVA_ZERO = 0x0966;

/**
 * Two slips no real text produces: a digit run mixing scripts ("1०", "१5" →
 * majority script, ASCII on a tie) and ₹ read as र right before a number.
 */
function tidy(t: string): string {
  return t
    .replace(/[0-9\u0966-\u096F]{2,}/g, (run) => {
      const deva = run.replace(/[0-9]/g, "").length;
      if (!deva || deva === run.length) return run;
      return deva > run.length - deva
        ? run.replace(/[0-9]/g, (d) => String.fromCharCode(DEVA_ZERO + +d))
        : run.replace(/[\u0966-\u096F]/g, (d) => String(d.charCodeAt(0) - DEVA_ZERO));
    })
    .replace(/(^|[\s(:])\u0930(?=[0-9])/g, "$1₹");
}

/** Greedy CTC over [T, C] probabilities: argmax, collapse repeats, drop blank (0); last class = space. */
function ctcDecode(data: Float32Array, base: number, T: number, C: number, dict: string[]): { text: string; score: number } {
  let prev = -1, text = "", sum = 0, n = 0;
  for (let t = 0; t < T; t++) {
    const o = base + t * C;
    let best = 0, bv = data[o];
    for (let c = 1; c < C; c++) if (data[o + c] > bv) { bv = data[o + c]; best = c; }
    if (best !== prev && best !== 0) {
      text += best === C - 1 ? " " : (dict[best - 1] ?? "");
      sum += bv;
      n++;
    }
    prev = best;
  }
  return { text: tidy(text.replace(/\s+/g, " ").trim()), score: n ? sum / n : 0 };
}

/** Recognize crops in width-sorted batches (padding to the batch's widest crop). */
export async function recognize(
  eng: OcrEngine, px: Pixels, quads: Quad[],
  onDone?: (done: number, total: number) => void,
  cancelled?: () => boolean,
  batch = REC_BATCH
): Promise<{ text: string; score: number }[]> {
  const { ort, rec, dict } = eng;
  const crops = quads.map(planCrop);
  const order = crops.map((_, i) => i).sort((a, b) => crops[a].outW - crops[b].outW);
  const results: { text: string; score: number }[] = new Array(crops.length);
  let done = 0;
  for (let i = 0; i < order.length;) {
    if (cancelled?.()) throw new Error("cancelled");
    const group = [order[i]];
    const minW = crops[order[i]].outW;
    // only equal widths share a batch: the recognizer's global attention sees
    // padding, and padded batches measurably raised CER on Hindi
    while (group.length < batch && i + group.length < order.length && crops[order[i + group.length]].outW === minW)
      group.push(order[i + group.length]);
    i += group.length;
    const maxW = crops[group[group.length - 1]].outW;
    const n = group.length;
    const buf = new Float32Array(n * 3 * REC_H * maxW);
    group.forEach((ci, b) => cropToTensor(px, crops[ci].quad, crops[ci].outW, REC_H, buf, b * 3 * REC_H * maxW, maxW));
    const input = new ort.Tensor("float32", buf, [n, 3, REC_H, maxW]);
    const out = await rec.run({ [rec.inputNames[0]]: input });
    const t = out[rec.outputNames[0]];
    const [, T, C] = t.dims as number[];
    const data = t.data as Float32Array;
    group.forEach((ci, b) => {
      const Ti = Math.min(T, Math.ceil((crops[ci].outW * T) / maxW));
      results[ci] = ctcDecode(data, b * T * C, Ti, C, dict);
    });
    t.dispose?.();
    input.dispose?.();
    done += n;
    onDone?.(done, crops.length);
  }
  return results;
}

/** Full pipeline on decoded pixels. */
export async function ocrPixels(
  eng: OcrEngine, px: Pixels,
  onProgress: (p: OcrProgress) => void = () => {},
  cancelled?: () => boolean
): Promise<OcrResult> {
  const t0 = now();
  onProgress({ step: "detect" });
  const quads = await detect(eng, px);
  const t1 = now();
  if (cancelled?.()) throw new Error("cancelled");
  onProgress({ step: "boxes", quads, width: px.width, height: px.height });
  const texts = await recognize(eng, px, quads, (done, total) => onProgress({ step: "recognize", done, total }), cancelled);
  const t2 = now();
  const boxes: OcrBox[] = [];
  quads.forEach((quad, i) => {
    const r = texts[i];
    if (r.text && r.score >= MIN_SCORE) boxes.push({ quad, text: r.text, score: r.score });
  });
  const rows = readingOrder(boxes);
  const text = rows.map((r) => (r.gapBefore ? "\n" : "") + r.text).join("\n");
  return {
    width: px.width, height: px.height, boxes, rows, text,
    ms: { det: Math.round(t1 - t0), rec: Math.round(t2 - t1), total: Math.round(t2 - t0) },
    device: eng.device,
  };
}

// ORT sessions aren't re-entrant: two overlapping run()s on one WebGPU
// session deadlock (wasm merely tolerates it). Every job takes a turn.
let turn: Promise<unknown> = Promise.resolve();
function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const run = turn.then(fn, fn);
  turn = run.catch(() => {});
  return run;
}

/** Load (once) and OCR one image. */
export async function ocrImage(
  src: Blob | ImageBitmap,
  onProgress: (p: OcrProgress) => void,
  opts: { wasm?: boolean; cancelled?: () => boolean } = {}
): Promise<OcrResult> {
  const [eng, px] = await Promise.all([loadOcr(onProgress, !!opts.wasm), toPixels(src)]);
  return exclusive(() => {
    if (opts.cancelled?.()) throw new Error("cancelled");
    return ocrPixels(eng, px, onProgress, opts.cancelled);
  });
}
