"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { computeMask } from "@/lib/rmbgClient";
import { BgRemoveIcon } from "@/components/Icons";
import OutputOptionsPanel, { optionsSummary } from "./OutputOptions";
import ResultPreview from "./ResultPreview";
import {
  collectDropped, cutoutCanvas, encodeOutput, fileThumb, formatBytes,
  isImageFile, maskPng, optionsKey, outputDims, outputExt, outputName, productLayout, releaseCanvas, renderFromMask,
  thumbFrom, triggerDownload, type CutMeta, type OutputOptions,
} from "./compose";

type Status = "queued" | "processing" | "done" | "error";

interface Item {
  id: number;
  file: File;
  status: Status;
  /** small JPEG of the original ("" = couldn't decode) */
  thumb?: string;
  /** small transparent PNG of the cutout, for CSS-composited previews */
  cutThumb?: string;
  /** alpha mask PNG — with the original file, re-renders never need the model */
  mask?: Blob;
  meta?: CutMeta;
  out?: Blob;
  outKey?: string;
  error?: string;
  ms?: number;
}

export const MAX_BATCH = 200;
// keep each ZIP comfortably inside what a phone can hold in memory at once
const ZIP_PART_BYTES = 400e6;

/**
 * Rendered files kept ready for instant ZIP/download. Past this budget the
 * oldest are dropped and re-rendered on demand from file + mask, so a
 * 100-photo transparent batch can't pile up a gigabyte of PNGs on a phone.
 */
function outputBudget() {
  const gb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 3;
  return Math.min(1024, Math.max(256, gb * 96)) * 1e6;
}

let nextId = 1;
const newItem = (file: File): Item => ({ id: nextId++, file, status: "queued" });
const fileKey = (f: File) => `${f.name}|${f.size}|${f.lastModified}`;

