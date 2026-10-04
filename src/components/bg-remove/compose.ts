/**
 * Compositing for the background remover: mask → transparent cutout, then
 * cutout → final file (transparent PNG, solid colour, or a square
 * marketplace canvas). DOM-only, shared by the single and batch flows.
 */
import type { RmbgMask } from "@/lib/rmbg";

export type BgMode = "transparent" | "color" | "product";
export type OutFormat = "jpeg" | "png";

export interface OutputOptions {
  mode: BgMode;
  /** solid-colour mode */
  color: string;
  /** marketplace mode: square edge in px */
  size: number;
  /** marketplace mode: empty space on each side, as a fraction of the edge */
  margin: number;
  /** marketplace mode backdrop */
  backdrop: string;
  shadow: boolean;
  /** colour + marketplace modes (transparent is always PNG) */
  format: OutFormat;
  quality: number;
}

// Amazon.in / Flipkart main image: pure white, product fills ≥85% of the
// frame, ≥1000px (2000px recommended for zoom), JPEG accepted everywhere.
// 6% a side → the product's long edge fills 88%, inside the 85% rule.
export const DEFAULT_OPTIONS: OutputOptions = {
  mode: "transparent",
  color: "#ffffff",
  size: 2000,
  margin: 0.06,
  backdrop: "#ffffff",
  shadow: false,
  format: "jpeg",
  quality: 0.92,
};

export interface Box { x: number; y: number; w: number; h: number }

/** Everything needed to re-render a cutout without the model. */
export interface CutMeta {
  w: number;
  h: number;
  /** subject bounds in cutout pixels (null = nothing detected) */
  box: Box | null;
  /** x-range of the subject's base, for the contact shadow */
  foot: [number, number] | null;
}

export function optionsKey(o: OutputOptions): string {
  if (o.mode === "transparent") return "t";
  const enc = o.format === "jpeg" ? `j${Math.round(o.quality * 100)}` : "p";
  if (o.mode === "color") return `c|${o.color}|${enc}`;
  return `p|${o.size}|${Math.round(o.margin * 1000)}|${o.backdrop}|${o.shadow ? 1 : 0}|${enc}`;
}

export function outputExt(o: OutputOptions): "png" | "jpg" {
  return o.mode === "transparent" || o.format === "png" ? "png" : "jpg";
}

export function outputMime(o: OutputOptions): string {
  return outputExt(o) === "png" ? "image/png" : "image/jpeg";
}

export function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").replace(/[\\/:*?"<>|]+/g, "_").trim() || "image";
}

export function outputName(fileName: string, o: OutputOptions): string {
  return `${baseName(fileName)}-nobg.${outputExt(o)}`;
}

export function outputDims(meta: CutMeta, o: OutputOptions): [number, number] {
  return o.mode === "product" ? [o.size, o.size] : [meta.w, meta.h];
}

// iOS Safari silently refuses canvases above 16.7MP (blank output); elsewhere
// the cap only bounds memory for very large camera files.
function maxCanvasPixels(): number {
  if (typeof navigator === "undefined") return 16_777_216;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) ||
    (navigator.userAgent.includes("Macintosh") && navigator.maxTouchPoints > 1);
  return ios ? 16_777_216 : 40_000_000;
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/** Drop the backing store now instead of waiting for GC. */
export function releaseCanvas(c: HTMLCanvasElement) {
  c.width = 0;
  c.height = 0;
}

export function canvasBlob(c: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((res, rej) =>
    c.toBlob((b) => (b ? res(b) : rej(new Error("Could not encode image"))), type, quality)
  );
}

/**
 * Subject bounds from the alpha mask. A column/row only counts once a few
 * pixels in it are solid, so stray specks don't drag the box off-centre.
 */
