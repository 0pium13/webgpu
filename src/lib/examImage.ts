"use client";

/**
 * Pixel work for the exam photo tool: load + orient, crop math, high-quality
 * downscale, signature/thumb cleanup, name+date strip, and a JPEG encoder
 * that lands inside a KB window and stamps the JFIF DPI. All canvas, no deps.
 */

export interface Crop { x: number; y: number; w: number }
export interface Box { x: number; y: number; w: number; h: number }

/** Longest side we keep for editing — more than any exam output needs. */
const WORK_MAX = 2000;

export function makeCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Decode with EXIF orientation applied, capped to WORK_MAX. */
export async function loadImage(file: Blob): Promise<HTMLCanvasElement> {
  let src: CanvasImageSource & { width: number; height: number };
  try {
    src = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      src = img;
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  const s = Math.min(1, WORK_MAX / Math.max(src.width, src.height));
  const out = makeCanvas(src.width * s, src.height * s);
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, out.width, out.height);
  if ("close" in src && typeof src.close === "function") src.close();
  return out;
}

// ── crop math ───────────────────────────────────────────────────────────

export interface CropLimits { minW: number; maxW: number }

export function cropLimits(imgW: number, imgH: number, aspect: number, outW: number, contain: boolean): CropLimits {
  // contain (documents): may zoom out past the image, white fills the rest
  const maxW = contain ? Math.max(imgW, imgH * aspect) * 1.5 : Math.min(imgW, imgH * aspect);
  const minW = Math.min(maxW, Math.max(32, outW * 0.5));
  return { minW, maxW };
}

export function clampCrop(c: Crop, aspect: number, imgW: number, imgH: number, lim: CropLimits, contain: boolean): Crop {
  const w = Math.min(Math.max(c.w, lim.minW), lim.maxW);
  const h = w / aspect;
  let { x, y } = c;
  if (contain) {
    // keep at least a sliver of the image in frame
    x = Math.min(Math.max(x, -w * 0.85), imgW - w * 0.15);
    y = Math.min(Math.max(y, -h * 0.85), imgH - h * 0.15);
  } else {
    x = w <= imgW ? Math.min(Math.max(x, 0), imgW - w) : (imgW - w) / 2;
    y = h <= imgH ? Math.min(Math.max(y, 0), imgH - h) : (imgH - h) / 2;
  }
  return { x, y, w };
}

/** Passport framing: head = `face` of the height, a little more air below the chin than above the crown. */
export function frameFace(face: { top: number; chin: number; cx: number }, aspect: number, imgW: number, imgH: number, frac: number): Crop {
  const len = face.chin - face.top;
  // landmark top sits around the hairline; the crown is ~30% of a face-length higher
  const crown = face.top - len * 0.3;
  const head = face.chin - crown;
  let h = head / frac;
  h = Math.min(h, imgH, imgW / aspect);
  const w = h * aspect;
  const y = crown - (h - head) * 0.4;
  return { x: face.cx - w / 2, y, w };
}

/** Fit an ink bounding box into the output aspect, ink filling `fill` of the tighter side. */
export function frameInk(b: Box, aspect: number, fill: number): Crop {
  let w = b.w / fill;
  let h = b.h / fill;
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  return { x: b.x + b.w / 2 - w / 2, y: b.y + b.h / 2 - h / 2, w };
}

/** No face found: centred crop biased to the upper part of the frame. */
export function frameDefault(imgW: number, imgH: number, aspect: number): Crop {
  const w = Math.min(imgW, imgH * aspect) * 0.9;
  const h = w / aspect;
  return { x: (imgW - w) / 2, y: Math.max(0, (imgH - h) * 0.3), w };
}

// ── drawing ─────────────────────────────────────────────────────────────

/**
 * Draw the crop of `src` into dst rect with stepwise halving, so a 2000px
 * phone photo shrinking to 140px stays smooth instead of aliasing.
 * Parts of the crop outside the image stay as whatever dst already holds.
 */
