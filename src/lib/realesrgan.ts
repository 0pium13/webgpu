"use client";

/**
 * Real-ESRGAN x4plus — the GAN-trained photo-realistic upscaler. Unlike the
 * PSNR-trained Swin2SR (optimized to be smooth/safe), this model was trained
 * adversarially to RECONSTRUCT believable texture: skin pores, hair strands,
 * fabric weave. It's also a plain convnet, so per-pixel it's several times
 * faster than a transformer.
 *
 * Export: bukuroo/RealESRGAN-ONNX (BSD-3) — fixed 128×128 fp32 input, ×4.
 * The fixed input suits our tiling: 112px core + 8px context per side = 128.
 * Runs on our CDN onnxruntime-web WebGPU runtime (wasm fallback).
 *
 * API mirrors superres.upscaleToCanvas including the FrameCache tile-skip,
 * so the video Quality path can swap engines with one import change.
 */

import { loadOrt, createSession } from "@/lib/ortRuntime";

const MODEL_URL = "https://huggingface.co/bukuroo/RealESRGAN-ONNX/resolve/main/real-esrgan-x4plus-128.onnx";
const IN = 128;        // fixed model input
const OVER = 8;        // context margin each side
const CORE = IN - OVER * 2; // 112px of trusted output per tile
const SCALE = 4;

export type SRProgress =
  | { phase: "download"; pct: number }
  | { phase: "tile"; done: number; total: number; timing: { readbackMs: number; inferenceMs: number; stitchMs: number }; skipped: boolean };

export interface FrameCache {
  tiles: Map<string, { pixels: Uint8ClampedArray; core: HTMLCanvasElement }>;
}

let sessionPromise: Promise<{ ort: any; session: any; inName: string; outName: string }> | null = null;
let usedDevice: "webgpu" | "wasm" = "webgpu";

export function srDevice() {
  return usedDevice;
}

export async function loadSR(onProgress?: (p: SRProgress) => void) {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const ort = await loadOrt();
    const session = await createSession(ort, MODEL_URL, (l, t) => {
      if (t) onProgress?.({ phase: "download", pct: Math.round((l / t) * 100) });
    });
    // createSession falls back to wasm internally; sniff which EP won
    usedDevice = (session.handler?._context?.backendName ?? "webgpu").includes("wasm") ? "wasm" : "webgpu";
    return { ort, session, inName: session.inputNames[0], outName: session.outputNames[0] };
  })();
  sessionPromise.catch(() => { sessionPromise = null; });
  return sessionPromise;
}

const TILE = CORE; // exported grid unit (kept name parity with superres)

export function estimateTiles(srcW: number, srcH: number): number {
  return Math.ceil(srcW / CORE) * Math.ceil(srcH / CORE);
}

/** RGBA region (exactly IN×IN, clamped inside the source) → fp32 CHW 0..1. */
function regionToTensor(id: ImageData): Float32Array {
  const n = IN * IN;
  const out = new Float32Array(3 * n);
  const d = id.data;
  for (let i = 0; i < n; i++) {
    out[i] = d[i * 4] / 255;
    out[n + i] = d[i * 4 + 1] / 255;
    out[2 * n + i] = d[i * 4 + 2] / 255;
  }
  return out;
}

/** fp32 CHW 0..1 (3,512,512) → canvas. */
function tensorToCanvas(t: Float32Array, size: number): HTMLCanvasElement {
  const n = size * size;
  const img = new ImageData(size, size);
  for (let i = 0; i < n; i++) {
    img.data[i * 4] = Math.max(0, Math.min(255, t[i] * 255));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, t[n + i] * 255));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, t[2 * n + i] * 255));
    img.data[i * 4 + 3] = 255;
  }
  const c = document.createElement("canvas");
  c.width = size; c.height = size;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return c;
}

const CHANGE_THRESHOLD = 2;
function regionsSimilar(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  let sum = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  }
  return sum / ((a.length / 4) * 3) < CHANGE_THRESHOLD;
}

/**
 * Upscale by 2 or 4 (native ×4; ×2 = high-quality downscale of the ×4).
 * Same return contract as superres.upscaleToCanvas: { canvas, cache }.
 */