function subjectBounds(m: Uint8Array, mw: number, mh: number): { box: Box; foot: [number, number] } | null {
  const T = 40;
  const cols = new Uint32Array(mw);
  const rows = new Uint32Array(mh);
  for (let y = 0; y < mh; y++) {
    const off = y * mw;
    let rc = 0;
    for (let x = 0; x < mw; x++) {
      if (m[off + x] > T) { rc++; cols[x]++; }
    }
    rows[y] = rc;
  }
  const minC = Math.max(1, Math.round(mh * 0.002));
  const minR = Math.max(1, Math.round(mw * 0.002));
  let x0 = 0, x1 = mw - 1, y0 = 0, y1 = mh - 1;
  while (x0 < mw && cols[x0] < minC) x0++;
  while (x1 > x0 && cols[x1] < minC) x1--;
  while (y0 < mh && rows[y0] < minR) y0++;
  while (y1 > y0 && rows[y1] < minR) y1--;
  if (x0 >= mw || y0 >= mh) return null;

  let f0 = x1, f1 = x0;
  const fy = Math.max(y0, Math.round(y1 - (y1 - y0) * 0.06));
  for (let y = fy; y <= y1; y++) {
    const off = y * mw;
    for (let x = x0; x <= x1; x++) {
      if (m[off + x] > 128) { if (x < f0) f0 = x; if (x > f1) f1 = x; }
    }
  }
  if (f1 < f0) { f0 = x0; f1 = x1; }
  return { box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }, foot: [f0, f1 + 1] };
}

/**
 * Original pixels + mask → transparent canvas (caller releases it). Decoded
 * with createImageBitmap, the same path the worker used, so orientation and
 * dimensions match the mask.
 */
export async function cutoutCanvas(file: Blob, mask: RmbgMask): Promise<{ canvas: HTMLCanvasElement; meta: CutMeta }> {
  const bmp = await createImageBitmap(file);
  const mw = mask.width, mh = mask.height;
  const scale = Math.min(1, Math.sqrt(maxCanvasPixels() / (mw * mh)));
  const w = Math.max(1, Math.round(mw * scale));
  const h = Math.max(1, Math.round(mh * scale));
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();

  const img = ctx.getImageData(0, 0, w, h);
  const px = img.data, m = mask.data;
  if (scale === 1) {
    for (let i = 0; i < m.length; i++) px[4 * i + 3] = m[i];
  } else {
    for (let y = 0; y < h; y++) {
      const sy = Math.min(mh - 1, Math.floor((y + 0.5) / scale)) * mw;
      for (let x = 0; x < w; x++) {
        px[4 * (y * w + x) + 3] = m[sy + Math.min(mw - 1, Math.floor((x + 0.5) / scale))];
      }
    }
  }
  ctx.putImageData(img, 0, 0);

  const b = subjectBounds(m, mw, mh);
  const meta: CutMeta = b
    ? {
        w, h,
        box: {
          x: Math.floor(b.box.x * scale), y: Math.floor(b.box.y * scale),
          w: Math.max(1, Math.ceil(b.box.w * scale)), h: Math.max(1, Math.ceil(b.box.h * scale)),
        },
        foot: [b.foot[0] * scale, b.foot[1] * scale],
      }
    : { w, h, box: null, foot: null };
  return { canvas, meta };
}

/** drawImage with stepwise halving, so big reductions don't alias. */
function drawScaled(
  ctx: CanvasRenderingContext2D, src: CanvasImageSource,
  sx: number, sy: number, sw: number, sh: number,
  dx: number, dy: number, dw: number, dh: number
) {
  let cur: CanvasImageSource = src;
  let tmp: HTMLCanvasElement | null = null;
  let cx = sx, cy = sy, cw = sw, ch = sh;
  while (cw * 0.5 > dw && ch * 0.5 > dh) {
    const nw = Math.max(1, Math.round(cw / 2)), nh = Math.max(1, Math.round(ch / 2));
    const next = makeCanvas(nw, nh);
    const nctx = next.getContext("2d")!;
    nctx.imageSmoothingQuality = "high";
    nctx.drawImage(cur, cx, cy, cw, ch, 0, 0, nw, nh);
    if (tmp) releaseCanvas(tmp);
    tmp = next; cur = next;
    cx = 0; cy = 0; cw = nw; ch = nh;
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cur, cx, cy, cw, ch, dx, dy, dw, dh);
  if (tmp) releaseCanvas(tmp);
}

