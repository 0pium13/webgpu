"use client";

import { useState } from "react";
import type { ImgFile } from "@/app/bg-remove/page";

type Phase = "idle" | "loading-model" | "processing" | "done" | "error";

const CHECKER =
  "repeating-conic-gradient(#2a2a2e 0% 25%, #18181b 0% 50%) 50% / 20px 20px";

function formatBytes(b: number) {
  if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${(b / 1e3).toFixed(0)} KB`;
}

export default function BgRemoveProcessor({
  input,
  onReset,
  useWebGPU,
}: {
  input: ImgFile;
  onReset: () => void;
  useWebGPU: boolean;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [dlPct, setDlPct] = useState(0);
  const [msg, setMsg] = useState("");
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outSize, setOutSize] = useState(0);

  async function run() {
    try {
      setPhase("loading-model");
      setMsg("Loading AI model…");

      const { AutoModel, AutoProcessor, RawImage, env } = await import("@huggingface/transformers");
      env.allowLocalModels = false;

      const progress = (p: any) => {
        if (p.status === "progress" && p.total) {
          setDlPct(Math.round((p.loaded / p.total) * 100));
          setMsg(`Downloading model… ${Math.round((p.loaded / p.total) * 100)}%`);
        }
      };

      let model: any;
      try {
        model = await AutoModel.from_pretrained("briaai/RMBG-1.4", {
          config: { model_type: "custom" } as any,
          device: useWebGPU ? "webgpu" : "wasm",
          progress_callback: progress,
        });
      } catch (e) {
        // webgpu can fail on some ops — fall back to wasm
        setMsg("Falling back to CPU…");
        model = await AutoModel.from_pretrained("briaai/RMBG-1.4", {
          config: { model_type: "custom" } as any,
          device: "wasm",
          progress_callback: progress,
        });
      }

      const processor = await AutoProcessor.from_pretrained("briaai/RMBG-1.4", {
        config: {
          do_normalize: true,
          do_pad: false,
          do_rescale: true,
          do_resize: true,
          image_mean: [0.5, 0.5, 0.5],
          image_std: [1, 1, 1],
          resample: 2,
          rescale_factor: 0.00392156862745098,
          size: { width: 1024, height: 1024 },
        } as any,
      });

      setPhase("processing");
      setMsg("Removing background…");

      const image = await RawImage.fromURL(input.url);
      const { pixel_values } = await processor(image);
      const { output } = await model({ input: pixel_values });

      const mask = await RawImage.fromTensor(
        output[0].mul(255).to("uint8")
      ).resize(image.width, image.height);

      // composite mask into alpha channel
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const ctx = canvas.getContext("2d")!;

      const srcImg = new Image();
      srcImg.src = input.url;
      await new Promise((r) => (srcImg.onload = r));
      ctx.drawImage(srcImg, 0, 0, image.width, image.height);

      const pixelData = ctx.getImageData(0, 0, image.width, image.height);
      for (let i = 0; i < mask.data.length; i++) {
        pixelData.data[4 * i + 3] = mask.data[i];
      }
      ctx.putImageData(pixelData, 0, 0);

      const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/png"));
      setOutputUrl(URL.createObjectURL(blob));
      setOutSize(blob.size);
      setPhase("done");
    } catch (err: any) {
      console.error(err);
      setMsg(err?.message ?? "Something went wrong");
      setPhase("error");
    }
  }

  function download() {
    if (!outputUrl) return;
    const a = document.createElement("a");
    a.href = outputUrl;
    a.download = `nobg_${input.file.name.replace(/\.[^.]+$/, "")}.png`;
    a.click();
  }

  const busy = phase === "loading-model" || phase === "processing";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {input.file.name} · {formatBytes(input.file.size)}
        </p>
        <button onClick={onReset} style={{ fontSize: 13, color: "var(--text-muted)", background: "transparent", border: "0.5px solid var(--border)", borderRadius: 8, padding: "6px 14px", cursor: "pointer" }}>
          ← New image
        </button>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* original */}
        <div style={{ background: "#000", border: "0.5px solid var(--border)", borderRadius: 12, overflow: "hidden", aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
          <img src={input.url} alt="original" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          <span style={{ position: "absolute", top: 10, left: 10, fontSize: 10, background: "rgba(0,0,0,0.6)", color: "#fff", padding: "3px 8px", borderRadius: 12, textTransform: "uppercase", letterSpacing: "0.06em" }}>Original</span>
        </div>

        {/* result */}
        <div style={{ background: CHECKER, border: "0.5px solid var(--border)", borderRadius: 12, overflow: "hidden", aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
          {phase === "done" && outputUrl ? (
            <img src={outputUrl} alt="result" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          ) : (
            <div style={{ textAlign: "center", padding: 20 }}>
              {busy ? (
                <>
                  <div style={{ position: "relative", width: 48, height: 48, margin: "0 auto 12px" }}>
                    <svg viewBox="0 0 48 48" style={{ transform: "rotate(-90deg)" }}>
                      <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="3" />
                      <circle cx="24" cy="24" r="20" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"
                        strokeDasharray={2 * Math.PI * 20}
                        strokeDashoffset={phase === "loading-model" ? 2 * Math.PI * 20 * (1 - dlPct / 100) : 2 * Math.PI * 20 * 0.25}
                        style={{ transition: "stroke-dashoffset 0.3s", animation: phase === "processing" ? "spin 1s linear infinite" : undefined, transformOrigin: "center" }}
                      />
                    </svg>
                  </div>
                  <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{msg}</p>
                </>
              ) : phase === "error" ? (
                <p style={{ fontSize: 13, color: "#ef4444" }}>{msg}</p>
              ) : (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Result will appear here</p>
              )}
            </div>
          )}
        </div>
      </div>

      {phase === "idle" && (
        <button onClick={run} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 10, padding: "14px", fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
          ✂️ Remove background
        </button>
      )}

      {phase === "error" && (
        <button onClick={run} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 10, padding: "14px", fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
          Try again
        </button>
      )}

      {phase === "done" && (
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={download} style={{ flex: 1, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 10, padding: "13px", fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
            ↓ Download PNG ({formatBytes(outSize)})
          </button>
          <button onClick={onReset} style={{ padding: "13px 20px", background: "transparent", border: "0.5px solid var(--border)", borderRadius: 10, fontSize: 15, color: "var(--text-muted)", cursor: "pointer" }}>
            New image
          </button>
        </div>
      )}
    </div>
  );
}
