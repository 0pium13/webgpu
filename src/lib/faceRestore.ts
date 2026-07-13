"use client";

/**
 * Face restoration — GFPGAN v1.4 (ONNX, 340MB, fetched once from HF and
 * cached by the browser). The exact pipeline the official repo uses:
 *
 *   detect landmarks → 5-point similarity alignment to the FFHQ 512
 *   template → GFPGAN on the aligned crop → inverse-warp the restored
 *   face back with a feathered mask.
 *
 * Detection reuses the self-hosted MediaPipe Face Landmarker (IMAGE mode,
 * up to 8 faces). Model contract (verified offline): input "input"
 * 1×3×512×512 fp32 RGB in [-1,1]; output same shape, needs clamping.
 */

import { loadOrt, createSession } from "@/lib/ortRuntime";

const MODEL_URL = "https://huggingface.co/Meeperomi/GFPGANv1.4-onnx/resolve/main/GFPGANv1.4.onnx";
const SIZE = 512;

/** FFHQ 512 alignment template (facexlib's face_template): image-left eye,
 *  image-right eye, nose tip, image-left mouth corner, image-right corner. */
const TEMPLATE: [number, number][] = [
  [192.98138, 239.94708],
  [318.90277, 240.1936],
  [256.63416, 314.01935],
  [201.26117, 371.41043],
  [313.08905, 371.15118],
];

export type RestoreProgress =
  | { phase: "detect" }
  | { phase: "download"; pct: number }
  | { phase: "restore"; face: number; total: number }
  | { phase: "paste" };

let sessionPromise: Promise<{ ort: any; session: any; inName: string; outName: string }> | null = null;
let detectorPromise: Promise<any> | null = null;

async function loadGfpgan(onProgress?: (p: RestoreProgress) => void) {
  if (sessionPromise) return sessionPromise;
  sessionPromise = (async () => {
    const ort = await loadOrt();
    const session = await createSession(ort, MODEL_URL, (l, t) => {
      if (t) onProgress?.({ phase: "download", pct: Math.round((l / t) * 100) });
    });
    return { ort, session, inName: session.inputNames[0], outName: session.outputNames[0] };
  })();
  sessionPromise.catch(() => { sessionPromise = null; });
  return sessionPromise;
}

/** MediaPipe landmarker in IMAGE mode (the webcam one runs VIDEO mode). */
async function loadDetector() {
  if (detectorPromise) return detectorPromise;
  detectorPromise = (async () => {
    const vision: any = await import("@mediapipe/tasks-vision");
    const { FilesetResolver, FaceLandmarker } = vision;
    const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
    const opts = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate },
      runningMode: "IMAGE" as const,
      numFaces: 8,
    });
    try {
      return await FaceLandmarker.createFromOptions(fileset, opts("GPU"));
    } catch (e) {
      console.warn("[restore] GPU delegate failed, CPU fallback", e);
      return await FaceLandmarker.createFromOptions(fileset, opts("CPU"));
    }
  })();
  detectorPromise.catch(() => { detectorPromise = null; });
  return detectorPromise;
}

/** Mean of a set of landmark indices, in pixels. */
function meanPt(lm: { x: number; y: number }[], idx: number[], w: number, h: number): [number, number] {
  let x = 0, y = 0;
  for (const i of idx) { x += lm[i].x; y += lm[i].y; }
  return [(x / idx.length) * w, (y / idx.length) * h];
}

/** The 5 alignment points from MediaPipe's 478-landmark mesh. */
function fivePoints(lm: { x: number; y: number }[], w: number, h: number): [number, number][] {
  // eye ring corners + lids give a stable center; sort by x so "left" is image-left
  const eyeA = meanPt(lm, [33, 133, 159, 145], w, h);
  const eyeB = meanPt(lm, [362, 263, 386, 374], w, h);
  const [eyeL, eyeR] = eyeA[0] <= eyeB[0] ? [eyeA, eyeB] : [eyeB, eyeA];
  const nose = meanPt(lm, [1], w, h);
  const mA = meanPt(lm, [61], w, h);
  const mB = meanPt(lm, [291], w, h);
  const [mouthL, mouthR] = mA[0] <= mB[0] ? [mA, mB] : [mB, mA];
  return [eyeL, eyeR, nose, mouthL, mouthR];
}

interface Similarity { a: number; b: number; tx: number; ty: number }

/**
 * Least-squares non-reflective similarity src→dst:
 * [x'] = [a -b][x] + [tx]  — closed form on centered points, same result
 * [y']   [b  a][y]   [ty]    as OpenCV's estimateAffinePartial2D here.
 */
function fitSimilarity(src: [number, number][], dst: [number, number][]): Similarity {
  const n = src.length;
  let sx = 0, sy = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { sx += src[i][0]; sy += src[i][1]; dx += dst[i][0]; dy += dst[i][1]; }
  sx /= n; sy /= n; dx /= n; dy /= n;
  let num_a = 0, num_b = 0, den = 0;
  for (let i = 0; i < n; i++) {
    const px = src[i][0] - sx, py = src[i][1] - sy;
    const qx = dst[i][0] - dx, qy = dst[i][1] - dy;
    num_a += px * qx + py * qy;
    num_b += px * qy - py * qx;
    den += px * px + py * py;
  }
  const a = num_a / den, b = num_b / den;
  return { a, b, tx: dx - (a * sx - b * sy), ty: dy - (b * sx + a * sy) };
}

