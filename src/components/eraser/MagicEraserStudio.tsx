"use client";

/**
 * Magic Eraser studio — paint over anything, it vanishes.
 *
 * The stroke overlay is drawn straight to canvas inside pointer events
 * (pointer capture + buttons fallback, no per-move React state) — same
 * pattern as the compare sliders, so painting feels like a native app.
 */

import { useEffect, useRef, useState } from "react";
import { erase, type EraserPhase } from "@/lib/magicEraser";
import { detectObjects, type Detection } from "@/lib/detect";
import { embedImage, decodeFromBox, rawImageFromCanvas, type SamSession } from "@/lib/sam2";
import ModelLoader from "@/components/ModelLoader";
import { SparkleIcon, WandIcon } from "@/components/Icons";

type Phase = "idle" | "working" | "error";
type DetState = "off" | "loading" | "ready" | "failed";

export default function MagicEraserStudio({ file, onReset }: { file: File; onReset: () => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [hasStrokes, setHasStrokes] = useState(false);
  const [canUndo, setCanUndo] = useState(false);
  const [erasedOnce, setErasedOnce] = useState(false);
  const [brush, setBrush] = useState(36); // display px
  const [ready, setReady] = useState(false);
  const [dlPct, setDlPct] = useState<number | null>(null);
  const [detState, setDetState] = useState<DetState>("off");
  const [detections, setDetections] = useState<Detection[]>([]);
  const [showBoxes, setShowBoxes] = useState(true);
  const [cutting, setCutting] = useState<number | null>(null); // detection idx being SAM-cut
  const samRef = useRef<SamSession | null>(null);
  const detRunRef = useRef(0);

  const wrapRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLCanvasElement>(null);   // image at display size
  const paintRef = useRef<HTMLCanvasElement>(null);  // stroke overlay, native res
  const sourceRef = useRef<HTMLCanvasElement | null>(null); // current image, native res
  const historyRef = useRef<HTMLCanvasElement[]>([]);
  const lastPt = useRef<{ x: number; y: number } | null>(null);
  const brushRef = useRef(brush);
  brushRef.current = brush;

  // load the image into the native-res source canvas + fit the view
  useEffect(() => {
    let alive = true;
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      if (!alive) return;
      const src = document.createElement("canvas");
      src.width = img.naturalWidth; src.height = img.naturalHeight;
      src.getContext("2d")!.drawImage(img, 0, 0);
      sourceRef.current = src;
      const paint = paintRef.current!;
      paint.width = src.width; paint.height = src.height;
      redraw();
      setReady(true);
      URL.revokeObjectURL(url);
      scanObjects();
    };
    img.src = url;
    return () => { alive = false; URL.revokeObjectURL(url); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  function redraw() {
    const src = sourceRef.current, view = viewRef.current, wrap = wrapRef.current;
    if (!src || !view || !wrap) return;
    const maxW = wrap.clientWidth, maxH = Math.round(window.innerHeight * 0.58);
    const scale = Math.min(maxW / src.width, maxH / src.height, 1);
    view.width = Math.round(src.width * scale);
    view.height = Math.round(src.height * scale);
    view.getContext("2d")!.drawImage(src, 0, 0, view.width, view.height);
  }
  useEffect(() => {
    const onR = () => redraw();
    window.addEventListener("resize", onR);
    return () => window.removeEventListener("resize", onR);
  }, []);

  // ── auto object detection: see it, click it, it's marked ─────────────────
  async function scanObjects() {
    const src = sourceRef.current;
    if (!src) return;
    const runId = ++detRunRef.current;
    setDetState("loading");
    setDetections([]);
    samRef.current = null;
    try {
      // detection list + SAM embeddings in parallel — by the time the user
      // picks an object, the segmenter is usually already warm
      const [dets, session] = await Promise.all([
        detectObjects(src, 0.5),
        (async () => embedImage(await rawImageFromCanvas(src)))(),
      ]);
      if (detRunRef.current !== runId) return; // image changed mid-scan
      samRef.current = session;
      setDetections(dets.slice(0, 12));
      setShowBoxes(true);
      setDetState("ready");
    } catch (e) {
      console.warn("[eraser] detection unavailable, brush still works", e);
      if (detRunRef.current === runId) setDetState("failed");
    }
  }

  /** click a detection → SAM cuts a pixel-accurate mask → lands on the paint layer */
  async function cutDetection(idx: number) {
    const det = detections[idx];
    const src = sourceRef.current, paint = paintRef.current;
    if (!det || !src || !paint || cutting !== null) return;
    setCutting(idx);
    try {
      let session = samRef.current;
      if (!session) session = samRef.current = await embedImage(await rawImageFromCanvas(src));
      const mask = await decodeFromBox(session, det.box);

      // rasterize mask at native res, dilated a few px so LaMa gets margin
      const mc = document.createElement("canvas");
      mc.width = mask.width; mc.height = mask.height;
      const mctx = mc.getContext("2d")!;
      const img = mctx.createImageData(mask.width, mask.height);
      for (let i = 0; i < mask.data.length; i++) {
        if (mask.data[i]) {
          img.data[i * 4] = 129; img.data[i * 4 + 1] = 140;
          img.data[i * 4 + 2] = 248; img.data[i * 4 + 3] = 230;
        }
      }
      mctx.putImageData(img, 0, 0);

      const ctx = paint.getContext("2d")!;
      const sx = paint.width / mask.width, sy = paint.height / mask.height;
      const d = Math.max(2, Math.round(paint.width / 300)); // dilation radius
      for (const [ox, oy] of [[0, 0], [d, 0], [-d, 0], [0, d], [0, -d], [d, d], [-d, -d]]) {
        ctx.drawImage(mc, ox * 1, oy * 1, mask.width * sx, mask.height * sy);
      }
      setHasStrokes(true);
      setShowBoxes(false);
    } catch (e) {
      console.error("[eraser] SAM cut failed", e);
    } finally {
      setCutting(null);
    }
  }

  // ── painting ───────────────────────────────────────────────────────────────
  function toNative(e: React.PointerEvent) {
    const view = viewRef.current!, src = sourceRef.current!;
    const r = view.getBoundingClientRect();
    const sx = src.width / r.width;
    return { x: (e.clientX - r.left) * sx, y: (e.clientY - r.top) * sx, sx };
  }

  function strokeTo(x: number, y: number, sx: number) {
    const ctx = paintRef.current!.getContext("2d")!;
    ctx.strokeStyle = ctx.fillStyle = "rgba(129,140,248,0.9)";
    ctx.lineCap = ctx.lineJoin = "round";
    ctx.lineWidth = brushRef.current * sx;
    if (lastPt.current) {
      ctx.beginPath();
      ctx.moveTo(lastPt.current.x, lastPt.current.y);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.arc(x, y, (brushRef.current * sx) / 2, 0, Math.PI * 2);
      ctx.fill();
    }
    lastPt.current = { x, y };
  }

  function onDown(e: React.PointerEvent) {
    if (phase === "working" || !ready) return;
    if (showBoxes) setShowBoxes(false); // brushing takes over from box-picking
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    lastPt.current = null;
    const p = toNative(e);
    strokeTo(p.x, p.y, p.sx);
    setHasStrokes(true);
  }
  function onMove(e: React.PointerEvent) {
    if (!(e.buttons & 1) || !lastPt.current || phase === "working") return;
    const p = toNative(e);
    strokeTo(p.x, p.y, p.sx);
  }
  function onUp() { lastPt.current = null; }

  function clearStrokes() {
    const p = paintRef.current!;
    p.getContext("2d")!.clearRect(0, 0, p.width, p.height);
    setHasStrokes(false);
  }

  // ── actions ────────────────────────────────────────────────────────────────
  async function runErase() {
    const src = sourceRef.current, paint = paintRef.current;
    if (!src || !paint) return;
    try {
      setPhase("working");
      setMsg("Loading model…");
      const result = await erase(src, paint, (p: EraserPhase) => {
        if (p.step === "download") { setDlPct(p.pct); setMsg(`Loading model… ${p.pct}%`); }
        else { setDlPct(null); setMsg("Reconstructing what was behind it…"); }
      });
      historyRef.current.push(src);
      if (historyRef.current.length > 8) historyRef.current.shift();
      sourceRef.current = result;
      clearStrokes();
      redraw();
      setCanUndo(true);
      setErasedOnce(true);
      setPhase("idle");
      scanObjects(); // the scene changed — re-find what's left
    } catch (e: any) {
      console.error(e);
      setErrMsg(e?.message ?? "Something went wrong");
      setPhase("error");
    }
  }

  function undo() {
    const prev = historyRef.current.pop();
    if (!prev) return;
    sourceRef.current = prev;
    clearStrokes();
    redraw();
    setCanUndo(historyRef.current.length > 0);
  }

  function download() {
    sourceRef.current?.toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = `${file.name.replace(/\.[^.]+$/, "")}-erased.png`;
      a.click();
    }, "image/png");
  }

  const busy = phase === "working";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {file.name}
          {erasedOnce && <span style={{ color: "var(--accent)" }}> · erased</span>}
        </p>
        {!busy && <button onClick={onReset} style={ghost}>← New image</button>}
      </div>

      {/* canvas stack */}
      <div ref={wrapRef} style={{ position: "relative", background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 16, overflow: "hidden", display: "flex", justifyContent: "center", padding: 12 }}>
        <div style={{ position: "relative", lineHeight: 0 }}>
          <canvas ref={viewRef} style={{ borderRadius: 8, maxWidth: "100%" }} />
          <canvas
            ref={paintRef}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            style={{
              position: "absolute", inset: 0, width: "100%", height: "100%",
              cursor: busy ? "wait" : "crosshair", touchAction: "none", opacity: 0.75,
            }}
          />
          {/* clickable detections — see it, click it, it's marked */}
          {showBoxes && detState === "ready" && !busy && detections.map((d, i) => (
            <button
              key={i}
              className="det-box"
              onClick={() => cutDetection(i)}
              disabled={cutting !== null}
              style={{
                position: "absolute",
                left: `${d.box.x1 * 100}%`, top: `${d.box.y1 * 100}%`,
                width: `${(d.box.x2 - d.box.x1) * 100}%`, height: `${(d.box.y2 - d.box.y1) * 100}%`,
                border: cutting === i ? "1.5px solid var(--accent)" : "1px solid rgba(129,140,248,0.55)",
                background: cutting === i ? "rgba(99,102,241,0.20)" : "rgba(99,102,241,0.05)",
                borderRadius: 6, cursor: cutting !== null ? "wait" : "pointer", padding: 0,
              }}
            >
              <span className="mono" style={{
                position: "absolute", top: -1, left: -1, transform: "translateY(-100%)",
                background: "rgba(10,10,11,0.85)", color: cutting === i ? "var(--accent)" : "#c7d2fe",
                fontSize: 10, padding: "2px 7px", borderRadius: "6px 6px 6px 0",
                whiteSpace: "nowrap", lineHeight: 1.5, letterSpacing: "0.03em",
              }}>
                {cutting === i ? "cutting out…" : d.label}
              </span>
            </button>
          ))}
        </div>

        {busy && dlPct !== null && (
          <div style={{ position: "absolute", inset: 0, background: "rgba(10,10,11,0.82)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ width: "100%", maxWidth: 520 }}>
              <ModelLoader pct={dlPct} title="The eraser is waking up" sub="~200MB · downloads once, cached forever" />
            </div>
          </div>
        )}
        {busy && dlPct === null && (
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(10,10,11,0.85)", backdropFilter: "blur(6px)", padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, borderTop: "0.5px solid var(--border)" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", animation: "pulse 1s ease-in-out infinite", flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: "#fff" }}>{msg}</span>
          </div>
        )}
      </div>

      {phase === "error" && (
        <p style={{ color: "#ef4444", fontSize: 13 }}>{errMsg}</p>
      )}

      {/* detection status */}
      {detState === "loading" && (
        <p className="mono" style={{ fontSize: 11.5, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", animation: "pulse 1s ease-in-out infinite" }} />
          Finding objects… (brush works meanwhile)
        </p>
      )}
      {detState === "ready" && detections.length > 0 && (
        <p className="mono" style={{ fontSize: 11.5, color: "var(--text-muted)", display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <WandIcon size={13} />
          {detections.length} object{detections.length > 1 ? "s" : ""} found — click one to mark it, or paint by hand
          <button onClick={() => setShowBoxes(!showBoxes)} style={{
            background: "transparent", border: "0.5px solid var(--border)", borderRadius: 6,
            color: showBoxes ? "var(--accent)" : "var(--text-muted)", fontSize: 11, padding: "3px 10px", cursor: "pointer",
          }}>
            {showBoxes ? "hide boxes" : "show boxes"}
          </button>
        </p>
      )}

      {/* controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button onClick={runErase} disabled={!hasStrokes || busy} style={{
          ...primary, opacity: !hasStrokes || busy ? 0.45 : 1,
          cursor: !hasStrokes || busy ? "default" : "pointer",
          display: "inline-flex", alignItems: "center", gap: 8,
        }}>
          <SparkleIcon size={15} /> Erase
        </button>

        <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 12.5, color: "var(--text-muted)" }}>
          Brush
          <input
            type="range" min={12} max={90} value={brush}
            onChange={(e) => setBrush(Number(e.target.value))}
            style={{ width: 110, accentColor: "var(--accent)" }}
          />
        </label>

        {hasStrokes && !busy && <button onClick={clearStrokes} style={ghost}>Clear marks</button>}
        {canUndo && !busy && <button onClick={undo} style={ghost}>↩ Undo</button>}
        <span style={{ flex: 1 }} />
        {erasedOnce && !busy && <button onClick={download} style={secondary}>↓ Download PNG</button>}
      </div>

      <p className="mono" style={{ fontSize: 11.5, color: "var(--text-dim)" }}>
        Paint over what should disappear, then hit Erase. Only the painted area
        is touched — the rest of your photo stays pixel-identical.
      </p>
    </div>
  );
}

const ghost: React.CSSProperties = {
  fontSize: 13, color: "var(--text-muted)", background: "transparent",
  border: "0.5px solid var(--border)", borderRadius: 8, padding: "7px 14px", cursor: "pointer",
};
const primary: React.CSSProperties = {
  background: "var(--accent)", color: "#fff", border: "none", borderRadius: 10,
  padding: "11px 22px", fontSize: 14, fontWeight: 500,
};
const secondary: React.CSSProperties = {
  background: "var(--surface-2)", color: "var(--text)", border: "0.5px solid var(--border)",
  borderRadius: 10, padding: "11px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer",
};
