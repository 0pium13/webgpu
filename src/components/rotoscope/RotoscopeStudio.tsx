"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { RotoFile } from "@/app/rotoscope/page";
import {
  loadSAM, rawImageFromCanvas, embedImage, decodeMask, decodeFromBox,
  type SamSession, type SamPoint, type MaskResult,
} from "@/lib/sam2";
import { loadDetector, detectObjects, type Detection } from "@/lib/detect";
import { WandIcon, RotoscopeIcon } from "@/components/Icons";

type Status =
  | "loading-frame" | "loading-models" | "analyzing" | "preparing"
  | "ready" | "working" | "error";

const CHECKER = "repeating-conic-gradient(#2a2a2e 0% 25%, #18181b 0% 50%) 50% / 20px 20px";
const ACCENT: [number, number, number] = [99, 102, 241];
const GREEN: [number, number, number] = [34, 197, 94];

/** Render a 0/255 mask (source-res) into a tinted RGBA canvas. */
function tintMask(mask: MaskResult, [r, g, b]: [number, number, number], alpha: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = mask.width; c.height = mask.height;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(mask.width, mask.height);
  const a = Math.round(alpha * 255);
  for (let i = 0; i < mask.data.length; i++) {
    if (mask.data[i]) {
      img.data[i * 4] = r; img.data[i * 4 + 1] = g; img.data[i * 4 + 2] = b; img.data[i * 4 + 3] = a;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

/** OR several masks into one. */
function unionMasks(masks: MaskResult[]): MaskResult | null {
  if (!masks.length) return null;
  const { width, height } = masks[0];
  const data = new Uint8Array(width * height);
  for (const m of masks) {
    if (m.width !== width || m.height !== height) continue;
    for (let i = 0; i < data.length; i++) if (m.data[i]) data[i] = 255;
  }
  return { data, width, height, score: 1 };
}

export default function RotoscopeStudio({ input, onReset }: { input: RotoFile; onReset: () => void }) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<SamSession | null>(null);

  const [status, setStatus] = useState<Status>("loading-frame");
  const [progress, setProgress] = useState<{ label: string; pct: number } | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  const [detections, setDetections] = useState<Detection[]>([]);
  const [objectMasks, setObjectMasks] = useState<(MaskResult | null)[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [prepCount, setPrepCount] = useState(0);

  const [manualMode, setManualMode] = useState(false);
  const [pointMode, setPointMode] = useState<1 | 0>(1);
  const [points, setPoints] = useState<SamPoint[]>([]);
  const [manualMask, setManualMask] = useState<MaskResult | null>(null);

  const [showBoxes, setShowBoxes] = useState(true);
  const [feather, setFeather] = useState(1);

  // ── 1) draw the frame ──────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const base = baseRef.current!;
      const ctx = base.getContext("2d")!;
      if (input.isVideo) {
        const v = document.createElement("video");
        v.src = input.url; v.muted = true; v.playsInline = true;
        await new Promise((r) => (v.onloadeddata = r));
        v.currentTime = Math.min(0.1, (v.duration || 1) * 0.05);
        await new Promise((r) => (v.onseeked = r));
        if (cancelled) return;
        base.width = v.videoWidth; base.height = v.videoHeight;
        ctx.drawImage(v, 0, 0);
        setDims({ w: v.videoWidth, h: v.videoHeight });
      } else {
        const img = new Image();
        img.src = input.url;
        await new Promise((r) => (img.onload = r));
        if (cancelled) return;
        base.width = img.naturalWidth; base.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);
        setDims({ w: img.naturalWidth, h: img.naturalHeight });
      }
      overlayRef.current!.width = base.width;
      overlayRef.current!.height = base.height;
      setStatus("loading-models");
    })();
    return () => { cancelled = true; };
  }, [input]);

  // ── 2) load models, embed + detect in parallel, precompute object masks ─────
  const started = useRef(false);
  useEffect(() => {
    if (!dims || started.current) return;
    started.current = true;
    let cancelled = false;
    (async () => {
      try {
        setStatus("loading-models");
        setProgress({ label: "Loading AI models", pct: 0 });
        const dl = (p: any) => {
          if (p?.status === "progress" && p.total) {
            setProgress({ label: "Loading AI models", pct: Math.round((p.loaded / p.total) * 100) });
          }
        };
        await Promise.all([loadSAM(dl), loadDetector(dl)]);
        if (cancelled) return;

        setStatus("analyzing");
        setProgress({ label: "Finding objects & analyzing frame", pct: 0 });
        const raw = await rawImageFromCanvas(baseRef.current!);
        const [session, dets] = await Promise.all([
          embedImage(raw),
          detectObjects(baseRef.current!, 0.5),
        ]);
        if (cancelled) return;
        sessionRef.current = session;
        setDetections(dets);

        // Precompute a clean SAM mask per detected object (box prompt).
        setStatus("preparing");
        const masks: (MaskResult | null)[] = [];
        for (let i = 0; i < dets.length; i++) {
          if (cancelled) return;
          setPrepCount(i + 1);
          try {
            masks.push(await decodeFromBox(session, dets[i].box));
          } catch (e) {
            console.warn("box decode failed", e);
            masks.push(null);
          }
        }
        if (cancelled) return;
        setObjectMasks(masks);
        setProgress(null);
        setStatus("ready");
      } catch (e) {
        console.error(e);
        if (!cancelled) setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [dims]);

  // ── overlay drawing ─────────────────────────────────────────────────────────
  const redraw = useCallback(() => {
    const ov = overlayRef.current; if (!ov || !dims) return;
    const ctx = ov.getContext("2d")!;
    ctx.clearRect(0, 0, dims.w, dims.h);

    // combined selection (selected object masks + manual mask)
    const chosen: MaskResult[] = [];
    selected.forEach((i) => { const m = objectMasks[i]; if (m) chosen.push(m); });
    if (manualMask) chosen.push(manualMask);
    const union = unionMasks(chosen);
    if (union) ctx.drawImage(tintMask(union, ACCENT, 0.42), 0, 0);

    // hover preview (only if not already selected)
    if (hoverIdx != null && !selected.has(hoverIdx)) {
      const m = objectMasks[hoverIdx];
      if (m) ctx.drawImage(tintMask(m, GREEN, 0.3), 0, 0);
    }

    // detection boxes + labels
    if (showBoxes) {
      const fs = Math.max(11, dims.w / 70);
      ctx.font = `600 ${fs}px system-ui, sans-serif`;
      ctx.textBaseline = "top";
      detections.forEach((d, i) => {
        const x = d.box.x1 * dims.w, y = d.box.y1 * dims.h;
        const w = (d.box.x2 - d.box.x1) * dims.w, h = (d.box.y2 - d.box.y1) * dims.h;
        const isSel = selected.has(i), isHov = hoverIdx === i;
        ctx.lineWidth = Math.max(1.5, dims.w / 500);
        ctx.strokeStyle = isSel ? "rgba(99,102,241,0.95)" : isHov ? "rgba(34,197,94,0.95)" : "rgba(255,255,255,0.35)";
        ctx.strokeRect(x, y, w, h);
        if (isSel || isHov) {
          const label = `${d.label} ${Math.round(d.score * 100)}%`;
          const pad = fs * 0.35;
          const tw = ctx.measureText(label).width;
          ctx.fillStyle = isSel ? "rgba(99,102,241,0.95)" : "rgba(34,197,94,0.95)";
          ctx.fillRect(x, Math.max(0, y - fs - pad * 2), tw + pad * 2, fs + pad * 2);
          ctx.fillStyle = "#fff";
          ctx.fillText(label, x + pad, Math.max(0, y - fs - pad * 2) + pad);
        }
      });
    }

    // manual points
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x * dims.w, p.y * dims.h, Math.max(5, dims.w / 160), 0, Math.PI * 2);
      ctx.fillStyle = p.label ? "#22c55e" : "#ef4444";
      ctx.fill();
      ctx.lineWidth = Math.max(2, dims.w / 400); ctx.strokeStyle = "#fff"; ctx.stroke();
    }
  }, [dims, detections, objectMasks, selected, hoverIdx, showBoxes, points, manualMask]);

  useEffect(() => { redraw(); }, [redraw]);

  // ── interactions ────────────────────────────────────────────────────────────
  function eventToNorm(e: React.MouseEvent) {
    const rect = overlayRef.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    };
  }

  function detectionAt(x: number, y: number): number | null {
    // topmost (smallest-area) detection whose box contains the point
    let best: number | null = null, bestArea = Infinity;
    detections.forEach((d, i) => {
      if (x >= d.box.x1 && x <= d.box.x2 && y >= d.box.y1 && y <= d.box.y2) {
        const area = (d.box.x2 - d.box.x1) * (d.box.y2 - d.box.y1);
        if (area < bestArea) { bestArea = area; best = i; }
      }
    });
    return best;
  }

  async function onCanvasClick(e: React.MouseEvent) {
    if (status !== "ready" && status !== "working") return;
    const { x, y } = eventToNorm(e);

    if (manualMode) {
      const next = [...points, { x, y, label: pointMode }];
      setPoints(next);
      setStatus("working");
      try { setManualMask(await decodeMask(sessionRef.current!, next)); }
      catch (err) { console.error(err); }
      setStatus("ready");
      return;
    }

    const idx = detectionAt(x, y);
    if (idx != null) toggleSelected(idx);
  }

  function onCanvasMove(e: React.MouseEvent) {
    if (manualMode || (status !== "ready" && status !== "working")) return;
    const { x, y } = eventToNorm(e);
    setHoverIdx(detectionAt(x, y));
  }

  function toggleSelected(i: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  }

  function selectAll() { setSelected(new Set(detections.map((_, i) => i))); }
  function clearAll() { setSelected(new Set()); setPoints([]); setManualMask(null); }

  // ── export ──────────────────────────────────────────────────────────────────
  function currentUnion(): MaskResult | null {
    const chosen: MaskResult[] = [];
    selected.forEach((i) => { const m = objectMasks[i]; if (m) chosen.push(m); });
    if (manualMask) chosen.push(manualMask);
    return unionMasks(chosen);
  }

  function downloadCutout() {
    const union = currentUnion();
    if (!union || !dims) return;
    const out = document.createElement("canvas");
    out.width = dims.w; out.height = dims.h;
    const ctx = out.getContext("2d")!;
    ctx.drawImage(baseRef.current!, 0, 0);

    // white-on-transparent matte, feathered, used as an alpha stencil
    const matte = tintMask(union, [255, 255, 255], 1);
    ctx.globalCompositeOperation = "destination-in";
    if (feather > 0) ctx.filter = `blur(${feather}px)`;
    ctx.drawImage(matte, 0, 0);
    ctx.filter = "none";
    ctx.globalCompositeOperation = "source-over";

    out.toBlob((b) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b!);
      a.download = `cutout_${input.file.name.replace(/\.[^.]+$/, "")}.png`;
      a.click();
    }, "image/png");
  }

  const busy = status === "loading-frame" || status === "loading-models" || status === "analyzing" || status === "preparing";
  const selectedCount = selected.size + (manualMask ? 1 : 0);
  const hasSelection = selectedCount > 0;

  const overlayText =
    status === "loading-frame" ? "Loading frame…" :
    status === "loading-models" ? `Loading AI models… ${progress?.pct ?? 0}%` :
    status === "analyzing" ? "Finding objects…" :
    status === "preparing" ? `Preparing objects… ${prepCount}/${detections.length}` :
    status === "error" ? "Something went wrong" : "";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 4, background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 10, padding: 4 }}>
          <ToolBtn active={!manualMode} onClick={() => setManualMode(false)}><WandIcon size={14} /> Auto-select</ToolBtn>
          <ToolBtn active={manualMode} onClick={() => setManualMode(true)}><RotoscopeIcon size={14} /> Manual</ToolBtn>
        </div>
        {manualMode && (
          <div style={{ display: "flex", gap: 4, background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 10, padding: 4 }}>
            <ToolBtn active={pointMode === 1} onClick={() => setPointMode(1)} color="#22c55e">+ Add</ToolBtn>
            <ToolBtn active={pointMode === 0} onClick={() => setPointMode(0)} color="#ef4444">− Remove</ToolBtn>
          </div>
        )}
        <button onClick={() => setShowBoxes((s) => !s)} style={ghostBtn(false)}>
          {showBoxes ? "Hide boxes" : "Show boxes"}
        </button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: status === "error" ? "#ef4444" : "var(--text-muted)", display: "flex", alignItems: "center", gap: 8 }}>
          {busy && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", animation: "pulse 1s ease-in-out infinite" }} />}
          {busy || status === "error" ? overlayText : `${detections.length} objects found · ${selectedCount} selected`}
        </span>
        <button onClick={onReset} style={ghostBtn(false)}>← New file</button>
      </div>

      {/* main: canvas + object panel */}
      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* canvas stage */}
        <div style={{ flex: "1 1 460px", minWidth: 300, position: "relative", background: CHECKER, border: "0.5px solid var(--border)", borderRadius: 14, overflow: "hidden", display: "flex", justifyContent: "center" }}>
          <div style={{ position: "relative", width: "100%", maxWidth: dims ? dims.w : "100%" }}>
            <canvas ref={baseRef} style={{ display: "block", width: "100%", height: "auto" }} />
            <canvas
              ref={overlayRef}
              onClick={onCanvasClick}
              onMouseMove={onCanvasMove}
              onMouseLeave={() => setHoverIdx(null)}
              style={{
                position: "absolute", inset: 0, width: "100%", height: "100%",
                cursor: status === "ready" ? (manualMode ? "crosshair" : "pointer") : "default",
              }}
            />
            {busy && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,10,11,0.6)", backdropFilter: "blur(2px)" }}>
                <div style={{ textAlign: "center", width: 240 }}>
                  <div style={{ width: 40, height: 40, margin: "0 auto 14px", border: "2px solid rgba(255,255,255,0.15)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.9s linear infinite" }} />
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 10 }}>{overlayText}</p>
                  {progress && (
                    <div style={{ height: 3, background: "rgba(255,255,255,0.1)", borderRadius: 4, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${status === "preparing" ? Math.round((prepCount / Math.max(1, detections.length)) * 100) : progress.pct}%`, background: "var(--accent)", borderRadius: 4, transition: "width 0.2s" }} />
                    </div>
                  )}
                </div>
              </div>
            )}
            {status === "error" && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,10,11,0.85)" }}>
                <p style={{ color: "#ef4444", fontSize: 14 }}>Something went wrong. Try a different file.</p>
              </div>
            )}
          </div>
        </div>

        {/* object list panel */}
        <div style={{ flex: "0 0 260px", maxWidth: "100%", background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 10, minWidth: 240 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Detected objects</span>
            <span className="mono" style={{ fontSize: 12, color: "var(--text-dim)" }}>{detections.length}</span>
          </div>

          {status === "ready" && detections.length > 0 && (
            <div style={{ display: "flex", gap: 6 }}>
              <button onClick={selectAll} style={{ ...miniBtn, flex: 1 }}>Select all</button>
              <button onClick={clearAll} style={{ ...miniBtn, flex: 1 }} disabled={!hasSelection}>Clear</button>
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 360, overflowY: "auto" }}>
            {busy && <p style={{ fontSize: 13, color: "var(--text-dim)" }}>Scanning the frame…</p>}
            {!busy && detections.length === 0 && (
              <p style={{ fontSize: 13, color: "var(--text-dim)", lineHeight: 1.5 }}>
                No objects auto-detected. Switch to <strong>Manual</strong> and click the thing you want to cut out.
              </p>
            )}
            {detections.map((d, i) => {
              const isSel = selected.has(i);
              return (
                <button
                  key={i}
                  onClick={() => toggleSelected(i)}
                  onMouseEnter={() => setHoverIdx(i)}
                  onMouseLeave={() => setHoverIdx((h) => (h === i ? null : h))}
                  style={{
                    display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left",
                    padding: "9px 11px", borderRadius: 9, cursor: "pointer",
                    border: isSel ? "0.5px solid var(--accent)" : "0.5px solid var(--border)",
                    background: isSel ? "var(--accent-dim)" : hoverIdx === i ? "var(--surface-2)" : "transparent",
                    transition: "all 0.12s",
                  }}
                >
                  <span style={{
                    width: 16, height: 16, borderRadius: 5, flexShrink: 0,
                    border: isSel ? "none" : "1.5px solid var(--border-strong)",
                    background: isSel ? "var(--accent)" : "transparent",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#fff",
                  }}>{isSel ? "✓" : ""}</span>
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 500, textTransform: "capitalize", color: isSel ? "var(--accent)" : "var(--text)" }}>{d.label}</span>
                  <span className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>{Math.round(d.score * 100)}%</span>
                </button>
              );
            })}
          </div>

          {/* edge feather */}
          <div style={{ borderTop: "0.5px solid var(--border)", paddingTop: 12, marginTop: 2 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Edge feather</span>
              <span className="mono" style={{ fontSize: 12, color: "var(--text-dim)" }}>{feather}px</span>
            </div>
            <input type="range" min={0} max={4} step={0.5} value={feather}
              onChange={(e) => setFeather(parseFloat(e.target.value))}
              style={{ width: "100%", accentColor: "var(--accent)" }} />
          </div>
        </div>
      </div>

      {/* actions */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={downloadCutout} disabled={!hasSelection}
          style={{ background: hasSelection ? "var(--accent)" : "var(--surface-2)", color: hasSelection ? "#fff" : "var(--text-dim)", border: "none", borderRadius: 10, padding: "12px 22px", fontSize: 15, fontWeight: 500, cursor: hasSelection ? "pointer" : "not-allowed" }}>
          ↓ Download cutout (PNG){selectedCount > 1 ? ` · ${selectedCount} objects` : ""}
        </button>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {manualMode
            ? "Click to add the object, use Remove to trim edges."
            : status === "ready"
              ? "Hover to preview, click an object (or the list) to add it to the cutout."
              : "Analyzing…"}
        </p>
      </div>
    </div>
  );
}

function ToolBtn({ children, active, onClick, color }: { children: React.ReactNode; active: boolean; onClick: () => void; color?: string }) {
  return (
    <button onClick={onClick} style={{
      padding: "6px 13px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500,
      display: "inline-flex", alignItems: "center", gap: 6,
      background: active ? "var(--surface-2)" : "transparent",
      color: active ? (color ?? "var(--accent)") : "var(--text-muted)",
    }}>{children}</button>
  );
}

const miniBtn: React.CSSProperties = {
  fontSize: 12, color: "var(--text-muted)", background: "var(--surface-2)",
  border: "0.5px solid var(--border)", borderRadius: 8, padding: "7px 10px", cursor: "pointer",
};

function ghostBtn(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 13, color: disabled ? "var(--text-dim)" : "var(--text-muted)", background: "transparent",
    border: "0.5px solid var(--border)", borderRadius: 8, padding: "7px 14px",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
