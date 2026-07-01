"use client";

/**
 * Hybrid video object tracker — follows a selected object across every frame.
 *
 * SAM2's ONNX exports don't include the memory graphs that power its learned
 * video propagation, so we drive the per-frame SAM2 segmenter (sam2.ts) with
 * our own tracking logic:
 *
 *   1. Detection re-association (primary): each frame, re-detect objects and
 *      match the same-class box that overlaps the previous frame's box most.
 *      This is drift-free and survives brief occlusion / reappearance.
 *   2. Mask propagation (fallback): when detection can't find the object
 *      (uncommon class, or a manual selection with no label), seed SAM2 with
 *      points sampled from the previous frame's mask.
 *
 * A confidence value + method is reported per frame so the UI can flag drift
 * and let the user drop a correction.
 */

import {
  embedImage, rawImageFromCanvas, decodeFromBox, decodeMask,
  type MaskResult, type SamPoint,
} from "@/lib/sam2";
import { detectObjects } from "@/lib/detect";

export interface Box { x1: number; y1: number; x2: number; y2: number }

export interface TrackInit {
  label?: string;   // COCO label when the object came from detection
  box: Box;         // normalized initial box (frame 0)
}

export interface FrameResult {
  frame: number;
  time: number;
  mask: MaskResult;
  box: Box;
  method: "detect" | "propagate";
  confidence: number;   // 0..1
  lost: boolean;        // true when the tracker likely lost the object
}

export interface TrackOptions {
  video: HTMLVideoElement;
  dims: { w: number; h: number };
  init: TrackInit;
  fps: number;
  onFrame: (r: FrameResult, done: number, total: number) => void;
  shouldAbort: () => boolean;
}

// ── geometry helpers ────────────────────────────────────────────────────────

function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy;
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1);
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1);
  const uni = areaA + areaB - inter;
  return uni > 0 ? inter / uni : 0;
}

function maskArea(m: MaskResult): number {
  let n = 0;
  for (let i = 0; i < m.data.length; i++) if (m.data[i]) n++;
  return n;
}

/** Normalized bounding box of a mask. Returns null for an empty mask. */
function bboxOfMask(m: MaskResult): Box | null {
  let minX = m.width, minY = m.height, maxX = -1, maxY = -1;
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      if (m.data[y * m.width + x]) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  return { x1: minX / m.width, y1: minY / m.height, x2: maxX / m.width, y2: maxY / m.height };
}

/** A handful of positive prompt points sampled from inside a mask. */
function pointsFromMask(m: MaskResult): SamPoint[] {
  // centroid
  let sx = 0, sy = 0, n = 0;
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      if (m.data[y * m.width + x]) { sx += x; sy += y; n++; }
    }
  }
  if (!n) return [];
  const pts: SamPoint[] = [{ x: sx / n / m.width, y: sy / n / m.height, label: 1 }];

  // a few interior samples toward the mask's quadrant extremes for robustness
  const bb = bboxOfMask(m);
  if (bb) {
    const cands = [
      { x: (bb.x1 + bb.x2) / 2, y: bb.y1 + (bb.y2 - bb.y1) * 0.3 },
      { x: bb.x1 + (bb.x2 - bb.x1) * 0.35, y: (bb.y1 + bb.y2) / 2 },
      { x: bb.x1 + (bb.x2 - bb.x1) * 0.65, y: (bb.y1 + bb.y2) / 2 },
    ];
    for (const c of cands) {
      const px = Math.round(c.x * m.width), py = Math.round(c.y * m.height);
      if (m.data[py * m.width + px]) pts.push({ x: c.x, y: c.y, label: 1 });
    }
  }
  return pts;
}

async function seekToFrame(video: HTMLVideoElement, t: number): Promise<void> {
  if (Math.abs(video.currentTime - t) < 0.002) return;
  await new Promise<void>((resolve) => {
    const h = () => { video.removeEventListener("seeked", h); resolve(); };
    video.addEventListener("seeked", h);
    video.currentTime = t;
  });
}

// ── the tracker ──────────────────────────────────────────────────────────────

export async function trackObject(opts: TrackOptions): Promise<FrameResult[]> {
  const { video, dims, init, fps, onFrame, shouldAbort } = opts;
  const duration = video.duration || 1;
  const total = Math.max(1, Math.ceil(duration * fps));

  const work = document.createElement("canvas");
  work.width = dims.w; work.height = dims.h;
  const wctx = work.getContext("2d", { willReadFrequently: true })!;

  const results: FrameResult[] = [];
  let prevBox: Box = init.box;
  let prevMask: MaskResult | null = null;
  let prevArea = 0;

  for (let i = 0; i < total; i++) {
    if (shouldAbort()) break;
    const t = Math.min(duration, i / fps);
    await seekToFrame(video, t);
    wctx.drawImage(video, 0, 0, dims.w, dims.h);

    const raw = await rawImageFromCanvas(work);
    const session = await embedImage(raw);

    let mask: MaskResult;
    let box: Box;
    let method: "detect" | "propagate";
    let confidence: number;

    // 1) try detection re-association (needs a known class)
    let matchedBox: Box | null = null;
    let matchScore = 0;
    if (init.label) {
      try {
        const dets = await detectObjects(work, 0.35);
        let bestIoU = 0.1; // require a minimum overlap to accept
        for (const d of dets) {
          if (d.label !== init.label) continue;
          const o = iou(d.box, prevBox);
          if (o > bestIoU) { bestIoU = o; matchedBox = d.box; matchScore = d.score; }
        }
      } catch { /* detection failed — fall through to propagation */ }
    }

    if (matchedBox) {
      mask = await decodeFromBox(session, matchedBox);
      box = matchedBox;
      method = "detect";
      confidence = Math.min(matchScore, mask.score);
    } else if (prevMask) {
      // 2) propagate from the previous mask
      const pts = pointsFromMask(prevMask);
      mask = pts.length ? await decodeMask(session, pts) : await decodeFromBox(session, prevBox);
      box = bboxOfMask(mask) ?? prevBox;
      method = "propagate";
      confidence = mask.score;
    } else {
      // first frame with no prior mask — use the initial box directly
      mask = await decodeFromBox(session, init.box);
      box = bboxOfMask(mask) ?? init.box;
      method = "detect";
      confidence = mask.score;
    }

    // drift / loss sanity: sudden large area change vs the last good frame
    const area = maskArea(mask);
    const ratio = prevArea > 0 ? area / prevArea : 1;
    const lost = area === 0 || ratio < 0.15 || ratio > 6;

    if (lost && prevMask) {
      // keep the last good mask rather than emit garbage
      mask = prevMask; box = prevBox;
    } else {
      prevMask = mask; prevBox = box; prevArea = area;
    }

    const r: FrameResult = { frame: i, time: t, mask, box, method, confidence, lost };
    results.push(r);
    onFrame(r, i + 1, total);
    await new Promise((res) => setTimeout(res, 0)); // yield to UI / GPU queue
  }

  return results;
}