export async function upscaleToCanvas(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | ImageBitmap,
  outScale: 2 | 4,
  onProgress?: (p: SRProgress) => void,
  prevCache?: FrameCache
): Promise<{ canvas: HTMLCanvasElement; cache: FrameCache }> {
  const { ort, session, inName, outName } = await loadSR(onProgress);

  let srcW = (source as any).naturalWidth ?? (source as any).videoWidth ?? (source as any).width;
  let srcH = (source as any).naturalHeight ?? (source as any).videoHeight ?? (source as any).height;

  // stage the source once; tiny sources get bicubic-lifted to the model minimum
  let stage = document.createElement("canvas");
  if (srcW < IN || srcH < IN) {
    const k = Math.max(IN / srcW, IN / srcH);
    stage.width = Math.ceil(srcW * k); stage.height = Math.ceil(srcH * k);
    const sctx = stage.getContext("2d")!;
    sctx.imageSmoothingEnabled = true; sctx.imageSmoothingQuality = "high";
    sctx.drawImage(source as CanvasImageSource, 0, 0, stage.width, stage.height);
    srcW = stage.width; srcH = stage.height;
  } else {
    stage.width = srcW; stage.height = srcH;
    stage.getContext("2d")!.drawImage(source as CanvasImageSource, 0, 0);
  }
  const stageCtx = stage.getContext("2d", { willReadFrequently: true })!;

  const x4 = document.createElement("canvas");
  x4.width = srcW * SCALE; x4.height = srcH * SCALE;
  const x4ctx = x4.getContext("2d")!;

  const stepsX = Math.ceil(srcW / CORE);
  const stepsY = Math.ceil(srcH / CORE);
  const total = stepsX * stepsY;
  const nextCache: FrameCache = { tiles: new Map() };
  let done = 0;

  for (let ty = 0; ty < stepsY; ty++) {
    for (let tx = 0; tx < stepsX; tx++) {
      const cx = tx * CORE, cy = ty * CORE;
      const cw = Math.min(CORE, srcW - cx), ch = Math.min(CORE, srcH - cy);
      // slide the fixed 128 window so it always fits inside the source
      const ex = Math.max(0, Math.min(cx - OVER, srcW - IN));
      const ey = Math.max(0, Math.min(cy - OVER, srcH - IN));

      const t0 = performance.now();
      const id = stageCtx.getImageData(ex, ey, IN, IN);
      const t1 = performance.now();

      const key = `${tx},${ty}`;
      const prev = prevCache?.tiles.get(key);
      const unchanged = !!prev && regionsSimilar(prev.pixels, id.data);

      let coreCanvas: HTMLCanvasElement;
      if (unchanged) {
        coreCanvas = prev!.core;
      } else {
        const input = new ort.Tensor("float32", regionToTensor(id), [1, 3, IN, IN]);
        const out = await session.run({ [inName]: input });
        const outT = out[outName];
        const outSize = IN * SCALE;
        const tileCanvas = tensorToCanvas(outT.data as Float32Array, outSize);

        coreCanvas = document.createElement("canvas");
        coreCanvas.width = cw * SCALE; coreCanvas.height = ch * SCALE;
        coreCanvas.getContext("2d")!.drawImage(
          tileCanvas,
          (cx - ex) * SCALE, (cy - ey) * SCALE, cw * SCALE, ch * SCALE,
          0, 0, cw * SCALE, ch * SCALE
        );
      }
      const t2 = performance.now();

      x4ctx.drawImage(coreCanvas, cx * SCALE, cy * SCALE);
      const t3 = performance.now();

      nextCache.tiles.set(key, { pixels: id.data, core: coreCanvas });
      done++;
      onProgress?.({
        phase: "tile", done, total, skipped: unchanged,
        timing: { readbackMs: t1 - t0, inferenceMs: t2 - t1, stitchMs: t3 - t2 },
      });
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  if (outScale === SCALE) return { canvas: x4, cache: nextCache };

  const out2 = document.createElement("canvas");
  out2.width = srcW * 2; out2.height = srcH * 2;
  const o2 = out2.getContext("2d")!;
  o2.imageSmoothingEnabled = true;
  o2.imageSmoothingQuality = "high";
  o2.drawImage(x4, 0, 0, out2.width, out2.height);
  return { canvas: out2, cache: nextCache };
}