export function drawCrop(ctx: CanvasRenderingContext2D, src: HTMLCanvasElement, crop: Crop, aspect: number, dx: number, dy: number, dw: number, dh: number) {
  const ch = crop.w / aspect;
  const sx0 = Math.max(0, crop.x), sy0 = Math.max(0, crop.y);
  const sx1 = Math.min(src.width, crop.x + crop.w), sy1 = Math.min(src.height, crop.y + ch);
  if (sx1 <= sx0 || sy1 <= sy0) return;
  const kx = dw / crop.w, ky = dh / ch;
  const tx = dx + (sx0 - crop.x) * kx, ty = dy + (sy0 - crop.y) * ky;
  const tw = (sx1 - sx0) * kx, th = (sy1 - sy0) * ky;

  let img: HTMLCanvasElement = src;
  let rx = sx0, ry = sy0, rw = sx1 - sx0, rh = sy1 - sy0;
  while (rw > tw * 2 && rh > th * 2) {
    const step = makeCanvas(rw / 2, rh / 2);
    const sctx = step.getContext("2d")!;
    sctx.imageSmoothingQuality = "high";
    sctx.drawImage(img, rx, ry, rw, rh, 0, 0, step.width, step.height);
    img = step; rx = 0; ry = 0; rw = step.width; rh = step.height;
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, rx, ry, rw, rh, tx, ty, tw, th);
}

/** Height of the name/date strip for an output of this size. */
export const stripHeight = (outW: number, outH: number) =>
  Math.round(Math.min(outH * 0.17, outW * 0.24));

export function drawStrip(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, name: string, date: string) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(x, y, w, h);
  ctx.fillStyle = "#000000";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = [name.trim().toUpperCase(), date.trim()].filter(Boolean);
  if (!lines.length) return;
  const pad = w * 0.05;
  const lineH = h / (lines.length + 0.35);
  lines.forEach((text, i) => {
    let size = lineH * (i === 0 ? 0.78 : 0.7);
    const font = (s: number) => `${i === 0 ? 700 : 600} ${s}px Arial, Helvetica, sans-serif`;
    ctx.font = font(size);
    const tw = ctx.measureText(text).width;
    if (tw > w - pad * 2) {
      size *= (w - pad * 2) / tw;
      ctx.font = font(size);
    }
    ctx.fillText(text, x + w / 2, y + lineH * (i + 0.675));
  });
}

/** Mean border luminance + how many border pixels are "not white". */
export function backgroundCheck(canvas: HTMLCanvasElement): { lum: number; dark: number } {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const { width: w, height: h } = canvas;
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.05));
  let sum = 0, n = 0, dark = 0;
  const regions: [number, number, number, number][] = [
    [0, 0, w, band], [0, 0, band, Math.round(h * 0.6)], [w - band, 0, band, Math.round(h * 0.6)],
  ];
  for (const [rx, ry, rw, rh] of regions) {
    const d = ctx.getImageData(rx, ry, rw, rh).data;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      sum += l; n++;
      if (l < 200 || Math.max(d[i], d[i + 1], d[i + 2]) - Math.min(d[i], d[i + 1], d[i + 2]) > 40) dark++;
    }
  }
  return { lum: sum / Math.max(1, n), dark: dark / Math.max(1, n) };
}

