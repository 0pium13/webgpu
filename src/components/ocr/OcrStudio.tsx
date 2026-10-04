"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ModelLoader from "@/components/ModelLoader";
import { runOcr } from "@/lib/ocrClient";
import { OCR_MODEL_MB, type OcrProgress, type OcrResult, type Quad } from "@/lib/ocr";
import { loadPdfjs, openDoc } from "@/lib/pdf";
import { titleProgress, titleDone } from "@/lib/bgYield";

const MAX_PDF_PAGES = 30;
/** PDF pages render at ~200 DPI for A4 — enough for small print, light on memory. */
const PDF_LONG_SIDE = 2200;
const LOW_CONF = 0.75;

type Status = "queued" | "working" | "done" | "error";

interface Page {
  id: number;
  label: string;
  url: string | null;
  /** OCR coordinate space; 0 until known */
  w: number;
  h: number;
  status: Status;
  /** detector boxes, shown while lines are being read */
  quads: Quad[];
  result: OcrResult | null;
  text: string;
  error?: string;
  canRetry: boolean;
}

type Stage =
  | { kind: "idle" }
  | { kind: "download"; pct: number }
  | { kind: "warmup" }
  | { kind: "detect" }
  | { kind: "read"; done: number; total: number };

type Source = () => Promise<Blob | ImageBitmap>;

const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);
const pts = (q: Quad) => q.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");

async function renderPdfPage(doc: any, n: number): Promise<HTMLCanvasElement> {
  const page = await doc.getPage(n);
  const vp1 = page.getViewport({ scale: 1 });
  const vp = page.getViewport({ scale: Math.min(3, PDF_LONG_SIDE / Math.max(vp1.width, vp1.height)) });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(vp.width);
  canvas.height = Math.ceil(vp.height);
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: ctx, viewport: vp }).promise;
  page.cleanup?.();
  return canvas;
}

const toBlob = (c: HTMLCanvasElement, type: string, q?: number) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), type, q));

