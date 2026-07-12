"use client";

/**
 * PDF text editing — the way every real web editor does it (because embedded
 * PDF fonts are subset-encoded and can't be extended): click a text run, we
 * patch over it with the page's own background colour and draw the
 * replacement text on top. pdf.js supplies exact glyph-run positions; pdf-lib
 * writes the patch + new text into a real saved PDF.
 */

import { loadPdfjs, openDoc } from "./pdf";

export interface TextRun {
  /** canvas-space (CSS px at the editor's scale) */
  x: number; y: number; w: number; h: number;
  str: string;
  /** PDF-space (points, origin bottom-left, y = baseline) */
  pdfX: number; pdfY: number; pdfW: number; pdfSize: number;
}

export interface PdfEdit {
  page: number;              // 0-based
  pdfX: number; pdfY: number; pdfW: number; pdfSize: number;
  newText: string;
  /** sampled page background 0..1 rgb for the whiteout patch */
  bg: [number, number, number];
  /** true = brand-new text (no whiteout patch) */
  isNew?: boolean;
}

export interface EditorPage {
  canvas: HTMLCanvasElement;
  runs: TextRun[];
  scale: number;
  pdfW: number; pdfH: number;
  numPages: number;
}

/** Render one page at editing size and extract clickable text runs. */
export async function renderEditorPage(
  data: ArrayBuffer,
  pageIndex: number,
  targetWidth = 860
): Promise<EditorPage> {
  const pdfjs = await loadPdfjs();
  const task = openDoc(pdfjs, data);
  const doc = await task.promise;
  const numPages = doc.numPages;
  const page = await doc.getPage(pageIndex + 1);
  const vp1 = page.getViewport({ scale: 1 });
  const scale = targetWidth / vp1.width;
  const vp = page.getViewport({ scale });

  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;

  const tc = await page.getTextContent();
  const runs: TextRun[] = [];
  for (const item of tc.items as any[]) {
    const str = String(item.str ?? "");
    if (!str.trim()) continue;
    const [a, b, , d, e, f] = item.transform; // text matrix, PDF space
    const size = Math.hypot(a, b) || Math.abs(d) || 10; // horizontal text: a = size
    const w = item.width ?? size * str.length * 0.5;
    const h = (item.height || size);
    runs.push({
      str,
      pdfX: e, pdfY: f, pdfW: w, pdfSize: size,
      x: e * scale,
      y: (vp1.height - f - h) * scale, // top edge ≈ baseline minus ascent(≈height)
      w: w * scale,
      h: h * scale * 1.25,
    });
  }
  await task.destroy();
  return { canvas, runs, scale, pdfW: vp1.width, pdfH: vp1.height, numPages };
}

/** Median background colour just outside a run's box (so the patch blends). */
export function sampleBackground(canvas: HTMLCanvasElement, r: TextRun): [number, number, number] {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const pts: [number, number][] = [
    [r.x - 4, r.y + r.h / 2], [r.x + r.w + 4, r.y + r.h / 2],
    [r.x + r.w / 2, r.y - 4], [r.x + r.w / 2, r.y + r.h + 4],
  ];
  const samples: number[][] = [];
  for (const [px, py] of pts) {
    const x = Math.min(canvas.width - 1, Math.max(0, Math.round(px)));
    const y = Math.min(canvas.height - 1, Math.max(0, Math.round(py)));
    const d = ctx.getImageData(x, y, 1, 1).data;
    samples.push([d[0], d[1], d[2]]);
  }
  const med = (i: number) => {
    const v = samples.map((s) => s[i]).sort((x, y) => x - y);
    return (v[1] + v[2]) / 2 / 255;
  };
  return [med(0), med(1), med(2)];
}

/** Burn all edits into a fresh copy of the PDF. */
export async function applyEdits(data: ArrayBuffer, edits: PdfEdit[]): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.load(data, { ignoreEncryption: true });
  const helv = await doc.embedFont(StandardFonts.Helvetica);
  const pages = doc.getPages();
  for (const ed of edits) {
    const page = pages[ed.page];
    if (!page) continue;
    if (!ed.isNew) {
      page.drawRectangle({
        x: ed.pdfX - 1.5,
        y: ed.pdfY - ed.pdfSize * 0.28,
        width: ed.pdfW + 3,
        height: ed.pdfSize * 1.42,
        color: rgb(ed.bg[0], ed.bg[1], ed.bg[2]),
      });
    }
    if (ed.newText.trim()) {
      page.drawText(ed.newText, {
        x: ed.pdfX,
        y: ed.pdfY,
        size: ed.pdfSize,
        font: helv,
        color: rgb(0, 0, 0),
      });
    }
  }
  return doc.save();
}