/** Composite the photo over white using an alpha mask (RMBG output). */
export function whiten(src: HTMLCanvasElement, mask: { data: Uint8Array; width: number; height: number }): HTMLCanvasElement {
  const out = makeCanvas(src.width, src.height);
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const d = img.data;
  const sameSize = mask.width === out.width && mask.height === out.height;
  for (let y = 0, i = 0; y < out.height; y++) {
    const my = sameSize ? y : Math.min(mask.height - 1, Math.floor((y * mask.height) / out.height));
    for (let x = 0; x < out.width; x++, i++) {
      const mx = sameSize ? x : Math.min(mask.width - 1, Math.floor((x * mask.width) / out.width));
      // slight gamma on alpha keeps hair edges from going grey
      const a = Math.pow(mask.data[my * mask.width + mx] / 255, 0.8);
      const p = i * 4;
      d[p] = d[p] * a + 255 * (1 - a);
      d[p + 1] = d[p + 1] * a + 255 * (1 - a);
      d[p + 2] = d[p + 2] * a + 255 * (1 - a);
    }
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

// ── ink cleanup (signature / thumb / declaration) ───────────────────────

const INK_MAX = 1600;

export interface InkResult { canvas: HTMLCanvasElement; box: Box | null; scale: number }

/**
 * Flat-field the paper (divide by a blurred max-filtered background, so
 * shadows and gradients vanish), then either threshold to crisp black ink
 * with a soft anti-aliased edge (signature) or keep the ink colour with
 * stretched levels (thumb). Specks are dropped; returns the ink bbox.
 * `strength` 0..1 — higher keeps fainter strokes.
 */
export function cleanInk(src: HTMLCanvasElement, strength: number, keepColor: boolean): InkResult {
  const scale = Math.min(1, INK_MAX / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale)), h = Math.max(1, Math.round(src.height * scale));
  const out = makeCanvas(w, h);
  const ctx = out.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(src, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;

  // background per channel on a coarse grid: block max → 3×3 max → 2× box blur
  const cell = Math.max(4, Math.round(Math.max(w, h) / 120));
  const gw = Math.ceil(w / cell), gh = Math.ceil(h / cell);
  const grids = [new Float32Array(gw * gh), new Float32Array(gw * gh), new Float32Array(gw * gh)];
  for (let y = 0; y < h; y++) {
    const gy = Math.floor(y / cell) * gw;
    for (let x = 0; x < w; x++) {
      const gi = gy + Math.floor(x / cell), p = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) if (d[p + c] > grids[c][gi]) grids[c][gi] = d[p + c];
    }
  }
  const bg = grids.map((g) => blurGrid(maxGrid(g, gw, gh), gw, gh));

  // normalised darkness per pixel
  const n = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / cell - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(gh - 1, y0 + 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / cell - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(gw - 1, x0 + 1), tx = fx - x0;
      const p = (y * w + x) * 4;
      let mn = 2, lum = 0;
      for (let c = 0; c < 3; c++) {
        const g = bg[c];
        const b = (g[y0 * gw + x0] * (1 - tx) + g[y0 * gw + x1] * tx) * (1 - ty)
          + (g[y1 * gw + x0] * (1 - tx) + g[y1 * gw + x1] * tx) * ty;
        const v = Math.min(1.2, d[p + c] / Math.max(24, b));
        if (keepColor) d[p + c] = Math.min(255, v * 255);
        if (v < mn) mn = v;
        lum += v * (c === 0 ? 0.299 : c === 1 ? 0.587 : 0.114);
      }
      n[y * w + x] = (mn + lum) / 2;
    }
  }

  // ink mask + connected components (drop specks, find the ink box)
  const t = 0.6 + 0.28 * strength;
  const label = new Int32Array(w * h);
  const minArea = Math.max(6, Math.round(w * h * 0.00001));
  const stack = new Int32Array(w * h);
  const comps: { area: number; x0: number; y0: number; x1: number; y1: number; edge: boolean; id: number }[] = [];
  let next = 0;
  for (let i = 0; i < w * h; i++) {
    if (n[i] >= t || label[i]) continue;
    const id = ++next;
    let sp = 0, area = 0, x0 = w, y0 = h, x1 = 0, y1 = 0, edge = false;
    stack[sp++] = i; label[i] = id;
    while (sp) {
      const j = stack[--sp];
      const x = j % w, y = (j - x) / w;
      area++;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
        const k = yy * w + xx;
        if (!label[k] && n[k] < t) { label[k] = id; stack[sp++] = k; }
      }
    }
    comps.push({ area, x0, y0, x1, y1, edge, id });
  }
  const keep = new Uint8Array(next + 1);
  for (const c of comps) if (c.area >= minArea) keep[c.id] = 1;

  // The paper's own edge against a darker table reads as ink: long and
  // straight, so nearly all its pixels hug its own bounding box. Drop those.
  // band scales with the component so a slightly tilted sheet still counts
  const hug = new Int32Array(next + 1);
  const band = new Float32Array(next + 1);
  const byId = new Array<(typeof comps)[number]>(next + 1);
  for (const c of comps) {
    byId[c.id] = c;
    band[c.id] = Math.max(3, Math.max(c.x1 - c.x0, c.y1 - c.y0) * 0.035);
  }
  for (let i = 0; i < w * h; i++) {
    const id = label[i];
    if (!id || !keep[id]) continue;
    const c = byId[id], b = band[id], x = i % w, y = (i - x) / w;
    if (x - c.x0 < b || c.x1 - x < b || y - c.y0 < b || c.y1 - y < b) hug[id]++;
  }
  for (const c of comps) {
    if (!keep[c.id]) continue;
    const long = c.x1 - c.x0 > w * 0.45 || c.y1 - c.y0 > h * 0.45;
    if (long && hug[c.id] > c.area * 0.85) keep[c.id] = 0;
  }

  // paper edges / table corners touch the border — ignore them for the box
  // unless they ARE most of the ink (a tightly cropped signature)
  const kept = comps.filter((c) => keep[c.id]);
  const inner = kept.filter((c) => !c.edge);
  const innerArea = inner.reduce((s, c) => s + c.area, 0);
  const allArea = kept.reduce((s, c) => s + c.area, 0);
  const boxComps = innerArea >= allArea * 0.3 ? inner : kept;
  // Grow the box out from the biggest stroke, absorbing nearby parts (dots,
  // a separate surname, stacked signatures). Small far-off bits — paper-edge
  // fragments, smudges — stay out of the box and are wiped.
  let box: Box | null = null;
  if (boxComps.length) {
    const order = [...boxComps].sort((a, b) => b.area - a.area);
    const total = order.reduce((s, c) => s + c.area, 0);
    const inBox = new Set([order[0]]);
    let { x0, y0, x1, y1 } = order[0];
    for (let grew = true; grew;) {
      grew = false;
      const reach = Math.max(x1 - x0, y1 - y0) * 0.3 + 8;
      for (const c of order) {
        if (inBox.has(c)) continue;
        const gap = Math.max(c.x0 - x1, x0 - c.x1, c.y0 - y1, y0 - c.y1, 0);
        if (gap > reach) continue;
        inBox.add(c); grew = true;
        x0 = Math.min(x0, c.x0); y0 = Math.min(y0, c.y0);
        x1 = Math.max(x1, c.x1); y1 = Math.max(y1, c.y1);
      }
    }
    const outside = order.filter((c) => !inBox.has(c));
    if (outside.reduce((s, c) => s + c.area, 0) < total * 0.2) {
      for (const c of outside) keep[c.id] = 0;
    } else {
      // a big separate chunk is real ink, not noise — box everything
      for (const c of outside) {
        x0 = Math.min(x0, c.x0); y0 = Math.min(y0, c.y0);
        x1 = Math.max(x1, c.x1); y1 = Math.max(y1, c.y1);
      }
    }
    box = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  // dropped components plus a 2px ring, so their anti-aliased halo goes too
  let drop = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (label[i] && !keep[label[i]]) drop[i] = 1;
  for (let pass = 0; pass < 2; pass++) {
    const grown = drop.slice();
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!drop[i] && (drop[i - 1] || drop[i + 1] || drop[i - w] || drop[i + w]) && !(label[i] && keep[label[i]])) grown[i] = 1;
    }
    drop = grown;
  }

  const lo = t - 0.14, hi = t + 0.05;
  for (let i = 0; i < w * h; i++) {
    const p = i * 4;
    const dropped = drop[i] === 1;
    if (keepColor) {
      if (dropped || n[i] >= hi) { d[p] = d[p + 1] = d[p + 2] = 255; continue; }
      // stretch so paper hits pure white and the ink keeps its hue
      for (let c = 0; c < 3; c++) d[p + c] = Math.max(0, Math.min(255, (d[p + c] - 255 * lo * 0.6) / (hi - lo * 0.6)));
      continue;
    }
    let v = 255;
    if (!dropped) {
      const k = Math.min(1, Math.max(0, (n[i] - lo) / (hi - lo)));
      v = 255 * k * k * (3 - 2 * k);
    }
    d[p] = d[p + 1] = d[p + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return { canvas: out, box, scale };
}

function maxGrid(g: Float32Array, gw: number, gh: number) {
  const o = new Float32Array(g.length);
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    let m = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < gw && yy < gh && g[yy * gw + xx] > m) m = g[yy * gw + xx];
    }
    o[y * gw + x] = m;
  }
  return o;
}

