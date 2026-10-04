/**
 * Pure geometry for the OCR pipeline (no DOM, no ORT): DB post-processing of
 * the detector's probability map into rotated text boxes, rotated crops for
 * the recognizer, and reading order. Mirrors PaddleOCR's DBPostProcess +
 * get_rotate_crop_image closely enough that its thresholds carry over.
 */

export type Pt = [number, number];
/** Corners in reading order: top-left, top-right, bottom-right, bottom-left. */
export type Quad = [Pt, Pt, Pt, Pt];

/** RGBA pixels, row-major (ImageData-compatible). */
export interface Pixels { data: Uint8ClampedArray; width: number; height: number }

/** Rotated rectangle: centre, size, and unit axis `u` along the width (pointing right). */
export interface RotRect { cx: number; cy: number; w: number; h: number; ux: number; uy: number }

const cross = (o: Pt, a: Pt, b: Pt) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** Andrew's monotone chain. Returns the hull without the closing point. */
export function convexHull(points: Pt[]): Pt[] {
  if (points.length < 3) return points.slice();
  const pts = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const lower: Pt[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: Pt[] = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

/** Minimum-area enclosing rectangle of a convex hull (rotating calipers over hull edges). */
export function minAreaRect(hull: Pt[]): RotRect {
  if (hull.length === 0) return { cx: 0, cy: 0, w: 0, h: 0, ux: 1, uy: 0 };
  if (hull.length === 1) return { cx: hull[0][0], cy: hull[0][1], w: 0, h: 0, ux: 1, uy: 0 };
  let best = { area: Infinity, ex: 1, ey: 0, minU: 0, maxU: 0, minV: 0, maxV: 0 };
  const n = hull.length;
  for (let i = 0; i < n; i++) {
    const a = hull[i], b = hull[(i + 1) % n];
    let ex = b[0] - a[0], ey = b[1] - a[1];
    const len = Math.hypot(ex, ey);
    if (len < 1e-9) continue;
    ex /= len; ey /= len;
    let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
    for (const p of hull) {
      const u = p[0] * ex + p[1] * ey;
      const v = -p[0] * ey + p[1] * ex;
      if (u < minU) minU = u;
      if (u > maxU) maxU = u;
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    const area = (maxU - minU) * (maxV - minV);
    if (area < best.area) best = { area, ex, ey, minU, maxU, minV, maxV };
  }
  const { ex, ey, minU, maxU, minV, maxV } = best;
  const mu = (minU + maxU) / 2, mv = (minV + maxV) / 2;
  // back from (u, v) to image space: p = u·e + v·n, n = (-ey, ex)
  const cx = mu * ex - mv * ey;
  const cy = mu * ey + mv * ex;
  let w = maxU - minU, h = maxV - minV;
  // pick the axis that points most to the right as the width axis
  const cands: [number, number, boolean][] = [[ex, ey, false], [-ex, -ey, false], [-ey, ex, true], [ey, -ex, true]];
  let pick = cands[0];
  for (const c of cands) if (c[0] > pick[0]) pick = c;
  if (pick[2]) [w, h] = [h, w];
  return { cx, cy, w, h, ux: pick[0], uy: pick[1] };
}

export function rectToQuad(r: RotRect): Quad {
  const hw = r.w / 2, hh = r.h / 2;
  const vx = -r.uy, vy = r.ux; // perpendicular, pointing down
  return [
    [r.cx - r.ux * hw - vx * hh, r.cy - r.uy * hw - vy * hh],
    [r.cx + r.ux * hw - vx * hh, r.cy + r.uy * hw - vy * hh],
    [r.cx + r.ux * hw + vx * hh, r.cy + r.uy * hw + vy * hh],
    [r.cx - r.ux * hw + vx * hh, r.cy - r.uy * hw + vy * hh],
  ];
}

export interface DbOptions {
  /** pixel threshold on the probability map */
  thresh?: number;
  /** minimum mean probability of a component */
  boxThresh?: number;
  unclipRatio?: number;
  minSize?: number;
  maxCandidates?: number;
}

/**
 * DB post-process: threshold → 8-connected components → mean-score filter →
 * convex hull → min-area rect → unclip (offset by area·ratio/perimeter).
 * Returns rects in probability-map pixel coordinates.
 */
export function dbPostprocess(prob: Float32Array, W: number, H: number, opts: DbOptions = {}): { rect: RotRect; score: number }[] {
  const thresh = opts.thresh ?? 0.3;
  const boxThresh = opts.boxThresh ?? 0.6;
  const unclipRatio = opts.unclipRatio ?? 1.5;
  const minSize = opts.minSize ?? 3;
  const maxCandidates = opts.maxCandidates ?? 1000;

  const N = W * H;
  const seen = new Uint8Array(N);
  const stack = new Int32Array(N);
  const members = new Int32Array(N);
  const out: { rect: RotRect; score: number }[] = [];

  for (let start = 0; start < N; start++) {
    if (seen[start] || prob[start] <= thresh) continue;
    // flood fill (8-connectivity ≈ cv2.findContours external outlines)
    let sp = 0, count = 0, sum = 0;
    let minX = W, maxX = 0, minY = H, maxY = 0;
    stack[sp++] = start;
    seen[start] = 1;
    while (sp > 0) {
      const idx = stack[--sp];
      members[count++] = idx;
      sum += prob[idx];
      const y = (idx / W) | 0, x = idx - y * W;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= W) continue;
          const ni = ny * W + nx;
          if (!seen[ni] && prob[ni] > thresh) { seen[ni] = 1; stack[sp++] = ni; }
        }
      }
    }
    if (maxX - minX + 1 < minSize && maxY - minY + 1 < minSize) continue;
    const score = sum / count;
    if (score < boxThresh) continue;

    // hull of a pixel set = hull of each row's extremes
    const rows = maxY - minY + 1;
    const rowMin = new Int32Array(rows).fill(W);
    const rowMax = new Int32Array(rows).fill(-1);
    for (let k = 0; k < count; k++) {
      const idx = members[k];
      const y = (idx / W) | 0, x = idx - y * W, r = y - minY;
      if (x < rowMin[r]) rowMin[r] = x;
      if (x > rowMax[r]) rowMax[r] = x;
    }
    const pts: Pt[] = [];
    for (let r = 0; r < rows; r++) {
      if (rowMax[r] < 0) continue;
      pts.push([rowMin[r], minY + r]);
      if (rowMax[r] !== rowMin[r]) pts.push([rowMax[r], minY + r]);
    }
    const rect = minAreaRect(convexHull(pts));
    if (Math.min(rect.w, rect.h) < minSize) continue;

    // pyclipper round-offset of a rectangle → its min-area rect grows by d on every side
    const d = (rect.w * rect.h * unclipRatio) / (2 * (rect.w + rect.h));
    rect.w += 2 * d;
    rect.h += 2 * d;
    if (Math.min(rect.w, rect.h) < minSize + 2) continue;
    out.push({ rect, score });
    if (out.length >= maxCandidates) break;
  }
  return out;
}

