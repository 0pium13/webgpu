"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { UpscaleFile } from "@/app/upscale/page";
import { restoreFaces, type RestoreProgress } from "@/lib/faceRestore";
import { SparkleIcon } from "@/components/Icons";

type Phase = "idle" | "working" | "done" | "error";

function formatBytes(b: number) {
  if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${(b / 1e3).toFixed(0)} KB`;
}

export default function FaceRestoreProcessor({
  input,
  onReset,
}: {
  input: UpscaleFile;
  onReset: () => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outSize, setOutSize] = useState(0);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  const [faceCount, setFaceCount] = useState(0);
  const [msg, setMsg] = useState("");
  const [dlPct, setDlPct] = useState(-1);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // compare slider — same direct-DOM pattern as ImageProcessor
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
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
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
      setPhase("working");
      setMsg("Finding faces…");
      setDlPct(-1);

      const onProgress = (p: RestoreProgress) => {
        if (p.phase === "detect") setMsg("Finding faces…");
        if (p.phase === "download") {
          setDlPct(p.pct);
          setMsg(`Loading face model (340MB, one time — cached after)… ${p.pct}%`);
        }
        if (p.phase === "restore") {
          setDlPct(-1);
          setMsg(`Restoring face ${p.face} of ${p.total}…`);
        }
        if (p.phase === "paste") setMsg("Blending the restored face back in…");
      };

      const { canvas, faces } = await restoreFaces(imgRef.current, onProgress);
      if (faces === 0) {
        setMsg("No face found in this photo — face restore needs a visible face. Try the normal upscaler instead.");
        setPhase("error");
        return;
      }
      setFaceCount(faces);
      const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/png"));
      setOutputUrl(URL.createObjectURL(blob));
      setOutSize(blob.size);
      setPhase("done");
    } catch (e: any) {
      console.error(e);
      setMsg(e?.message ?? "Something went wrong");
      setPhase("error");
    }
  }

  function download() {
    if (!outputUrl) return;
    const a = document.createElement("a");
    a.href = outputUrl;
    a.download = `restored_${input.file.name.replace(/\.[^.]+$/, "")}.png`;
    a.click();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {input.file.name} · {formatBytes(input.file.size)}
          {dims && ` · ${dims.w}×${dims.h}`}
        </p>
        {phase !== "working" && (
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
            <img src={outputUrl} alt="restored" draggable={false} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }} />
            <div ref={clipRef} style={{ position: "absolute", inset: 0, overflow: "hidden", clipPath: "inset(0 50% 0 0)", pointerEvents: "none" }}>
              <img src={input.url} alt="original" draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            </div>
            <div ref={lineRef} style={{ position: "absolute", top: 0, bottom: 0, left: "50%", width: 2, background: "#fff", transform: "translateX(-50%)", pointerEvents: "none", boxShadow: "0 0 12px rgba(0,0,0,0.5)" }}>
              <div style={{ position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: 34, height: 34, borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", color: "#000", fontSize: 13 }}>↔</div>
            </div>
            <span style={{ position: "absolute", top: 12, left: 12, fontSize: 11, fontWeight: 500, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "4px 10px", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.06em", pointerEvents: "none" }}>Original</span>
            <span style={{ position: "absolute", top: 12, right: 12, fontSize: 11, fontWeight: 500, background: "rgba(228,192,120,0.92)", color: "var(--on-accent)", padding: "4px 10px", borderRadius: 20, textTransform: "uppercase", letterSpacing: "0.06em", pointerEvents: "none" }}>Restored</span>
          </>
        ) : (
          <>
            <img src={input.url} alt="preview" draggable={false} style={{ width: "100%", height: "100%", objectFit: "contain", opacity: phase === "working" ? 0.3 : 1 }} />

            {phase === "idle" && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "rgba(10,10,11,0.4)" }}>
                <button onClick={start} style={{ background: "var(--accent)", color: "var(--on-accent)", border: "none", borderRadius: 12, padding: "14px 32px", fontSize: 16, fontWeight: 500, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 9 }}>
                  <SparkleIcon size={17} /> Restore blurry faces
                </button>
                <p className="mono" style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>GFPGAN · rebuilds sharp eyes, skin and hair from blur · runs on your GPU</p>
              </div>
            )}

            {phase === "working" && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16, background: "rgba(10,10,11,0.55)", backdropFilter: "blur(2px)" }}>
                <div style={{ width: 44, height: 44, border: "2px solid rgba(255,255,255,0.15)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.9s linear infinite" }} />
                <p style={{ fontSize: 14, color: "var(--text-secondary)", padding: "0 24px", textAlign: "center" }}>{msg}</p>
                {dlPct >= 0 && (
                  <div style={{ width: 220, height: 4, background: "rgba(255,255,255,0.1)", borderRadius: 4, overflow: "hidden" }}>
                    <div style={{ height: "100%", width: `${dlPct}%`, background: "var(--accent)", borderRadius: 4, transition: "width 0.3s ease" }} />
                  </div>
                )}
              </div>
            )}

            {phase === "error" && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,10,11,0.85)" }}>
                <div style={{ textAlign: "center", padding: 24, maxWidth: 420 }}>
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
            <Stat label="Faces restored" value={String(faceCount)} />
            <Stat label="Engine" value="GFPGAN v1.4" />
            <Stat label="Size" value={formatBytes(outSize)} />
            <Stat label="Format" value="PNG" />
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button onClick={download} style={{ flex: 1, background: "var(--accent)", color: "var(--on-accent)", border: "none", borderRadius: 10, padding: "13px", fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
              ↓ Download restored photo (PNG) · {formatBytes(outSize)}
            </button>
            <button onClick={onReset} style={{ padding: "13px 20px", background: "transparent", border: "0.5px solid var(--border)", borderRadius: 10, fontSize: 15, color: "var(--text-muted)", cursor: "pointer" }}>
              New file
            </button>
          </div>
          <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
            Drag the slider over each face to compare. Restoration is strongest on eyes, teeth and hair — heavily damaged or side-profile faces recover less.
          </p>
        </>
      )}

      {phase === "idle" && (
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          GFPGAN is a face-specific generative model — it rebuilds a sharp face from a blurry one instead of just sharpening pixels. Works on every face it finds in the photo; the rest of the image is left untouched.
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