function fmtDuration(ms: number) {
  const s = Math.max(1, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, "0")}s`;
}

function uniqueName(name: string, used: Map<string, number>) {
  const n = used.get(name) ?? 0;
  used.set(name, n + 1);
  return n === 0 ? name : name.replace(/(\.[^.]+)$/, `-${n + 1}$1`);
}

export default function BatchProcessor({
  initialFiles,
  options,
  onOptionsChange,
  onReset,
}: {
  initialFiles: File[];
  options: OutputOptions;
  onOptionsChange: (o: OutputOptions) => void;
  onReset: () => void;
}) {
  const [items, setItems] = useState<Item[]>(() => initialFiles.slice(0, MAX_BATCH).map(newItem));
  // async work reads/writes through the ref; React state follows via commit()
  const itemsRef = useRef(items);
  const commit = useCallback((next: Item[]) => {
    itemsRef.current = next;
    setItems(next);
  }, []);

  const optsRef = useRef(options);
  useEffect(() => { optsRef.current = options; }, [options]);

  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [modelPct, setModelPct] = useState<number | null>(null);
  const [modelReady, setModelReady] = useState(false);
  const [fallback, setFallback] = useState(false);
  const [notice, setNotice] = useState(() =>
    initialFiles.length > MAX_BATCH ? `Batch limit is ${MAX_BATCH} images — ${initialFiles.length - MAX_BATCH} not added.` : ""
  );
  const [zip, setZip] = useState<{ label: string; pct: number } | null>(null);
  const [drag, setDrag] = useState(false);
  const [view, setView] = useState<number | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const wide = useWide();

  const runRef = useRef(0);
  const activeRef = useRef(false);
  const inflightRef = useRef<Promise<unknown>>(Promise.resolve());
  const modelReadyRef = useRef(false);
  const aliveRef = useRef(true);
  const thumbBusy = useRef(false);

  const patch = useCallback((id: number, p: Partial<Item>) => {
    const list = itemsRef.current;
    const i = list.findIndex((it) => it.id === id);
    if (i < 0) return;
    const next = list.slice();
    next[i] = { ...list[i], ...p };
    commit(next);
  }, [commit]);

  const trimOutputs = useCallback((keepId: number) => {
    const list = itemsRef.current;
    const budget = outputBudget();
    let total = list.reduce((a, it) => a + (it.out?.size ?? 0), 0);
    if (total <= budget) return;
    const next = list.slice();
    for (let i = 0; i < next.length && total > budget; i++) {
      const it = next[i];
      if (!it.out || it.id === keepId) continue;
      total -= it.out.size;
      next[i] = { ...it, out: undefined, outKey: undefined };
    }
    commit(next);
  }, [commit]);

  const flash = useCallback((msg: string) => {
    setNotice(msg);
    window.setTimeout(() => aliveRef.current && setNotice((n) => (n === msg ? "" : n)), 4500);
  }, []);

  // ── thumbnails: decoded small, one at a time, never the full image ──
  const pumpThumbs = useCallback(async () => {
    if (thumbBusy.current) return;
    thumbBusy.current = true;
    try {
      for (;;) {
        const it = itemsRef.current.find((x) => x.thumb === undefined);
        if (!it || !aliveRef.current) break;
        let url = "";
        try { url = URL.createObjectURL(await fileThumb(it.file)); } catch { /* undecodable */ }
        if (!itemsRef.current.some((x) => x.id === it.id)) { if (url) URL.revokeObjectURL(url); continue; }
        patch(it.id, { thumb: url });
      }
    } finally {
      thumbBusy.current = false;
    }
  }, [patch]);

  useEffect(() => {
    const run = runRef;
    aliveRef.current = true;
    void pumpThumbs();
    return () => {
      aliveRef.current = false;
      run.current++; // stops the queue loop after its current image
      // deferred so a StrictMode remount doesn't lose its thumbnails
      window.setTimeout(() => {
        if (aliveRef.current) return;
        for (const it of itemsRef.current) {
          if (it.thumb) URL.revokeObjectURL(it.thumb);
          if (it.cutThumb) URL.revokeObjectURL(it.cutThumb);
        }
      }, 0);
    };
  }, [pumpThumbs]);

  const addFiles = useCallback((files: File[]) => {
    const list = itemsRef.current;
    const seen = new Set(list.map((it) => fileKey(it.file)));
    const imgs = files.filter(isImageFile);
    const fresh = imgs.filter((f) => { const k = fileKey(f); if (seen.has(k)) return false; seen.add(k); return true; });
    const room = MAX_BATCH - list.length;
    const take = fresh.slice(0, Math.max(0, room));
    const skipped = files.length - imgs.length;
    const dupes = imgs.length - fresh.length;
    if (fresh.length > take.length) flash(`Batch limit is ${MAX_BATCH} images — ${fresh.length - take.length} not added.`);
    else if (dupes || skipped) flash([dupes && `${dupes} duplicate${dupes > 1 ? "s" : ""}`, skipped && `${skipped} non-image file${skipped > 1 ? "s" : ""}`].filter(Boolean).join(" and ") + " skipped.");
    if (!take.length) return;
    commit([...list, ...take.map(newItem)]);
    void pumpThumbs();
  }, [commit, flash, pumpThumbs]);

  // ── the queue: strictly sequential through the one shared worker ──
  const processItem = useCallback(async (it: Item) => {
    patch(it.id, { status: "processing", error: undefined });
    let t0 = performance.now();
    try {
      const mask = await computeMask(it.file, {
        progress: (p) => {
          if (p.status === "progress" && p.total && p.loaded != null) setModelPct(Math.round((p.loaded / p.total) * 100));
        },
        onFallback: () => setFallback(true),
        onProcessing: () => {
          t0 = performance.now();
          modelReadyRef.current = true;
          setModelReady(true);
          setModelPct(null);
        },
      });
      if (!itemsRef.current.some((x) => x.id === it.id)) return;
      const { canvas, meta } = await cutoutCanvas(it.file, mask);
      try {
        const alpha = await maskPng(canvas);
        const thumb = await thumbFrom(canvas, meta.w, meta.h, 360);
        const o = optsRef.current;
        const out = await encodeOutput(canvas, meta, o);
        if (!aliveRef.current || !itemsRef.current.some((x) => x.id === it.id)) return;
        patch(it.id, { status: "done", mask: alpha, meta, out, outKey: optionsKey(o), cutThumb: URL.createObjectURL(thumb), ms: performance.now() - t0 });
        trimOutputs(it.id);
      } finally {
        releaseCanvas(canvas);
      }
    } catch (err) {
      console.error("[bg-remove batch]", err);
      if (!modelReadyRef.current) {
        // the model itself didn't load — failing every image would be noise
        patch(it.id, { status: "queued" });
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);
      patch(it.id, { status: "error", error: /decode|source|InvalidState|format/i.test(msg) ? "Couldn't read this image" : msg || "Failed" });
    }
  }, [patch, trimOutputs]);

  const runQueue = useCallback(async () => {
    const me = ++runRef.current;
    activeRef.current = true;
    setRunning(true);
    setStopped(false);
    // on phones, fold the settings away so the grid is what you watch
    if (!window.matchMedia(WIDE).matches) setPanelOpen(false);
    setNotice("");
    let lock: WakeLockSentinel | null = null;
    try { lock = (await navigator.wakeLock?.request("screen")) ?? null; } catch { /* unsupported / denied */ }
    try {
      // a cancelled run's last image may still be in the worker
      await inflightRef.current;
      while (runRef.current === me) {
        const next = itemsRef.current.find((x) => x.status === "queued");
        if (!next) break;
        const p = processItem(next);
        inflightRef.current = p.catch(() => {});
        await p;
      }
    } catch {
      if (aliveRef.current) flash("Couldn't load the AI model — check your connection and try again.");
    } finally {
      void lock?.release().catch(() => {});
      if (runRef.current === me) {
        activeRef.current = false;
        if (aliveRef.current) setRunning(false);
      }
    }
  }, [processItem, flash]);

  const cancel = useCallback(() => {
    runRef.current++;
    activeRef.current = false;
    setRunning(false);
    setStopped(true);
  }, []);

  useEffect(() => {
    if (!running) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [running]);

  const retryFailed = useCallback(() => {
    commit(itemsRef.current.map((it) => (it.status === "error" ? { ...it, status: "queued", error: undefined } : it)));
    void runQueue();
  }, [commit, runQueue]);

  const retryOne = useCallback((id: number) => {
    patch(id, { status: "queued", error: undefined });
    if (!activeRef.current) void runQueue();
  }, [patch, runQueue]);

  const remove = useCallback((id: number) => {
    const it = itemsRef.current.find((x) => x.id === id);
    if (!it || it.status === "processing") return;
    if (it.thumb) URL.revokeObjectURL(it.thumb);
    if (it.cutThumb) URL.revokeObjectURL(it.cutThumb);
    commit(itemsRef.current.filter((x) => x.id !== id));
    setView((v) => (v === id ? null : v));
  }, [commit]);

  /** Current-options file for an item, re-rendered from its cutout if stale. */
  const ensureOutput = useCallback(async (id: number): Promise<Blob> => {
    const it = itemsRef.current.find((x) => x.id === id);
    if (!it?.mask || !it.meta) throw new Error("Not processed yet");
    const o = optsRef.current;
    const key = optionsKey(o);
    if (it.out && it.outKey === key) return it.out;
    const out = await renderFromMask(it.file, it.mask, it.meta, o);
    if (optionsKey(optsRef.current) === key) {
      patch(id, { out, outKey: key });
      trimOutputs(id);
    }
    return out;
  }, [patch, trimOutputs]);

  const downloadOne = useCallback(async (id: number) => {
    const it = itemsRef.current.find((x) => x.id === id);
    if (!it) return;
    try {
      triggerDownload(await ensureOutput(id), outputName(it.file.name, optsRef.current));
    } catch (err) {
      flash(err instanceof Error ? err.message : "Download failed");
    }
  }, [ensureOutput, flash]);

  const downloadZip = useCallback(async () => {
    const done = itemsRef.current.filter((x) => x.status === "done");
    if (!done.length || zip) return;
    const o = optsRef.current;
    try {
      const { default: JSZip } = await import("jszip");
      const used = new Map<string, number>();
      const parts: { name: string; blob: Blob }[][] = [[]];
      let partBytes = 0;
      for (let i = 0; i < done.length; i++) {
        setZip({ label: `Preparing ${i + 1}/${done.length}`, pct: (i / done.length) * 70 });
        const blob = await ensureOutput(done[i].id);
        if (partBytes + blob.size > ZIP_PART_BYTES && parts[parts.length - 1].length) { parts.push([]); partBytes = 0; }
        parts[parts.length - 1].push({ name: uniqueName(outputName(done[i].file.name, o), used), blob });
        partBytes += blob.size;
      }
      for (let p = 0; p < parts.length; p++) {
        const z = new JSZip();
        for (const f of parts[p]) z.file(f.name, f.blob, { binary: true, date: new Date() });
        // images are already compressed; STORE keeps zipping instant
        const blob = await z.generateAsync({ type: "blob", compression: "STORE" }, (m) =>
          setZip({ label: "Zipping", pct: 70 + ((p + m.percent / 100) / parts.length) * 30 })
        );
        const suffix = parts.length > 1 ? `-part${p + 1}` : "";
        triggerDownload(blob, `nobg-${done.length}-images${suffix}.zip`);
      }
    } catch (err) {
      console.error(err);
      flash("Couldn't build the ZIP — try downloading images one by one.");
    } finally {
      if (aliveRef.current) setZip(null);
    }
  }, [ensureOutput, flash, zip]);

  // ── derived ──
  const total = items.length;
  const counts = useMemo(() => {
    const c = { queued: 0, processing: 0, done: 0, error: 0, bytes: 0, ms: 0, timed: 0 };
    for (const it of items) {
      c[it.status]++;
      c.bytes += it.file.size;
      if (it.ms) { c.ms += it.ms; c.timed++; }
    }
    return c;
  }, [items]);
  const finished = counts.done + counts.error;
  const remaining = counts.queued + counts.processing;
  const avg = counts.timed ? counts.ms / counts.timed : 0;
  const loadingModel = running && !modelReady;
  const pct = loadingModel ? (modelPct ?? 0) : total ? (finished / total) * 100 : 0;

  let title: string, sub: string;
  if (loadingModel) {
    title = modelPct != null && modelPct < 100 ? `Downloading AI model · ${modelPct}%` : "Preparing AI model…";
    sub = fallback ? "WebGPU unavailable — running on CPU" : "one-time ~44 MB, cached after this";
  } else if (running) {
    title = `Removing backgrounds · ${finished + 1 > total ? total : finished + 1} of ${total}`;
    sub = avg ? `~${fmtDuration(avg * remaining)} left · ${(avg / 1000).toFixed(1)}s per image` : fallback ? "running on CPU — slower, but private" : "first one warms up the GPU";
  } else if (counts.done && !remaining) {
    title = `All done · ${counts.done} image${counts.done > 1 ? "s" : ""}`;
    sub = counts.error ? `${counts.error} failed · ${optionsSummary(options)}` : optionsSummary(options);
  } else if (counts.done && stopped) {
    title = `Paused · ${finished} of ${total}`;
    sub = `${remaining} left · ${optionsSummary(options)}`;
  } else if (counts.done) {
    title = `${counts.queued} new image${counts.queued === 1 ? "" : "s"} ready`;
    sub = `${counts.done} done · ${optionsSummary(options)}`;
  } else {
    title = `${total} image${total === 1 ? "" : "s"} ready`;
    sub = `${formatBytes(counts.bytes)} · ${optionsSummary(options)}`;
  }

  const viewItem = view != null ? items.find((x) => x.id === view) ?? null : null;
  const doneIds = items.filter((x) => x.status === "done").map((x) => x.id);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    void collectDropped(e.dataTransfer).then(addFiles);
  };

  const panel = (
    <OutputOptionsPanel
      value={options}
      onChange={onOptionsChange}
      collapsed={!wide && !panelOpen}
      onToggleCollapsed={wide ? undefined : () => setPanelOpen((o) => !o)}
    />
  );

  const actionBar = (
    <div style={{ position: "sticky", top: 64, zIndex: 5, background: "rgba(20,18,14,0.86)", backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)", border: "0.5px solid var(--border)", borderRadius: 14, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, padding: "12px 14px" }}>
        <div style={{ minWidth: 0, flex: "1 1 200px" }}>
          <p style={{ fontSize: 14.5, fontWeight: 500, color: "var(--text)", display: "flex", alignItems: "center", gap: 8 }}>
            {running && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", animation: "pulse 1.4s ease-in-out infinite", flexShrink: 0 }} />}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{title}</span>
          </p>
          <p className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{sub}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", flex: wide ? "0 0 auto" : "1 1 100%" }}>
          {running ? (
            <button onClick={cancel} style={{ ...ghost, flex: wide ? undefined : 1 }}>Cancel</button>
          ) : (
            <>
              {counts.error > 0 && !counts.queued && (
                <button onClick={retryFailed} style={{ ...ghost, flex: wide ? undefined : 1 }}>Retry {counts.error} failed</button>
              )}
              {counts.queued > 0 && (
                <button onClick={() => void runQueue()} style={{ ...primary, flex: wide ? undefined : 1 }}>
                  <BgRemoveIcon size={16} />
                  {stopped ? `Resume · ${counts.queued} left` : `Remove backgrounds · ${counts.queued}`}
                </button>
              )}
            </>
          )}
          {counts.done > 0 && (
            <button onClick={() => void downloadZip()} disabled={!!zip} style={{ ...(running || counts.queued ? ghost : primary), flex: wide ? undefined : 1, opacity: zip ? 0.85 : 1, minWidth: 150 }}>
              {zip ? `${zip.label} · ${Math.round(zip.pct)}%` : <><DownloadGlyph /> Download all · ZIP</>}
            </button>
          )}
        </div>
      </div>
      <div style={{ height: 2, background: "rgba(245,240,225,0.06)" }}>
        <div style={{ height: "100%", width: `${zip ? zip.pct : pct}%`, background: "linear-gradient(90deg, var(--accent-3), var(--accent))", transition: "width 0.4s var(--ease-lux)" }} />
      </div>
    </div>
  );

  const body = (
    <>
      {notice && (
        <p role="status" style={{ fontSize: 12.5, color: "var(--amber)", background: "var(--amber-dim)", border: "0.5px solid rgba(245,158,11,0.25)", borderRadius: 10, padding: "8px 12px" }}>{notice}</p>
      )}

      <div
        style={{
          display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(132px, 1fr))", gap: 10,
          outline: drag ? "1px dashed var(--accent)" : "1px dashed transparent", outlineOffset: 6, borderRadius: 14,
          transition: "outline-color 0.2s",
        }}
      >
        {items.map((it) => (
          <Tile key={it.id} item={it} options={options} onRemove={remove} onRetry={retryOne} onDownload={downloadOne} onOpen={setView} running={running} />
        ))}
        {total < MAX_BATCH && <AddButton onFiles={addFiles} tile />}
      </div>

      <p className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)", lineHeight: 1.7 }}>
        Drop more images or a folder anywhere here · up to {MAX_BATCH} per batch · change output settings any time — finished images re-render instantly, no re-processing.
      </p>
    </>
  );

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!drag) setDrag(true); }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDrag(false); }}
      onDrop={onDrop}
      style={{ display: "flex", flexDirection: "column", gap: 16 }}
    >
      <style>{BATCH_CSS}</style>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8 }}>
          <span className="pill pill-accent" style={{ letterSpacing: "0.06em", textTransform: "uppercase", fontSize: 10 }}>Batch</span>
          {total} image{total === 1 ? "" : "s"} · {formatBytes(counts.bytes)}
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <AddButton onFiles={addFiles} disabled={total >= MAX_BATCH} compact />
          <button onClick={onReset} style={ghostSm}>← Start over</button>
        </div>
      </div>

      {wide ? (
        <div style={{ display: "grid", gridTemplateColumns: "300px minmax(0, 1fr)", gap: 16, alignItems: "start" }}>
          <div style={{ position: "sticky", top: 72 }}>{panel}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
            {actionBar}
            {body}
          </div>
        </div>
      ) : (
        // phone: the sticky action bar leads, so Start/Cancel/ZIP never scroll away
        <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
          {actionBar}
          {panel}
          {body}
        </div>
      )}

      {viewItem && (
        <Lightbox
          item={viewItem}
          options={options}
          ensureOutput={ensureOutput}
          onClose={() => setView(null)}
          onDownload={downloadOne}
          onStep={(d) => {
            const i = doneIds.indexOf(viewItem.id);
            if (i < 0 || !doneIds.length) return;
            setView(doneIds[(i + d + doneIds.length) % doneIds.length]);
          }}
          count={doneIds.length}
          index={doneIds.indexOf(viewItem.id)}
        />
      )}
    </div>
  );
}

/* ─────────────────────────── tile ─────────────────────────── */

const Tile = memo(function Tile({
  item: it, options, onRemove, onRetry, onDownload, onOpen, running,
}: {
  item: Item;
  options: OutputOptions;
  onRemove: (id: number) => void;
  onRetry: (id: number) => void;
  onDownload: (id: number) => void;
  onOpen: (id: number) => void;
  running: boolean;
}) {
  const done = it.status === "done" && it.cutThumb && it.meta;
  return (
    <div className="bgr-tile" style={{ position: "relative", borderRadius: 12, overflow: "hidden", background: "var(--surface)", border: it.status === "processing" ? "0.5px solid var(--accent-border)" : "0.5px solid var(--border)", transition: "border-color 0.3s" }}>
      <div style={{ position: "relative", aspectRatio: "1", background: "var(--surface-2)", overflow: "hidden" }}>
        {done ? (
          <button onClick={() => onOpen(it.id)} aria-label={`Preview ${it.file.name}`} style={{ position: "absolute", inset: 0, padding: 0, border: "none", background: "none", cursor: "zoom-in", animation: "fadein 0.5s var(--ease-lux) both" }}>
            <ResultPreview src={it.cutThumb!} meta={it.meta!} options={options} />
          </button>
        ) : it.thumb ? (
          <img
            src={it.thumb}
            alt=""
            draggable={false}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", maxWidth: "none", objectFit: "cover", opacity: it.status === "processing" ? 0.75 : it.status === "error" ? 0.3 : 0.5, filter: it.status === "queued" ? "saturate(0.55)" : "none", transition: "opacity 0.3s" }}
          />
        ) : (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-dim)" }}>
            {it.thumb === undefined ? <span className="bgr-shimmer" style={{ position: "absolute", inset: 0 }} /> : <span className="mono" style={{ fontSize: 10 }}>no preview</span>}
          </div>
        )}

        {it.status === "processing" && (
          <>
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(11,10,8,0) 40%, rgba(11,10,8,0.55))" }} />
            <div className="bgr-scan" />
            <span style={{ ...badge, background: "rgba(228,192,120,0.92)", color: "var(--on-accent)" }}>Removing…</span>
          </>
        )}
        {it.status === "queued" && running && <span style={{ ...badge, background: "rgba(0,0,0,0.55)", color: "rgba(255,255,255,0.75)" }}>Queued</span>}
        {it.status === "error" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, padding: 12, textAlign: "center" }}>
            <p style={{ fontSize: 11.5, color: "#fca5a5", lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }} title={it.error}>{it.error ?? "Failed"}</p>
            <button onClick={() => onRetry(it.id)} style={{ fontSize: 11.5, color: "var(--text)", background: "rgba(0,0,0,0.5)", border: "0.5px solid var(--border-strong)", borderRadius: 999, padding: "4px 12px", cursor: "pointer" }}>Retry</button>
          </div>
        )}
        {it.status !== "processing" && (
          <button className="bgr-x" onClick={() => onRemove(it.id)} aria-label={`Remove ${it.file.name}`} title="Remove" style={{ position: "absolute", top: 6, right: 6, width: 24, height: 24, borderRadius: "50%", border: "none", background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)", color: "#fff", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0 }}>
            <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden><path d="M2 2l6 6M8 2l-6 6" /></svg>
          </button>
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 6px 6px 10px", minHeight: 36 }}>
        <span className="mono" title={it.file.name} style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: it.status === "done" ? "var(--text-secondary)" : "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.file.name}</span>
        {it.status === "done" && (
          <button onClick={() => onDownload(it.id)} aria-label={`Download ${it.file.name}`} title={`Download ${outputExt(options).toUpperCase()}`} style={{ width: 26, height: 26, borderRadius: 8, border: "0.5px solid var(--border)", background: "var(--surface-2)", color: "var(--accent)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0, flexShrink: 0 }}>
            <DownloadGlyph size={13} />
          </button>
        )}
        {it.status === "error" && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#ef4444", marginRight: 8, flexShrink: 0 }} />}
      </div>
    </div>
  );
});

/* ─────────────────────────── lightbox ─────────────────────────── */

function Lightbox({
  item, options, ensureOutput, onClose, onDownload, onStep, count, index,
}: {
  item: Item;
  options: OutputOptions;
  ensureOutput: (id: number) => Promise<Blob>;
  onClose: () => void;
  onDownload: (id: number) => void;
  onStep: (d: number) => void;
  count: number;
  index: number;
}) {
  const [showOriginal, setShowOriginal] = useState(false);
  const [size, setSize] = useState(0);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight") onStep(1);
      else if (e.key === "ArrowLeft") onStep(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onStep]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  const [w, h] = item.meta ? outputDims(item.meta, options) : [0, 0];
  const transparent = options.mode === "transparent";
  const upscale = options.mode === "product" && item.meta ? productLayout(item.meta, options.size, options.margin).s : 0;

  // portalled: the page wrapper animates with a transform, which would
  // otherwise become the containing block for position: fixed
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={`Preview ${item.file.name}`} onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(8,7,5,0.86)", backdropFilter: "blur(14px)", WebkitBackdropFilter: "blur(14px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16, animation: "fadein 0.25s var(--ease-lux) both" }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 720, maxHeight: "100%", display: "flex", flexDirection: "column", gap: 12, background: "var(--surface)", border: "0.5px solid var(--border-strong)", borderRadius: 16, padding: 12, boxShadow: "0 40px 120px -30px rgba(0,0,0,0.9)" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "2px 2px 0 6px" }}>
          <p className="mono" style={{ fontSize: 11.5, color: "var(--text-secondary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{item.file.name}</p>
          <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
            <div style={{ display: "flex", background: "var(--canvas)", border: "0.5px solid var(--border)", borderRadius: 9, padding: 2 }}>
              {(["Result", "Original"] as const).map((l, i) => {
                const on = showOriginal === (i === 1);
                return <button key={l} onClick={() => setShowOriginal(i === 1)} style={{ fontSize: 11.5, padding: "4px 10px", borderRadius: 7, border: "none", cursor: "pointer", background: on ? "var(--surface-2)" : "transparent", color: on ? "var(--text)" : "var(--text-muted)" }}>{l}</button>;
              })}
            </div>
            <button onClick={onClose} aria-label="Close preview" style={{ ...iconBtn }}>
              <svg width="11" height="11" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden><path d="M2 2l6 6M8 2l-6 6" /></svg>
            </button>
          </div>
        </div>

        <div style={{ position: "relative", flex: 1, minHeight: 0, aspectRatio: w && h ? `${w} / ${h}` : "1", maxHeight: "calc(100dvh - 180px)", margin: "0 auto", width: "100%", borderRadius: 10, overflow: "hidden", background: transparent && !showOriginal ? CHECKER : "#0d0c0a" }}>
          {showOriginal ? (
            <BlobImage key={`o${item.id}`} load={() => Promise.resolve(item.file)} alt="original" />
          ) : (
            <BlobImage key={`r${item.id}|${optionsKey(options)}`} load={() => ensureOutput(item.id)} onSize={setSize} alt="result" />
          )}
          {count > 1 && (
            <>
              <button onClick={() => onStep(-1)} aria-label="Previous image" style={{ ...navBtn, left: 8 }}>‹</button>
              <button onClick={() => onStep(1)} aria-label="Next image" style={{ ...navBtn, right: 8 }}>›</button>
            </>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", padding: "0 2px 2px 6px" }}>
          <p className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>
            {w}×{h} · {outputExt(options).toUpperCase()}{size ? ` · ${formatBytes(size)}` : ""}{count > 1 ? ` · ${index + 1}/${count}` : ""}
            {upscale > 1.5 && <span style={{ color: "var(--amber)" }}> · small source, upscaled {upscale.toFixed(1)}×</span>}
          </p>
          <button onClick={() => onDownload(item.id)} style={{ ...primary, padding: "9px 18px", fontSize: 13.5 }}>
            <DownloadGlyph /> Download {outputExt(options).toUpperCase()}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Loads a blob once per mount (callers key it) and owns its object URL. */
function BlobImage({ load, alt, onSize }: { load: () => Promise<Blob>; alt: string; onSize?: (n: number) => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const loadRef = useRef(load);
  const sizeRef = useRef(onSize);
  useEffect(() => {
    let live = true;
    let made: string | null = null;
    loadRef.current().then((b) => {
      if (!live) return;
      made = URL.createObjectURL(b);
      setUrl(made);
      sizeRef.current?.(b.size);
    }).catch(() => {});
    return () => { live = false; if (made) URL.revokeObjectURL(made); };
  }, []);
  if (!url) {
    return (
      <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span style={{ width: 22, height: 22, borderRadius: "50%", border: "2px solid rgba(255,255,255,0.12)", borderTopColor: "var(--accent)", animation: "spin 0.8s linear infinite" }} />
      </div>
    );
  }
  return <img src={url} alt={alt} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", maxWidth: "none", objectFit: "contain", animation: "fadein 0.3s var(--ease-lux) both" }} />;
}

/* ─────────────────────────── bits ─────────────────────────── */

function AddButton({ onFiles, disabled, compact, tile }: { onFiles: (f: File[]) => void; disabled?: boolean; compact?: boolean; tile?: boolean }) {
  const input = (
    <input
      type="file"
      accept="image/*"
      multiple
      disabled={disabled}
      style={{ display: "none" }}
      onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) onFiles(f); }}
    />
  );
  if (tile) {
    return (
      <label className="bgr-add" style={{ borderRadius: 12, border: "0.5px dashed var(--border-strong)", background: "transparent", minHeight: 120, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8, cursor: "pointer", color: "var(--text-muted)", aspectRatio: "1 / 1.27" }}>
        {input}
        <span style={{ width: 34, height: 34, borderRadius: 10, border: "0.5px solid var(--border)", background: "var(--surface)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)" }}>
          <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden><path d="M7 2v10M2 7h10" /></svg>
        </span>
        <span style={{ fontSize: 12.5 }}>Add images</span>
      </label>
    );
  }
  return (
    <label style={{ ...ghostSm, opacity: disabled ? 0.4 : 1, cursor: disabled ? "default" : "pointer", display: "inline-flex", alignItems: "center", gap: 6 }}>
      {input}
      <svg width="11" height="11" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M7 2v10M2 7h10" /></svg>
      {compact ? "Add" : "Add images"}
    </label>
  );
}

function DownloadGlyph({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 4v11M7 10.5l5 5 5-5M5 20h14" />
    </svg>
  );
}

const WIDE = "(min-width: 860px)";
function useWide() {
  return useSyncExternalStore(
    (cb) => { const mq = window.matchMedia(WIDE); mq.addEventListener("change", cb); return () => mq.removeEventListener("change", cb); },
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

const CHECKER = "repeating-conic-gradient(#2a2a2e 0% 25%, #18181b 0% 50%) 50% / 20px 20px";

const badge: CSSProperties = {
  position: "absolute", left: 8, bottom: 8, fontSize: 9.5, fontWeight: 500, padding: "3px 8px", borderRadius: 20,
  textTransform: "uppercase", letterSpacing: "0.06em",
};

const primary: CSSProperties = {
  background: "var(--accent)", color: "var(--on-accent)", border: "none", borderRadius: 10,
  padding: "11px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, whiteSpace: "nowrap",
};

const ghost: CSSProperties = {
  background: "transparent", color: "var(--text-secondary)", border: "0.5px solid var(--border-strong)", borderRadius: 10,
  padding: "11px 16px", fontSize: 14, cursor: "pointer",
  display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8, whiteSpace: "nowrap",
};

const ghostSm: CSSProperties = {
  fontSize: 13, color: "var(--text-muted)", background: "transparent", border: "0.5px solid var(--border)",
  borderRadius: 8, padding: "6px 14px", cursor: "pointer",
};

const iconBtn: CSSProperties = {
  width: 30, height: 30, borderRadius: 9, border: "0.5px solid var(--border)", background: "var(--surface-2)",
  color: "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: 0,
};

const navBtn: CSSProperties = {
  position: "absolute", top: "50%", transform: "translateY(-50%)", width: 34, height: 34, borderRadius: "50%",
  border: "none", background: "rgba(0,0,0,0.55)", backdropFilter: "blur(8px)", color: "#fff", fontSize: 20, lineHeight: 1,
  cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", padding: "0 0 2px",
};

const BATCH_CSS = `
.bgr-scan { position:absolute; left:0; right:0; height:38%; top:-38%;
  background: linear-gradient(180deg, transparent, rgba(228,192,120,0.16) 70%, rgba(228,192,120,0.65) 98%, transparent);
  animation: bgr-scan 1.7s cubic-bezier(0.45,0,0.55,1) infinite; pointer-events:none; }
@keyframes bgr-scan { from { top:-38%; } to { top:100%; } }
.bgr-shimmer { background: linear-gradient(100deg, transparent 20%, rgba(245,240,225,0.05) 50%, transparent 80%) 0 0 / 200% 100%;
  animation: bgr-shimmer 1.4s linear infinite; }
@keyframes bgr-shimmer { from { background-position: 150% 0; } to { background-position: -50% 0; } }
.bgr-add { transition: border-color 0.2s, background 0.2s, color 0.2s; }
.bgr-add:hover { border-color: var(--accent-border); background: var(--accent-dim); color: var(--text); }
@media (hover: hover) {
  .bgr-tile .bgr-x { opacity: 0; transition: opacity 0.2s; }
  .bgr-tile:hover .bgr-x, .bgr-tile .bgr-x:focus-visible { opacity: 1; }
}
`;
