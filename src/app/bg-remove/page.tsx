"use client";

import { useState } from "react";
import Nav from "@/components/Nav";
import BgRemoveProcessor from "@/components/bg-remove/BgRemoveProcessor";
import { useGPU, TIER_COLOR } from "@/lib/useGPU";
import { BgRemoveIcon } from "@/components/Icons";

export type ImgFile = { file: File; url: string };

export default function BgRemovePage() {
  const [input, setInput] = useState<ImgFile | null>(null);
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
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "100px 24px 80px" }}>
        <div style={{ marginBottom: 40 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.15em", color: "var(--accent)", textTransform: "uppercase" }}>
            webgpu.in / remove background
          </span>
          <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 500, letterSpacing: "-0.03em", marginTop: 12, marginBottom: 10 }}>
            AI Background Remover
          </h1>
          <p style={{ fontSize: 16, color: "var(--text-muted)", maxWidth: 520, lineHeight: 1.6 }}>
            Real AI segmentation (RMBG) running on your GPU via WebGPU. The model
            downloads once, then everything runs locally — no upload, no account.
          </p>
        </div>

        {!input && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "14px 18px", marginBottom: 20 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: TIER_COLOR[gpu.tier], flexShrink: 0 }} />
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {gpu.scanning ? "Detecting your GPU…" : (
                <>Running on <span className="mono" style={{ color: "var(--text)" }}>{gpu.supported ? "WebGPU" : "CPU (WASM)"}</span> · first run downloads a ~44MB model, then it&apos;s instant</>
              )}
            </p>
          </div>
        )}

        {!input ? (
          <Dropzone onFile={handleFile} />
        ) : (
          <BgRemoveProcessor input={input} onReset={reset} useWebGPU={gpu.supported} />
        )}
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
      <div style={{ width: 56, height: 56, borderRadius: 14, background: "var(--surface-2)", border: "0.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", color: "var(--accent)" }}><BgRemoveIcon size={26} /></div>
      <p style={{ fontSize: 17, fontWeight: 500, marginBottom: 8 }}>Drop an image here</p>
      <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 20 }}>PNG, JPG, WebP</p>
      <span style={{ display: "inline-block", padding: "9px 22px", background: "var(--accent)", color: "var(--on-accent)", borderRadius: 8, fontSize: 14, fontWeight: 500 }}>Choose image</span>
      <p className="mono" style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 24 }}>Processed locally · Nothing uploaded · Free</p>
    </label>
  );
}
