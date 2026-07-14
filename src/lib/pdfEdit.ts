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
  /** page looks like a scan/photocopy (noisy, off-white) → soften edits by default */
  looksScanned: boolean;
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
  const looksScanned = detectScanned(canvas);
  await task.destroy();
  return { canvas, runs, scale, pdfW: vp1.width, pdfH: vp1.height, numPages, looksScanned };
}

/**
 * Guess whether a page is a scan/photocopy rather than a clean digital PDF.
 * Scans are off-white with sensor/paper noise; digital pages are pure #FFFFFF
 * with zero variance. We sample small patches in the margins (avoiding the
 * centre, where a watermark or seal would skew it) and look for either noise
 * or a non-white paper tone. If so, crisp vector edits will stand out and we
 * default to softening them.
 */
function detectScanned(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const W = canvas.width, H = canvas.height, S = 10;
  const spots: [number, number][] = [
    [W * 0.5, H * 0.04], [W * 0.5, H * 0.96],           // top/bottom margins
    [W * 0.04, H * 0.3], [W * 0.96, H * 0.3],           // left/right margins
    [W * 0.04, H * 0.7], [W * 0.96, H * 0.7],
  ];
  const stds: number[] = [];
  const means: number[] = [];
  for (const [cx, cy] of spots) {
    const x = clampInt(cx - S / 2, W - S), y = clampInt(cy - S / 2, H - S);
    const d = ctx.getImageData(x, y, S, S).data;
    const lums: number[] = [];
    for (let i = 0; i < d.length; i += 4) lums.push(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    const m = lums.reduce((a, v) => a + v, 0) / lums.length;
    const sd = Math.sqrt(lums.reduce((a, v) => a + (v - m) * (v - m), 0) / lums.length);
    means.push(m); stds.push(sd);
  }
  const medStd = stds.sort((a, b) => a - b)[Math.floor(stds.length / 2)];
  const medMean = means.sort((a, b) => a - b)[Math.floor(means.length / 2)];
  // noisy margins, or paper that isn't paper-white → treat as scanned
  return medStd > 3.5 || (medMean > 120 && medMean < 246);
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

/**
 * Render replacement text to a slightly-softened raster (a PNG) instead of
 * crisp vector glyphs. On a scan, the original text is fixed-resolution and
 * goes soft/pixelated when zoomed — vector text stays razor sharp and screams
 * "edited". Rasterising at ~scan DPI with a hair of blur makes the edit
 * degrade the same way, so it disappears into the page.
 */
async function renderSoftText(
  text: string, fontKey: string, sizePt: number, color: [number, number, number]
): Promise<{ png: Uint8Array; wPt: number; hPt: number; belowBaselinePt: number; leftPadPt: number }> {
  const scale = 2;          // ~144 DPI — matches typical scans; pixelates like one when zoomed
  const css = cssFontFor(fontKey);
  const font = `${css.fontStyle} ${css.fontWeight} ${sizePt * scale}px ${css.fontFamily}`;
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = font;
  const tw = Math.max(1, Math.ceil(measure.measureText(text).width));
  const pad = Math.ceil(3 * scale);
  const ascent = Math.ceil(sizePt * scale * 0.92);
  const descent = Math.ceil(sizePt * scale * 0.32);
  const cw = tw + pad * 2, ch = ascent + descent + pad * 2;

  const c = document.createElement("canvas");
  c.width = cw; c.height = ch;
  const ctx = c.getContext("2d")!;
  ctx.filter = "blur(0.4px)";   // soften the crisp vector edges to scan-like
  ctx.font = font;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = `rgb(${color.map((v) => Math.round(v * 255)).join(",")})`;
  ctx.fillText(text, pad, pad + ascent);

  const blob = await new Promise<Blob>((res) => c.toBlob((b) => res(b!), "image/png"));
  const png = new Uint8Array(await blob.arrayBuffer());
  return { png, wPt: cw / scale, hPt: ch / scale, belowBaselinePt: (descent + pad) / scale, leftPadPt: pad / scale };
}

/**
 * Burn all edits into a fresh copy of the PDF. `soften` renders replacement
 * text as a scan-matched raster so it blends into low-quality/scanned pages.
 */
export async function applyEdits(
  data: ArrayBuffer, edits: PdfEdit[], opts: { soften?: boolean } = {}
): Promise<Uint8Array> {
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

    if (opts.soften) {
      const img = await renderSoftText(ed.newText, ed.fontKey || "Helvetica", size, ed.color ?? [0, 0, 0]);
      const emb = await doc.embedPng(img.png);
      page.drawImage(emb, {
        x: ed.pdfX - img.leftPadPt,
        y: ed.pdfY - img.belowBaselinePt,
        width: img.wPt,
        height: img.hPt,
      });
      continue;
    }

    // crisp vector path: character spacing keeps the original's tracking + footprint
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