/** Scale a quad from map space to image space and clamp it inside the image. */
export function scaleQuad(q: Quad, sx: number, sy: number, W: number, H: number): Quad {
  return q.map(([x, y]) => [
    Math.min(W, Math.max(0, x * sx)),
    Math.min(H, Math.max(0, y * sy)),
  ]) as Quad;
}

const dist = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Box size as the recognizer will read it (PaddleOCR: max of opposite sides). */
export function quadSize(q: Quad): { w: number; h: number } {
  return {
    w: Math.max(dist(q[0], q[1]), dist(q[3], q[2])),
    h: Math.max(dist(q[0], q[3]), dist(q[1], q[2])),
  };
}

/** Same box seen rotated 90° counter-clockwise (np.rot90 on the crop) — for vertical text. */
export const rotateQuadCCW = (q: Quad): Quad => [q[1], q[2], q[3], q[0]];

/**
 * Sample the parallelogram `q` into a `outW`×`outH` RGB patch and write it,
 * normalised for the recognizer ((v/255 − 0.5)/0.5, BGR planes), into `dst`
 * at item offset `off` of a [N,3,outH,stride] tensor. Bilinear with k×k
 * supersampling when the source is larger than the patch, so big text
 * shrinks without aliasing.
 */
export function cropToTensor(
  px: Pixels, q: Quad, outW: number, outH: number,
  dst: Float32Array, off: number, stride: number
): void {
  const { data, width: W, height: H } = px;
  const [p0, p1, , p3] = q;
  const ax = p1[0] - p0[0], ay = p1[1] - p0[1]; // along width
  const bx = p3[0] - p0[0], by = p3[1] - p0[1]; // along height
  const { w, h } = quadSize(q);
  const k = Math.max(1, Math.min(4, Math.ceil(Math.max(w / outW, h / outH))));
  const plane = outH * stride;
  const inv = 1 / (k * k * 127.5);
  for (let j = 0; j < outH; j++) {
    for (let i = 0; i < outW; i++) {
      let r = 0, g = 0, b = 0;
      for (let sj = 0; sj < k; sj++) {
        const t = (j + (sj + 0.5) / k) / outH;
        for (let si = 0; si < k; si++) {
          const s = (i + (si + 0.5) / k) / outW;
          // pixel centres sit at +0.5
          let x = p0[0] + s * ax + t * bx - 0.5;
          let y = p0[1] + s * ay + t * by - 0.5;
          if (x < 0) x = 0; else if (x > W - 1) x = W - 1;
          if (y < 0) y = 0; else if (y > H - 1) y = H - 1;
          const x0 = x | 0, y0 = y | 0;
          const x1 = x0 + 1 < W ? x0 + 1 : x0, y1 = y0 + 1 < H ? y0 + 1 : y0;
          const fx = x - x0, fy = y - y0;
          const i00 = (y0 * W + x0) * 4, i01 = (y0 * W + x1) * 4, i10 = (y1 * W + x0) * 4, i11 = (y1 * W + x1) * 4;
          const w00 = (1 - fx) * (1 - fy), w01 = fx * (1 - fy), w10 = (1 - fx) * fy, w11 = fx * fy;
          r += data[i00] * w00 + data[i01] * w01 + data[i10] * w10 + data[i11] * w11;
          g += data[i00 + 1] * w00 + data[i01 + 1] * w01 + data[i10 + 1] * w10 + data[i11 + 1] * w11;
          b += data[i00 + 2] * w00 + data[i01 + 2] * w01 + data[i10 + 2] * w10 + data[i11 + 2] * w11;
        }
      }
      const o = off + j * stride + i;
      dst[o] = b * inv - 1;
      dst[o + plane] = g * inv - 1;
      dst[o + 2 * plane] = r * inv - 1;
    }
  }
}

