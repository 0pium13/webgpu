"use client";

import { useEffect, useRef, useState } from "react";
import type { UpscaleFile, UpscaleScale } from "@/app/upscale/page";
import CompareSlider from "./CompareSlider";
import { useGPU, estimateVideoUpscale, formatDuration } from "@/lib/useGPU";
import { getFFmpeg, fileToUint8, setFFmpegCallbacks } from "@/lib/ffmpeg";

type Phase = "idle" | "loading" | "processing" | "done" | "error";

interface Meta {
  width: number;
  height: number;
  duration: number;
}

function formatBytes(b: number) {
  if (b > 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${(b / 1e3).toFixed(0)} KB`;
}

export default function UpscaleProcessor({
  input,
  scale,
  onReset,
}: {
  input: UpscaleFile;
  scale: UpscaleScale;
  onReset: () => void;
}) {
  const gpu = useGPU();
  const [phase, setPhase] = useState<Phase>("idle");
  const [pct, setPct] = useState(0);
  const [statusMsg, setStatusMsg] = useState("Ready to upscale");
  const [eta, setEta] = useState<number | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [outSize, setOutSize] = useState<number>(0);
  const [meta, setMeta] = useState<Meta | null>(null);

  const previewRef = useRef<HTMLVideoElement>(null);
  const startTimeRef = useRef(0);
  const multiplier = scale === "4x" ? 4 : 2;

  // load video metadata for estimate + preview
  useEffect(() => {
    const v = document.createElement("video");
    v.src = input.url;
    v.onloadedmetadata = () => {
      setMeta({ width: v.videoWidth, height: v.videoHeight, duration: v.duration });
    };
  }, [input.url]);

  const estimate =
    meta && !gpu.scanning
      ? estimateVideoUpscale(meta.width, meta.height, meta.duration, 30, multiplier, gpu.tier)
      : null;

  async function startUpscale() {
    setPhase("loading");
    setStatusMsg("Loading ffmpeg engine…");
    setPct(0);

    try {
      setFFmpegCallbacks(
        (message) => {
          if (message.includes("frame=")) setStatusMsg(message.trim());
        },
        (progress) => {
          const p = Math.max(0, Math.min(1, progress));
          setPct(Math.round(p * 100));
          const elapsed = (Date.now() - startTimeRef.current) / 1000;
          if (p > 0.02 && elapsed > 1) {
            setEta((elapsed / p) * (1 - p));
          }
        }
      );

      const ffmpeg = await getFFmpeg();

      setStatusMsg("Reading your video…");
      setPhase("processing");
      await ffmpeg.writeFile("input.mp4", await fileToUint8(input.file));

      setStatusMsg("Upscaling…");
      startTimeRef.current = Date.now();

      // single-pass scale — far faster + more reliable than per-frame
      await ffmpeg.exec([
        "-i", "input.mp4",
        "-vf", `scale=iw*${multiplier}:ih*${multiplier}:flags=lanczos`,
        "-c:v", "libx264",
        "-preset", "veryfast",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-c:a", "copy",
        "output.mp4",
      ]);

      const data = await ffmpeg.readFile("output.mp4");
      const blob = new Blob([data as unknown as BlobPart], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);

      setOutputUrl(url);
      setOutSize(blob.size);
      setPct(100);
      setEta(0);
      setPhase("done");
      setStatusMsg(`Done — ${formatBytes(blob.size)}`);
    } catch (err: any) {
      console.error(err);
      setPhase("error");
      setStatusMsg(err?.message ?? "Something went wrong");
    }
  }

  function download() {
    if (!outputUrl) return;
    const a = document.createElement("a");
    a.href = outputUrl;
    a.download = `upscaled_${scale}_${input.file.name.replace(/\.[^.]+$/, "")}.mp4`;
    a.click();
  }

  const isProcessing = phase === "loading" || phase === "processing";
  const isDone = phase === "done";
  const elapsedSec = startTimeRef.current ? (Date.now() - startTimeRef.current) / 1000 : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {/* header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {input.file.name} · {formatBytes(input.file.size)}
          {meta && ` · ${meta.width}×${meta.height} → ${meta.width * multiplier}×${meta.height * multiplier}`}
        </p>
        <button
          onClick={onReset}
          style={{
            fontSize: 13, color: "var(--text-muted)", background: "transparent",
            border: "0.5px solid var(--border)", borderRadius: 8, padding: "6px 14px", cursor: "pointer",
          }}
        >
          ← New video
        </button>
      </div>

      {/* preview / output viewport */}
      <div
        style={{
          background: "#000",
          border: "0.5px solid var(--border)",
          borderRadius: 16,
          overflow: "hidden",
          position: "relative",
          aspectRatio: "16/9",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {isDone && outputUrl ? (
          <CompareSlider beforeUrl={input.url} afterUrl={outputUrl} />
        ) : (
          <>
            {/* LIVE preview — original video plays the whole time */}
            <video
              ref={previewRef}
              src={input.url}
              autoPlay
              loop
              muted
              playsInline
              style={{ width: "100%", height: "100%", objectFit: "contain" }}
            />

            {/* processing overlay */}
            {isProcessing && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(10,10,11,0.55)",
                  backdropFilter: "blur(2px)",
                  gap: 14,
                }}
              >
                <div style={{ position: "relative", width: 64, height: 64 }}>
                  <svg viewBox="0 0 64 64" style={{ transform: "rotate(-90deg)" }}>
                    <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="4" />
                    <circle
                      cx="32" cy="32" r="28" fill="none"
                      stroke="var(--accent)" strokeWidth="4" strokeLinecap="round"
                      strokeDasharray={2 * Math.PI * 28}
                      strokeDashoffset={2 * Math.PI * 28 * (1 - pct / 100)}
                      style={{ transition: "stroke-dashoffset 0.3s ease" }}
                    />
                  </svg>
                  <span className="mono" style={{
                    position: "absolute", inset: 0, display: "flex", alignItems: "center",
                    justifyContent: "center", fontSize: 14, fontWeight: 500,
                  }}>
                    {pct}%
                  </span>
                </div>
                <div style={{ textAlign: "center" }}>
                  <p style={{ fontSize: 14, fontWeight: 500 }}>
                    {phase === "loading" ? "Loading engine…" : "Upscaling on your GPU"}
                  </p>
                  {eta !== null && phase === "processing" && (
                    <p className="mono" style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                      ~{formatDuration(eta)} remaining
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* start overlay */}
            {phase === "idle" && (
              <div
                style={{
                  position: "absolute", inset: 0, display: "flex", flexDirection: "column",
                  alignItems: "center", justifyContent: "center", gap: 16,
                  background: "rgba(10,10,11,0.4)", backdropFilter: "blur(1px)",
                }}
              >
                <button
                  onClick={startUpscale}
                  style={{
                    background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12,
                    padding: "14px 32px", fontSize: 16, fontWeight: 500, cursor: "pointer",
                  }}
                >
                  ⚡ Start {scale} upscale
                </button>
                {estimate !== null && (
                  <p className="mono" style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>
                    est. ~{formatDuration(estimate)} on your {gpu.name.split(" ").slice(0, 2).join(" ")}
                  </p>
                )}
              </div>
            )}

            {phase === "error" && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,10,11,0.8)" }}>
                <div style={{ textAlign: "center", padding: 24 }}>
                  <p style={{ color: "#ef4444", fontSize: 14, marginBottom: 12 }}>{statusMsg}</p>
                  <button onClick={startUpscale} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, cursor: "pointer" }}>
                    Try again
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* stats row during/after processing */}
      {(isProcessing || isDone) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
          <StatBox label="Progress" value={`${pct}%`} />
          <StatBox label={isDone ? "Took" : "ETA"} value={isDone ? formatDuration(elapsedSec) : eta !== null ? `~${formatDuration(eta)}` : "…"} />
          <StatBox label="Output" value={meta ? `${meta.width * multiplier}×${meta.height * multiplier}` : "—"} />
          <StatBox label="Size" value={isDone ? formatBytes(outSize) : "—"} />
        </div>
      )}

      {/* progress bar */}
      {isProcessing && (
        <div style={{ height: 3, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)", borderRadius: 4, transition: "width 0.3s ease" }} />
        </div>
      )}

      {/* download */}
      {isDone && (
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={download}
            style={{
              flex: 1, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 10,
              padding: "13px", fontSize: 15, fontWeight: 500, cursor: "pointer",
            }}
          >
            ↓ Download {scale} video
          </button>
          <button
            onClick={onReset}
            style={{
              padding: "13px 20px", background: "transparent", border: "0.5px solid var(--border)",
              borderRadius: 10, fontSize: 15, color: "var(--text-muted)", cursor: "pointer",
            }}
          >
            New video
          </button>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 10, padding: "12px 16px" }}>
      <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, letterSpacing: "0.06em", textTransform: "uppercase" }}>{label}</p>
      <p className="mono" style={{ fontSize: 16, fontWeight: 500 }}>{value}</p>
    </div>
  );
}