/** Where the subject lands on the square marketplace canvas. */
export function productLayout(meta: CutMeta, size: number, margin: number) {
  const box = meta.box ?? { x: 0, y: 0, w: meta.w, h: meta.h };
  const inner = size * (1 - 2 * margin);
  const s = Math.min(inner / box.w, inner / box.h);
  const dw = box.w * s, dh = box.h * s;
  return { box, s, dw, dh, dx: (size - dw) / 2, dy: (size - dh) / 2 };
}

/** Contact-shadow ellipse under the product, kept inside its footprint. */
export function shadowGeometry(meta: CutMeta, size: number, margin: number) {
  const L = productLayout(meta, size, margin);
  const foot = meta.foot ?? [L.box.x, L.box.x + L.box.w];
  const fx0 = L.dx + (foot[0] - L.box.x) * L.s;
  const fx1 = L.dx + (foot[1] - L.box.x) * L.s;
  const rx = Math.min(Math.max(fx1 - fx0, L.dw * 0.3), L.dw) / 2;
  const baseY = L.dy + L.dh;
  const below = size - baseY;
  const ry = Math.min(Math.max(size * 0.012, rx * 0.08), Math.max(below * 0.55, size * 0.004));
  const cx = Math.min(Math.max((fx0 + fx1) / 2, L.dx + rx), L.dx + L.dw - rx);
  return { cx, baseY, rx, ry };
}

