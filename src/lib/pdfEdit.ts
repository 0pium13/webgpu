"use client";

/**
 * PDF text editing — the way every real web editor does it (because embedded
 * PDF fonts are subset-encoded and can't be extended): click a text run, we
 * patch over it with the page's own background colour and draw the
 * replacement text on top. pdf.js supplies exact glyph-run positions; pdf-lib
 * writes the patch + new text into a real saved PDF.
 *
 * To make the replacement indistinguishable we match three things per run:
 *  - font: pdf.js gives the PostScript name (e.g. "Times-Bold") + generic
 *    family, mapped to the closest of the 14 standard fonts incl. bold/italic;
 *  - colour: sampled from the actual rendered glyph pixels, not assumed black;
 *  - spacing: character spacing (Tc) is derived so the new text keeps the
 *    original run's letter-spacing and lands in the same footprint.
 */

import { loadPdfjs, openDoc } from "./pdf";

export interface TextRun {
  /** canvas-space (CSS px at the editor's scale) */
  x: number; y: number; w: number; h: number;
  str: string;
  /** PDF-space (points, origin bottom-left, y = baseline) */
  pdfX: number; pdfY: number; pdfW: number; pdfSize: number;
  /** matched standard-font key (pdf-lib StandardFonts) */
  fontKey: string;
  /** sampled glyph colour, 0..1 rgb */
  color: [number, number, number];
}

export interface PdfEdit {
  page: number;              // 0-based
  pdfX: number; pdfY: number; pdfW: number; pdfSize: number;
  newText: string;
  origStr: string;           // original run text (for spacing match)
  fontKey: string;
  color: [number, number, number];   // text colour 0..1
  /** sampled page background 0..1 rgb for the whiteout patch */
  bg: [number, number, number];
  /** true = brand-new text (no whiteout patch, no spacing match) */
  isNew?: boolean;
}

export interface EditorPage {
  canvas: HTMLCanvasElement;
  runs: TextRun[];
  scale: number;
  pdfW: number; pdfH: number;
  numPages: number;
}

/** Map a PDF font's PostScript name + generic family to a standard-14 key. */
export function pickFontKey(psName: string | null, family: string | null): string {
  const s = `${psName ?? ""} ${family ?? ""}`.toLowerCase();
  const bold = /bold|black|heavy|semibold|-bd|,bold|extrab|\bbd\b/.test(s);
  const italic = /italic|oblique/.test(s);
  const mono = /courier|mono|consol|menlo|typewriter|inconsolata/.test(s);
  const serif = !mono && /times|serif|georgia|roman|minion|garamond|palatino|cambria|book\s?antiqua|charter|mincho|song|sung|ming|caslon|didot/.test(s) && !/sans/.test(s);

  if (mono) return `Courier${bold ? "Bold" : ""}${italic ? "Oblique" : ""}`;
  if (serif) return `TimesRoman${bold ? "Bold" : ""}${italic ? "Italic" : ""}`;
  return `Helvetica${bold ? "Bold" : ""}${italic ? "Oblique" : ""}`;
}

/** CSS description of a font key, for the on-screen live preview. */
export function cssFontFor(key: string): { fontFamily: string; fontWeight: string; fontStyle: string } {
  const family = key.startsWith("Courier") ? "'Courier New', monospace"
    : key.startsWith("Times") ? "Georgia, 'Times New Roman', serif"
    : "Helvetica, Arial, sans-serif";
  return {
    fontFamily: family,
    fontWeight: /Bold/.test(key) ? "700" : "400",
    fontStyle: /Italic|Oblique/.test(key) ? "italic" : "normal",
  };
}

/** Render one page at editing size and extract clickable, styled text runs. */
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
  // getOperatorList first would also load fonts, but render() populates
  // commonObjs too and gives us the pixels we need for colour sampling.
  await page.render({ canvas, canvasContext: canvas.getContext("2d")!, viewport: vp }).promise;

  const tc = await readTextContent(page);
  const runs: TextRun[] = [];
  for (const item of tc.items) {
    const str = String(item.str ?? "");
    if (!str.trim()) continue;
    const [a, b, , d, e, f] = item.transform; // text matrix, PDF space
    const size = Math.hypot(a, b) || Math.abs(d) || 10; // horizontal text: a = size
    const w = item.width ?? size * str.length * 0.5;
    const h = (item.height || size);

    // font: PostScript name (commonObjs, loaded during render) + family (styles)
    let psName: string | null = null;
    try { psName = page.commonObjs.get(item.fontName)?.name ?? null; } catch { psName = null; }
    const family = tc.styles?.[item.fontName]?.fontFamily ?? null;
    const fontKey = pickFontKey(psName, family);

    const run: TextRun = {
      str,
      pdfX: e, pdfY: f, pdfW: w, pdfSize: size,
      x: e * scale,
      y: (vp1.height - f - h) * scale, // top edge ≈ baseline minus ascent(≈height)
      w: w * scale,
      h: h * scale * 1.25,
      fontKey,
      color: [0, 0, 0],
    };
    run.color = sampleTextColor(canvas, run);
    runs.push(run);
  }
  await task.destroy();
  return { canvas, runs, scale, pdfW: vp1.width, pdfH: vp1.height, numPages };
}