function invertSimilarity(m: Similarity): Similarity {
  const s2 = m.a * m.a + m.b * m.b;
  const ia = m.a / s2, ib = -m.b / s2;
  return { a: ia, b: ib, tx: -(ia * m.tx - ib * m.ty), ty: -(ib * m.tx + ia * m.ty) };
}

function applyTransform(ctx: CanvasRenderingContext2D, m: Similarity) {
  // canvas setTransform(m11, m12, m21, m22, dx, dy): x' = m11·x + m21·y + dx
  ctx.setTransform(m.a, m.b, -m.b, m.a, m.tx, m.ty);
}

/** 512 crop → fp32 CHW RGB in [-1,1]. */
function cropToTensor(crop: HTMLCanvasElement): Float32Array {
  const d = crop.getContext("2d")!.getImageData(0, 0, SIZE, SIZE).data;
  const n = SIZE * SIZE;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++) {
    out[i] = d[i * 4] / 127.5 - 1;
    out[n + i] = d[i * 4 + 1] / 127.5 - 1;
    out[2 * n + i] = d[i * 4 + 2] / 127.5 - 1;
  }
  return out;
}

/** fp32 CHW [-1,1] → canvas. */
function tensorToCanvas(data: Float32Array): HTMLCanvasElement {
  const n = SIZE * SIZE;
  const img = new ImageData(SIZE, SIZE);
  for (let i = 0; i < n; i++) {
    img.data[i * 4] = Math.max(0, Math.min(255, (data[i] + 1) * 127.5));
    img.data[i * 4 + 1] = Math.max(0, Math.min(255, (data[n + i] + 1) * 127.5));
    img.data[i * 4 + 2] = Math.max(0, Math.min(255, (data[2 * n + i] + 1) * 127.5));
    img.data[i * 4 + 3] = 255;
  }
  const c = document.createElement("canvas");
  c.width = SIZE; c.height = SIZE;
  c.getContext("2d")!.putImageData(img, 0, 0);
  return c;
}

/** Feathered alpha mask so the paste has no hard seam (inset + blur). */
function featherMask(face: HTMLCanvasElement): HTMLCanvasElement {
  const m = document.createElement("canvas");
  m.width = SIZE; m.height = SIZE;
  const mc = m.getContext("2d")!;
  mc.filter = "blur(16px)";
  mc.fillStyle = "#fff";
  mc.beginPath();
  mc.roundRect(30, 30, SIZE - 60, SIZE - 60, 40);
  mc.fill();
  mc.filter = "none";
  mc.globalCompositeOperation = "source-in";
  mc.drawImage(face, 0, 0);
  return m;
}

export interface RestoreResult {
  canvas: HTMLCanvasElement;
  faces: number;
}

/** Restore every face in the image; returns a full-size result canvas. */
export async function restoreFaces(
  source: HTMLImageElement | HTMLCanvasElement,
  onProgress?: (p: RestoreProgress) => void
): Promise<RestoreResult> {
  const w = source instanceof HTMLImageElement ? source.naturalWidth : source.width;
  const h = source instanceof HTMLImageElement ? source.naturalHeight : source.height;

  onProgress?.({ phase: "detect" });
  const detector = await loadDetector();
  const det = detector.detect(source);
  const faces: { x: number; y: number }[][] = det?.faceLandmarks ?? [];
  if (!faces.length) return { canvas: toCanvas(source, w, h), faces: 0 };

  const { ort, session, inName, outName } = await loadGfpgan(onProgress);

  const out = toCanvas(source, w, h);
  const octx = out.getContext("2d")!;

  for (let f = 0; f < faces.length; f++) {
    onProgress?.({ phase: "restore", face: f + 1, total: faces.length });

    const pts = fivePoints(faces[f], w, h);
    const M = fitSimilarity(pts, TEMPLATE);

    // aligned 512 crop
    const crop = document.createElement("canvas");
    crop.width = SIZE; crop.height = SIZE;
    const cctx = crop.getContext("2d")!;
    cctx.imageSmoothingQuality = "high";
    applyTransform(cctx, M);
    cctx.drawImage(source, 0, 0);

    const feed = new ort.Tensor("float32", cropToTensor(crop), [1, 3, SIZE, SIZE]);
    const res = await session.run({ [inName]: feed });
    const restored = tensorToCanvas(res[outName].data as Float32Array);

    onProgress?.({ phase: "paste" });
    const masked = featherMask(restored);
    octx.save();
    octx.imageSmoothingQuality = "high";
    applyTransform(octx, invertSimilarity(M));
    octx.drawImage(masked, 0, 0);
    octx.restore();
  }

  return { canvas: out, faces: faces.length };
}

function toCanvas(source: HTMLImageElement | HTMLCanvasElement, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d")!.drawImage(source, 0, 0, w, h);
  return c;
}
