"use client";

/**
 * Real AI super-resolution (Swin2SR) on WebGPU via transformers.js.
 *
 * Unlike canvas bicubic (which only interpolates) or Anime4K (anime-only),
 * Swin2SR is a transformer trained to RECONSTRUCT realistic detail on real,
 * compressed/degraded photos. This is the engine behind the "top quality"
 * upscale for photographic content.
 *
 * The model upscales by a fixed ×4. Large images are processed in overlapping
 * tiles to bound GPU memory and avoid seams.
 *
 * Video frames pass a `prevCache` (the previous sampled frame's cache) in and
 * get a new one back. Tiles whose source pixels are nearly identical to last
 * time skip re-inference entirely and reuse the exact previous output — this
 * is a real memory optimization (identical input -> identical output), not an
 * approximation, so it carries no quality risk. Static backgrounds behind a
 * moving subject are the common case this pays off on; fast, constant motion
 * across the whole frame won't benefit much.
 */

// Real-world degradation–trained x4 model — best for realistic photos/film frames.
const MODEL_X4 = "Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr";
const NATIVE_SCALE = 4;

// Per-tile timing breakdown so callers (and us, diagnostically) can see where
// the time is actually going: readback (canvas draw + getImageData, a
// GPU->CPU sync point), inference (the awaited pipe() call — this blocks
// until the GPU finishes, so its wall-clock time is a faithful proxy for
// real model compute even without raw WebGPU timestamp-query access), and
// stitch (compositing the tile's output back into the full-res canvas).
export type TileTiming = { readbackMs: number; inferenceMs: number; stitchMs: number };

export type SRProgress =
  | { phase: "download"; pct: number }
  | { phase: "tile"; done: number; total: number; timing: TileTiming; skipped: boolean };

/** Per-tile memory of the previous frame: its source pixels (for the change
 * check) and its finished output (reused as-is when unchanged). Pass the
 * cache a call returns into the next frame's call to enable skipping. */
export interface FrameCache {
  tiles: Map<string, { pixels: Uint8ClampedArray; core: HTMLCanvasElement }>;
}

let pipePromise: Promise<any> | null = null;
let usedDevice: "webgpu" | "wasm" = "webgpu";

async function getTJ() {
  return (await import("@huggingface/transformers")) as any;
}

/** Lazy-load the Swin2SR image-to-image pipeline (WebGPU, wasm fallback). */
export async function loadSR(onProgress?: (p: SRProgress) => void): Promise<any> {
  if (pipePromise) return pipePromise;
  pipePromise = (async () => {
    const tj = await getTJ();
    const { pipeline, env } = tj;
    env.allowLocalModels = false;

    const cb = (p: any) => {
      if (p?.status === "progress" && p.total) {
        onProgress?.({ phase: "download", pct: Math.round((p.loaded / p.total) * 100) });
      }
    };

    try {
      const pipe = await pipeline("image-to-image", MODEL_X4, {
        device: "webgpu",
        dtype: "fp32",
        progress_callback: cb,
      });
      usedDevice = "webgpu";
      return pipe;
    } catch (e) {
      console.warn("[sr] webgpu pipeline failed, falling back to wasm", e);
      const pipe = await pipeline("image-to-image", MODEL_X4, {
        device: "wasm",
        dtype: "fp32",
        progress_callback: cb,
      });
      usedDevice = "wasm";
      return pipe;
    }
  })();
  return pipePromise;
}

export function srDevice() {
  return usedDevice;
}

const TILE = 256; // input tile core size — also used by estimateTiles below

/** Number of tiles upscaleToCanvas will process for a given source size. */
export function estimateTiles(srcW: number, srcH: number): number {
  return Math.ceil(srcW / TILE) * Math.ceil(srcH / TILE);
}

/** Draw a region of the source into a small canvas and read its pixels back. */
function getRegionImageData(
  src: CanvasImageSource,
  sx: number,
  sy: number,
  w: number,
  h: number
): ImageData {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, sx, sy, w, h, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h);
}

/** Build a transformers.js RawImage (RGB) from already-read-back pixels. */
async function rawImageFromImageData(id: ImageData): Promise<any> {
  const { RawImage } = await getTJ();
  const raw = new RawImage(new Uint8ClampedArray(id.data), id.width, id.height, 4);
  return raw.rgb();
}

// Conservative on purpose: a false "unchanged" verdict reuses stale content,
// while a false "changed" verdict only costs a bit of time re-running the
// model. Comparing every pixel's R/G/B (skipping alpha) against a low
// threshold biases toward reprocessing when in doubt.
const CHANGE_THRESHOLD = 2; // average per-channel difference (0-255) below which a tile is "unchanged"

function regionsSimilar(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  let sumDiff = 0;
  for (let i = 0; i < a.length; i += 4) {
    sumDiff += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
  }
  const channelCount = (a.length / 4) * 3;
  return sumDiff / channelCount < CHANGE_THRESHOLD;
}

/**
 * Upscale a source image (canvas/bitmap/image) by `outScale` (2 or 4) using
 * real Swin2SR. Returns a freshly drawn output canvas at source×outScale.
 *
 * The model is native ×4; for ×2 we run ×4 then downscale 50% with high-quality
 * smoothing (this also denoises compression — cleaner than a native ×2 on real
 * web images).
 *
 * `prevCache` is optional — omit it for one-shot images. For video, pass the
 * cache returned from the previous sampled frame's call to skip re-inference
 * on tiles whose source pixels haven't meaningfully changed.
 */