export default function OcrStudio({ files, onReset }: { files: File[]; onReset: () => void }) {
  const [pages, setPages] = useState<Page[]>([]);
  const [active, setActive] = useState(0);
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [boxesOn, setBoxesOn] = useState(true);
  const [hoverLine, setHoverLine] = useState<number | null>(null);
  const [caretLine, setCaretLine] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const follow = useRef(true);
  const sources = useRef(new Map<number, Source>());
  const editor = useRef<EditorHandle>(null);
  const runPage = useRef<(id: number) => Promise<void>>(async () => {});

  useEffect(() => {
    let alive = true;
    const abort = new AbortController();
    const urls: string[] = [];
    const docs: any[] = [];
    const order: number[] = [];
    let nextId = 0;
    // OcrStudio is keyed per job, so state starts fresh; this only matters for StrictMode's re-run
    sources.current.clear();
    follow.current = true;

    const patch = (id: number, p: Partial<Page>) =>
      setPages((ps) => ps.map((x) => (x.id === id ? { ...x, ...p } : x)));
    const blank = (label: string, url: string | null): Page =>
      ({ id: nextId++, label, url, w: 0, h: 0, status: "queued", quads: [], result: null, text: "", canRetry: true });

    const onProgress = (id: number) => (p: OcrProgress) => {
      if (!alive) return;
      if (p.step === "download") setStage({ kind: "download", pct: p.pct });
      else if (p.step === "warmup") setStage({ kind: "warmup" });
      else if (p.step === "detect") setStage({ kind: "detect" });
      else if (p.step === "boxes") {
        patch(id, { quads: p.quads, w: p.width, h: p.height });
        setStage({ kind: "read", done: 0, total: p.quads.length });
      } else setStage({ kind: "read", done: p.done, total: p.total });
    };

    async function run(id: number) {
      const src = sources.current.get(id);
      if (!src || !alive) return;
      patch(id, { status: "working", error: undefined, quads: [], result: null });
      setStage({ kind: "idle" });
      if (follow.current) setActive(order.indexOf(id));
      try {
        const s = await src();
        try {
          const result = await runOcr(s, onProgress(id), abort.signal);
          if (alive) patch(id, { status: "done", result, text: result.text, w: result.width, h: result.height });
        } finally {
          if (!(s instanceof Blob)) s.close();
        }
      } catch (e) {
        if (!alive) return;
        console.error(e);
        const msg = e instanceof Error ? e.message : String(e);
        if (alive) patch(id, { status: "error", error: /decode|source image|InvalidState/i.test(msg) ? "Couldn't open this image — try a JPG or PNG." : msg });
      }
    }
    runPage.current = run;

    (async () => {
      const added: Page[] = [];
      for (const f of files) {
        if (!alive) return;
        if (!isPdf(f)) {
          const url = URL.createObjectURL(f);
          urls.push(url);
          const pg = blank(f.name, url);
          sources.current.set(pg.id, async () => f);
          added.push(pg);
          order.push(pg.id);
          continue;
        }
        try {
          const pdfjs = await loadPdfjs();
          const doc = await openDoc(pdfjs, await f.arrayBuffer()).promise;
          docs.push(doc);
          const n = Math.min(doc.numPages, MAX_PDF_PAGES);
          const base = f.name.replace(/\.pdf$/i, "");
          for (let i = 1; i <= n; i++) {
            const pg = blank(doc.numPages > 1 ? `${base} · p${i}` : f.name, null);
            // the preview JPEG doubles as the "Try again" source once the doc is closed
            let preview: Blob | null = null;
            sources.current.set(pg.id, async () => {
              if (preview) return preview;
              const canvas = await renderPdfPage(doc, i);
              preview = await toBlob(canvas, "image/jpeg", 0.92);
              const url = URL.createObjectURL(preview);
              urls.push(url);
              if (alive) patch(pg.id, { url, w: canvas.width, h: canvas.height });
              const bmp = await createImageBitmap(canvas);
              canvas.width = canvas.height = 0;
              return bmp;
            });
            added.push(pg);
            order.push(pg.id);
          }
          if (doc.numPages > MAX_PDF_PAGES) setNote(`Long PDF — reading the first ${MAX_PDF_PAGES} of ${doc.numPages} pages.`);
        } catch (e) {
          console.error(e);
          const pg = blank(f.name, null);
          added.push({ ...pg, status: "error", error: "Couldn't open this PDF — is it password-protected?", canRetry: false });
        }
      }
      if (!alive) return;
      setPages(added);
      for (let k = 0; k < order.length; k++) {
        if (!alive) return;
        if (order.length > 1) titleProgress("Reading", (k / order.length) * 100);
        await run(order[k]);
      }
      if (!alive) return;
      setStage({ kind: "idle" });
      if (!order.length) return;
      for (const d of docs.splice(0)) d.destroy?.();
      titleDone("Text ready");
    })();

    return () => {
      alive = false;
      abort.abort();
      for (const u of urls) URL.revokeObjectURL(u);
      for (const d of docs) d.destroy?.();
      titleProgress(null);
    };
  }, [files]);

  const page = pages[active];
  const busy = pages.some((p) => p.status === "working" || p.status === "queued");
  const doneCount = pages.filter((p) => p.status === "done").length;

  // textarea line ↔ result row (blank paragraph-break lines map to nothing)
  const { lineToRow, rowToLine } = useMemo(() => {
    const l2r: (number | null)[] = [];
    const r2l: number[] = [];
    page?.result?.rows.forEach((r, i) => {
      if (r.gapBefore) l2r.push(null);
      r2l[i] = l2r.length;
      l2r.push(i);
    });
    return { lineToRow: l2r, rowToLine: r2l };
  }, [page?.result]);

  const hl = hoverLine ?? caretLine;
  const hlRow = hl != null ? lineToRow[hl] ?? null : null;

  function pick(i: number) {
    follow.current = false;
    setActive(i);
    setHoverLine(null);
    setCaretLine(null);
  }

  function editText(t: string) {
    if (!page) return;
    setPages((ps) => ps.map((x) => (x.id === page.id ? { ...x, text: t } : x)));
  }

  function allText() {
    if (pages.length === 1) return pages[0].text;
    return pages.filter((p) => p.text).map((p) => `--- ${p.label} ---\n${p.text}`).join("\n\n");
  }

  function download() {
    const base = (files[0]?.name ?? "text").replace(/\.[^.]+$/, "");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([allText()], { type: "text/plain;charset=utf-8" }));
    a.download = `${base}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const status = stageLabel(stage, busy, pages.length, doneCount);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <style>{CSS}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)", minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
          {busy && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", animation: "pulse 1s ease-in-out infinite", flexShrink: 0 }} />}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {busy ? status : pages.length > 1 ? `${doneCount} of ${pages.length} pages read` : page?.label}
          </span>
        </p>
        <button onClick={onReset} style={ghost}>← New file</button>
      </div>
      {note && <p style={{ fontSize: 12.5, color: "var(--amber)", marginTop: -6 }}>{note}</p>}

      {pages.length > 1 && (
        <div className="ocr-strip" role="tablist" aria-label="Pages">
          {pages.map((p, i) => (
            <button key={p.id} role="tab" aria-selected={i === active} onClick={() => pick(i)} className="ocr-thumb" data-on={i === active || undefined}>
              {p.url ? <img src={p.url} alt="" /> : <span className="ocr-thumb-blank" />}
              <span className="mono ocr-thumb-n" data-state={p.status}>{p.status === "done" ? "✓" : p.status === "error" ? "!" : i + 1}</span>
            </button>
          ))}
        </div>
      )}

      {page && (
        <div className="ocr-grid">
          <div className="ocr-img-col">
            <ImagePanel
              page={page}
              boxesOn={boxesOn}
              onToggle={() => setBoxesOn((v) => !v)}
              hlRow={hlRow}
              onHoverRow={(r) => setHoverLine(r == null ? null : rowToLine[r] ?? null)}
              onPickRow={(r) => {
                const line = rowToLine[r];
                if (line == null) return;
                setCaretLine(line);
                if (window.matchMedia("(pointer: fine)").matches) editor.current?.selectLine(line);
              }}
            />
          </div>

          <div className="ocr-text-col">
            {page.status === "done" && page.result ? (
              <ResultPanel
                page={page}
                hl={hl}
                editorRef={editor}
                onText={editText}
                onHoverLine={setHoverLine}
                onCaretLine={setCaretLine}
                multi={pages.length > 1}
                allText={allText}
                onDownload={download}
              />
            ) : page.status === "error" ? (
              <div style={{ ...panel, minHeight: 200, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, textAlign: "center" }}>
                <p style={{ color: "#ef4444", fontSize: 14, maxWidth: 360 }}>{page.error ?? "Something went wrong"}</p>
                {page.canRetry && !busy && (
                  <button onClick={() => void runPage.current(page.id)} style={primary}>Try again</button>
                )}
              </div>
            ) : stage.kind === "download" && page.status === "working" ? (
              <div style={{ ...panel, padding: 0, overflow: "hidden" }}>
                <ModelLoader pct={stage.pct} title="Hindi + English reader is waking up" sub={`${OCR_MODEL_MB} MB · downloads once, cached after`} />
              </div>
            ) : (
              <ReadingSkeleton label={page.status === "queued" ? "Waiting for earlier pages…" : status} stage={stage} />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function stageLabel(s: Stage, busy: boolean, pages: number, done: number): string {
  const prefix = pages > 1 && busy ? `Page ${Math.min(done + 1, pages)} of ${pages} · ` : "";
  switch (s.kind) {
    case "download": return `${prefix}Downloading reader… ${s.pct}%`;
    case "warmup": return `${prefix}Warming up your GPU…`;
    case "detect": return `${prefix}Finding text…`;
    case "read": return s.total ? `${prefix}Reading line ${Math.min(s.done + 1, s.total)} of ${s.total}` : `${prefix}No text found`;
    default: return busy ? `${prefix}Preparing…` : "";
  }
}

function ImagePanel({ page, boxesOn, onToggle, hlRow, onHoverRow, onPickRow }: {
  page: Page;
  boxesOn: boolean;
  onToggle: () => void;
  hlRow: number | null;
  onHoverRow: (r: number | null) => void;
  onPickRow: (r: number) => void;
}) {
  const working = page.status === "working" || page.status === "queued";
  const res = page.result;
  // box index → row, for highlight + click-through
  const boxRow = useMemo(() => {
    const m: number[] = [];
    res?.rows.forEach((r, ri) => r.boxes.forEach((b) => { m[b] = ri; }));
    return m;
  }, [res]);

  return (
    <div className="ocr-stage">
      {page.url ? (
        <div className="ocr-frame">
          <img src={page.url} alt={page.label} className="ocr-img" />
          {boxesOn && page.w > 0 && (
            <svg viewBox={`0 0 ${page.w} ${page.h}`} preserveAspectRatio="none" className="ocr-svg" onMouseLeave={() => onHoverRow(null)}>
              {res
                ? res.boxes.map((b, i) => {
                    const row = boxRow[i];
                    const on = row != null && row === hlRow;
                    const low = b.score < LOW_CONF;
                    return (
                      <polygon
                        key={i}
                        points={pts(b.quad)}
                        className="ocr-box"
                        style={{ animationDelay: `${Math.min(i, 40) * 12}ms` }}
                        fill={on ? "rgba(228,192,120,0.30)" : low ? "rgba(245,158,11,0.10)" : "rgba(228,192,120,0.07)"}
                        stroke={low ? "var(--amber)" : "var(--accent)"}
                        strokeOpacity={on ? 1 : 0.75}
                        strokeWidth={on ? 2 : 1.25}
                        vectorEffect="non-scaling-stroke"
                        onMouseEnter={() => row != null && onHoverRow(row)}
                        onClick={() => row != null && onPickRow(row)}
                      >
                        <title>{`${b.text}  ·  ${Math.round(b.score * 100)}%`}</title>
                      </polygon>
                    );
                  })
                : page.quads.map((q, i) => (
                    <polygon
                      key={i}
                      points={pts(q)}
                      className="ocr-box ocr-box-pending"
                      style={{ animationDelay: `${Math.min(i, 40) * 15}ms` }}
                      fill="rgba(228,192,120,0.06)"
                      stroke="var(--accent)"
                      strokeWidth={1.25}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
            </svg>
          )}
          {working && <div className="ocr-beam" />}
        </div>
      ) : (
        <div className="ocr-frame-blank">
          <span className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>{page.status === "error" ? "—" : "Rendering page…"}</span>
        </div>
      )}
      {(res?.boxes.length ?? 0) > 0 && (
        <button onClick={onToggle} className="ocr-chip" aria-pressed={boxesOn}>
          <span style={{ width: 6, height: 6, borderRadius: 2, border: "1px solid currentColor", background: boxesOn ? "currentColor" : "transparent" }} />
          Boxes
        </button>
      )}
    </div>
  );
}

function ReadingSkeleton({ label, stage }: { label: string; stage: Stage }) {
  const n = stage.kind === "read" ? Math.max(3, Math.min(9, stage.total)) : 6;
  const pct = stage.kind === "read" && stage.total ? (stage.done / stage.total) * 100 : stage.kind === "warmup" ? 8 : 3;
  return (
    <div style={{ ...panel, minHeight: 240 }}>
      <p className="mono" style={kicker}>Extracted text</p>
      <div style={{ display: "grid", gap: 12, margin: "18px 0 22px" }}>
        {Array.from({ length: n }, (_, i) => (
          <span key={i} className="ocr-skel" style={{ width: `${[92, 78, 86, 64, 88, 71, 83, 58, 75][i % 9]}%`, animationDelay: `${i * 0.09}s` }} />
        ))}
      </div>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 10 }}>{label}</p>
      <div style={{ height: 3, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)", transition: "width 0.3s var(--ease-lux)" }} />
      </div>
    </div>
  );
}

function ResultPanel({ page, hl, editorRef, onText, onHoverLine, onCaretLine, multi, allText, onDownload }: {
  page: Page;
  hl: number | null;
  editorRef: React.RefObject<EditorHandle | null>;
  onText: (t: string) => void;
  onHoverLine: (l: number | null) => void;
  onCaretLine: (l: number | null) => void;
  multi: boolean;
  allText: () => string;
  onDownload: () => void;
}) {
  const res = page.result!;
  const [copied, setCopied] = useState<"page" | "all" | null>(null);
  const low = res.boxes.filter((b) => b.score < LOW_CONF).length;
  const lines = res.rows.length;

  async function copy(which: "page" | "all") {
    const t = which === "all" ? allText() : page.text;
    try {
      await navigator.clipboard.writeText(t);
    } catch {
      editorRef.current?.selectAll();
      document.execCommand("copy");
    }
    setCopied(which);
    setTimeout(() => setCopied(null), 1600);
  }

  return (
    <div style={{ ...panel, padding: 0, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "16px 18px 12px" }}>
        <p className="mono" style={kicker}>Extracted text</p>
        <p className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {lines} {lines === 1 ? "line" : "lines"} · {(res.ms.total / 1000).toFixed(res.ms.total < 10000 ? 2 : 1)}s · {res.device === "webgpu" ? "GPU" : "CPU"}
        </p>
      </div>
      {lines === 0 ? (
        <div style={{ padding: "28px 18px 34px", textAlign: "center" }}>
          <p style={{ fontSize: 15, color: "var(--text)", marginBottom: 6 }}>No text found</p>
          <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.6, maxWidth: 340, margin: "0 auto" }}>
            Printed text works best. Handwriting isn&apos;t supported yet — and very small or blurry text may need a closer photo.
          </p>
        </div>
      ) : (
        <div style={{ padding: "0 10px" }}>
          <LineEditor ref={editorRef} text={page.text} hl={hl} onText={onText} onHoverLine={onHoverLine} onCaretLine={onCaretLine} />
        </div>
      )}
      {low > 0 && (
        <p style={{ fontSize: 12, color: "var(--text-muted)", padding: "10px 18px 0", lineHeight: 1.5 }}>
          <span style={{ color: "var(--amber)" }}>■</span> {low} {low === 1 ? "box" : "boxes"} read with low confidence — worth a quick check.
        </p>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "14px 18px 18px" }}>
        <button onClick={() => copy("page")} disabled={!page.text} style={{ ...primary, minWidth: 108 }}>
          {copied === "page" ? "Copied ✓" : multi ? "Copy page" : "Copy text"}
        </button>
        {multi && <button onClick={() => copy("all")} style={secondary}>{copied === "all" ? "Copied ✓" : "Copy all"}</button>}
        <button onClick={onDownload} style={secondary}>↓ .txt{multi && <span style={sub}> · all pages</span>}</button>
      </div>
    </div>
  );
}

export type EditorHandle = { selectLine: (i: number) => void; selectAll: () => void };

const EDIT_FONT: React.CSSProperties = {
  fontSize: 15, lineHeight: "27px", padding: "8px 10px 12px", fontFamily: "inherit", letterSpacing: "normal",
  whiteSpace: "pre-wrap", overflowWrap: "break-word", wordBreak: "normal", tabSize: 4, margin: 0, border: "none",
};

/**
 * Auto-growing textarea over an invisible mirror of its own text: the mirror
 * sets the height (no inner scrollbar) and paints the highlight band behind
 * the hovered/caret line, and its line boxes map mouse Y → line index.
 */
function LineEditor({ ref, text, hl, onText, onHoverLine, onCaretLine }: {
  ref: React.Ref<EditorHandle | null>;
  text: string;
  hl: number | null;
  onText: (t: string) => void;
  onHoverLine: (l: number | null) => void;
  onCaretLine: (l: number | null) => void;
}) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const lines = useMemo(() => text.split("\n"), [text]);

  useEffect(() => {
    const h: EditorHandle = {
      selectLine(i) {
        const el = ta.current;
        if (!el) return;
        let start = 0;
        for (let k = 0; k < i && k < lines.length; k++) start += lines[k].length + 1;
        el.focus({ preventScroll: true });
        el.setSelectionRange(start, start + (lines[i]?.length ?? 0));
        (mirror.current?.children[i] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      },
      selectAll() { ta.current?.select(); },
    };
    if (typeof ref === "function") ref(h);
    else if (ref) (ref as React.RefObject<EditorHandle | null>).current = h;
  }, [ref, lines]);

  function caret() {
    const el = ta.current;
    if (!el || document.activeElement !== el) return;
    onCaretLine(text.slice(0, el.selectionStart).split("\n").length - 1);
  }

  function hover(e: React.MouseEvent) {
    const m = mirror.current;
    if (!m) return;
    const y = e.clientY - m.getBoundingClientRect().top;
    const kids = m.children;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i] as HTMLElement;
      if (y >= k.offsetTop && y < k.offsetTop + k.offsetHeight) { onHoverLine(i); return; }
    }
    onHoverLine(null);
  }

  return (
    <div style={{ position: "relative" }}>
      <div ref={mirror} aria-hidden style={{ ...EDIT_FONT, color: "transparent", minHeight: 160, pointerEvents: "none", userSelect: "none" }}>
        {lines.map((l, i) => (
          <div key={i} className="ocr-line" data-on={i === hl || undefined}>{l || "​"}</div>
        ))}
      </div>
      <textarea
        ref={ta}
        value={text}
        spellCheck={false}
        aria-label="Extracted text"
        onChange={(e) => { onText(e.target.value); requestAnimationFrame(caret); }}
        onSelect={caret}
        onKeyUp={caret}
        onFocus={caret}
        onBlur={() => onCaretLine(null)}
        onMouseMove={hover}
        onMouseLeave={() => onHoverLine(null)}
        style={{
          ...EDIT_FONT, position: "absolute", inset: 0, width: "100%", height: "100%", resize: "none", overflow: "hidden",
          background: "transparent", color: "var(--text)", outline: "none", caretColor: "var(--accent)",
        }}
      />
    </div>
  );
}

const CSS = `
.ocr-grid { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; }
@media (min-width: 900px) {
  .ocr-grid { grid-template-columns: minmax(0, 1.05fr) minmax(0, 1fr); align-items: start; }
  .ocr-img-col { position: sticky; top: 84px; }
}
.ocr-stage { position: relative; display: flex; justify-content: center; align-items: center; background: var(--surface); border: 0.5px solid var(--border); border-radius: 16px; padding: 12px; min-height: 180px; }
.ocr-frame { position: relative; display: inline-block; line-height: 0; max-width: 100%; border-radius: 8px; overflow: hidden; }
.ocr-img { display: block; max-width: 100%; max-height: 52vh; width: auto; height: auto; }
@media (min-width: 900px) { .ocr-img { max-height: calc(100vh - 150px); } }
.ocr-svg { position: absolute; inset: 0; width: 100%; height: 100%; }
.ocr-frame-blank { width: 100%; min-height: 260px; display: flex; align-items: center; justify-content: center; }
.ocr-box { cursor: pointer; animation: ocr-box-in 0.5s var(--ease-lux) both; transition: fill 0.15s ease, stroke-width 0.15s ease; }
.ocr-box-pending { cursor: default; animation: ocr-box-in 0.5s var(--ease-lux) both, ocr-breathe 1.6s ease-in-out 0.5s infinite; }
@keyframes ocr-box-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes ocr-breathe { 0%, 100% { stroke-opacity: 0.9; } 50% { stroke-opacity: 0.35; } }
.ocr-beam { position: absolute; left: 0; right: 0; top: 0; height: 2px; pointer-events: none;
  background: linear-gradient(90deg, transparent, var(--accent) 30%, var(--accent) 70%, transparent);
  box-shadow: 0 0 22px 6px rgba(228, 192, 120, 0.28);
  animation: ocr-beam 2.2s var(--ease-lux) infinite alternate; }
@keyframes ocr-beam { from { top: 0%; } to { top: calc(100% - 2px); } }
.ocr-chip { position: absolute; top: 20px; right: 20px; display: inline-flex; align-items: center; gap: 7px;
  font-size: 12px; color: var(--text); background: rgba(11, 10, 8, 0.72); backdrop-filter: blur(8px);
  border: 0.5px solid var(--border-strong); border-radius: 999px; padding: 6px 11px; cursor: pointer; }
.ocr-chip[aria-pressed="true"] { color: var(--accent); }
.ocr-skel { display: block; height: 10px; border-radius: 6px;
  background: linear-gradient(90deg, var(--surface-2) 0%, rgba(228, 192, 120, 0.16) 50%, var(--surface-2) 100%);
  background-size: 200% 100%; animation: ocr-shimmer 1.4s ease-in-out infinite; }
@keyframes ocr-shimmer { from { background-position: 100% 0; } to { background-position: -100% 0; } }
.ocr-line { border-radius: 6px; margin: 0 -6px; padding: 0 6px; transition: background 0.15s ease, box-shadow 0.15s ease; }
.ocr-line[data-on] { background: rgba(228, 192, 120, 0.12); box-shadow: inset 2px 0 0 var(--accent); }
.ocr-strip { display: flex; gap: 8px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: thin; }
.ocr-thumb { position: relative; flex: 0 0 auto; width: 56px; height: 72px; border-radius: 8px; overflow: hidden; padding: 0;
  background: var(--surface-2); border: 0.5px solid var(--border); cursor: pointer; opacity: 0.6; transition: opacity 0.2s, border-color 0.2s; }
.ocr-thumb[data-on] { opacity: 1; border-color: var(--accent); }
.ocr-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ocr-thumb-blank { display: block; width: 100%; height: 100%; }
.ocr-thumb-n { position: absolute; right: 4px; bottom: 4px; font-size: 10px; line-height: 1; padding: 3px 4px; border-radius: 4px; background: rgba(11, 10, 8, 0.8); color: var(--text-secondary); }
.ocr-thumb-n[data-state="done"] { color: var(--green); }
.ocr-thumb-n[data-state="error"] { color: #ef4444; }
`;

const panel: React.CSSProperties = {
  background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 16, padding: "18px",
};
const kicker: React.CSSProperties = {
  fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--accent)", margin: 0,
};
const ghost: React.CSSProperties = {
  fontSize: 13, color: "var(--text-muted)", background: "transparent",
  border: "0.5px solid var(--border)", borderRadius: 8, padding: "7px 14px", cursor: "pointer", flexShrink: 0,
};
const primary: React.CSSProperties = {
  background: "var(--accent)", color: "var(--on-accent)", border: "none", borderRadius: 10,
  padding: "11px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer",
};
const secondary: React.CSSProperties = {
  background: "var(--surface-2)", color: "var(--text)", border: "0.5px solid var(--border)",
  borderRadius: 10, padding: "11px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer",
};
const sub: React.CSSProperties = { fontSize: 11, opacity: 0.6, fontWeight: 400 };
