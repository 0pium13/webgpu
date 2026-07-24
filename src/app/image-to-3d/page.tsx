"use client";

import { useState } from "react";
import Nav from "@/components/Nav";
import ImageTo3DStudio, { type Img3DFile } from "@/components/three-d/ImageTo3DStudio";
import { useGPU } from "@/lib/useGPU";
import { CubeIcon } from "@/components/Icons";

export default function ImageTo3DPage() {
  const [input, setInput] = useState<Img3DFile | null>(null);
  const gpu = useGPU();

  function handleFile(file: File) {
    if (!file.type.startsWith("image/")) return alert("Please choose an image.");
    setInput({ file, url: URL.createObjectURL(file) });
  }

  function reset() {
    if (input) URL.revokeObjectURL(input.url);
    setInput(null);
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <Nav />
      <div style={{ maxWidth: 900, margin: "0 auto", padding: "100px 24px 80px" }}>
        <div style={{ marginBottom: 36 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.15em", color: "var(--accent)", textTransform: "uppercase" }}>
            webgpu.in / image to 3d
          </span>
          <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 500, letterSpacing: "-0.03em", marginTop: 12, marginBottom: 10 }}>
            Image → 3D Model
          </h1>
          <p style={{ fontSize: 16, color: "var(--text-muted)", maxWidth: 580, lineHeight: 1.6 }}>
            One photo in, a real 3D model out. The AI isolates the object,
            predicts the sides the camera never saw, and builds a colored mesh
            you can orbit and export — entirely on your GPU.
          </p>
        </div>

        {!input && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "14px 18px", marginBottom: 20 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: gpu.supported ? "var(--green)" : "var(--amber)", flexShrink: 0 }} />
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {gpu.scanning ? "Detecting your GPU…" : (
                <>TripoSR runs on <span className="mono" style={{ color: "var(--text)" }}>{gpu.supported ? "your GPU (WebGPU)" : "CPU (very slow)"}</span> · first run downloads ~840MB of model, cached after</>
              )}
            </p>
          </div>
        )}

        {!input ? <Dropzone onFile={handleFile} /> : <ImageTo3DStudio input={input} onReset={reset} />}
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
      <div style={{ width: 56, height: 56, borderRadius: 14, background: "var(--surface-2)", border: "0.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", color: "var(--accent)" }}><CubeIcon size={26} /></div>
      <p style={{ fontSize: 17, fontWeight: 500, marginBottom: 8 }}>Drop a photo of one object</p>
      <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 20 }}>PNG, JPG, WebP · a clear single subject works best</p>
      <span style={{ display: "inline-block", padding: "9px 22px", background: "var(--accent)", color: "var(--on-accent)", borderRadius: 8, fontSize: 14, fontWeight: 500 }}>Choose image</span>
      <p className="mono" style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 24 }}>Processed locally · Nothing uploaded · Export GLB / OBJ / STL</p>
    </label>
  );
}
