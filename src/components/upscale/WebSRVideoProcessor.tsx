"use client";

import { useEffect, useRef, useState } from "react";
import type { UpscaleFile } from "@/app/upscale/page";
import CompareSlider from "./CompareSlider";
import { createUpscaler, type Content } from "@/lib/websr";
import { formatDuration } from "@/lib/useGPU";

type Phase = "idle" | "init" | "processing" | "done" | "error";

function fmtBytes(b: number) {
  if (b > 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${(b / 1e3).toFixed(0)} KB`;
}

export default function WebSRVideoProcessor({ input, onReset }: { input: UpscaleFile; onReset: () => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState("");
  const [meta, setMeta] = useState<{ w: number; h: number; duration: number } | null>(null);
  const [content, setContent] = useState<Content>("rl");
  const [outUrl, setOutUrl] = useState<string | null>(null);
  const [outSize, setOutSize] = useState(0);
  const startRef = useRef(0);

  useEffect(() => {
    const v = document.createElement("video");
    v.src = input.url;
    v.onloadedmetadata = () => setMeta({ w: v.videoWidth, h: v.videoHeight, duration: v.duration });
  }, [input.url]);

  async function start() {
    try {
      setPhase("init");
      setMsg("Loading AI model…");
      setPct(0);

      const video = videoRef.current!;
      const canvas = canvasRef.current!;
      video.src = input.url;
      video.muted = true;
      video.playsInline = true;
      await new Promise((r) => (video.onloadeddata = r));

      const websr = await createUpscaler(canvas, "m", content);

      // render the first frame so the canvas sizes to 2x
      video.currentTime = 0;
      await new Promise((r) => (video.onseeked = r));
      await websr.render(video);

      // audio: route through WebAudio so it lands in the recording but stays
      // silent for the user; degrade to video-only if it fails
      let audioTracks: MediaStreamTrack[] = [];
      try {
        const AC = (window.AudioContext || (window as any).webkitAudioContext);
        const ac = new AC();
        const srcNode = ac.createMediaElementSource(video);
        const dest = ac.createMediaStreamDestination();
        srcNode.connect(dest);
        const gain = ac.createGain();
        gain.gain.value = 0;
        srcNode.connect(gain);
        gain.connect(ac.destination);
        audioTracks = dest.stream.getAudioTracks();
      } catch {
        audioTracks = [];
      }

      const fps = 30;
      const canvasStream = canvas.captureStream(fps);
      const combined = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      const rec = new MediaRecorder(combined, { mimeType: mime, videoBitsPerSecond: 14_000_000 });
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const recorded = new Promise<Blob>((res) => { rec.onstop = () => res(new Blob(chunks, { type: "video/webm" })); });

      setPhase("processing");
      setMsg("Upscaling on your GPU…");
      startRef.current = Date.now();
      rec.start(120);

      const dur = video.duration || 1;
      const renderFrame = async () => {
        try { await websr.render(video); } catch {}
        setPct(Math.min(99, Math.round((video.currentTime / dur) * 100)));
        if (!video.ended) (video as any).requestVideoFrameCallback(renderFrame);
      };
      (video as any).requestVideoFrameCallback(renderFrame);
      video.onended = () => setTimeout(() => rec.state !== "inactive" && rec.stop(), 250);

      await video.play();

      const blob = await recorded;
      setOutUrl(URL.createObjectURL(blob));
      setOutSize(blob.size);
      setPct(100);
      setPhase("done");
      setMsg(`Done — ${fmtBytes(blob.size)}`);
    } catch (e: any) {
      console.error(e);
      setMsg(e?.message ?? "Something went wrong");
      setPhase("error");
    }
  }

  function download() {
    if (!outUrl) return;
    const a = document.createElement("a");
    a.href = outUrl;
    a.download = `upscaled_2x_${input.file.name.replace(/\.[^.]+$/, "")}.webm`;
    a.click();
  }

  const busy = phase === "init" || phase === "processing";
  const elapsed = startRef.current ? (Date.now() - startRef.current) / 1000 : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {input.file.name} · {fmtBytes(input.file.size)}
          {meta && ` · ${meta.w}×${meta.h} → ${meta.w * 2}×${meta.h * 2}`}
        </p>
        <button onClick={onReset} style={{ fontSize: 13, color: "var(--text-muted)", background: "transparent", border: "0.5px solid var(--border)", borderRadius: 8, padding: "6px 14px", cursor: "pointer" }}>
          ← New video
        </button>
      </div>

      {/* content-type picker (only before start) */}
      {phase === "idle" && (
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Content:</span>
          {([["rl", "Real life / film"], ["an", "Anime / cartoon"]] as [Content, string][]).map(([v, label]) => (
            <button key={v} onClick={() => setContent(v)}
              style={{ padding: "6px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer",
                border: content === v ? "0.5px solid var(--accent)" : "0.5px solid var(--border)",
                background: content === v ? "var(--accent-dim)" : "transparent",
                color: content === v ? "var(--accent)" : "var(--text-muted)" }}>
              {label}
            </button>
          ))}
        </div>
      )}

      {/* stage */}
      <div style={{ position: "relative", background: "#000", border: "0.5px solid var(--border)", borderRadius: 16, overflow: "hidden", aspectRatio: "16/9", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <video ref={videoRef} style={{ display: "none" }} />
        {phase === "done" && outUrl ? (
          <CompareSlider beforeUrl={input.url} afterUrl={outUrl} />
        ) : (
          <>
            {/* live upscaled output canvas */}
            <canvas ref={canvasRef} style={{ width: "100%", height: "100%", objectFit: "contain", display: phase === "processing" ? "block" : "none" }} />
            {phase !== "processing" && (
              <video src={input.url} muted playsInline style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            )}
            {phase === "idle" && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, background: "rgba(10,10,11,0.45)" }}>
                <button onClick={start} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12, padding: "14px 32px", fontSize: 16, fontWeight: 500, cursor: "pointer" }}>
                  ⚡ Upscale 2× with AI
                </button>
                <p className="mono" style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>Anime4K neural net · runs on your GPU · processes in real time</p>
              </div>
            )}
            {busy && (
              <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: phase === "init" ? "rgba(10,10,11,0.6)" : "transparent" }}>
                {phase === "init" ? (
                  <>
                    <div style={{ width: 40, height: 40, border: "2px solid rgba(255,255,255,0.15)", borderTopColor: "var(--accent)", borderRadius: "50%", animation: "spin 0.9s linear infinite" }} />
                    <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>{msg}</p>
                  </>
                ) : (
                  <div style={{ position: "absolute", bottom: 14, left: 14, right: 14, display: "flex", alignItems: "center", gap: 10, background: "rgba(10,10,11,0.7)", borderRadius: 10, padding: "10px 14px" }}>
                    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", animation: "pulse 1s ease-in-out infinite" }} />
                    <span style={{ fontSize: 13, color: "#fff", flex: 1 }}>Upscaling… {pct}%</span>
                    <span className="mono" style={{ fontSize: 12, color: "rgba(255,255,255,0.7)" }}>{pct > 2 ? `~${formatDuration((elapsed / pct) * (100 - pct))} left` : ""}</span>
                  </div>
                )}
              </div>
            )}
            {phase === "error" && (
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,10,11,0.85)" }}>
                <div style={{ textAlign: "center", padding: 24 }}>
                  <p style={{ color: "#ef4444", fontSize: 14, marginBottom: 12 }}>{msg}</p>
                  <button onClick={start} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, cursor: "pointer" }}>Try again</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {phase === "processing" && (
        <div style={{ height: 3, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)", borderRadius: 4, transition: "width 0.3s ease" }} />
        </div>
      )}

      {phase === "done" && (
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={download} style={{ flex: 1, background: "var(--accent)", color: "#fff", border: "none", borderRadius: 10, padding: "13px", fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
            ↓ Download 2× video (WebM)
          </button>
          <button onClick={onReset} style={{ padding: "13px 20px", background: "transparent", border: "0.5px solid var(--border)", borderRadius: 10, fontSize: 15, color: "var(--text-muted)", cursor: "pointer" }}>
            New video
          </button>
        </div>
      )}

      <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
        Real AI upscaling (Anime4K CNN) on your GPU. Processes in real time, so a 1-min clip takes ~1 min. Output is WebM.
      </p>
    </div>
  );
}
