"use client";

import { useEffect, useRef, useState } from "react";
import type { UpscaleFile, UpscaleScale } from "@/app/upscale/page";
import CompareSlider from "./CompareSlider";
import { createUpscaler, type Content } from "@/lib/websr";
import { formatDuration } from "@/lib/useGPU";
import { getFFmpeg } from "@/lib/ffmpeg";

type Phase = "idle" | "init" | "processing" | "transcoding" | "done" | "error";

function fmtBytes(b: number) {
  if (b > 1e9) return `${(b / 1e9).toFixed(1)} GB`;
  if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${Math.round(b / 1e3)} KB`;
}

// importExternalTexture requires the video to have a GPU "back resource".
// That only exists after at least one frame has been decoded via the GPU pipeline,
// which means the video must be played (not just seeked). We play briefly, wait
// for requestVideoFrameCallback (which fires only when the GPU texture is ready),
// then pause. After this, importExternalTexture works reliably.
async function primeVideoFrame(video: HTMLVideoElement): Promise<void> {
  return new Promise<void>((resolve) => {
    const done = () => { video.pause(); resolve(); };
    if ((video as any).requestVideoFrameCallback) {
      (video as any).requestVideoFrameCallback(done);
      video.play().catch(resolve);
    } else {
      // Fallback: just play for two frames worth of time
      video.play().then(() => setTimeout(done, 66)).catch(resolve);
    }
  });
}

// For frame-by-frame seeks, use requestVideoFrameCallback instead of seeked —
// it fires when the frame is actually GPU-ready, not just CPU-decoded.
async function seekToFrame(video: HTMLVideoElement, t: number) {
  if (Math.abs(video.currentTime - t) < 0.002) return;
  await new Promise<void>((resolve) => {
    if ((video as any).requestVideoFrameCallback) {
      (video as any).requestVideoFrameCallback(() => resolve());
      video.currentTime = t;
    } else {
      const h = () => { video.removeEventListener("seeked", h); resolve(); };
      video.addEventListener("seeked", h);
      video.currentTime = t;
    }
  });
}

async function findH264Codec(w: number, h: number, fps: number): Promise<string | null> {
  if (!("VideoEncoder" in window)) return null;
  // Try from highest level down; higher levels support larger resolutions
  const candidates = ["64003E", "64003C", "640034", "640033", "64002A", "640028", "4D401E"];
  for (const l of candidates) {
    try {
      const { supported } = await (window as any).VideoEncoder.isConfigSupported({
        codec: `avc1.${l}`,
        width: w,
        height: h,
        bitrate: 16_000_000,
        framerate: fps,
      });
      if (supported) return `avc1.${l}`;
    } catch {}
  }
  return null;
}

const ghostBtn: React.CSSProperties = {
  fontSize: 13,
  color: "var(--text-muted)",
  background: "transparent",
  border: "0.5px solid var(--border)",
  borderRadius: 8,
  padding: "6px 14px",
  cursor: "pointer",
};

export default function WebSRVideoProcessor({
  input,
  scale,
  onReset,
}: {
  input: UpscaleFile;
  scale: UpscaleScale;
  onReset: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);   // final output (2x or 4x)
  const canvas1Ref = useRef<HTMLCanvasElement>(null);  // intermediate 2x pass (4x only)

  const [phase, setPhase] = useState<Phase>("idle");
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState("");
  const [meta, setMeta] = useState<{ w: number; h: number; duration: number } | null>(null);
  const [content, setContent] = useState<Content>("rl");
  const [fastMode, setFastMode] = useState(false);
  const [hasVE, setHasVE] = useState(false);
  const [outUrl, setOutUrl] = useState<string | null>(null);
  const [outSize, setOutSize] = useState(0);
  const [outExt, setOutExt] = useState<"webm" | "mp4">("webm");
  const [speed, setSpeed] = useState(0); // x-times faster than realtime (fast mode)
  const startRef = useRef(0);
  const abortRef = useRef(false);

  useEffect(() => { setHasVE("VideoEncoder" in window); }, []);

  useEffect(() => {
    const v = document.createElement("video");
    v.src = input.url;
    v.onloadedmetadata = () =>
      setMeta({ w: v.videoWidth, h: v.videoHeight, duration: v.duration });
  }, [input.url]);

  const mul = scale === "4x" ? 4 : 2;
  const outW = meta ? meta.w * mul : null;
  const outH = meta ? meta.h * mul : null;

  // ── Helpers ────────────────────────────────────────────────────────────────

  async function loadWebSR(video: HTMLVideoElement) {
    const canvas = canvasRef.current!;
    const canvas1 = canvas1Ref.current!;
    const is4x = scale === "4x";

    if (is4x) {
      const [ws1, ws2] = await Promise.all([
        createUpscaler(canvas1, "m", content),
        createUpscaler(canvas, "m", content),
      ]);
      // Play briefly so the GPU pipeline allocates a back resource for the frame
      await primeVideoFrame(video);
      await ws1.render(video);
      // WebSR render() only accepts HTMLVideoElement or VideoFrame (uses importExternalTexture).
      // A raw HTMLCanvasElement would silently fail. Wrap canvas1 in VideoFrame for pass 2.
      const primeVF = new (window as any).VideoFrame(canvas1, { timestamp: 0 });
      await ws2.render(primeVF);
      primeVF.close();
      return { ws1, ws2 };
    } else {
      const ws1 = await createUpscaler(canvas, "m", content);
      await primeVideoFrame(video);
      await ws1.render(video);
      return { ws1, ws2: null };
    }
  }

  async function renderPasses(
    ws1: any,
    ws2: any,
    src: HTMLVideoElement,
    canvas1: HTMLCanvasElement
  ) {
    if (ws2) {
      await ws1.render(src);
      // WebSR only accepts HTMLVideoElement/VideoFrame — canvas must be wrapped
      const vf = new (window as any).VideoFrame(canvas1, { timestamp: 0 });
      await ws2.render(vf);
      vf.close();
    } else {
      await ws1.render(src);
    }
  }

  // ── Realtime pipeline (captureStream + MediaRecorder → WebM) ──────────────

  async function startRealtime() {
    try {
      setPhase("init"); setMsg("Loading AI model…"); setPct(0);
      abortRef.current = false;

      const video = videoRef.current!;
      const canvas = canvasRef.current!;
      const canvas1 = canvas1Ref.current!;

      video.src = input.url;
      video.muted = true;
      video.playsInline = true;
      await new Promise<void>((r) => { video.onloadeddata = () => r(); });

      const { ws1, ws2 } = await loadWebSR(video);

      // Route audio to MediaRecorder without playing to speakers
      let audioTracks: MediaStreamTrack[] = [];
      try {
        const AC = window.AudioContext ?? (window as any).webkitAudioContext;
        const ac = new AC();
        const src = ac.createMediaElementSource(video);
        const dest = ac.createMediaStreamDestination();
        src.connect(dest);
        const mute = ac.createGain();
        mute.gain.value = 0;
        src.connect(mute);
        mute.connect(ac.destination);
        audioTracks = dest.stream.getAudioTracks();
      } catch { audioTracks = []; }

      const fps = 30;
      const stream = new MediaStream([
        ...canvas.captureStream(fps).getVideoTracks(),
        ...audioTracks,
      ]);
      const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : "video/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 14_000_000 });
      const chunks: BlobPart[] = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      const done$ = new Promise<Blob>((res) => {
        rec.onstop = () => res(new Blob(chunks, { type: "video/webm" }));
      });

      setPhase("processing"); setMsg("Upscaling…"); startRef.current = Date.now();
      rec.start(120);

      const dur = video.duration || 1;
      const tick = async () => {
        if (abortRef.current) { rec.stop(); return; }
        try { await renderPasses(ws1, ws2, video, canvas1); } catch {}
        setPct(Math.min(99, Math.round((video.currentTime / dur) * 100)));
        if (!video.ended) (video as any).requestVideoFrameCallback(tick);
      };
      (video as any).requestVideoFrameCallback(tick);
      video.onended = () => setTimeout(() => rec.state !== "inactive" && rec.stop(), 250);
      await video.play();

      const blob = await done$;
      setOutUrl(URL.createObjectURL(blob));
      setOutSize(blob.size);
      setOutExt("webm");
      setPct(100);
      setPhase("done");
      setMsg(`Done — ${fmtBytes(blob.size)}`);
    } catch (e: any) {
      console.error(e);
      setMsg(e?.message ?? "Something went wrong");
      setPhase("error");
    }
  }

  // ── Fast pipeline (seek + VideoEncoder → H.264 → ffmpeg mux → MP4) ────────

  async function startFast() {
    try {
      setPhase("init"); setMsg("Initializing…"); setPct(0); setSpeed(0);
      abortRef.current = false;

      const video = videoRef.current!;
      const canvas = canvasRef.current!;
      const canvas1 = canvas1Ref.current!;
      const fps = 30;

      video.src = input.url;
      video.muted = true;
      video.playsInline = true;
      await new Promise<void>((r) => { video.onloadeddata = () => r(); });

      setMsg("Loading AI model…");
      const { ws1, ws2 } = await loadWebSR(video);

      const W = canvas.width;
      const H = canvas.height;
      const duration = video.duration || 1;
      const totalFrames = Math.ceil(duration * fps);

      setMsg("Checking GPU encoder…");
      const codec = await findH264Codec(W, H, fps);
      if (!codec) throw new Error("H.264 encoder not supported — use Real-time mode instead");

      type EncodedChunk = { data: Uint8Array; ts: number };
      const encodedChunks: EncodedChunk[] = [];
      let encoderErr: Error | null = null;

      const encoder = new (window as any).VideoEncoder({
        output: (chunk: any) => {
          const d = new Uint8Array(chunk.byteLength);
          chunk.copyTo(d);
          encodedChunks.push({ data: d, ts: chunk.timestamp });
        },
        error: (e: Error) => { encoderErr = e; },
      });
      encoder.configure({
        codec,
        width: W,
        height: H,
        bitrate: 14_000_000,
        framerate: fps,
        latencyMode: "quality",
      });

      setPhase("processing"); setMsg("Rendering frames on GPU…");
      startRef.current = Date.now();

      for (let i = 0; i < totalFrames; i++) {
        if (abortRef.current || encoderErr) break;

        await seekToFrame(video, i / fps);
        await renderPasses(ws1, ws2, video, canvas1);

        const ts = Math.round((i / fps) * 1_000_000); // microseconds
        const frame = new (window as any).VideoFrame(canvas, { timestamp: ts });
        encoder.encode(frame, { keyFrame: i % 60 === 0 });
        frame.close();

        const elapsed = (Date.now() - startRef.current) / 1000;
        setPct(Math.min(99, Math.round((i / totalFrames) * 100)));
        if (i > 5 && elapsed > 0) setSpeed((i / fps) / elapsed);

        // Backpressure: yield if encoder queue fills up
        while (encoder.encodeQueueSize > 10) {
          await new Promise((r) => setTimeout(r, 5));
        }
      }

      if (encoderErr) throw encoderErr;
      await encoder.flush();
      encoder.close();

      // Mux encoded H.264 + audio → MP4 via ffmpeg
      setPhase("transcoding"); setMsg("Loading ffmpeg…"); setPct(0);
      const ff = await getFFmpeg();

      // Concat all H.264 NAL units into one blob
      const totalBytes = encodedChunks.reduce((s, c) => s + c.data.byteLength, 0);
      const h264Bytes = new Uint8Array(totalBytes);
      let off = 0;
      for (const c of encodedChunks) { h264Bytes.set(c.data, off); off += c.data.byteLength; }
      await ff.writeFile("video.h264", h264Bytes);

      // Extract audio from original file (best-effort)
      let hasAudio = false;
      try {
        const srcBytes = new Uint8Array(await input.file.arrayBuffer());
        await ff.writeFile("source", srcBytes);
        await ff.exec(["-i", "source", "-vn", "-c:a", "aac", "-b:a", "192k", "-y", "audio.aac"]);
        hasAudio = true;
      } catch { hasAudio = false; }

      setMsg("Muxing to MP4…");
      if (hasAudio) {
        await ff.exec([
          "-f", "h264", "-framerate", String(fps), "-i", "video.h264",
          "-i", "audio.aac",
          "-c:v", "copy", "-c:a", "copy", "-shortest",
          "-y", "out.mp4",
        ]);
      } else {
        await ff.exec([
          "-f", "h264", "-framerate", String(fps), "-i", "video.h264",
          "-c:v", "copy",
          "-y", "out.mp4",
        ]);
      }

      const mp4 = await ff.readFile("out.mp4");
      const blob = new Blob([mp4 as unknown as BlobPart], { type: "video/mp4" });
      setOutUrl(URL.createObjectURL(blob));
      setOutSize(blob.size);
      setOutExt("mp4");
      setPct(100);
      setPhase("done");
      setMsg(`Done — ${fmtBytes(blob.size)}`);
    } catch (e: any) {
      console.error(e);
      setMsg(e?.message ?? "Something went wrong");
      setPhase("error");
    }
  }

  function start() { fastMode ? startFast() : startRealtime(); }

  function download() {
    if (!outUrl) return;
    const a = document.createElement("a");
    a.href = outUrl;
    a.download = `upscaled_${scale}_${input.file.name.replace(/\.[^.]+$/, "")}.${outExt}`;
    a.click();
  }

  const busy = phase === "init" || phase === "processing" || phase === "transcoding";
  const elapsed = startRef.current ? (Date.now() - startRef.current) / 1000 : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* File info + reset */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {input.file.name} · {fmtBytes(input.file.size)}
          {meta && ` · ${meta.w}×${meta.h}`}
          {outW && <span style={{ color: "var(--accent)" }}> → {outW}×{outH}</span>}
        </p>
        {!busy && (
          <button onClick={onReset} style={ghostBtn}>← New video</button>
        )}
      </div>

      {/* Pre-start controls */}
      {phase === "idle" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Content type */}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span style={{ fontSize: 13, color: "var(--text-muted)", minWidth: 60 }}>Content:</span>
            {([["rl", "Real life / film"], ["an", "Anime / cartoon"]] as [Content, string][]).map(([v, label]) => (
              <button key={v} onClick={() => setContent(v)}
                style={{
                  padding: "6px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer",
                  border: content === v ? "0.5px solid var(--accent)" : "0.5px solid var(--border)",
                  background: content === v ? "var(--accent-dim)" : "transparent",
                  color: content === v ? "var(--accent)" : "var(--text-muted)",
                }}>
                {label}
              </button>
            ))}
          </div>

          {/* Mode picker — only when VideoEncoder is available */}
          {hasVE && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "var(--text-muted)", minWidth: 60 }}>Mode:</span>
              {([
                [false, "Real-time", "WebM · captures as it plays"],
                [true,  "Fast mode", "MP4 · GPU-encoded · ~2–4× speed"],
              ] as [boolean, string, string][]).map(([v, label, sub]) => (
                <button key={String(v)} onClick={() => setFastMode(v)}
                  style={{
                    padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500,
                    cursor: "pointer", textAlign: "left",
                    border: fastMode === v ? "0.5px solid var(--accent)" : "0.5px solid var(--border)",
                    background: fastMode === v ? "var(--accent-dim)" : "transparent",
                    color: fastMode === v ? "var(--accent)" : "var(--text-muted)",
                  }}>
                  {label}
                  <span style={{ fontSize: 11, display: "block", opacity: 0.65, marginTop: 1 }}>{sub}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stage: canvas / compare / idle preview */}
      <div style={{
        position: "relative", background: "#000",
        border: "0.5px solid var(--border)", borderRadius: 16,
        overflow: "hidden", aspectRatio: "16/9",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {/* Hidden but rendered — display:none prevents GPU back resource allocation */}
        <video ref={videoRef} muted playsInline style={{ position: "absolute", opacity: 0, pointerEvents: "none", width: 1, height: 1 }} />
        <canvas ref={canvas1Ref} style={{ display: "none" }} />

        {phase === "done" && outUrl ? (
          <CompareSlider beforeUrl={input.url} afterUrl={outUrl} />
        ) : (
          <>
            {/* Live upscaled canvas — visible while processing or transcoding (shows last frame) */}
            <canvas
              ref={canvasRef}
              style={{
                width: "100%", height: "100%", objectFit: "contain",
                display: (phase === "processing" || phase === "transcoding") ? "block" : "none",
              }}
            />

            {/* Original video preview — visible while idle or on error */}
            {(phase === "idle" || phase === "error") && (
              <video
                src={input.url}
                muted
                playsInline
                style={{ width: "100%", height: "100%", objectFit: "contain" }}
              />
            )}

            {/* Idle overlay: big start button */}
            {phase === "idle" && (
              <div style={{
                position: "absolute", inset: 0,
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                gap: 12, background: "rgba(10,10,11,0.5)",
              }}>
                <button onClick={start} style={{
                  background: "var(--accent)", color: "#fff", border: "none",
                  borderRadius: 12, padding: "14px 32px", fontSize: 16, fontWeight: 500, cursor: "pointer",
                }}>
                  ⚡ Upscale {scale} with AI
                </button>
                <p className="mono" style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>
                  Anime4K CNN · {fastMode ? "GPU-encoded MP4" : "real-time WebM"} · runs on your GPU
                </p>
              </div>
            )}

            {/* Init / transcoding spinner */}
            {(phase === "init" || phase === "transcoding") && (
              <div style={{
                position: "absolute", inset: 0,
                display: "flex", flexDirection: "column",
                alignItems: "center", justifyContent: "center",
                gap: 14, background: "rgba(10,10,11,0.75)",
              }}>
                <div style={{
                  width: 40, height: 40,
                  border: "2px solid rgba(255,255,255,0.15)",
                  borderTopColor: phase === "transcoding" ? "#22c55e" : "var(--accent)",
                  borderRadius: "50%",
                  animation: "spin 0.9s linear infinite",
                }} />
                <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>{msg}</p>
              </div>
            )}

            {/* Processing HUD */}
            {phase === "processing" && (
              <div style={{
                position: "absolute", bottom: 14, left: 14, right: 14,
                display: "flex", alignItems: "center", gap: 10,
                background: "rgba(10,10,11,0.75)", borderRadius: 10, padding: "10px 14px",
              }}>
                <span style={{
                  width: 7, height: 7, borderRadius: "50%",
                  background: "var(--accent)", animation: "pulse 1s ease-in-out infinite", flexShrink: 0,
                }} />
                <span style={{ fontSize: 13, color: "#fff", flex: 1 }}>
                  {fastMode ? "Frame-by-frame…" : "Upscaling…"} {pct}%
                </span>
                <span className="mono" style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>
                  {fastMode && speed > 0
                    ? `${speed.toFixed(1)}× realtime`
                    : !fastMode && pct > 2
                      ? `~${formatDuration((elapsed / pct) * (100 - pct))} left`
                      : ""}
                </span>
              </div>
            )}

            {/* Error */}
            {phase === "error" && (
              <div style={{
                position: "absolute", inset: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "rgba(10,10,11,0.85)",
              }}>
                <div style={{ textAlign: "center", padding: 24 }}>
                  <p style={{ color: "#ef4444", fontSize: 14, marginBottom: 12 }}>{msg}</p>
                  <button onClick={start} style={{
                    background: "var(--accent)", color: "#fff", border: "none",
                    borderRadius: 8, padding: "8px 18px", fontSize: 13, cursor: "pointer",
                  }}>
                    Try again
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Progress bar */}
      {(phase === "processing" || phase === "transcoding") && (
        <div style={{ height: 3, background: "var(--surface-2)", borderRadius: 4, overflow: "hidden" }}>
          <div style={{
            height: "100%",
            width: `${pct}%`,
            background: phase === "transcoding" ? "#22c55e" : "var(--accent)",
            borderRadius: 4,
            transition: "width 0.3s ease",
          }} />
        </div>
      )}

      {/* Done: download */}
      {phase === "done" && (
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={download} style={{
            flex: 1, background: "var(--accent)", color: "#fff", border: "none",
            borderRadius: 10, padding: "13px", fontSize: 15, fontWeight: 500, cursor: "pointer",
          }}>
            ↓ Download {scale} video ({outExt.toUpperCase()}) · {fmtBytes(outSize)}
          </button>
          <button onClick={onReset} style={{
            padding: "13px 20px", background: "transparent",
            border: "0.5px solid var(--border)", borderRadius: 10,
            fontSize: 15, color: "var(--text-muted)", cursor: "pointer",
          }}>
            New video
          </button>
        </div>
      )}

      {/* Footer note */}
      {phase === "idle" && (
        <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
          {fastMode
            ? `Fast mode: seeks each frame, GPU-encodes H.264, muxes to MP4 via ffmpeg. ${scale === "4x" ? "Two-pass 4× AI upscale. " : ""}Audio preserved from original.`
            : `Real-time: Anime4K CNN upscale. ${scale === "4x" ? "Two-pass 4× — doubles twice through the neural net. " : ""}Processes at video playback speed.`}
        </p>
      )}
    </div>
  );
}
