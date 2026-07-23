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
  | {
      phase: "tile"; done: number; total: number;
      timing: { readbackMs: number; inferenceMs: number; stitchMs: number };
      skipped: boolean;
      /** the freshly painted tile, for live "developing photo" previews */
      tile?: { core: HTMLCanvasElement; x: number; y: number; outW: number; outH: number };
    };

export interface FrameCache {
  tiles: Map<
    string,
    // core is painted at (coreX*4 - ox, coreY*4 - oy): tiles carry a feathered
    // left/top margin that cross-fades into the previously painted neighbour
    { pixels: Uint8ClampedArray; core: HTMLCanvasElement; ox: number; oy: number }
  >;
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

/** Feather width in source px — must stay ≤ OVER so the window covers it. */
const FEATHER = 6;

function scanHasAlpha(d: Uint8ClampedArray): boolean {
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return true;
  return false;
}

/**
 * Bleed edge colours into transparent pixels. Canvas hands us unpremultiplied
 * RGBA where fully-transparent pixels usually carry RGB=0 — the model would
 * smear those black values into dark halos along every cutout edge. Growing
 * the nearest opaque colour outward gives it honest context instead.
 */
function dilateIntoTransparent(id: ImageData, passes: number) {
  const { width: w, height: h, data: d } = id;
  const solid = new Uint8Array(w * h);
  for (let p = 0; p < w * h; p++) solid[p] = d[p * 4 + 3] >= 8 ? 1 : 0;
  for (let pass = 0; pass < passes; pass++) {
    const next = solid.slice();
    let changed = false;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (solid[p]) continue;
        const n =
          x > 0 && solid[p - 1] ? p - 1 :
          x < w - 1 && solid[p + 1] ? p + 1 :
          y > 0 && solid[p - w] ? p - w :
          y < h - 1 && solid[p + w] ? p + w : -1;
        if (n >= 0) {
          d[p * 4] = d[n * 4];
          d[p * 4 + 1] = d[n * 4 + 1];
          d[p * 4 + 2] = d[n * 4 + 2];
          next[p] = 1;
          changed = true;
        }
      }
    }
    solid.set(next);
    if (!changed) break;
  }
}

/**
 * Alpha-ramp a tile's left/top edge so it cross-fades over the neighbour
 * painted before it (tiles land in raster order), instead of butting
 * against it with a hard seam.
 */
