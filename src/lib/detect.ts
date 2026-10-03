"use client";

/**
 * Automatic object detection (RF-DETR medium, Apache-2.0) in-browser via
 * transformers.js.
 *
 * Runs once per frame so the user picks from real, labelled detections
 * ("person 98%", "cup 87%") instead of blindly clicking and hoping SAM
 * guesses the right object. Detections feed SAM as box prompts, which produce
 * far cleaner masks than a single click point. WebGPU with wasm fallback.
 *
 * Replaced DETR-ResNet-50: ~100ms vs ~350-500ms per frame on WebGPU (it also
 * runs every frame in the video tracker) with one clean box per object where
 * DETR emitted duplicates. fp32 only — the fp16 export returns no boxes, and
 * q8 is no faster on wasm. Input is fixed at 576px (position embeddings).
 */

import { tjsDevice } from "./gpuBackend";
import { registerModel } from "@/lib/modelRegistry";
import { rawImageFromCanvas } from "@/lib/sam2";

const DETECT_MODEL = "onnx-community/rfdetr_medium-ONNX";

export interface Detection {
  label: string;
  score: number;
  // normalized 0..1 relative to the source image
  box: { x1: number; y1: number; x2: number; y2: number };
}

let detectorPromise: Promise<any> | null = null;
registerModel(["/erase", "/rotoscope"], () => { const p = detectorPromise; detectorPromise = null; return p; });
let detectDevice: "webgpu" | "wasm" = "webgpu";

async function getTJ() {
  return (await import("@huggingface/transformers")) as any;
}

export function detectorDevice() {
  return detectDevice;
}

export async function loadDetector(onProgress?: (p: any) => void): Promise<any> {
  if (detectorPromise) return detectorPromise;
  detectorPromise = (async () => {
    const { pipeline, env } = await getTJ();
    env.allowLocalModels = false;
    const want = await tjsDevice(); // Safari <26 / unknown WebKit → wasm
    try {
      const det = await pipeline("object-detection", DETECT_MODEL, {
        device: want,
        dtype: "fp32",
        progress_callback: onProgress,
      });
      detectDevice = want;
      return det;
    } catch (e) {
      console.warn("[detect] webgpu failed, wasm fallback", e);
      const det = await pipeline("object-detection", DETECT_MODEL, {
        device: "wasm",
        dtype: "fp32",
        progress_callback: onProgress,
      });
      detectDevice = "wasm";
      return det;
    }
  })();
  return detectorPromise;
}

/** Detect objects in a canvas. Returns normalized boxes sorted by confidence. */
export async function detectObjects(
  canvas: HTMLCanvasElement,
  threshold = 0.5
): Promise<Detection[]> {
  const detector = await loadDetector();
  const raw = await rawImageFromCanvas(canvas);

  const w = canvas.width;
  const h = canvas.height;
  const out: any[] = await detector(raw, { threshold, percentage: false });

  return out
    .map((o) => ({
      label: String(o.label),
      score: o.score,
      box: {
        x1: o.box.xmin / w,
        y1: o.box.ymin / h,
        x2: o.box.xmax / w,
        y2: o.box.ymax / h,
      },
    }))
    // Drop degenerate boxes and near-full-frame "background" detections.
    .filter((d) => {
      const bw = d.box.x2 - d.box.x1;
      const bh = d.box.y2 - d.box.y1;
      return bw > 0.01 && bh > 0.01 && bw * bh < 0.98;
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);
}