function blurGrid(g: Float32Array, gw: number, gh: number) {
  let a: Float32Array = g, b: Float32Array = new Float32Array(g.length);
  for (let pass = 0; pass < 2; pass++) {
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let s = 0, c = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < gw && yy < gh) { s += a[yy * gw + xx]; c++; }
      }
      b[y * gw + x] = s / c;
    }
    [a, b] = [b, a];
  }
  return a;
}

/** After a big downscale, faint grey strokes → solid; near-white → paper. */
export function inkLevels(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = d[i + c] / 255;
      d[i + c] = v > 0.93 ? 255 : Math.round(255 * Math.pow(v / 0.93, 1.6));
    }
  }
  ctx.putImageData(img, 0, 0);
}

// ── JPEG encoding ───────────────────────────────────────────────────────

/** Patch (or insert) the JFIF APP0 segment so the file reports `dpi`. */
export function setJpegDpi(bytes: Uint8Array, dpi: number): Uint8Array {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const hi = (dpi >> 8) & 0xff, lo = dpi & 0xff;
  const isJfif = bytes[2] === 0xff && bytes[3] === 0xe0
    && bytes[6] === 0x4a && bytes[7] === 0x46 && bytes[8] === 0x49 && bytes[9] === 0x46 && bytes[10] === 0;
  if (isJfif) {
    const out = bytes.slice();
    out[13] = 1; // units: dots per inch
    out[14] = hi; out[15] = lo;
    out[16] = hi; out[17] = lo;
    return out;
  }
  const app0 = [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x01, hi, lo, hi, lo, 0x00, 0x00];
  const out = new Uint8Array(bytes.length + app0.length);
  out.set(bytes.subarray(0, 2), 0);
  out.set(app0, 2);
  out.set(bytes.subarray(2), 2 + app0.length);
  return out;
}

