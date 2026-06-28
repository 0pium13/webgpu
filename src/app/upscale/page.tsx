"use client";

import { useRef, useState, useCallback } from "react";
import Nav from "@/components/Nav";
import UpscaleDropzone from "@/components/upscale/UpscaleDropzone";
import UpscaleProcessor from "@/components/upscale/UpscaleProcessor";

export type UpscaleScale = "2x" | "4x";
export type UpscaleFile = { file: File; url: string };

export default function UpscalePage() {
  const [input, setInput] = useState<UpscaleFile | null>(null);
  const [scale, setScale] = useState<UpscaleScale>("4x");

  function handleFile(file: File) {
    const url = URL.createObjectURL(file);
    setInput({ file, url });
  }

  function reset() {
    if (input) URL.revokeObjectURL(input.url);
    setInput(null);
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <Nav />

      <div style={{ maxWidth: 860, margin: "0 auto", padding: "100px 24px 80px" }}>
        <div style={{ marginBottom: 48 }}>
          <span
            className="mono"
            style={{ fontSize: 11, letterSpacing: "0.15em", color: "var(--accent)", textTransform: "uppercase" }}
          >
            webgpu.in / upscale
          </span>
          <h1
            style={{
              fontSize: "clamp(32px, 5vw, 56px)",
              fontWeight: 500,
              letterSpacing: "-0.03em",
              marginTop: 12,
              marginBottom: 10,
            }}
          >
            Free AI Video Upscaler
          </h1>
          <p style={{ fontSize: 16, color: "var(--text-muted)", maxWidth: 520, lineHeight: 1.6 }}>
            Upscale video to 4K right in your browser. Your GPU does the work —
            nothing is uploaded, nothing leaves your machine.
          </p>
        </div>

        {!input ? (
          <>
            <ScalePicker scale={scale} setScale={setScale} />
            <UpscaleDropzone onFile={handleFile} />
            <Features />
          </>
        ) : (
          <UpscaleProcessor input={input} scale={scale} onReset={reset} />
        )}
      </div>
    </div>
  );
}

function ScalePicker({ scale, setScale }: { scale: UpscaleScale; setScale: (s: UpscaleScale) => void }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 24 }}>
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
            fontSize: 14,
            fontWeight: 500,
            cursor: "pointer",
            transition: "all 0.15s",
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
    { icon: "🔒", label: "100% private", desc: "Nothing uploaded. Runs locally." },
    { icon: "⚡", label: "GPU accelerated", desc: "WebGPU + your own hardware." },
    { icon: "🆓", label: "Completely free", desc: "No account. No limits." },
    { icon: "🎬", label: "MP4 output", desc: "Download a clean 4K file." },
  ];

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 12,
        marginTop: 40,
      }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          style={{
            background: "var(--surface)",
            border: "0.5px solid var(--border)",
            borderRadius: 12,
            padding: "18px 20px",
          }}
        >
          <span style={{ fontSize: 20 }}>{item.icon}</span>
          <p style={{ fontWeight: 500, fontSize: 14, marginTop: 10, marginBottom: 4 }}>{item.label}</p>
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{item.desc}</p>
        </div>
      ))}
    </div>
  );
}
