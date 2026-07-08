"use client";

/**
 * MediaPipe Face Landmarker wrapper — real-time 468-point face mesh, GPU
 * delegate, VIDEO mode. Self-hosted wasm + model so nothing leaves the tab
 * and CSP stays 'self'. One model powers two features: the landmark polygons
 * drive the beautify masks, and the landmark bounding box drives auto-framing.
 */

let landmarkerPromise: Promise<any> | null = null;

export interface FaceResult {
  /** normalized 0..1 landmark points [{x,y,z}], or null when no face this frame */
  points: { x: number; y: number }[] | null;
  /** tight face box in normalized coords */
  box: { cx: number; cy: number; w: number; h: number } | null;
}

/** Region index sets, derived once from MediaPipe's connection constants. */
export interface FaceRegions {
  oval: number[];
  leftEye: number[];
  rightEye: number[];
  lips: number[];
}
let regions: FaceRegions | null = null;

function ringIndices(connections: { start: number; end: number }[]): number[] {
  const set = new Set<number>();
  for (const c of connections) { set.add(c.start); set.add(c.end); }
  return [...set];
}

export function faceRegions(): FaceRegions | null {
  return regions;
}

export async function loadFaceTracker(onProgress?: (msg: string) => void) {
  if (landmarkerPromise) return landmarkerPromise;
  landmarkerPromise = (async () => {
    onProgress?.("Loading face tracker…");
    const vision: any = await import("@mediapipe/tasks-vision");
    const { FilesetResolver, FaceLandmarker } = vision;
    const fileset = await FilesetResolver.forVisionTasks("/mediapipe/wasm");
    let landmarker;
    try {
      landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate: "GPU" },
        runningMode: "VIDEO",
        numFaces: 1,
      });
    } catch (e) {
      console.warn("[face] GPU delegate failed, CPU fallback", e);
      landmarker = await FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: "/models/face_landmarker.task", delegate: "CPU" },
        runningMode: "VIDEO",
        numFaces: 1,
      });
    }
    regions = {
      oval: ringIndices(FaceLandmarker.FACE_LANDMARKS_FACE_OVAL),
      leftEye: ringIndices(FaceLandmarker.FACE_LANDMARKS_LEFT_EYE),
      rightEye: ringIndices(FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE),
      lips: ringIndices(FaceLandmarker.FACE_LANDMARKS_LIPS),
    };
    return landmarker;
  })();
  landmarkerPromise.catch(() => { landmarkerPromise = null; });
  return landmarkerPromise;
}

/** Detect one frame. `tsMs` must be monotonically increasing. */
export function detectFace(landmarker: any, video: HTMLVideoElement, tsMs: number): FaceResult {
  const out = landmarker.detectForVideo(video, tsMs);
  const lm = out?.faceLandmarks?.[0];
  if (!lm || !lm.length) return { points: null, box: null };
  let minX = 1, minY = 1, maxX = 0, maxY = 0;
  const points = new Array(lm.length);
  for (let i = 0; i < lm.length; i++) {
    const x = lm[i].x, y = lm[i].y;
    points[i] = { x, y };
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    points,
    box: { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY },
  };
}
