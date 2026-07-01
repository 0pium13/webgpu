"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { RotoFile } from "@/app/rotoscope/page";
import {
  loadSAM, rawImageFromCanvas, embedImage, decodeMask, decodeFromBox,
  type SamSession, type MaskResult,
} from "@/lib/sam2";
import { loadDetector, detectObjects, type Detection } from "@/lib/detect";
import { trackObject, type FrameResult, type Box } from "@/lib/track";
import { encodeFramesToVideo } from "@/lib/videoEncode";

type Phase = "loading" | "select" | "tracking" | "review" | "exporting" | "error";
type ExportMode = "matte" | "greenscreen";

const CHECKER = "repeating-conic-gradient(#2a2a2e 0% 25%, #18181b 0% 50%) 50% / 20px 20px";
const TRACK_FPS = 10;

function tintMaskCanvas(mask: MaskResult, rgb: [number, number, number], alpha: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = mask.width; c.height = mask.height;
  const ctx = c.getContext("2d")!;
  const img = ctx.createImageData(mask.width, mask.height);
  const a = Math.round(alpha * 255);
  for (let i = 0; i < mask.data.length; i++) {
    if (mask.data[i]) { img.data[i * 4] = rgb[0]; img.data[i * 4 + 1] = rgb[1]; img.data[i * 4 + 2] = rgb[2]; img.data[i * 4 + 3] = a; }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

async function seekTo(video: HTMLVideoElement, t: number) {
  if (Math.abs(video.currentTime - t) < 0.002) return;
  await new Promise<void>((r) => { const h = () => { video.removeEventListener("seeked", h); r(); }; video.addEventListener("seeked", h); video.currentTime = t; });
}

export default function VideoRotoscopeStudio({ input, onReset }: { input: RotoFile; onReset: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sessionRef = useRef<SamSession | null>(null);
  const resultsRef = useRef<FrameResult[]>([]);
  const abortRef = useRef(false);

  const [phase, setPhase] = useState<Phase>("loading");
  const [progress, setProgress] = useState<{ label: string; pct: number } | null>(null);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);

  const [detections, setDetections] = useState<Detection[]>([]);
  const [targetIdx, setTargetIdx] = useState<number | null>(null);
  const [targetMask, setTargetMask] = useState<MaskResult | null>(null);
  const [manualBox, setManualBox] = useState<Box | null>(null);

  const [trackStats, setTrackStats] = useState({ done: 0, total: 0, lost: 0 });
  const [reviewIdx, setReviewIdx] = useState(0);
  const [exportMode, setExportMode] = useState<ExportMode>("greenscreen");
  const [outUrl, setOutUrl] = useState<string | null>(null);
  const [outExt, setOutExt] = useState<"mp4" | "webm">("webm");

  // ── load frame 0, models, detect ────────────────────────────────────────────
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      try {
        const v = videoRef.current!;
        v.src = input.url; v.muted = true; v.playsInline = true;
        await new Promise((r) => (v.onloadeddata = r));
        await seekTo(v, Math.min(0.1, (v.duration || 1) * 0.03));
        const w = v.videoWidth, h = v.videoHeight;
        setDims({ w, h });
        const base = baseRef.current!; base.width = w; base.height = h;
        base.getContext("2d")!.drawImage(v, 0, 0);
        overlayRef.current!.width = w; overlayRef.current!.height = h;

        setProgress({ label: "Loading AI models", pct: 0 });
        const dl = (p: any) => { if (p?.status === "progress" && p.total) setProgress({ label: "Loading AI models", pct: Math.round((p.loaded / p.total) * 100) }); };
        await Promise.all([loadSAM(dl), loadDetector(dl)]);

        setProgress({ label: "Finding objects", pct: 0 });
        const raw = await rawImageFromCanvas(base);
        const [session, dets] = await Promise.all([embedImage(raw), detectObjects(base, 0.5)]);
        sessionRef.current = session;
        setDetections(dets);
        setProgress(null);
        setPhase("select");
      } catch (e) { console.error(e); setPhase("error"); }
    })();
  }, [input]);

  // ── overlay draw ─────────────────────────────────────────────────────────────
  const redraw = useCallback((maskOverride?: MaskResult | null) => {
    const ov = overlayRef.current; if (!ov || !dims) return;
    const ctx = ov.getContext("2d")!;
    ctx.clearRect(0, 0, dims.w, dims.h);
    const mask = maskOverride !== undefined ? maskOverride : targetMask;
    if (mask) ctx.drawImage(tintMaskCanvas(mask, [99, 102, 241], 0.45), 0, 0);
    if (phase === "select") {
      const fs = Math.max(11, dims.w / 70);
      ctx.font = `600 ${fs}px system-ui`; ctx.textBaseline = "top";
      detections.forEach((d, i) => {
        const x = d.box.x1 * dims.w, y = d.box.y1 * dims.h;
        const sel = targetIdx === i;
        ctx.lineWidth = Math.max(1.5, dims.w / 500);
        ctx.strokeStyle = sel ? "rgba(99,102,241,0.95)" : "rgba(255,255,255,0.3)";
        ctx.strokeRect(x, y, (d.box.x2 - d.box.x1) * dims.w, (d.box.y2 - d.box.y1) * dims.h);
      });
    }
  }, [dims, targetMask, detections, targetIdx, phase]);

  useEffect(() => { redraw(); }, [redraw]);

  // ── selection ────────────────────────────────────────────────────────────────
  async function pickTarget(i: number) {
    setTargetIdx(i); setManualBox(null);
    if (!sessionRef.current) return;
    try { setTargetMask(await decodeFromBox(sessionRef.current, detections[i].box)); }
    catch (e) { console.error(e); }
  }

  async function onCanvasClick(e: React.MouseEvent) {
    if (phase !== "select") return;
    const rect = overlayRef.current!.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width, y = (e.clientY - rect.top) / rect.height;
    // topmost detection under the click
    let best: number | null = null, bestArea = Infinity;
    detections.forEach((d, i) => {
      if (x >= d.box.x1 && x <= d.box.x2 && y >= d.box.y1 && y <= d.box.y2) {
        const a = (d.box.x2 - d.box.x1) * (d.box.y2 - d.box.y1);
        if (a < bestArea) { bestArea = a; best = i; }
      }
    });
    if (best != null) { pickTarget(best); return; }
    // manual point → SAM mask → track by propagation
    try {
      const m = await decodeMask(sessionRef.current!, [{ x, y, label: 1 }]);
      setTargetMask(m); setTargetIdx(null);
      // derive a box for the manual selection
      let minX = 1, minY = 1, maxX = 0, maxY = 0, any = false;
      for (let yy = 0; yy < m.height; yy++) for (let xx = 0; xx < m.width; xx++) if (m.data[yy * m.width + xx]) {
        any = true; minX = Math.min(minX, xx / m.width); maxX = Math.max(maxX, xx / m.width);
        minY = Math.min(minY, yy / m.height); maxY = Math.max(maxY, yy / m.height);
      }
      if (any) setManualBox({ x1: minX, y1: minY, x2: maxX, y2: maxY });
    } catch (e) { console.error(e); }
  }

  // ── tracking ─────────────────────────────────────────────────────────────────
  async function startTracking() {
    const target = targetIdx != null ? { label: detections[targetIdx].label, box: detections[targetIdx].box }
      : manualBox ? { box: manualBox } : null;
    if (!target || !dims) return;
    abortRef.current = false;
    setPhase("tracking");
    setTrackStats({ done: 0, total: Math.ceil((videoRef.current!.duration || 1) * TRACK_FPS), lost: 0 });
    let lost = 0;
    try {
      const results = await trackObject({
        video: videoRef.current!, dims, init: target, fps: TRACK_FPS,
        shouldAbort: () => abortRef.current,
        onFrame: (r, done, total) => {
          if (r.lost) lost++;
          setTrackStats({ done, total, lost });
          setProgress({ label: `Tracking object`, pct: Math.round((done / total) * 100) });
          // live preview
          const base = baseRef.current!;
          seekTo(videoRef.current!, r.time).then(() => {
            base.getContext("2d")!.drawImage(videoRef.current!, 0, 0);
            redraw(r.mask);
          });
        },
      });
      resultsRef.current = results;
      setProgress(null);
      setReviewIdx(0);
      setPhase("review");
      showReviewFrame(0);
    } catch (e) { console.error(e); setPhase("error"); }
  }

  // ── review ───────────────────────────────────────────────────────────────────
  async function showReviewFrame(i: number) {
    const results = resultsRef.current; if (!results[i] || !dims) return;
    const v = videoRef.current!;
    await seekTo(v, results[i].time);
    baseRef.current!.getContext("2d")!.drawImage(v, 0, 0);
    redraw(results[i].mask);
  }

  function onScrub(i: number) { setReviewIdx(i); showReviewFrame(i); }

  // ── export ───────────────────────────────────────────────────────────────────
  async function runExport() {
    const results = resultsRef.current; if (!results.length || !dims) return;
    setPhase("exporting"); setProgress({ label: "Rendering", pct: 0 });
    const v = videoRef.current!;

    try {
      const { blob, ext } = await encodeFramesToVideo({
        width: dims.w, height: dims.h, fps: TRACK_FPS, totalFrames: results.length,
        preferWebM: true, // reliable mux + alpha support for the transparent mode
        audioSource: exportMode === "greenscreen" ? input.file : undefined,
        onProgress: (ph, pct) => setProgress({ label: ph === "encoding" ? "Rendering frames" : "Muxing video", pct }),
        renderFrame: async (canvas, i) => {
          const r = results[i];
          await seekTo(v, r.time);
          const ctx = canvas.getContext("2d")!;
          const mask = r.mask;
          if (exportMode === "matte") {
            ctx.fillStyle = "#000"; ctx.fillRect(0, 0, dims.w, dims.h);
            ctx.drawImage(tintMaskCanvas(mask, [255, 255, 255], 1), 0, 0);
          } else {
            // green screen: draw source, recolor the background to key green
            ctx.clearRect(0, 0, dims.w, dims.h);
            ctx.drawImage(v, 0, 0, dims.w, dims.h);
            const id = ctx.getImageData(0, 0, dims.w, dims.h);
            for (let p = 0; p < mask.data.length; p++) {
              if (!mask.data[p]) {
                id.data[p * 4] = 0; id.data[p * 4 + 1] = 177; id.data[p * 4 + 2] = 64; id.data[p * 4 + 3] = 255;
              }
            }
            ctx.putImageData(id, 0, 0);
          }
        },
        shouldAbort: () => abortRef.current,
      });
      setOutUrl(URL.createObjectURL(blob)); setOutExt(ext);
      setProgress(null); setPhase("review");
    } catch (e) { console.error(e); setPhase("error"); }
  }

  function download() {
    if (!outUrl) return;
    const a = document.createElement("a");
    a.href = outUrl;
    a.download = `roto_${exportMode}_${input.file.name.replace(/\.[^.]+$/, "")}.${outExt}`;
    a.click();
  }

  const busy = phase === "loading" || phase === "tracking" || phase === "exporting";
  const canTrack = targetIdx != null || manualBox != null;
  const results = resultsRef.current;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <video ref={videoRef} style={{ display: "none" }} />

      {/* toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--accent)" }}>
          {phase === "select" ? "Step 1 · Pick the object to track"
            : phase === "tracking" ? "Tracking through the video…"
            : phase === "review" ? "Review & export"
            : phase === "exporting" ? "Exporting…" : "Loading…"}
        </span>
        <div style={{ flex: 1 }} />
        {phase === "tracking" && <button onClick={() => { abortRef.current = true; }} style={ghost}>Stop</button>}
        <button onClick={onReset} style={ghost}>← New file</button>
      </div>

      <div style={{ display: "flex", gap: 14, alignItems: "flex-start", flexWrap: "wrap" }}>
        {/* stage */}
        <div style={{ flex: "1 1 460px", minWidth: 300, position: "relative", background: CHECKER, border: "0.5px solid var(--border)", borderRadius: 14, overflow: "hidden", display: "flex", justifyContent: "center" }}>
          <div style={{ position: "relative", width: "100%", maxWidth: dims ? dims.w : "100%" }}>
            <canvas ref={baseRef} style={{ display: "block", width: "100%", height: "auto" }} />
            <canvas ref={overlayRef} onClick={onCanvasClick}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor: phase === "select" ? "pointer" : "default" }} />
            {busy && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,10,11,0.55)", backdropFilter: "blur(2px)" }}>
                <div style={{ textAlign: "center", width: 260 }}>
                  <div style={{ width: 40, height: 40, margin: "0 auto 12px", border: "2px solid rgba(255,255,255,0.15)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.9s linear infinite" }} />
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 8 }}>{progress?.label ?? "Working"}… {progress?.pct ?? 0}%</p>
                  <div style={{ height: 3, background: "rgba(255,255,255,0.1)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${progress?.pct ?? 0}%`, background: "var(--accent)", transition: "width 0.2s" }} />
                  </div>
                  {phase === "tracking" && (
                    <p className="mono" style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginTop: 8 }}>
                      frame {trackStats.done}/{trackStats.total}{trackStats.lost > 0 ? ` · ${trackStats.lost} low-confidence` : ""}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* side panel */}
        <div style={{ flex: "0 0 260px", minWidth: 240, maxWidth: "100%", background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          {phase === "select" && (
            <>
              <span style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Objects ({detections.length})</span>
              <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 300, overflowY: "auto" }}>
                {detections.map((d, i) => (
                  <button key={i} onClick={() => pickTarget(i)}
                    style={{ display: "flex", alignItems: "center", gap: 10, padding: "9px 11px", borderRadius: 9, cursor: "pointer", textAlign: "left",
                      border: targetIdx === i ? "0.5px solid var(--accent)" : "0.5px solid var(--border)",
                      background: targetIdx === i ? "var(--accent-dim)" : "transparent" }}>
                    <span style={{ flex: 1, fontSize: 14, fontWeight: 500, textTransform: "capitalize", color: targetIdx === i ? "var(--accent)" : "var(--text)" }}>{d.label}</span>
                    <span className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>{Math.round(d.score * 100)}%</span>
                  </button>
                ))}
                {detections.length === 0 && <p style={{ fontSize: 13, color: "var(--text-dim)" }}>No objects detected — click the thing you want on the frame.</p>}
              </div>
              <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 }}>Pick one object (or click it on the frame), then track it through the whole clip.</p>
              <button onClick={startTracking} disabled={!canTrack}
                style={{ background: canTrack ? "var(--accent)" : "var(--surface-2)", color: canTrack ? "#fff" : "var(--text-dim)", border: "none", borderRadius: 10, padding: "12px", fontSize: 15, fontWeight: 500, cursor: canTrack ? "pointer" : "not-allowed" }}>
                Track through video →
              </button>
            </>
          )}

          {phase === "review" && (
            <>
              <span style={{ fontSize: 12, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)" }}>Export format</span>
              {([
                ["greenscreen", "Green screen", "Object on green — key it in any editor"],
                ["matte", "B/W matte", "Luma matte for roto / masking (like DaVinci Magic Mask)"],
              ] as [ExportMode, string, string][]).map(([m, label, sub]) => (
                <button key={m} onClick={() => setExportMode(m)}
                  style={{ textAlign: "left", padding: "9px 11px", borderRadius: 9, cursor: "pointer",
                    border: exportMode === m ? "0.5px solid var(--accent)" : "0.5px solid var(--border)",
                    background: exportMode === m ? "var(--accent-dim)" : "transparent" }}>
                  <span style={{ fontSize: 14, fontWeight: 500, color: exportMode === m ? "var(--accent)" : "var(--text)" }}>{label}</span>
                  <span style={{ fontSize: 11, display: "block", color: "var(--text-dim)", marginTop: 1 }}>{sub}</span>
                </button>
              ))}
              <button onClick={runExport} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 10, padding: "12px", fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
                ⬇ Render {exportMode} video
              </button>
              {outUrl && (
                <button onClick={download} style={{ background: "var(--surface-2)", color: "var(--text)", border: "0.5px solid var(--border)", borderRadius: 10, padding: "11px", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
                  ↓ Download ({outExt.toUpperCase()})
                </button>
              )}
              <p style={{ fontSize: 12, color: "var(--text-muted)" }}>Tracked {results.length} frames at {TRACK_FPS}fps{trackStats.lost > 0 ? ` · ${trackStats.lost} low-confidence (scrub to check)` : ""}.</p>
            </>
          )}

          {phase === "error" && <p style={{ fontSize: 13, color: "#ef4444" }}>Something went wrong. Try a different file.</p>}
        </div>
      </div>

      {/* timeline scrubber (review) */}
      {phase === "review" && results.length > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="mono" style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 64 }}>{reviewIdx + 1}/{results.length}</span>
          <input type="range" min={0} max={results.length - 1} value={reviewIdx}
            onChange={(e) => onScrub(parseInt(e.target.value))}
            style={{ flex: 1, accentColor: results[reviewIdx]?.lost ? "#ef4444" : "var(--accent)" }} />
          <span className="mono" style={{ fontSize: 12, color: results[reviewIdx]?.lost ? "#ef4444" : "var(--text-dim)", minWidth: 90 }}>
            {results[reviewIdx]?.method}{results[reviewIdx]?.lost ? " · low-conf" : ""}
          </span>
        </div>
      )}
    </div>
  );
}

const ghost: React.CSSProperties = {
  fontSize: 13, color: "var(--text-muted)", background: "transparent",
  border: "0.5px solid var(--border)", borderRadius: 8, padding: "7px 14px", cursor: "pointer",
};