function featherLeftTop(c: HTMLCanvasElement, fx: number, fy: number) {
  if (!fx && !fy) return;
  const ctx = c.getContext("2d")!;
  ctx.globalCompositeOperation = "destination-in";
  if (fx > 0) {
    const g = ctx.createLinearGradient(0, 0, c.width, 0);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(fx / c.width, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  if (fy > 0) {
    const g = ctx.createLinearGradient(0, 0, 0, c.height);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(fy / c.height, "rgba(0,0,0,1)");
    g.addColorStop(1, "rgba(0,0,0,1)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, c.width, c.height);
  }
  ctx.globalCompositeOperation = "source-over";
}

/** Rebuild the output's alpha from the original plane, upscaled smoothly. */
function applyAlpha(out: HTMLCanvasElement, alphaPlane: HTMLCanvasElement) {
  const s = document.createElement("canvas");
  s.width = out.width; s.height = out.height;
  const sctx = s.getContext("2d")!;
  sctx.imageSmoothingEnabled = true;
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(alphaPlane, 0, 0, out.width, out.height);
  const a = sctx.getImageData(0, 0, out.width, out.height).data;
  const octx = out.getContext("2d")!;
  const o = octx.getImageData(0, 0, out.width, out.height);
  for (let i = 3; i < o.data.length; i += 4) o.data[i] = a[i];
  octx.putImageData(o, 0, 0);
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

  // Transparency: video frames are always opaque, so only images pay for the
  // scan. When alpha exists we (1) keep the original alpha plane aside,
  // (2) bleed edge colours into the transparent region so the model sees
  // honest context instead of black, (3) restore smooth upscaled alpha at
  // the end. Without this, transparent PNGs came out opaque with halos.
  const isVideo =
    typeof HTMLVideoElement !== "undefined" && source instanceof HTMLVideoElement;
  let alphaPlane: HTMLCanvasElement | null = null;
  if (!isVideo) {
    const full = stageCtx.getImageData(0, 0, srcW, srcH);
    if (scanHasAlpha(full.data)) {
      alphaPlane = document.createElement("canvas");
      alphaPlane.width = srcW; alphaPlane.height = srcH;
      const ai = new ImageData(srcW, srcH);
      for (let i = 0; i < srcW * srcH; i++) {
        ai.data[i * 4] = 255; ai.data[i * 4 + 1] = 255; ai.data[i * 4 + 2] = 255;
        ai.data[i * 4 + 3] = full.data[i * 4 + 3];
      }
      alphaPlane.getContext("2d")!.putImageData(ai, 0, 0);
      dilateIntoTransparent(full, FEATHER + 2);
      for (let i = 3; i < full.data.length; i += 4) full.data[i] = 255;
      stageCtx.putImageData(full, 0, 0);
    }
  }

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

      // Feather margins: extend the painted region a few px into the tile
      // painted before it (left/top in raster order) and alpha-ramp that
      // strip, so adjacent tiles cross-fade instead of butting hard — GAN
      // tiles never agree exactly at the cut, which showed as grid seams
      // on skies and gradients.
      const mL = tx > 0 ? FEATHER : 0;
      const mT = ty > 0 ? FEATHER : 0;
      let coreCanvas: HTMLCanvasElement;
      let ox: number, oy: number;
      if (unchanged) {
        coreCanvas = prev!.core;
        ox = prev!.ox; oy = prev!.oy;
      } else {
        const input = new ort.Tensor("float32", regionToTensor(id), [1, 3, IN, IN]);
        const out = await session.run({ [inName]: input });
        const outT = out[outName];
        const outSize = IN * SCALE;
        const tileCanvas = tensorToCanvas(outT.data as Float32Array, outSize);

        ox = mL * SCALE; oy = mT * SCALE;
        coreCanvas = document.createElement("canvas");
        coreCanvas.width = (cw + mL) * SCALE;
        coreCanvas.height = (ch + mT) * SCALE;
        coreCanvas.getContext("2d")!.drawImage(
          tileCanvas,
          (cx - mL - ex) * SCALE, (cy - mT - ey) * SCALE,
          coreCanvas.width, coreCanvas.height,
          0, 0, coreCanvas.width, coreCanvas.height
        );
        featherLeftTop(coreCanvas, ox, oy);
      }
      const t2 = performance.now();

      x4ctx.drawImage(coreCanvas, cx * SCALE - ox, cy * SCALE - oy);
      const t3 = performance.now();

      nextCache.tiles.set(key, { pixels: id.data, core: coreCanvas, ox, oy });
      done++;
      onProgress?.({
        phase: "tile", done, total, skipped: unchanged,
        timing: { readbackMs: t1 - t0, inferenceMs: t2 - t1, stitchMs: t3 - t2 },
        tile: { core: coreCanvas, x: cx * SCALE - ox, y: cy * SCALE - oy, outW: srcW * SCALE, outH: srcH * SCALE },
      });
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  let outCanvas = x4;
  if (outScale !== SCALE) {
    const out2 = document.createElement("canvas");
    out2.width = srcW * 2; out2.height = srcH * 2;
    const o2 = out2.getContext("2d")!;
    o2.imageSmoothingEnabled = true;
    o2.imageSmoothingQuality = "high";
    o2.drawImage(x4, 0, 0, out2.width, out2.height);
    outCanvas = out2;
  }
  if (alphaPlane) applyAlpha(outCanvas, alphaPlane);
  return { canvas: outCanvas, cache: nextCache };
}
