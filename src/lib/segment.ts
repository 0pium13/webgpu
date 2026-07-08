"use client";

/**
 * MediaPipe Selfie Segmenter — real-time person/background mask (249KB model,
 * GPU delegate). Drives the background-blur "bokeh" that gives the DSLR look.
 * Self-hosted so nothing leaves the tab.
 *
 * We read the confidence mask into a reusable Uint8 buffer (person=255) that
 * the WebGL engine uploads as a single-channel texture each frame.
 */

let segmenterPromise: Promise<any> | null = null;

export async function loadSegmenter(onProgress?: (msg: string) => void) {
  if (segmenterPromise) return segmenterPromise;
  segmenterPromise = (async () => {
    onProgress?.("Loading background AI…");
    const vision: any = await import("@mediapipe/tasks-vision");
    const { FilesetResolver, ImageSegmenter } = vision;
    const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
    const opts = {
      baseOptions: { modelAssetPath: "/models/selfie_segmenter.tflite", delegate: "GPU" as const },
      runningMode: "VIDEO" as const,
      outputConfidenceMasks: true,
      outputCategoryMask: false,
    };
    try {
      return await ImageSegmenter.createFromOptions(fileset, opts);
    } catch (e) {
      console.warn("[segment] GPU delegate failed, CPU fallback", e);
      return await ImageSegmenter.createFromOptions(fileset, { ...opts, baseOptions: { ...opts.baseOptions, delegate: "CPU" } });
    }
  })();
  segmenterPromise.catch(() => { segmenterPromise = null; });
  return segmenterPromise;
}

export interface PersonMask {
  data: Uint8Array;  // person confidence 0..255, row-major
  width: number;
  height: number;
}

/** Segment one frame. Returns the person mask, or null if unavailable. */
export function segmentFrame(segmenter: any, video: HTMLVideoElement, tsMs: number): PersonMask | null {
  const res = segmenter.segmentForVideo(video, tsMs);
  const mask = res?.confidenceMasks?.[0];
  if (!mask) return null;
  const f = mask.getAsFloat32Array();       // 0..1 person confidence
  const w = mask.width, h = mask.height;
  const out = new Uint8Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = f[i] * 255;
  mask.close();
  return { data: out, width: w, height: h };
}