/**
 * Resize RGBA → detector tensor [1,3,dh,dw]: BGR planes, ImageNet mean/std
 * applied in B,G,R order (PaddleOCR's quirk — the model was trained that
 * way). Bilinear; area-averaged when shrinking by more than 1.5×.
 */
export function detTensor(px: Pixels, dw: number, dh: number): Float32Array {
  const { data, width: W, height: H } = px;
  const out = new Float32Array(3 * dw * dh);
  const plane = dw * dh;
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  const sx = W / dw, sy = H / dh;
  const k = Math.max(1, Math.min(3, Math.round(Math.max(sx, sy))));
  const inv = 1 / (k * k * 255);
  for (let j = 0; j < dh; j++) {
    for (let i = 0; i < dw; i++) {
      let r = 0, g = 0, b = 0;
      for (let sj = 0; sj < k; sj++) {
        let y = (j + (sj + 0.5) / k) * sy - 0.5;
        if (y < 0) y = 0; else if (y > H - 1) y = H - 1;
        const y0 = y | 0, y1 = y0 + 1 < H ? y0 + 1 : y0, fy = y - y0;
        for (let si = 0; si < k; si++) {
          let x = (i + (si + 0.5) / k) * sx - 0.5;
          if (x < 0) x = 0; else if (x > W - 1) x = W - 1;
          const x0 = x | 0, x1 = x0 + 1 < W ? x0 + 1 : x0, fx = x - x0;
          const i00 = (y0 * W + x0) * 4, i01 = (y0 * W + x1) * 4, i10 = (y1 * W + x0) * 4, i11 = (y1 * W + x1) * 4;
          const w00 = (1 - fx) * (1 - fy), w01 = fx * (1 - fy), w10 = (1 - fx) * fy, w11 = fx * fy;
          r += data[i00] * w00 + data[i01] * w01 + data[i10] * w10 + data[i11] * w11;
          g += data[i00 + 1] * w00 + data[i01 + 1] * w01 + data[i10 + 1] * w10 + data[i11 + 1] * w11;
          b += data[i00 + 2] * w00 + data[i01 + 2] * w01 + data[i10 + 2] * w10 + data[i11 + 2] * w11;
        }
      }
      const o = j * dw + i;
      out[o] = (b * inv - mean[0]) / std[0];
      out[o + plane] = (g * inv - mean[1]) / std[1];
      out[o + 2 * plane] = (r * inv - mean[2]) / std[2];
    }
  }
  return out;
}