/**
 * Grow a JPEG to `target` bytes with COM (0xFFFE) segments placed right
 * after the JFIF APP0. Decoders skip comments, so the pixels are untouched.
 */
export function padJpeg(bytes: Uint8Array, target: number): Uint8Array {
  let need = target - bytes.length;
  if (need <= 0 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const at = bytes[2] === 0xff && bytes[3] === 0xe0 ? 4 + ((bytes[4] << 8) | bytes[5]) : 2;
  const segs: Uint8Array[] = [];
  while (need > 0) {
    // a segment is marker (2) + length (2) + payload; length covers itself
    const payload = Math.min(65533, Math.max(1, need - 4));
    const seg = new Uint8Array(4 + payload).fill(0x20);
    seg[0] = 0xff; seg[1] = 0xfe;
    seg[2] = ((payload + 2) >> 8) & 0xff; seg[3] = (payload + 2) & 0xff;
    segs.push(seg);
    need -= seg.length;
  }
  const extra = segs.reduce((s, x) => s + x.length, 0);
  const out = new Uint8Array(bytes.length + extra);
  out.set(bytes.subarray(0, at), 0);
  let p = at;
  for (const s of segs) { out.set(s, p); p += s.length; }
  out.set(bytes.subarray(at), p);
  return out;
}

/** Read back the JFIF density (for the checklist). */
export function readJpegDpi(bytes: Uint8Array): number | null {
  if (bytes[2] !== 0xff || bytes[3] !== 0xe0 || bytes[13] !== 1) return null;
  return (bytes[14] << 8) | bytes[15];
}

async function encodeJpeg(canvas: HTMLCanvasElement, q: number, dpi?: number): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", q));
  if (!blob) throw new Error("This browser could not encode a JPEG");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  return dpi ? setJpegDpi(bytes, dpi) : bytes;
}

export type FitStatus = "ok" | "too-small" | "too-big";
export interface Encoded { bytes: Uint8Array; quality: number; status: FitStatus; maxQualityBytes: number }

/** Lowest quality we'll go to before calling a size impossible. */
const Q_FLOOR = 50;

/**
 * Highest JPEG quality whose file fits under maxB (binary search over the
 * integer qualities browsers actually use). If even quality 100 is under
 * minB the pixels simply don't carry enough data — reported, not faked.
 */
export async function encodeInRange(canvas: HTMLCanvasElement, minB: number, maxB: number, dpi?: number): Promise<Encoded> {
  const cache = new Map<number, Uint8Array>();
  const at = async (q: number) => {
    let b = cache.get(q);
    if (!b) { b = await encodeJpeg(canvas, q / 100, dpi); cache.set(q, b); }
    return b;
  };
  const top = await at(100);
  const result = (q: number, bytes: Uint8Array, status: FitStatus): Encoded =>
    ({ bytes, quality: q, status, maxQualityBytes: top.length });
  if (top.length <= maxB) return result(100, top, top.length >= minB ? "ok" : "too-small");
  const floor = await at(Q_FLOOR);
  if (floor.length > maxB) return result(Q_FLOOR, floor, "too-big");
  let lo = Q_FLOOR, hi = 100;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((await at(mid)).length <= maxB) lo = mid;
    else hi = mid;
  }
  const best = await at(lo);
  return result(lo, best, best.length >= minB ? "ok" : "too-small");
}

export const fmtKB = (bytes: number) => `${(bytes / 1024).toFixed(1)} KB`;

export function todayDMY() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}
