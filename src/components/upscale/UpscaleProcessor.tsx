"use client";

import { useEffect, useRef, useState } from "react";
import type { UpscaleFile, UpscaleScale } from "@/app/upscale/page";
import CompareSlider from "./CompareSlider";

type Phase =
  | "idle"
  | "loading-ffmpeg"
  | "extracting"
  | "upscaling"
  | "encoding"
  | "done"
  | "error";

interface Progress {
  phase: Phase;
  pct: number;
  frame?: number;
  total?: number;
  message: string;
}

const PHASE_LABELS: Record<Phase, string> = {
  idle: "Ready",
  "loading-ffmpeg": "Loading ffmpeg…",
  extracting: "Extracting frames…",
  upscaling: "Upscaling frames…",
  encoding: "Encoding video…",
  done: "Done",
  error: "Error",
};

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
  const [progress, setProgress] = useState<Progress>({ phase: "idle", pct: 0, message: "Ready to upscale" });
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const thumbCanvas = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const abortRef = useRef(false);

  useEffect(() => {
    const vid = videoRef.current;
    if (!vid) return;
    vid.src = input.url;
    vid.onloadedmetadata = () => {
      vid.currentTime = Math.min(2, vid.duration * 0.1);
    };
    vid.onseeked = () => {
      const c = thumbCanvas.current;
      if (!c) return;
      c.width = vid.videoWidth;
      c.height = vid.videoHeight;
      c.getContext("2d")?.drawImage(vid, 0, 0);
    };
  }, [input.url]);

  async function startUpscale() {
    setStarted(true);
    abortRef.current = false;

    try {
      setProgress({ phase: "loading-ffmpeg", pct: 5, message: "Loading ffmpeg.wasm…" });

      const { FFmpeg } = await import("@ffmpeg/ffmpeg");
      const { fetchFile, toBlobURL } = await import("@ffmpeg/util");

      const ffmpeg = new FFmpeg();
      const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";
      await ffmpeg.load({
        coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
        wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
      });

      setProgress({ phase: "extracting", pct: 15, message: "Writing video to memory…" });
      await ffmpeg.writeFile("input.mp4", await fetchFile(input.file));

      setProgress({ phase: "extracting", pct: 25, message: "Extracting frames…" });
      await ffmpeg.exec(["-i", "input.mp4", "-vf", "fps=24", "frame%04d.png"]);

      const files = await ffmpeg.listDir("/");
      const frames = files
        .filter((f) => f.name.match(/^frame\d+\.png$/))
        .sort((a, b) => a.name.localeCompare(b.name));

      const totalFrames = frames.length;
      const multiplier = scale === "4x" ? 4 : 2;

      setProgress({ phase: "upscaling", pct: 30, message: `Upscaling ${totalFrames} frames…`, total: totalFrames, frame: 0 });

      for (let i = 0; i < frames.length; i++) {
        if (abortRef.current) break;
        const name = frames[i].name;

        await ffmpeg.exec([
          "-i", name,
          "-vf", `scale=iw*${multiplier}:ih*${multiplier}:flags=lanczos`,
          `up_${name}`,
        ]);

        const pct = 30 + Math.round((i / totalFrames) * 40);
        setProgress({
          phase: "upscaling",
          pct,
          message: `Upscaling frame ${i + 1} of ${totalFrames}…`,
          frame: i + 1,
          total: totalFrames,
        });
      }

      setProgress({ phase: "encoding", pct: 72, message: "Encoding output video…" });

      await ffmpeg.exec([
        "-framerate", "24",
        "-i", "up_frame%04d.png",
        "-c:v", "libx264",
        "-crf", "18",
        "-preset", "fast",
        "-pix_fmt", "yuv420p",
        "output.mp4",
      ]);

      const data = await ffmpeg.readFile("output.mp4");
      const blob = new Blob([data], { type: "video/mp4" });
      const url = URL.createObjectURL(blob);

      setOutputUrl(url);
      setProgress({ phase: "done", pct: 100, message: `Done — ${formatBytes(blob.size)}` });
    } catch (err: any) {
      setProgress({ phase: "error", pct: 0, message: err?.message ?? "Something went wrong" });
    }
  }

  function download() {
    if (!outputUrl) return;
    const a = document.createElement("a");
    a.href = outputUrl;
    a.download = `upscaled_${scale}_${input.file.name}`;
    a.click();
  }

  const isDone = progress.phase === "done";
  const isRunning = started && !isDone && progress.phase !== "error";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
            {input.file.name} · {formatBytes(input.file.size)} · {scale} upscale
          </p>
        </div>
        <button
          onClick={onReset}
          style={{
            fontSize: 13,
            color: "var(--text-muted)",
            background: "transparent",
            border: "0.5px solid var(--border)",
            borderRadius: 8,
            padding: "6px 14px",
            cursor: "pointer",
          }}
        >
          ← New video
        </button>
      </div>

      <div
        style={{
          background: "var(--surface)",
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
            <video ref={videoRef} style={{ display: "none" }} />
            <canvas
              ref={thumbCanvas}
              style={{ width: "100%", height: "100%", objectFit: "contain", display: "block" }}
            />
            {!started && (
              <div
                style={{
                  position: "absolute",
                  inset: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "rgba(10,10,11,0.6)",
                  backdropFilter: "blur(4px)",
                }}
              >
                <button
                  onClick={startUpscale}
                  style={{
                    background: "var(--accent)",
                    color: "#fff",
                    border: "none",
                    borderRadius: 12,
                    padding: "14px 32px",
                    fontSize: 16,
                    fontWeight: 500,
                    cursor: "pointer",
                    transition: "opacity 0.15s",
                  }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = "0.85")}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = "1")}
                >
                  ⚡ Start {scale} upscale
                </button>
              </div>
            )}
          </>
        )}
      </div>

      {(isRunning || progress.phase === "error") && (
        <ProgressBar progress={progress} />
      )}

      {isDone && (
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={download}
            style={{
              flex: 1,
              background: "var(--accent)",
              color: "#fff",
              border: "none",
              borderRadius: 10,
              padding: "13px",
              fontSize: 15,
              fontWeight: 500,
              cursor: "pointer",
              transition: "opacity 0.15s",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = "0.85")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = "1")}
          >
            ↓ Download {scale} video
          </button>
          <button
            onClick={onReset}
            style={{
              padding: "13px 20px",
              background: "transparent",
              border: "0.5px solid var(--border)",
              borderRadius: 10,
              fontSize: 15,
              color: "var(--text-muted)",
              cursor: "pointer",
            }}
          >
            New video
          </button>
        </div>
      )}
    </div>
  );
}

function ProgressBar({ progress }: { progress: Progress }) {
  const isError = progress.phase === "error";

  return (
    <div
      style={{
        background: "var(--surface)",
        border: `0.5px solid ${isError ? "rgba(239,68,68,0.3)" : "var(--border)"}`,
        borderRadius: 12,
        padding: "20px 24px",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}>
        <p style={{ fontSize: 14, color: isError ? "#ef4444" : "var(--text)" }}>
          {PHASE_LABELS[progress.phase]}
        </p>
        <span className="mono" style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {progress.pct}%
          {progress.frame && progress.total ? ` · frame ${progress.frame}/${progress.total}` : ""}
        </span>
      </div>

      <div
        style={{
          height: 3,
          background: "var(--surface-2)",
          borderRadius: 4,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${progress.pct}%`,
            background: isError ? "#ef4444" : "var(--accent)",
            borderRadius: 4,
            transition: "width 0.3s ease",
          }}
        />
      </div>

      <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10 }}>
        {progress.message}
      </p>
    </div>
  );
}
