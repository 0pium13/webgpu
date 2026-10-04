"use client";

import type { FaceLandmarker } from "@mediapipe/tasks-vision";
import { registerModel } from "@/lib/modelRegistry";
import { makeCanvas } from "@/lib/examImage";

/**
 * Face box for auto-framing exam photos. Reuses the self-hosted MediaPipe
 * Face Landmarker (same wasm + .task the webcam/upscale tools ship) in
 * IMAGE mode, so no extra model download and nothing leaves the tab.
 */

let landmarkerPromise: Promise<FaceLandmarker> | null = null;
registerModel(["/exam-photo"], () => { const p = landmarkerPromise; landmarkerPromise = null; return p; });

function load() {
  if (landmarkerPromise) return landmarkerPromise;
  landmarkerPromise = (async () => {
    const { FilesetResolver, FaceLandmarker } = await import("@mediapipe/tasks-vision");
    const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
    const opts = (delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate },
      runningMode: "IMAGE" as const,
      numFaces: 3,
    });
    try {
      return await FaceLandmarker.createFromOptions(fileset, opts("GPU"));
    } catch (e) {
      console.warn("[exam-photo] GPU delegate failed, CPU fallback", e);
      return await FaceLandmarker.createFromOptions(fileset, opts("CPU"));
    }
  })();
  landmarkerPromise.catch(() => { landmarkerPromise = null; });
  return landmarkerPromise;
}

/** In source-canvas pixels: landmark top (≈ hairline), chin, centre x. */
export interface FaceBox { top: number; chin: number; cx: number; left: number; right: number }

const DETECT_MAX = 1024;

export async function detectFace(src: HTMLCanvasElement): Promise<FaceBox | null> {
  const landmarker = await load();
  const s = Math.min(1, DETECT_MAX / Math.max(src.width, src.height));
  let input = src;
  if (s < 1) {
    input = makeCanvas(src.width * s, src.height * s);
    input.getContext("2d")!.drawImage(src, 0, 0, input.width, input.height);
  }
  const res = landmarker.detect(input);
  let best: FaceBox | null = null;
  let bestArea = 0;
  for (const lm of res.faceLandmarks ?? []) {
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const p of lm) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const area = (maxX - minX) * (maxY - minY);
    if (area <= bestArea) continue;
    bestArea = area;
    best = {
      top: minY * src.height,
      chin: maxY * src.height,
      cx: ((minX + maxX) / 2) * src.width,
      left: minX * src.width,
      right: maxX * src.width,
    };
  }
  return best;
}
