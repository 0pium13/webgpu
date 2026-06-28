"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { RotoFile } from "@/app/rotoscope/page";
import { loadSAM, rawImageFromCanvas, embedImage, decodeMask, type SamSession, type SamPoint, type MaskResult } from "@/lib/sam";

type Status = "loading-frame" | "loading-model" | "embedding" | "ready" | "segmenting" | "error";

const CHECKER = "repeating-conic-gradient(#2a2a2e 0% 25%, #18181b 0% 50%) 50% / 20px 20px";

export default function RotoscopeStudio({ input, onReset }: { input: RotoFile; onReset: () => void }) {
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<Status>("loading-frame");
  const [dlPct, setDlPct] = useState(0);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [mode, setMode] = useState<1 | 0>(1);
  const [points, setPoints] = useState<SamPoint[]>([]);
  const [mask, setMask] = useState<MaskResult | null>(null);
  const sessionRef = useRef<SamSession | null>(null);

  // 1) draw the frame (first frame of video, or the image)
  useEffect(() => {
    let cancelled = false;
    async function drawFrame() {
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
      const ov = overlayRef.current!;
      ov.width = base.width; ov.height = base.height;
      setStatus("loading-model");
    }
    drawFrame();
    return () => { cancelled = true; };
  }, [input]);

  // 2) load model + embed this frame (once, keyed on the frame being ready)
  const embedStarted = useRef(false);
  useEffect(() => {
    if (!dims || embedStarted.current) return;
    embedStarted.current = true;
    let cancelled = false;
    (async () => {
      try {
        setStatus("loading-model");
        await loadSAM((p: any) => {
          if (p.status === "progress" && p.total) setDlPct(Math.round((p.loaded / p.total) * 100));
        });
        if (cancelled) return;
        setStatus("embedding");
        const raw = await rawImageFromCanvas(baseRef.current!);
        const session = await embedImage(raw);
        if (cancelled) return;
        sessionRef.current = session;
        setStatus("ready");
      } catch (e) {
        console.error(e);
        if (!cancelled) setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [dims]);

  // draw overlay (mask + points) whenever they change
  const redraw = useCallback(() => {
    const ov = overlayRef.current; if (!ov || !dims) return;
    const ctx = ov.getContext("2d")!;
    ctx.clearRect(0, 0, dims.w, dims.h);
    if (mask) {
      const img = ctx.createImageData(mask.width, mask.height);
      for (let i = 0; i < mask.data.length; i++) {
        if (mask.data[i]) {
          img.data[i * 4] = 99; img.data[i * 4 + 1] = 102; img.data[i * 4 + 2] = 241; img.data[i * 4 + 3] = 120;
        }
      }
      ctx.putImageData(img, 0, 0);
    }
    for (const p of points) {
      ctx.beginPath();
      ctx.arc(p.x * dims.w, p.y * dims.h, Math.max(5, dims.w / 160), 0, Math.PI * 2);
      ctx.fillStyle = p.label ? "#22c55e" : "#ef4444";
      ctx.fill();
      ctx.lineWidth = Math.max(2, dims.w / 400); ctx.strokeStyle = "#fff"; ctx.stroke();
    }
  }, [mask, points, dims]);

  useEffect(() => { redraw(); }, [redraw]);

  async function onClick(e: React.MouseEvent) {
    if (status !== "ready" && status !== "segmenting") return;
    const ov = overlayRef.current!;
    const rect = ov.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const y = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    const next = [...points, { x, y, label: mode }];
    setPoints(next);
    setStatus("segmenting");
    try {
      const m = await decodeMask(sessionRef.current!, next);
      setMask(m);
    } catch (e) { console.error(e); }
    setStatus("ready");
  }

  function resetPoints() { setPoints([]); setMask(null); }

  function downloadCutout() {
    if (!mask || !dims) return;
    const c = document.createElement("canvas");
    c.width = dims.w; c.height = dims.h;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(baseRef.current!, 0, 0);
    const id = ctx.getImageData(0, 0, dims.w, dims.h);
    for (let i = 0; i < mask.data.length; i++) if (!mask.data[i]) id.data[i * 4 + 3] = 0;
    ctx.putImageData(id, 0, 0);
    c.toBlob((b) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b!);
      a.download = `cutout_${input.file.name.replace(/\.[^.]+$/, "")}.png`;
      a.click();
    }, "image/png");
  }

  const busy = status === "loading-frame" || status === "loading-model" || status === "embedding";
  const statusText =
    status === "loading-frame" ? "Loading frame…" :
    status === "loading-model" ? `Loading AI model… ${dlPct}%` :
    status === "embedding" ? "Analyzing frame…" :
    status === "segmenting" ? "Segmenting…" :
    status === "error" ? "Something went wrong" : "Click the object to select it";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* toolbar */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", gap: 6, background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 10, padding: 4 }}>
          <ToolBtn active={mode === 1} onClick={() => setMode(1)} color="#22c55e">+ Add</ToolBtn>
          <ToolBtn active={mode === 0} onClick={() => setMode(0)} color="#ef4444">− Remove</ToolBtn>
        </div>
        <button onClick={resetPoints} disabled={!points.length} style={ghostBtn(!points.length)}>Reset</button>
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 13, color: status === "error" ? "#ef4444" : "var(--text-muted)", display: "flex", alignItems: "center", gap: 8 }}>
          {busy && <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", animation: "pulse 1s ease-in-out infinite" }} />}
          {statusText}
          {mask && status === "ready" && <span className="mono" style={{ color: "var(--green)" }}>· {Math.min(100, Math.round(mask.score * 100))}% conf</span>}
        </span>
        <button onClick={onReset} style={ghostBtn(false)}>← New file</button>
      </div>

      {/* canvas stage */}
      <div style={{ position: "relative", background: CHECKER, border: "0.5px solid var(--border)", borderRadius: 14, overflow: "hidden", display: "flex", justifyContent: "center" }}>
        <div style={{ position: "relative", width: "100%", maxWidth: dims ? dims.w : "100%" }}>
          <canvas ref={baseRef} style={{ display: "block", width: "100%", height: "auto" }} />
          <canvas
            ref={overlayRef}
            onClick={onClick}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", cursor: status === "ready" ? "crosshair" : "default" }}
          />
          {busy && (
            <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,10,11,0.55)", backdropFilter: "blur(2px)" }}>
              <div style={{ textAlign: "center" }}>
                <div style={{ width: 40, height: 40, margin: "0 auto 12px", border: "2px solid rgba(255,255,255,0.15)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.9s linear infinite" }} />
                <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>{statusText}</p>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* actions */}
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={downloadCutout} disabled={!mask}
          style={{ background: mask ? "var(--accent)" : "var(--surface-2)", color: mask ? "#fff" : "var(--text-dim)", border: "none", borderRadius: 10, padding: "12px 22px", fontSize: 15, fontWeight: 500, cursor: mask ? "pointer" : "not-allowed" }}>
          ↓ Download cutout (PNG)
        </button>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {input.isVideo ? "Selecting on the first frame · video tracking is Phase 2" : "Click to add the object, use Remove to trim edges"}
        </p>
      </div>
    </div>
  );
}

function ToolBtn({ children, active, onClick, color }: any) {
  return (
    <button onClick={onClick} style={{
      padding: "6px 14px", borderRadius: 8, border: "none", cursor: "pointer", fontSize: 13, fontWeight: 500,
      background: active ? "var(--surface-2)" : "transparent",
      color: active ? color : "var(--text-muted)",
    }}>{children}</button>
  );
}

function ghostBtn(disabled: boolean): React.CSSProperties {
  return {
    fontSize: 13, color: disabled ? "var(--text-dim)" : "var(--text-muted)", background: "transparent",
    border: "0.5px solid var(--border)", borderRadius: 8, padding: "7px 14px",
    cursor: disabled ? "not-allowed" : "pointer",
  };
}
