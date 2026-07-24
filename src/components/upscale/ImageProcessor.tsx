"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { UpscaleFile, UpscaleScale } from "@/app/upscale/page";
import { upscaleToCanvas, srDevice, type SRProgress } from "@/lib/realesrgan";
import { SparkleIcon } from "@/components/Icons";

type Phase = "idle" | "loading" | "processing" | "done" | "error";

function formatBytes(b: number) {
  if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${(b / 1e3).toFixed(0)} KB`;
}

export default function ImageProcessor({
  input,
  scale,
  onReset,
}: {
  input: UpscaleFile;
  scale: UpscaleScale;
  onReset: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outSize, setOutSize] = useState(0);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [dlPct, setDlPct] = useState(0);
  const [tile, setTile] = useState<{ done: number; total: number } | null>(null);
  const [msg, setMsg] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const multiplier = scale === "4x" ? 4 : 2;

  // ── developing-photo live preview ─────────────────────────────────────────
  const previewRef = useRef<HTMLCanvasElement>(null);
  const mpPainted = useRef(0);

  // ── compare slider (pointer capture + direct DOM = no jank, no drops) ────
  const containerRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const sliderRaf = useRef(0);
  const sliderPos = useRef(50);

  const applySlider = useCallback(() => {
    sliderRaf.current = 0;
    const p = sliderPos.current;
    if (clipRef.current) clipRef.current.style.clipPath = `inset(0 ${100 - p}% 0 0)`;
    if (lineRef.current) lineRef.current.style.left = `${p}%`;
  }, []);

  const sliderTo = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    sliderPos.current = Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100));
    if (!sliderRaf.current) sliderRaf.current = requestAnimationFrame(applySlider);
  }, [applySlider]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (phase !== "done") return;
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    sliderTo(e.clientX);
  }, [phase, sliderTo]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (phase !== "done") return;
    if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId) || e.buttons & 1) sliderTo(e.clientX);
  }, [phase, sliderTo]);

  useEffect(() => {
    const img = new Image();
    img.src = input.url;
    img.onload = () => {
      imgRef.current = img;
      setDims({ w: img.naturalWidth, h: img.naturalHeight });
    };
  }, [input.url]);

  async function start() {
    if (!imgRef.current) return;
    try {
      setPhase("loading");
      setMsg("Loading AI model…");
      setDlPct(0);
      setTile(null);
      mpPainted.current = 0;
      const t0 = Date.now();
      const timer = setInterval(() => setElapsed((Date.now() - t0) / 1000), 200);

      const onProgress = (p: SRProgress) => {
        if (p.phase === "download") {
          setDlPct(p.pct);
          setMsg(`Loading AI model… ${p.pct}%`);
          return;
        }
        if (phaseRef.current !== "processing") {
          setPhaseSafe("processing");
          // seed the preview with a soft version of the original — each
          // finished tile then lands SHARP on top: the photo "develops"
          if (p.tile && previewRef.current && imgRef.current) {
            const pv = previewRef.current;
            pv.width = p.tile.outW; pv.height = p.tile.outH;
            const ctx = pv.getContext("2d")!;
            ctx.filter = "blur(6px) saturate(0.85)";
            ctx.drawImage(imgRef.current, 0, 0, pv.width, pv.height);
            ctx.filter = "none";
          }
        }
        setTile({ done: p.done, total: p.total });
        if (p.tile && previewRef.current) {
          const ctx = previewRef.current.getContext("2d")!;
          ctx.drawImage(p.tile.core, p.tile.x, p.tile.y);
          mpPainted.current += (p.tile.core.width * p.tile.core.height) / 1e6;
        }
        setMsg(`${mpPainted.current.toFixed(1)} MP of real detail painted`);
      };

      const { canvas: out } = await upscaleToCanvas(imgRef.current, multiplier, onProgress);
      clearInterval(timer);

      const blob: Blob = await new Promise((res) => out.toBlob((b) => res(b!), "image/png"));
      setOutputUrl(URL.createObjectURL(blob));
      setOutSize(blob.size);
      setPhase("done");
    } catch (e: any) {
      console.error(e);
      setMsg(e?.message ?? "Something went wrong");
      setPhase("error");
    }
  }

  // keep a ref so the progress callback can switch phase without stale closure
  const phaseRef = useRef<Phase>("idle");
  function setPhaseSafe(p: Phase) { phaseRef.current = p; setPhase(p); }
  useEffect(() => { phaseRef.current = phase; }, [phase]);

  function download() {
    if (!outputUrl) return;
    const a = document.createElement("a");
    a.href = outputUrl;
    a.download = `upscaled_${scale}_${input.file.name.replace(/\.[^.]+$/, "")}.png`;
    a.click();
  }

  const outW = dims ? dims.w * multiplier : 0;
  const outH = dims ? dims.h * multiplier : 0;
  const busy = phase === "loading" || phase === "processing";
  const tilePct = tile ? Math.round((tile.done / tile.total) * 100) : 0;
  const eta =
    tile && tile.done > 1 && elapsed > 0
      ? Math.max(0, Math.round((elapsed / tile.done) * (tile.total - tile.done)))
      : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {input.file.name} · {formatBytes(input.file.size)}
          {dims && ` · ${dims.w}×${dims.h}`}
          {dims && <span style={{ color: "var(--accent)" }}> → {outW}×{outH}</span>}
        </p>
        {!busy && (
          <button onClick={onReset} style={{ fontSize: 13, color: "var(--text-muted)", background: "transparent", border: "0.5px solid var(--border)", borderRadius: 8, padding: "6px 14px", cursor: "pointer" }}>
            ← New file
          </button>
        )}
      </div>

      <div
        ref={containerRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        style={{
          background: "#000", border: "0.5px solid var(--border)", borderRadius: 16,
          overflow: "hidden", position: "relative", aspectRatio: "16/10",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: phase === "done" ? "col-resize" : "default",
          userSelect: "none", touchAction: phase === "done" ? "none" : "auto",
        }}
      >
        {phase === "done" && outputUrl ? (
          <>
            <img src={outputUrl} alt="upscaled" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }} />
            <div ref={clipRef} style={{ position: "absolute", inset: 0, overflow: "hidden", clipPath: "inset(0 50% 0 0)", pointerEvents: "none" }}>
              <img src={input.url} alt="original" draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            </div>
            <div ref={lineRef} style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 2, background: "#fff", transform: "translateX(-50%)", pointerEvents: "none", boxShadow: "0 0 12px rgba(0,0,0,0.5)" }}>
              <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 34, height: 34, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#000", fontSize: 13 }}>↔</div>
            </div>
            <span style={{ position: "absolute", top: 12, left: 12, fontSize: 11, fontWeight: 500, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "4px 10px", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.06em", pointerEvents: "none" }}>Original</span>
            <span style={{ position: "absolute", top: 12, right: 12, fontSize: 11, fontWeight: 500, background: "rgba(228,192,120,0.92)", color: "var(--on-accent)", padding: "4px 10px", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.06em", pointerEvents: "none" }}>AI {scale}</span>
          </>
        ) : (
          <>
            {/* the developing photo: soft base, sharp tiles landing live */}
            <canvas
              ref={previewRef}
              style={{
                width: "100%", height: "100%", objectFit: "contain",
                display: phase === "processing" ? "block" : "none",
              }}
            />
            {phase !== "processing" && (
              <img src={input.url} alt="preview" draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain", opacity: phase === "loading" ? 0.25 : 1 }} />
            )}

            {phase === "idle" && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "rgba(10,10,11,0.4)" }}>
                <button onClick={start} style={{ background: "var(--accent)", color: "var(--on-accent)", border: "none", borderRadius: 12, padding: "14px 32px", fontSize: 16, fontWeight: 500, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 9 }}>
                  <SparkleIcon size={17} /> Upscale {scale} with AI {dims && `→ ${outW}×${outH}`}
                </button>
                <p className="mono" style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>Real-ESRGAN · photo-real texture reconstruction · runs on your GPU</p>
              </div>
            )}

            {phase === "loading" && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: "rgba(10,10,11,0.55)", backdropFilter: "blur(2px)" }}>
                <div style={{ width: 44, height: 44, border: "2px solid rgba(255,255,255,0.15)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.9s linear infinite" }} />
                <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>{msg}</p>
                <div style={{ width: 220, height: 4, background: "rgba(255,255,255,0.1)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${dlPct}%`, background: "var(--accent)", borderRadius: 4, transition: "width 0.3s ease" }} />
                </div>
              </div>
            )}

            {phase === "processing" && (
              <div style={{
                position: "absolute", bottom: 14, left: 14, right: 14,
                display: "flex", alignItems: "center", gap: 12,
                background: "rgba(10,10,11,0.78)", borderRadius: 12, padding: "12px 16px",
                backdropFilter: "blur(6px)",
              }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", animation: "pulse 1s ease-in-out infinite", flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, color: "#fff", marginBottom: 6 }}>
                    Developing your image… <span className="mono" style={{ color: "var(--accent)" }}>{msg}</span>
                  </p>
                  <div style={{ height: 3, background: "rgba(255,255,255,0.1)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${tilePct}%`, background: "linear-gradient(90deg, var(--accent-2), var(--accent))", borderRadius: 4, transition: "width 0.25s ease" }} />
                  </div>
                </div>
                <span className="mono" style={{ fontSize: 12, color: "rgba(255,255,255,0.7)", flexShrink: 0 }}>
                  {tile ? `${tile.done}/${tile.total}` : ""}{eta !== null ? ` · ~${eta}s` : ""}
                </span>
              </div>
            )}

            {phase === "error" && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,10,11,0.85)" }}>
                <div style={{ textAlign: "center", padding: 24 }}>
                  <p style={{ color: "#ef4444", fontSize: 14, marginBottom: 12 }}>{msg}</p>
                  <button onClick={start} style={{ background: "var(--accent)", color: "var(--on-accent)", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, cursor: "pointer" }}>Try again</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {phase === "done" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: 10 }}>
            <Stat label="Resolution" value={`${outW}×${outH}`} />
            <Stat label="Engine" value={`Real-ESRGAN · ${srDevice() === "webgpu" ? "GPU" : "CPU"}`} />
            <Stat label="Size" value={formatBytes(outSize)} />
            <Stat label="Format" value="PNG" />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={download} style={{ flex: 1, background: "var(--accent)", color: "var(--on-accent)", border: "none", borderRadius: 10, padding: "13px", fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
              ↓ Download {scale} image (PNG) · {formatBytes(outSize)}
            </button>
            <button onClick={onReset} style={{ padding: "13px 20px", background: "transparent", border: "0.5px solid var(--border)", borderRadius: 10, fontSize: 15, color: "var(--text-muted)", cursor: "pointer" }}>
              New file
            </button>
          </div>
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Drag the slider to compare. This is real AI reconstruction — zoom in on edges, textures, and text to see detail the original didn't have.
          </p>
        </>
      )}

      {phase === "idle" && (
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          Real-ESRGAN is a GAN-trained super-resolution net — it reconstructs believable texture (skin, hair, fabric) instead of just smoothing. Larger images process in tiles and take longer.
        </p>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 10, padding: "12px 16px" }}>
      <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</p>
      <p className="mono" style={{ fontSize: 15, fontWeight: 500 }}>{value}</p>
    </div>
  );
}