/**
 * pdf.js v6's page.getTextContent() does `for await` directly on a
 * ReadableStream — Safari only supports async stream iteration from 18.4,
 * so it throws "undefined is not a function" there. Read the stream with a
 * plain reader instead; identical result, works in every browser.
 */
async function readTextContent(page: any): Promise<{ items: any[]; styles: any }> {
  const reader = page.streamTextContent().getReader();
  const items: any[] = [];
  let styles: any = {};
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value?.items) for (const it of value.items) items.push(it);
    if (value?.styles) styles = Object.assign(styles, value.styles);
  }
  return { items, styles };
}

function clampInt(v: number, max: number) {
  return Math.min(max, Math.max(0, Math.round(v)));
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
    const x = clampInt(px, canvas.width - 1);
    const y = clampInt(py, canvas.height - 1);
    const d = ctx.getImageData(x, y, 1, 1).data;
    samples.push([d[0], d[1], d[2]]);
  }
  const med = (i: number) => {
    const v = samples.map((s) => s[i]).sort((x, y) => x - y);
    return (v[1] + v[2]) / 2 / 255;
  };
  return [med(0), med(1), med(2)];
}

/**
 * True glyph colour: take the page background (reliably sampled just outside
 * the box), then inside the box keep only pixels far from that background —
 * the ink — and median the strongest of them. Works for black, coloured, or
 * light-on-dark text.
 */
export function sampleTextColor(canvas: HTMLCanvasElement, r: TextRun): [number, number, number] {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const x0 = clampInt(r.x, canvas.width - 1);
  const y0 = clampInt(r.y, canvas.height - 1);
  const w = Math.min(canvas.width - x0, Math.max(1, Math.round(r.w)));
  const h = Math.min(canvas.height - y0, Math.max(1, Math.round(r.h)));
  if (w < 2 || h < 2) return [0, 0, 0];

  const bg = sampleBackground(canvas, r).map((v) => v * 255);
  const img = ctx.getImageData(x0, y0, w, h).data;
  const ink: { r: number; g: number; b: number; d: number }[] = [];
  for (let i = 0; i < img.length; i += 4) {
    const R = img[i], G = img[i + 1], B = img[i + 2], A = img[i + 3];
    if (A < 128) continue;
    const d = Math.max(Math.abs(R - bg[0]), Math.abs(G - bg[1]), Math.abs(B - bg[2]));
    if (d > 40) ink.push({ r: R, g: G, b: B, d });
  }
  if (ink.length < 3) return [0, 0, 0]; // no clear ink → safe black
  // strongest 55% of ink pixels are the solid strokes; median their colour
  ink.sort((p, q) => q.d - p.d);
  const core = ink.slice(0, Math.max(3, Math.floor(ink.length * 0.55)));
  const chan = (k: "r" | "g" | "b") => {
    const v = core.map((p) => p[k]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)] / 255;
  };
  return [chan("r"), chan("g"), chan("b")];
}

/** Burn all edits into a fresh copy of the PDF. */
export async function applyEdits(data: ArrayBuffer, edits: PdfEdit[]): Promise<Uint8Array> {
  const { PDFDocument, StandardFonts, rgb, setCharacterSpacing } = await import("pdf-lib");
  const doc = await PDFDocument.load(data, { ignoreEncryption: true });
  const pages = doc.getPages();

  const fontCache = new Map<string, any>();
  const getFont = async (key: string) => {
    if (fontCache.has(key)) return fontCache.get(key);
    const sf = (StandardFonts as any)[key] ?? StandardFonts.Helvetica;
    const font = await doc.embedFont(sf);
    fontCache.set(key, font);
    return font;
  };

  for (const ed of edits) {
    const page = pages[ed.page];
    if (!page) continue;
    const size = ed.pdfSize;
    const font = await getFont(ed.fontKey || "Helvetica");

    if (!ed.isNew) {
      page.drawRectangle({
        x: ed.pdfX - 1.5,
        y: ed.pdfY - size * 0.28,
        width: ed.pdfW + 3,
        height: size * 1.42,
        color: rgb(ed.bg[0], ed.bg[1], ed.bg[2]),
      });
    }

    if (!ed.newText.trim()) continue;

    // character spacing so the run keeps the original's tracking + footprint
    let tc = 0;
    if (!ed.isNew && ed.origStr) {
      const natural = font.widthOfTextAtSize(ed.origStr, size);
      const n = ed.origStr.length || 1;
      tc = (ed.pdfW - natural) / n;
      tc = Math.max(-0.08 * size, Math.min(0.8 * size, tc));
    }
    const [r, g, b] = ed.color ?? [0, 0, 0];
    if (tc) page.pushOperators(setCharacterSpacing(tc));
    page.drawText(ed.newText, { x: ed.pdfX, y: ed.pdfY, size, font, color: rgb(r, g, b) });
    if (tc) page.pushOperators(setCharacterSpacing(0));
  }
  return doc.save();
}
