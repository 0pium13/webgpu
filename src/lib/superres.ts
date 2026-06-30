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
 */

// Real-world degradation–trained x4 model — best for realistic photos/film frames.
const MODEL_X4 = "Xenova/swin2SR-realworld-sr-x4-64-bsrgan-psnr";
const NATIVE_SCALE = 4;

export type SRProgress =
  | { phase: "download"; pct: number }
  | { phase: "tile"; done: number; total: number };

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

/** Build a transformers.js RawImage (RGB) from a region of a source canvas. */
async function rawFromRegion(
  src: CanvasImageSource & { width?: number; height?: number },
  sx: number,
  sy: number,
  w: number,
  h: number
): Promise<any> {
  const { RawImage } = await getTJ();
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src as CanvasImageSource, sx, sy, w, h, 0, 0, w, h);
  const id = ctx.getImageData(0, 0, w, h);
  const raw = new RawImage(new Uint8ClampedArray(id.data), w, h, 4);
  return raw.rgb();
}

/**
 * Upscale a source image (canvas/bitmap/image) by `outScale` (2 or 4) using
 * real Swin2SR. Returns a freshly drawn output canvas at source×outScale.
 *
 * The model is native ×4; for ×2 we run ×4 then downscale 50% with high-quality
 * smoothing (this also denoises compression — cleaner than a native ×2 on real
 * web images).
 */
export async function upscaleToCanvas(
  source: HTMLImageElement | HTMLCanvasElement | HTMLVideoElement | ImageBitmap,
  outScale: 2 | 4,
  onProgress?: (p: SRProgress) => void
): Promise<HTMLCanvasElement> {
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
  const TILE = 128;   // input tile core size
  const OVER = 16;    // context margin pulled from neighbours
  const stepsX = Math.ceil(srcW / TILE);
  const stepsY = Math.ceil(srcH / TILE);
  const total = stepsX * stepsY;
  let done = 0;

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

      const raw = await rawFromRegion(source as any, ex, ey, ew, eh);
      const out = await pipe(raw); // RawImage at ew*4 × eh*4
      const outImg: any = Array.isArray(out) ? out[0] : out;

      // place only the CORE of this tile into the ×4 canvas (crop the overlap)
      const cropL = (cx - ex) * NATIVE_SCALE;
      const cropT = (cy - ey) * NATIVE_SCALE;
      const cropW = cw * NATIVE_SCALE;
      const cropH = ch * NATIVE_SCALE;

      const tileCanvas: HTMLCanvasElement =
        typeof outImg.toCanvas === "function"
          ? outImg.toCanvas()
          : rawToCanvas(outImg, RawImage);

      x4ctx.drawImage(
        tileCanvas,
        cropL, cropT, cropW, cropH,
        cx * NATIVE_SCALE, cy * NATIVE_SCALE, cropW, cropH
      );

      done++;
      onProgress?.({ phase: "tile", done, total });
      // yield so the UI paints and the GPU queue drains
      await new Promise((r) => setTimeout(r, 0));
    }
  }

  if (outScale === NATIVE_SCALE) return x4;

  // ×2 requested: downscale the ×4 result 50% with high-quality smoothing
  const out2 = document.createElement("canvas");
  out2.width = srcW * 2;
  out2.height = srcH * 2;
  const o2 = out2.getContext("2d")!;
  o2.imageSmoothingEnabled = true;
  o2.imageSmoothingQuality = "high";
  o2.drawImage(x4, 0, 0, out2.width, out2.height);
  return out2;
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
