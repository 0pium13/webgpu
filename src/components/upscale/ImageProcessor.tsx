"use client";

import { useEffect, useRef, useState } from "react";
import type { UpscaleFile, UpscaleScale } from "@/app/upscale/page";

type Phase = "idle" | "processing" | "done";

function formatBytes(b: number) {
  if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${(b / 1e3).toFixed(0)} KB`;
}

/**
 * Stepped upscale: doubling repeatedly with high-quality smoothing
 * produces noticeably cleaner edges than a single large draw.
 */
async function upscaleImage(img: HTMLImageElement, factor: number): Promise<Blob> {
  let srcCanvas = document.createElement("canvas");
  srcCanvas.width = img.naturalWidth;
  srcCanvas.height = img.naturalHeight;
  srcCanvas.getContext("2d")!.drawImage(img, 0, 0);

  let current = srcCanvas;
  let remaining = factor;

  while (remaining > 1) {
    const step = remaining >= 2 ? 2 : remaining;
    const next = document.createElement("canvas");
    next.width = Math.round(current.width * step);
    next.height = Math.round(current.height * step);
    const ctx = next.getContext("2d")!;
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(current, 0, 0, next.width, next.height);
    current = next;
    remaining /= step;
    // yield so the UI can paint progress
    await new Promise((r) => setTimeout(r, 30));
  }

  return new Promise<Blob>((resolve) =>
    current.toBlob((b) => resolve(b!), "image/png")
  );
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
  const [pos, setPos] = useState(50);
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
    setPhase("processing");
    await new Promise((r) => setTimeout(r, 50));
    const blob = await upscaleImage(imgRef.current, multiplier);
    setOutputUrl(URL.createObjectURL(blob));
    setOutSize(blob.size);
    setPhase("done");
  }

  function download() {
    if (!outputUrl) return;
    const a = document.createElement("a");
    a.href = outputUrl;
    a.download = `upscaled_${scale}_${input.file.name.replace(/\.[^.]+$/, "")}.png`;
    a.click();
  }

  const outW = dims ? dims.w * multiplier : 0;
  const outH = dims ? dims.h * multiplier : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {input.file.name} · {formatBytes(input.file.size)}
          {dims && ` · ${dims.w}×${dims.h} → ${outW}×${outH}`}
        </p>
        <button onClick={onReset} style={{ fontSize: 13, color: "var(--text-muted)", background: "transparent", border: "0.5px solid var(--border)", borderRadius: 8, padding: "6px 14px", cursor: "pointer" }}>
          ← New file
        </button>
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
            <span style={{ position: "absolute", top: 12, right: 12, fontSize: 11, fontWeight: 500, background: "rgba(99,102,241,0.7)", color: "#fff", padding: "4px 10px", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.06em" }}>{scale}</span>
          </>
        ) : (
          <>
            <img src={input.url} alt="preview" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            {phase === "idle" && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "rgba(10,10,11,0.4)" }}>
                <button onClick={start} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12, padding: "14px 32px", fontSize: 16, fontWeight: 500, cursor: "pointer" }}>
                  ⚡ Upscale {scale} {dims && `→ ${outW}×${outH}`}
                </button>
                <p className="mono" style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>instant · runs on your device</p>
              </div>
            )}
            {phase === "processing" && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,10,11,0.6)" }}>
                <p style={{ fontSize: 14 }}>Upscaling…</p>
              </div>
            )}
          </>
        )}
      </div>

      {phase === "done" && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: 10 }}>
            <Stat label="Resolution" value={`${outW}×${outH}`} />
            <Stat label="Scale" value={scale} />
            <Stat label="Size" value={formatBytes(outSize)} />
            <Stat label="Format" value="PNG" />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={download} style={{ flex: 1, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 10, padding: "13px", fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
              ↓ Download {scale} image
            </button>
            <button onClick={onReset} style={{ padding: "13px 20px", background: "transparent", border: "0.5px solid var(--border)", borderRadius: 10, fontSize: 15, color: "var(--text-muted)", cursor: "pointer" }}>
              New file
            </button>
          </div>
        </>
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
