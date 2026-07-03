"use client";

import { useState } from "react";
import Nav from "@/components/Nav";
import UpscaleDropzone from "@/components/upscale/UpscaleDropzone";
import WebSRVideoProcessor from "@/components/upscale/WebSRVideoProcessor";
import ImageProcessor from "@/components/upscale/ImageProcessor";
import { useGPU, TIER_COLOR, formatDuration } from "@/lib/useGPU";
import { LockIcon, BoltIcon, InfinityIcon, MediaIcon } from "@/components/Icons";

export type UpscaleScale = "2x" | "4x";
export type UpscaleFile = { file: File; url: string; isImage: boolean };

export default function UpscalePage() {
  const [input, setInput] = useState<UpscaleFile | null>(null);
  const [scale, setScale] = useState<UpscaleScale>("4x");
  const gpu = useGPU();

  function handleFile(file: File) {
    const url = URL.createObjectURL(file);
    setInput({ file, url, isImage: file.type.startsWith("image/") });
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
            webgpu.in / upscale
          </span>
          <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 500, letterSpacing: "-0.03em", marginTop: 12, marginBottom: 10 }}>
            Free AI Upscaler
          </h1>
          <p style={{ fontSize: 16, color: "var(--text-muted)", maxWidth: 520, lineHeight: 1.6 }}>
            Upscale video and images right in your browser. Your GPU does the
            work — nothing is uploaded, nothing leaves your machine.
          </p>
        </div>

        {!input && <GpuBanner gpu={gpu} scale={scale} />}

        {!input ? (
          <>
            <ScalePicker scale={scale} setScale={setScale} />
            <UpscaleDropzone onFile={handleFile} />
            <Features />
          </>
        ) : input.isImage ? (
          <ImageProcessor input={input} scale={scale} onReset={reset} />
        ) : (
          <WebSRVideoProcessor input={input} scale={scale} onReset={reset} />
        )}
      </div>
    </div>
  );
}

function GpuBanner({ gpu, scale }: { gpu: ReturnType<typeof useGPU>; scale: UpscaleScale }) {
  const imgEst = ["~2s", "~1s", "<1s", "instant"][gpu.tier];

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        background: "var(--surface)",
        border: "0.5px solid var(--border)",
        borderRadius: 12,
        padding: "14px 18px",
        marginBottom: 20,
      }}
    >
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: TIER_COLOR[gpu.tier], flexShrink: 0 }} />
      <p style={{ fontSize: 13, color: "var(--text-muted)", flex: 1 }}>
        {gpu.scanning ? (
          "Detecting your GPU…"
        ) : (
          <>
            Detected <span style={{ color: "var(--text)" }} className="mono">{gpu.name.split(" ").slice(0, 3).join(" ")}</span>{" "}
            · images upscale in <span style={{ color: TIER_COLOR[gpu.tier] }}>{imgEst}</span>;
            video uses real AI (Anime4K) and processes in <span style={{ color: TIER_COLOR[gpu.tier] }}>real time</span>
          </>
        )}
      </p>
    </div>
  );
}

function ScalePicker({ scale, setScale }: { scale: UpscaleScale; setScale: (s: UpscaleScale) => void }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
      {(["2x", "4x"] as UpscaleScale[]).map((s) => (
        <button
          key={s}
          onClick={() => setScale(s)}
          style={{
            padding: "7px 20px",
            borderRadius: 8,
            border: scale === s ? "0.5px solid var(--accent)" : "0.5px solid var(--border)",
            background: scale === s ? "var(--accent-dim)" : "transparent",
            color: scale === s ? "var(--accent)" : "var(--text-muted)",
            fontSize: 14, fontWeight: 500, cursor: "pointer", transition: "all 0.15s",
          }}
        >
          {s} upscale
        </button>
      ))}
    </div>
  );
}

function Features() {
  const items = [
    { Icon: LockIcon, label: "100% private", desc: "Nothing uploaded. Runs locally." },
    { Icon: BoltIcon, label: "GPU accelerated", desc: "WebGPU + your own hardware." },
    { Icon: InfinityIcon, label: "Completely free", desc: "No account. No limits." },
    { Icon: MediaIcon, label: "Video + images", desc: "MP4, MOV, PNG, JPG, WebP." },
  ];
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 40 }}>
      {items.map((item) => (
        <div key={item.label} style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "18px 20px" }}>
          <item.Icon size={20} style={{ color: "var(--accent)" }} />
          <p style={{ fontWeight: 500, fontSize: 14, marginTop: 10, marginBottom: 4 }}>{item.label}</p>
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{item.desc}</p>
        </div>
      ))}
    </div>
  );
}
