"use client";

/**
 * PDF engine — pdf-lib for document surgery (merge/extract/rotate/build),
 * pdf.js for rendering (thumbnails, PDF→image, compress-by-rasterize).
 * Worker is self-hosted at /pdf.worker.min.mjs so CSP stays 'self'.
 *
 * Everything runs in the tab. The whole point: people upload contracts and
 * salary slips to "free PDF" sites every day — here the file never leaves.
 */

let pdfjsPromise: Promise<any> | null = null;

export function loadPdfjs(): Promise<any> {
  if (pdfjsPromise) return pdfjsPromise;
  pdfjsPromise = (async () => {
    const pdfjs: any = await import("pdfjs-dist");
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
    return pdfjs;
  })();
  return pdfjsPromise;
}

/**
 * pdf.js v6 fetches side assets at render time: qcms/openjpeg/jbig2 WASM
 * (color management + image codecs) and the 14 standard fonts. If those
 * fetches 404 — as they do with a bare self-hosted worker — page.render()
 * hangs FOREVER with no error. Every getDocument must point at our copies.
 */
export function openDoc(pdfjs: any, data: ArrayBuffer) {
  return pdfjs.getDocument({
    data: data.slice(0), // pdf.js transfers the buffer to its worker — hand it a copy
    wasmUrl: "/pdfjs/wasm/",
    standardFontDataUrl: "/pdfjs/standard_fonts/",
  });
}

export interface PageThumb {
  index: number; // 0-based
  canvas: HTMLCanvasElement;
  width: number;  // PDF points
  height: number;
}

/** Open a PDF with pdf.js and render every page as a thumbnail. */
export async function renderThumbs(
  data: ArrayBuffer,
  onPage: (t: PageThumb, total: number) => void,
  thumbWidth = 180
): Promise<void> {
  const pdfjs = await loadPdfjs();
  const task = openDoc(pdfjs, data);
  const doc = await task.promise;
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = thumbWidth / vp1.width;
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
    onPage({ index: i - 1, canvas, width: vp1.width, height: vp1.height }, doc.numPages);
  }
  await task.destroy();
}

/** Merge whole PDFs in order. */
export async function mergePdfs(buffers: ArrayBuffer[]): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  for (const buf of buffers) {
    const src = await PDFDocument.load(buf, { ignoreEncryption: true });
    const pages = await out.copyPages(src, src.getPageIndices());
    for (const p of pages) out.addPage(p);
  }
  return out.save();
}

/**
 * Rebuild a PDF keeping only `keep` (0-based, in the given order), applying
 * per-page extra rotation in degrees. Covers extract, delete, reorder, rotate.
 */
export async function rebuildPdf(
  buffer: ArrayBuffer,
  keep: number[],
  rotations: Record<number, number> = {}
): Promise<Uint8Array> {
  const { PDFDocument, degrees } = await import("pdf-lib");
  const src = await PDFDocument.load(buffer, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, keep);
  pages.forEach((p, i) => {
    const extra = rotations[keep[i]] ?? 0;
    if (extra) p.setRotation(degrees(((p.getRotation().angle + extra) % 360 + 360) % 360));
    out.addPage(p);
  });
  return out.save();
}

/** One image per page, page sized to the image. */
export async function imagesToPdf(files: File[]): Promise<Uint8Array> {
  const { PDFDocument } = await import("pdf-lib");
  const out = await PDFDocument.create();
  for (const f of files) {
    const bytes = await f.arrayBuffer();
    const isPng = f.type.includes("png");
    let img;
    if (isPng) {
      img = await out.embedPng(bytes);
    } else if (f.type.includes("jpe")) {
      img = await out.embedJpg(bytes);
    } else {
      // webp/heic/etc → decode via canvas, re-encode as JPEG
      const bmp = await createImageBitmap(new Blob([bytes]));
      const c = document.createElement("canvas");
      c.width = bmp.width; c.height = bmp.height;
      c.getContext("2d")!.drawImage(bmp, 0, 0);
      const jpg = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/jpeg", 0.92));
      img = await out.embedJpg(await jpg.arrayBuffer());
    }
    const page = out.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  return out.save();
}

/** Render every page to PNG and zip them. */
export async function pdfToImages(
  data: ArrayBuffer,
  onProgress: (done: number, total: number) => void,
  scale = 2
): Promise<Blob> {
  const pdfjs = await loadPdfjs();
  const { default: JSZip } = await import("jszip");
  const task = openDoc(pdfjs, data);
  const doc = await task.promise;
  const zip = new JSZip();
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/png"));
    zip.file(`page-${String(i).padStart(3, "0")}.png`, blob);
    onProgress(i, doc.numPages);
  }
  await task.destroy();
  return zip.generateAsync({ type: "blob" });
}

/**
 * Compress by re-rendering pages as JPEG. Brutal but effective on scans and
 * photo-heavy decks (usually 3–10× smaller). Text becomes an image — we say
 * that in the UI instead of hiding it.
 */
export async function compressPdf(
  data: ArrayBuffer,
  onProgress: (done: number, total: number) => void,
  quality = 0.72,
  maxDim = 1600
): Promise<Uint8Array> {
  const pdfjs = await loadPdfjs();
  const { PDFDocument } = await import("pdf-lib");
  const task = openDoc(pdfjs, data);
  const doc = await task.promise;
  const out = await PDFDocument.create();
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const vp1 = page.getViewport({ scale: 1 });
    const scale = Math.min(2, maxDim / Math.max(vp1.width, vp1.height));
    const vp = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(vp.width);
    canvas.height = Math.ceil(vp.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
    const blob = await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), "image/jpeg", quality));
    const img = await out.embedJpg(await blob.arrayBuffer());
    const p = out.addPage([vp1.width, vp1.height]);
    p.drawImage(img, { x: 0, y: 0, width: vp1.width, height: vp1.height });
    onProgress(i, doc.numPages);
  }
  await task.destroy();
  return out.save();
}

export function downloadBytes(bytes: Uint8Array | Blob, name: string) {
  const blob = bytes instanceof Blob
    ? bytes
    : new Blob([bytes.slice(0) as unknown as BlobPart], { type: "application/pdf" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
}
