"use client";

import { useEffect, useRef, useState } from "react";
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
  const [pos, setPos] = useState(50);
  const [elapsed, setElapsed] = useState(0);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const multiplier = scale === "4x" ? 4 : 2;

  useEffect(() => {
    const img = new Image();
    img.src = input.url;
    img.onload = () => {
      imgRef.current = img;
      setDims({ w: img.naturalWidth, h: img.naturalHeight });
    };
  }, [input.url]);

  useEffect(() => {
    function move(e: MouseEvent | TouchEvent) {
      if (!dragging.current || !containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const x = "touches" in e ? e.touches[0].clientX : e.clientX;
      setPos(Math.max(0, Math.min(100, ((x - rect.left) / rect.width) * 100)));
    }
    function up() { dragging.current = false; }
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("touchmove", move);
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
  }, []);

  async function start() {
    if (!imgRef.current) return;
    try {
      setPhase("loading");
      setMsg("Loading AI model…");
      setDlPct(0);
      setTile(null);
      const t0 = Date.now();
      const timer = setInterval(() => setElapsed((Date.now() - t0) / 1000), 200);

      const onProgress = (p: SRProgress) => {
        if (p.phase === "download") {
          setDlPct(p.pct);
          setMsg(`Loading AI model… ${p.pct}%`);
        } else {
          if (phaseRef.current !== "processing") setPhaseSafe("processing");
          setTile({ done: p.done, total: p.total });
          setMsg(`Reconstructing detail… tile ${p.done}/${p.total}`);
        }
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
        style={{
          background: "#000", border: "0.5px solid var(--border)", borderRadius: 16,
          overflow: "hidden", position: "relative", aspectRatio: "16/10",
          display: "flex", alignItems: "center", justifyContent: "center",
          cursor: phase === "done" ? "col-resize" : "default", userSelect: "none",
        }}
        onMouseDown={(e) => { if (phase === "done") { dragging.current = true; const r = containerRef.current!.getBoundingClientRect(); setPos(((e.clientX - r.left) / r.width) * 100); } }}
      >
        {phase === "done" && outputUrl ? (
          <>
            <img src={outputUrl} alt="upscaled" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
            <div style={{ position: "absolute", inset: 0, overflow: "hidden", clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
              <img src={input.url} alt="original" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            </div>
            <div style={{ position: "absolute", top: 0, bottom: 0, left: `${pos}%`, width: 2, background: "#fff", transform: "translateX(-50%)", pointerEvents: "none" }}>
              <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 34, height: 34, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#000", fontSize: 13 }}>↔</div>
            </div>
            <span style={{ position: "absolute", top: 12, left: 12, fontSize: 11, fontWeight: 500, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "4px 10px", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.06em" }}>Original</span>
            <span style={{ position: "absolute", top: 12, right: 12, fontSize: 11, fontWeight: 500, background: "rgba(99,102,241,0.7)", color: "#fff", padding: "4px 10px", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.06em" }}>AI {scale}</span>
          </>
        ) : (
          <>
            <img src={input.url} alt="preview" style={{ width: "100%", height: "100%", objectFit: "contain", opacity: busy ? 0.25 : 1 }} />
            {phase === "idle" && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "rgba(10,10,11,0.4)" }}>
                <button onClick={start} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12, padding: "14px 32px", fontSize: 16, fontWeight: 500, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 9 }}>
                  <SparkleIcon size={17} /> Upscale {scale} with AI {dims && `→ ${outW}×${outH}`}
                </button>
                <p className="mono" style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>Real-ESRGAN · photo-real texture reconstruction · runs on your GPU</p>
              </div>
            )}
            {busy && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: "rgba(10,10,11,0.55)", backdropFilter: "blur(2px)" }}>
                <div style={{ width: 44, height: 44, border: "2px solid rgba(255,255,255,0.15)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.9s linear infinite" }} />
                <p style={{ fontSize: 14, color: "var(--text-secondary)" }}>{msg}</p>
                {/* progress bar */}
                <div style={{ width: 220, height: 4, background: "rgba(255,255,255,0.1)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{
                    height: "100%",
                    width: `${phase === "loading" ? dlPct : tilePct}%`,
                    background: "var(--accent)",
                    borderRadius: 4,
                    transition: "width 0.3s ease",
                  }} />
                </div>
                {eta !== null && (
                  <p className="mono" style={{ fontSize: 11, color: "rgba(255,255,255,0.6)" }}>~{eta}s left</p>
                )}
              </div>
            )}
            {phase === "error" && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,10,11,0.85)" }}>
                <div style={{ textAlign: "center", padding: 24 }}>
                  <p style={{ color: "#ef4444", fontSize: 14, marginBottom: 12 }}>{msg}</p>
                  <button onClick={start} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, cursor: "pointer" }}>Try again</button>
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
            <button onClick={download} style={{ flex: 1, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 10, padding: "13px", fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
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
