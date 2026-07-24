"use client";

import { useState } from "react";
import Nav from "@/components/Nav";
import { useGPU } from "@/lib/useGPU";
import { EraserIcon } from "@/components/Icons";
import MagicEraserStudio from "@/components/eraser/MagicEraserStudio";

export default function ErasePage() {
  const [file, setFile] = useState<File | null>(null);
  const gpu = useGPU();

  function handleFile(f: File) {
    if (!f.type.startsWith("image/")) return alert("Please choose an image.");
    setFile(f);
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <Nav />
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "100px 24px 80px" }}>
        <div style={{ marginBottom: 36 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.15em", color: "var(--accent)", textTransform: "uppercase" }}>
            webgpu.in / eraser
          </span>
          <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 500, letterSpacing: "-0.03em", marginTop: 12, marginBottom: 10 }}>
            Magic Eraser
          </h1>
          <p style={{ fontSize: 16, color: "var(--text-muted)", maxWidth: 560, lineHeight: 1.6 }}>
            Paint over tourists, power lines, logos, your ex — the AI
            reconstructs what was behind them. Same tech as the flagship
            phone erasers, running on your own GPU. Nothing uploaded.
          </p>
        </div>

        {!file && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "14px 18px", marginBottom: 20 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: gpu.supported ? "var(--green)" : "var(--amber)", flexShrink: 0 }} />
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {gpu.scanning ? "Detecting your GPU…" : (
                <>LaMa inpainting runs on <span className="mono" style={{ color: "var(--text)" }}>{gpu.supported ? "your GPU (WebGPU)" : "CPU (slower)"}</span> · ~200MB model, downloads once</>
              )}
            </p>
          </div>
        )}

        {!file ? <Dropzone onFile={handleFile} /> : <MagicEraserStudio file={file} onReset={() => setFile(null)} />}
      </div>
    </div>
  );
}

function Dropzone({ onFile }: { onFile: (f: File) => void }) {
  const [drag, setDrag] = useState(false);
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      style={{
        display: "block", border: drag ? "0.5px solid var(--accent)" : "0.5px dashed var(--border-strong)",
        borderRadius: 16, background: drag ? "var(--accent-dim)" : "var(--surface)",
        padding: "64px 32px", textAlign: "center", cursor: "pointer", transition: "all 0.15s",
      }}
    >
      <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      <div style={{ width: 56, height: 56, borderRadius: 14, background: "var(--surface-2)", border: "0.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", color: "var(--accent)" }}><EraserIcon size={26} /></div>
      <p style={{ fontSize: 17, fontWeight: 500, marginBottom: 8 }}>Drop an image</p>
      <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 20 }}>JPG, PNG, WebP · any resolution</p>
      <span style={{ display: "inline-block", padding: "9px 22px", background: "var(--accent)", color: "var(--on-accent)", borderRadius: 8, fontSize: 14, fontWeight: 500 }}>Choose image</span>
      <p className="mono" style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 24 }}>Processed locally · Nothing uploaded · Full-res PNG out</p>
    </label>
  );
}