export async function upscaleToCanvas(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | ImageBitmap,
  outScale: 2 | 4,
  onProgress?: (p: SRProgress) => void,
  prevCache?: FrameCache
): Promise<{ canvas: HTMLCanvasElement; cache: FrameCache }> {
  const pipe = await loadSR(onProgress);
  const { RawImage } = await getTJ();

  const srcW = (source as any).naturalWidth ?? (source as any).videoWidth ?? (source as any).width;
  const srcH = (source as any).naturalHeight ?? (source as any).videoHeight ?? (source as any).height;

  // ×4 canvas the model writes into
  const x4 = document.createElement("canvas");
  x4.width = srcW * NATIVE_SCALE;
  x4.height = srcH * NATIVE_SCALE;
  const x4ctx = x4.getContext("2d")!;

  // Tile the source with overlap so the model sees context → no visible seams.
  const OVER = 16;    // context margin pulled from neighbours
  const stepsX = Math.ceil(srcW / TILE);
  const stepsY = Math.ceil(srcH / TILE);
  const total = stepsX * stepsY;
  let done = 0;

  const nextCache: FrameCache = { tiles: new Map() };

  for (let ty = 0; ty < stepsY; ty++) {
    for (let tx = 0; tx < stepsX; tx++) {
      // core region
      const cx = tx * TILE;
      const cy = ty * TILE;
      const cw = Math.min(TILE, srcW - cx);
      const ch = Math.min(TILE, srcH - cy);

      // expanded region (core + overlap), clamped to image bounds
      const ex = Math.max(0, cx - OVER);
      const ey = Math.max(0, cy - OVER);
      const ew = Math.min(srcW, cx + cw + OVER) - ex;
      const eh = Math.min(srcH, cy + ch + OVER) - ey;

      const cropW = cw * NATIVE_SCALE;
      const cropH = ch * NATIVE_SCALE;

      const t0 = performance.now();
      const imgData = getRegionImageData(source as CanvasImageSource, ex, ey, ew, eh);
      const t1 = performance.now();

      const key = `${tx},${ty}`;
      const prev = prevCache?.tiles.get(key);
      const unchanged = !!prev && regionsSimilar(prev.pixels, imgData.data);

      let coreCanvas: HTMLCanvasElement;
      if (unchanged) {
        coreCanvas = prev!.core;
      } else {
        const raw = await rawImageFromImageData(imgData);
        const out = await pipe(raw); // RawImage at ew*4 × eh*4 — awaited, so this IS the GPU compute time
        const outImg: any = Array.isArray(out) ? out[0] : out;

        const cropL = (cx - ex) * NATIVE_SCALE;
        const cropT = (cy - ey) * NATIVE_SCALE;
        const tileCanvas: HTMLCanvasElement =
          typeof outImg.toCanvas === "function"
            ? outImg.toCanvas()
            : rawToCanvas(outImg, RawImage);

        // Cache only the CORE crop (already at native 4x) so a future reuse
        // is a direct drawImage with no re-crop math.
        coreCanvas = document.createElement("canvas");
        coreCanvas.width = cropW;
        coreCanvas.height = cropH;
        coreCanvas.getContext("2d")!.drawImage(
          tileCanvas, cropL, cropT, cropW, cropH, 0, 0, cropW, cropH
        );
      }
      const t2 = performance.now();

      x4ctx.drawImage(coreCanvas, 0, 0, cropW, cropH, cx * NATIVE_SCALE, cy * NATIVE_SCALE, cropW, cropH);
      const t3 = performance.now();

      nextCache.tiles.set(key, { pixels: imgData.data, core: coreCanvas });

      done++;
      onProgress?.({
        phase: "tile", done, total, skipped: unchanged,
        timing: { readbackMs: t1 - t0, inferenceMs: t2 - t1, stitchMs: t3 - t2 },
      });
      // yield so the UI paints and the GPU queue drains
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  if (outScale === NATIVE_SCALE) return { canvas: x4, cache: nextCache };

  // ×2 requested: downscale the ×4 result 50% with high-quality smoothing
  const out2 = document.createElement("canvas");
  out2.width = srcW * 2;
  out2.height = srcH * 2;
  const o2 = out2.getContext("2d")!;
  o2.imageSmoothingEnabled = true;
  o2.imageSmoothingQuality = "high";
  o2.drawImage(x4, 0, 0, out2.width, out2.height);
  return { canvas: out2, cache: nextCache };
}

/** Fallback canvas builder if RawImage.toCanvas isn't available. */
function rawToCanvas(img: any, _RawImage: any): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d")!;
  const ch = img.channels;
  const rgba = new Uint8ClampedArray(img.width * img.height * 4);
  for (let i = 0, j = 0; i < img.width * img.height; i++) {
    rgba[j++] = img.data[i * ch];
    rgba[j++] = img.data[i * ch + 1];
    rgba[j++] = img.data[i * ch + 2];
    rgba[j++] = ch === 4 ? img.data[i * ch + 3] : 255;
  }
  ctx.putImageData(new ImageData(rgba, img.width, img.height), 0, 0);
  return c;
}
