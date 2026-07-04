"use client";

/**
 * Magic Eraser — LaMa inpainting (Carve/LaMa-ONNX, big-lama fp32 export).
 *
 * The model is fixed at 512×512 (its FFT layers can't do dynamic shapes in
 * ONNX), so instead of squashing the whole photo through 512px we inpaint a
 * square context window around the painted region and composite only the
 * masked pixels back into the full-resolution original — everything the user
 * didn't touch stays pixel-identical.
 *
 * I/O contract (from the Carve demo): image (1,3,512,512) fp32 ÷255,
 * mask (1,1,512,512) fp32 binarized >0, output (1,3,512,512) already 0–255.
 */

import { loadOrt, createSession } from "./ortRuntime";

const MODEL_URL =
  "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx";
const SIZE = 512;

export type EraserPhase =
  | { step: "download"; pct: number }
  | { step: "inpaint" };

let sessionPromise: Promise<any> | null = null;

export function loadEraser(onProgress?: (p: EraserPhase) => void) {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const ort = await loadOrt();
    const session = await createSession(ort, MODEL_URL, (l, t) => {
      if (t) onProgress?.({ step: "download", pct: Math.round((l / t) * 100) });
    });
    return { ort, session };
  })();
  sessionPromise.catch(() => { sessionPromise = null; });
  return sessionPromise;
}

function canvas2d(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return { c, ctx: c.getContext("2d", { willReadFrequently: true })! };
}

/** Alpha-channel bounding box of the painted strokes; null if untouched. */
function maskBBox(mask: HTMLCanvasElement) {
  const { width: w, height: h } = mask;
  const a = mask.getContext("2d")!.getImageData(0, 0, w, h).data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (a[(y * w + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x0, y0, x1, y1 };
}

/**
 * Inpaint the painted region of `source`. Returns a new full-resolution
 * canvas; `source` and `mask` are left untouched.
 */
export async function erase(
  source: HTMLCanvasElement,
  mask: HTMLCanvasElement,
  onProgress?: (p: EraserPhase) => void
): Promise<HTMLCanvasElement> {
  const bbox = maskBBox(mask);
  if (!bbox) throw new Error("Paint over what you want to remove first.");

  const { ort, session } = await loadEraser(onProgress);
  onProgress?.({ step: "inpaint" });

  const W = source.width, H = source.height;

  // square context window: ~3× the brushed area so the model sees enough
  // surroundings to reconstruct texture, never smaller than 384px
  const bw = bbox.x1 - bbox.x0 + 1, bh = bbox.y1 - bbox.y0 + 1;
  let side = Math.min(Math.max(Math.max(bw, bh) * 3, 384), Math.min(W, H));
  const cx = (bbox.x0 + bbox.x1) / 2, cy = (bbox.y0 + bbox.y1) / 2;
  let wx = Math.round(Math.min(Math.max(cx - side / 2, 0), W - side));
  let wy = Math.round(Math.min(Math.max(cy - side / 2, 0), H - side));
  // tiny images: window is the whole picture
  if (side >= Math.min(W, H)) {
    side = Math.min(W, H);
    wx = Math.round(Math.min(Math.max(cx - side / 2, 0), W - side));
    wy = Math.round(Math.min(Math.max(cy - side / 2, 0), H - side));
  }

  // model-space image + mask (slightly dilated via blur so stroke edges are
  // fully covered — LaMa behaves better with a little margin)
  const img512 = canvas2d(SIZE, SIZE);
  img512.ctx.drawImage(source, wx, wy, side, side, 0, 0, SIZE, SIZE);
  const msk512 = canvas2d(SIZE, SIZE);
  msk512.ctx.filter = "blur(2px)";
  msk512.ctx.drawImage(mask, wx, wy, side, side, 0, 0, SIZE, SIZE);
  msk512.ctx.filter = "none";

  const imgData = img512.ctx.getImageData(0, 0, SIZE, SIZE).data;
  const mskData = msk512.ctx.getImageData(0, 0, SIZE, SIZE).data;
  const n = SIZE * SIZE;
  const imgT = new Float32Array(3 * n);
  const mskT = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    imgT[i] = imgData[i * 4] / 255;
    imgT[n + i] = imgData[i * 4 + 1] / 255;
    imgT[2 * n + i] = imgData[i * 4 + 2] / 255;
    mskT[i] = mskData[i * 4 + 3] > 8 ? 1 : 0;
  }

  const out = await session.run({
    image: new ort.Tensor("float32", imgT, [1, 3, SIZE, SIZE]),
    mask: new ort.Tensor("float32", mskT, [1, 1, SIZE, SIZE]),
  });
  const o = out[session.outputNames[0]].data as Float32Array;

  // output is already 0–255
  const res512 = canvas2d(SIZE, SIZE);
  const resData = res512.ctx.createImageData(SIZE, SIZE);
  for (let i = 0; i < n; i++) {
    resData.data[i * 4] = Math.min(255, Math.max(0, o[i]));
    resData.data[i * 4 + 1] = Math.min(255, Math.max(0, o[n + i]));
    resData.data[i * 4 + 2] = Math.min(255, Math.max(0, o[2 * n + i]));
    resData.data[i * 4 + 3] = 255;
  }
  res512.ctx.putImageData(resData, 0, 0);

  // composite: inpainted pixels only, feathered a few px to blend the seam
  const patch = canvas2d(side, side);
  patch.ctx.imageSmoothingQuality = "high";
  patch.ctx.drawImage(res512.c, 0, 0, SIZE, SIZE, 0, 0, side, side);
  const feather = canvas2d(side, side);
  feather.ctx.filter = "blur(3px)";
  feather.ctx.drawImage(mask, wx, wy, side, side, 0, 0, side, side);
  feather.ctx.filter = "none";
  patch.ctx.globalCompositeOperation = "destination-in";
  patch.ctx.drawImage(feather.c, 0, 0);

  const result = canvas2d(W, H);
  result.ctx.drawImage(source, 0, 0);
  result.ctx.drawImage(patch.c, wx, wy);
  return result.c;
}
