"use client";

import { useEffect, useState } from "react";
import Nav from "@/components/Nav";
import OcrDropzone, { isOcrFile } from "@/components/ocr/OcrDropzone";
import OcrStudio from "@/components/ocr/OcrStudio";
import { useGPU, TIER_COLOR } from "@/lib/useGPU";
import { OCR_MODEL_MB } from "@/lib/ocr";

const MAX_FILES = 30;

export default function OcrPage() {
  const [job, setJob] = useState<{ key: number; files: File[] } | null>(null);
  const gpu = useGPU();

  function start(list: File[]) {
    const files = list.filter(isOcrFile).slice(0, MAX_FILES);
    if (!files.length) return alert("Please choose an image (JPG, PNG, WebP) or a PDF.");
    setJob((j) => ({ key: (j?.key ?? 0) + 1, files }));
  }

  // paste a screenshot anywhere — but leave normal text pastes to the editor
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter(isOcrFile);
      if (!files.length || e.clipboardData?.getData("text/plain")) return;
      e.preventDefault();
      start(files);
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, []);

  return (
    <div style={{ minHeight: "100vh" }}>
      <Nav />
      <div style={{ maxWidth: job ? 1120 : 860, margin: "0 auto", padding: "100px 16px 80px", transition: "max-width 0.5s var(--ease-lux)" }}>
        <div style={{ marginBottom: job ? 28 : 40, padding: "0 4px" }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.15em", color: "var(--accent)", textTransform: "uppercase" }}>
            webgpu.in / image to text
          </span>
          <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 500, letterSpacing: "-0.03em", marginTop: 12, marginBottom: 6 }}>
            Image to Text
          </h1>
          <p style={{ fontSize: 15, color: "var(--text-secondary)", marginBottom: 12 }}>
            फोटो से टेक्स्ट निकालें — हिंदी + English
          </p>
          {!job && (
            <p style={{ fontSize: 16, color: "var(--text-muted)", maxWidth: 580, lineHeight: 1.6 }}>
              Pull the text out of any photo, screenshot, scanned page or PDF — Hindi and
              English, even mixed in one line, with ₹ and digits intact. Edit it, copy it,
              save it as .txt. The OCR runs on your own GPU, so your bills and documents
              never leave this tab.
            </p>
          )}
        </div>

        {!job && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "14px 18px", marginBottom: 20 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: TIER_COLOR[gpu.tier], flexShrink: 0 }} />
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {gpu.scanning ? "Detecting your GPU…" : (
                <>Runs on <span className="mono" style={{ color: "var(--text)" }}>{gpu.supported ? "WebGPU" : "CPU (WASM)"}</span> · first run downloads a {OCR_MODEL_MB} MB model, then it&apos;s instant</>
              )}
            </p>
          </div>
        )}

        {job ? <OcrStudio key={job.key} files={job.files} onReset={() => setJob(null)} /> : <OcrDropzone onFiles={start} />}
      </div>
    </div>
  );
}