function drawContactShadow(ctx: CanvasRenderingContext2D, g: ReturnType<typeof shadowGeometry>) {
  // [x radius, y radius, alpha]: wide soft ambient + tight dark contact
  const layers: [number, number, number][] = [
    [g.rx, g.ry, 0.14],
    [g.rx * 0.72, g.ry * 0.42, 0.22],
  ];
  for (const [lx, ly, a] of layers) {
    ctx.save();
    ctx.translate(g.cx, g.baseY);
    ctx.scale(lx, ly);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    grad.addColorStop(0, `rgba(0,0,0,${a})`);
    grad.addColorStop(0.55, `rgba(0,0,0,${a * 0.45})`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** Opaque composite for colour / marketplace modes. Caller releases it. */
export function composite(src: CanvasImageSource, meta: CutMeta, o: OutputOptions): HTMLCanvasElement {
  if (o.mode === "color") {
    const c = makeCanvas(meta.w, meta.h);
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = o.color;
    ctx.fillRect(0, 0, meta.w, meta.h);
    ctx.drawImage(src, 0, 0, meta.w, meta.h);
    return c;
  }
  const S = o.size;
  const c = makeCanvas(S, S);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = o.backdrop;
  ctx.fillRect(0, 0, S, S);
  const L = productLayout(meta, S, o.margin);
  if (o.shadow) drawContactShadow(ctx, shadowGeometry(meta, S, o.margin));
  drawScaled(ctx, src, L.box.x, L.box.y, L.box.w, L.box.h, L.dx, L.dy, L.dw, L.dh);
  return c;
}

/** Final file from a transparent cutout canvas. */
export async function encodeOutput(src: HTMLCanvasElement, meta: CutMeta, o: OutputOptions): Promise<Blob> {
  if (o.mode === "transparent") return canvasBlob(src, "image/png");
  const c = composite(src, meta, o);
  try {
    return await canvasBlob(c, outputMime(o), o.format === "jpeg" ? o.quality : undefined);
  } finally {
    releaseCanvas(c);
  }
}

/**
 * The cutout's alpha as a small PNG (black + alpha) — what a batch keeps per
 * image instead of a multi-MB cutout. RMBG predicts at 1024², so storing the
 * mask at ≤2048px loses nothing real and keeps it ~100KB even for 12MP.
 */
export async function maskPng(cut: HTMLCanvasElement, maxSide = 2048): Promise<Blob> {
  const s = Math.min(1, maxSide / Math.max(cut.width, cut.height));
  const c = makeCanvas(Math.max(1, Math.round(cut.width * s)), Math.max(1, Math.round(cut.height * s)));
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.globalCompositeOperation = "destination-in";
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cut, 0, 0, c.width, c.height);
  try { return await canvasBlob(c, "image/png"); } finally { releaseCanvas(c); }
}

/** Re-render from the original file + stored mask PNG (no model involved). */
export async function renderFromMask(file: Blob, mask: Blob, meta: CutMeta, o: OutputOptions): Promise<Blob> {
  const [img, m] = await Promise.all([createImageBitmap(file), createImageBitmap(mask)]);
  const c = makeCanvas(meta.w, meta.h);
  try {
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, meta.w, meta.h);
    ctx.globalCompositeOperation = "destination-in";
    ctx.drawImage(m, 0, 0, meta.w, meta.h); // upscales a capped mask back to size
    ctx.globalCompositeOperation = "source-over";
    return await encodeOutput(c, meta, o);
  } finally {
    img.close();
    m.close();
    releaseCanvas(c);
  }
}

/** Small preview image (keeps alpha). */
export async function thumbFrom(src: CanvasImageSource, w: number, h: number, max = 360, type = "image/png"): Promise<Blob> {
  const s = Math.min(1, max / Math.max(w, h));
  const tw = Math.max(1, Math.round(w * s)), th = Math.max(1, Math.round(h * s));
  const c = makeCanvas(tw, th);
  drawScaled(c.getContext("2d")!, src, 0, 0, w, h, 0, 0, tw, th);
  try { return await canvasBlob(c, type, type === "image/jpeg" ? 0.82 : undefined); } finally { releaseCanvas(c); }
}

/** Thumbnail straight from a file, decoding at reduced size where supported. */
export async function fileThumb(file: Blob, max = 320): Promise<Blob> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(file, { resizeWidth: max * 2, resizeQuality: "medium" });
  } catch {
    bmp = await createImageBitmap(file);
  }
  try { return await thumbFrom(bmp, bmp.width, bmp.height, max, "image/jpeg"); } finally { bmp.close(); }
}

export function formatBytes(b: number) {
  if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(b / 1e3))} KB`;
}

export function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

const IMAGE_EXT = /\.(jpe?g|png|webp|avif|gif|bmp|heic|heif|tiff?)$/i;

export function isImageFile(f: File) {
  if (f.name.startsWith(".")) return false;
  return f.type.startsWith("image/") || IMAGE_EXT.test(f.name);
}

/**
 * Files from a drop, walking into dropped folders. Entries must be grabbed
 * synchronously inside the drop handler — the DataTransfer is dead after it.
 */
export function collectDropped(dt: DataTransfer): Promise<File[]> {
  const plain = Array.from(dt.files);
  const entries = Array.from(dt.items ?? [])
    .map((it) => (it.kind === "file" ? it.webkitGetAsEntry?.() ?? null : null))
    .filter((e): e is FileSystemEntry => !!e);
  if (!entries.some((e) => e.isDirectory)) return Promise.resolve(plain.filter(isImageFile));

  const out: File[] = [];
  const walk = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isFile) {
      const f = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      if (isImageFile(f)) out.push(f);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (!batch.length) break;
        for (const e of batch) await walk(e);
      }
    }
  };
  return (async () => {
    for (const e of entries) {
      try { await walk(e); } catch { /* unreadable entry */ }
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  })();
}