export interface Placed { quad: Quad; text: string; score: number }

export interface OcrRow { text: string; boxes: number[]; gapBefore: boolean }

/**
 * Reading order: deskew by the dominant text angle, sort by vertical centre,
 * put a box on the current line if its centre is within half the smaller
 * height, order each line left→right. Boxes in a line join with a space;
 * a large vertical gap marks a paragraph break.
 */
export function readingOrder(items: Placed[]): OcrRow[] {
  if (!items.length) return [];
  const geo = items.map((it) => {
    const [p0, p1, p2, p3] = it.quad;
    const { w, h } = quadSize(it.quad);
    return {
      cx: (p0[0] + p1[0] + p2[0] + p3[0]) / 4,
      cy: (p0[1] + p1[1] + p2[1] + p3[1]) / 4,
      w, h,
      ang: Math.atan2(p1[1] - p0[1], p1[0] - p0[0]),
    };
  });
  // dominant skew from line-shaped boxes, width-weighted median
  const lineish = geo.filter((g) => g.w > 2 * g.h).sort((a, b) => a.ang - b.ang);
  let skew = 0;
  if (lineish.length) {
    const total = lineish.reduce((s, g) => s + g.w, 0);
    let acc = 0;
    for (const g of lineish) { acc += g.w; if (acc >= total / 2) { skew = g.ang; break; } }
  }
  const c = Math.cos(-skew), s = Math.sin(-skew);
  const boxes = geo.map((g, i) => ({
    i, w: g.w, h: g.h,
    x: g.cx * c - g.cy * s,
    y: g.cx * s + g.cy * c,
  }));
  boxes.sort((a, b) => a.y - b.y);

  type Line = { members: typeof boxes; y: number; h: number };
  const lines: Line[] = [];
  for (const b of boxes) {
    // nearest open line among the last few (a tall box can sit between two short ones)
    let target: Line | null = null;
    for (let k = lines.length - 1; k >= Math.max(0, lines.length - 3); k--) {
      const L = lines[k];
      if (Math.abs(b.y - L.y) < 0.5 * Math.min(b.h, L.h)) { target = L; break; }
    }
    if (target) {
      target.members.push(b);
      const n = target.members.length;
      target.y += (b.y - target.y) / n;
      target.h += (b.h - target.h) / n;
    } else {
      lines.push({ members: [b], y: b.y, h: b.h });
    }
  }
  lines.sort((a, b) => a.y - b.y);

  const rows: OcrRow[] = [];
  let prev: Line | null = null;
  for (const L of lines) {
    L.members.sort((a, b) => a.x - b.x);
    let text = "";
    let lastRight = 0;
    for (const m of L.members) {
      const t = items[m.i].text;
      if (!t) continue;
      if (text) {
        const gap = m.x - m.w / 2 - lastRight;
        // wide gaps are table columns — keep them visibly apart
        text += gap > 2.5 * L.h ? "    " : " ";
      }
      text += t;
      lastRight = m.x + m.w / 2;
    }
    if (!text) continue;
    const gapBefore = !!prev && L.y - L.h / 2 - (prev.y + prev.h / 2) > 1.1 * Math.min(L.h, prev.h);
    rows.push({ text, boxes: L.members.map((m) => m.i), gapBefore });
    prev = L;
  }
  return rows;
}
