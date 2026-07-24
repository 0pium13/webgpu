"use client";

import { useEffect, useRef, useState } from "react";
import type { UpscaleFile, UpscaleScale } from "@/app/upscale/page";
import CompareSlider from "./CompareSlider";
import { createUpscaler, type Content } from "@/lib/websr";
import { formatDuration } from "@/lib/useGPU";
import { getFFmpeg, setFFmpegCallbacks } from "@/lib/ffmpeg";
import { upscaleToCanvas, loadSR, estimateTiles, type FrameCache } from "@/lib/realesrgan";
import { SparkleIcon } from "@/components/Icons";

type Phase = "idle" | "init" | "processing" | "transcoding" | "done" | "error";
type Engine = "anime4k" | "swin2sr";

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
  const candidates = ["64003E", "64003C", "640034", "640033", "64002A", "640028", "4D401E"];
  for (const l of candidates) {
    try {
      const { supported } = await (window as any).VideoEncoder.isConfigSupported({
        codec: `avc1.${l}`,
        width: w,
        height: h,
        bitrate: 16_000_000,
        framerate: fps,
        avc: { format: "annexb" },
      });
      if (supported) return `avc1.${l}`;
    } catch {}
  }
  return null;
}

// Real browser H.264 encoders cap out well below the codec spec's resolution
// ceiling — e.g. Chrome on most machines only supports H.264 encode up to
// 1080p, so any 2x/4x upscale of a typical 1080p source already exceeds it.
// VP9 has no such practical ceiling (works up to 8K+), so it's the fallback
// for any output the H.264 encoder rejects.
async function findVP9Codec(w: number, h: number, fps: number): Promise<string | null> {
  if (!("VideoEncoder" in window)) return null;
  const candidates = ["vp09.00.10.08", "vp09.00.50.08", "vp8"];
  for (const c of candidates) {
    try {
      const { supported } = await (window as any).VideoEncoder.isConfigSupported({
        codec: c, width: w, height: h, bitrate: 16_000_000, framerate: fps,
      });
      if (supported) return c;
    } catch {}
  }
  return null;
}

type Container = "mp4" | "webm";

async function pickVideoCodec(
  w: number, h: number, fps: number
): Promise<{ codec: string; container: Container } | null> {
  const h264 = await findH264Codec(w, h, fps);
  if (h264) return { codec: h264, container: "mp4" };
  const vp9 = await findVP9Codec(w, h, fps);
  if (vp9) return { codec: vp9, container: "webm" };
  return null;
}

type Chunk = { data: Uint8Array };

function makeEncoder(
  codec: string,
  container: Container,
  W: number,
  H: number,
  fps: number,
  onChunk: (c: Chunk) => void,
  onError: (e: Error) => void
) {
  const encoder = new (window as any).VideoEncoder({
    output: (chunk: any) => {
      const d = new Uint8Array(chunk.byteLength);
      chunk.copyTo(d);
      onChunk({ data: d });
    },
    error: onError,
  });
  const config: any = {
    codec, width: W, height: H, bitrate: 14_000_000, framerate: fps, latencyMode: "quality",
  };
  // ffmpeg's raw "-f h264" demuxer expects Annex-B (start-code prefixed) NAL
  // units. VideoEncoder defaults to AVCC (length-prefixed), which ffmpeg's
  // raw demuxer can't parse — it silently produces no output. Request
  // annexb explicitly so the muxed file actually gets written. (VP9 has no
  // equivalent bitstream-format option — it's framed via the IVF container.)
  if (container === "mp4") config.avc = { format: "annexb" };
  encoder.configure(config);
  return encoder;
}

// Minimal IVF container so ffmpeg can demux a raw VP9 elementary stream.
// VP9 frames have no self-delimiting start codes the way Annex-B H.264 does,
// so they need an explicit per-frame size/timestamp header to be readable.
function buildIVF(frames: Uint8Array[], width: number, height: number, fps: number): Uint8Array {
  const HEADER = 32;
  const FRAME_HEADER = 12;
  let total = HEADER;
  for (const f of frames) total += FRAME_HEADER + f.byteLength;

  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);

  bytes.set([0x44, 0x4b, 0x49, 0x46], 0); // "DKIF"
  view.setUint16(4, 0, true);             // version
  view.setUint16(6, HEADER, true);        // header length
  bytes.set([0x56, 0x50, 0x39, 0x30], 8); // "VP90" fourcc
  view.setUint16(12, width, true);
  view.setUint16(14, height, true);
  view.setUint32(16, fps, true);          // framerate numerator
  view.setUint32(20, 1, true);            // framerate denominator
  view.setUint32(24, frames.length, true);
  view.setUint32(28, 0, true);

  let offset = HEADER;
  frames.forEach((f, i) => {
    view.setUint32(offset, f.byteLength, true);
    view.setUint32(offset + 4, i, true);  // timestamp low 32 bits = frame index
    view.setUint32(offset + 8, 0, true);  // timestamp high 32 bits
    bytes.set(f, offset + FRAME_HEADER);
    offset += FRAME_HEADER + f.byteLength;
  });
  return bytes;
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
  const canvas1Ref = useRef<HTMLCanvasElement>(null);  // intermediate 2x pass (4x, anime4k only)

  const [phase, setPhase] = useState<Phase>("idle");
  const [pct, setPct] = useState(0);
  const [msg, setMsg] = useState("");
  const [meta, setMeta] = useState<{ w: number; h: number; duration: number } | null>(null);
  const [content, setContent] = useState<Content>("rl");
  const [fastMode, setFastMode] = useState(false);
  // For real-life content, the user can trade detail quality for speed: Swin2SR
  // genuinely reconstructs detail but is tile-by-tile slow; Anime4K (using its
  // real-life-tuned weights, not the anime ones) is much faster but does far
  // less to the image. Anime content always uses Anime4K — it's purpose-built
  // for line art and there's no slow "quality" alternative worth offering.
  const [qualityPreferred, setQualityPreferred] = useState(true);
  const [hasVE, setHasVE] = useState(false);
  const [outUrl, setOutUrl] = useState<string | null>(null);
  const [outSize, setOutSize] = useState(0);
  const [outExt, setOutExt] = useState<"webm" | "mp4">("webm");
  const [speed, setSpeed] = useState(0); // x-times faster than realtime (anime4k fast mode)
  const [tileStats, setTileStats] = useState({ done: 0, skipped: 0 }); // swin2sr: reused-vs-reprocessed tiles, for transparency
  const startRef = useRef(0);
  const abortRef = useRef(false);

  const engine: Engine = content === "an" ? "anime4k" : (qualityPreferred ? "swin2sr" : "anime4k");

  useEffect(() => { setHasVE("VideoEncoder" in window); }, []);

  useEffect(() => {
    const v = document.createElement("video");
    v.src = input.url;
    v.onloadedmetadata = () =>
      setMeta({ w: v.videoWidth, h: v.videoHeight, duration: v.duration });
  }, [input.url]);

  // Output is capped at 4K (3840×2160). Beyond that the pixel count explodes
  // (8K is 4x the pixels of 4K) for detail almost nobody can display, encode
  // support gets shaky, and processing time quadruples. The cap also lets us
  // skip the second Anime4K pass entirely when the capped output is ≤2x the
  // source (e.g. 1080p -> 4K is exactly 2x), which halves the GPU work.
  const CAP_W = 3840, CAP_H = 2160;
  const reqMul = scale === "4x" ? 4 : 2;
  const capInfo = (() => {
    if (!meta) return null;
    const rawW = meta.w * reqMul, rawH = meta.h * reqMul;
    const fit = Math.min(1, CAP_W / rawW, CAP_H / rawH);
    // encoders want even dimensions
    const outW = Math.floor((rawW * fit) / 2) * 2;
    const outH = Math.floor((rawH * fit) / 2) * 2;
    // if the capped output is within 2x of the source, a single 2x engine
    // pass already covers it — running 4x would be wasted compute
    const effMul = reqMul === 4 && outW <= meta.w * 2 && outH <= meta.h * 2 ? 2 : reqMul;
    return { outW, outH, effMul, capped: fit < 1 };
  })();
  const mul = capInfo?.effMul ?? reqMul;
  const outW = capInfo?.outW ?? null;
  const outH = capInfo?.outH ?? null;

  // ── Anime4K helpers (WebSR) ─────────────────────────────────────────────────

  async function loadWebSR(video: HTMLVideoElement) {
    const canvas = canvasRef.current!;
    const canvas1 = canvas1Ref.current!;
    const is4x = mul === 4;

    if (is4x) {
      const [ws1, ws2] = await Promise.all([
        createUpscaler(canvas1, "m", content),
        createUpscaler(canvas, "m", content),
      ]);
      await primeVideoFrame(video);
      await ws1.render(video);
      // WebSR render() only accepts HTMLVideoElement or VideoFrame (uses importExternalTexture).
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

  async function renderAnime4K(ws1: any, ws2: any, src: HTMLVideoElement, canvas1: HTMLCanvasElement) {
    if (ws2) {
      await ws1.render(src);
      const vf = new (window as any).VideoFrame(canvas1, { timestamp: 0 });
      await ws2.render(vf);
      vf.close();
    } else {
      await ws1.render(src);
    }
  }

  // ── Shared: mux encoded video + source audio via ffmpeg ────────────────────

  async function extractAudio(ff: any): Promise<boolean> {
    // exec() returns an exit code rather than throwing, so a missing/failed
    // audio track must be checked explicitly — not assumed from a thrown error.
    try {
      const srcBytes = new Uint8Array(await input.file.arrayBuffer());
      await ff.writeFile("source", srcBytes);
      const ret = await ff.exec(["-i", "source", "-vn", "-c:a", "aac", "-b:a", "192k", "-y", "audio.aac"]);
      return ret === 0;
    } catch {
      return false;
    }
  }

  async function muxToMp4(chunks: Chunk[], fps: number): Promise<Blob> {
    setPhase("transcoding"); setMsg("Loading ffmpeg…"); setPct(0);
    const ff = await getFFmpeg();
    // Captured so a mux failure can report ffmpeg's actual stderr instead of
    // an opaque "FS error" on the readFile that follows a failed exec.
    const ffLog: string[] = [];
    setFFmpegCallbacks((m) => { ffLog.push(m); }, null);

    const totalBytes = chunks.reduce((s, c) => s + c.data.byteLength, 0);
    const h264Bytes = new Uint8Array(totalBytes);
    let off = 0;
    for (const c of chunks) { h264Bytes.set(c.data, off); off += c.data.byteLength; }
    await ff.writeFile("video.h264", h264Bytes);

    const hasAudio = await extractAudio(ff);

    setMsg("Muxing to MP4…");
    const muxArgs = hasAudio
      ? ["-f", "h264", "-framerate", String(fps), "-i", "video.h264",
         "-i", "audio.aac", "-c:v", "copy", "-c:a", "copy", "-shortest", "-y", "out.mp4"]
      : ["-f", "h264", "-framerate", String(fps), "-i", "video.h264",
         "-c:v", "copy", "-y", "out.mp4"];

    // exec() returns ffmpeg's exit code rather than throwing — a parse/mux
    // failure otherwise surfaces only as an opaque "FS error" on readFile.
    const ret = await ff.exec(muxArgs);
    if (ret !== 0) throw new Error(`ffmpeg mux failed (exit ${ret}): ${ffLog.slice(-5).join(" | ")}`);

    const mp4 = await ff.readFile("out.mp4");
    return new Blob([mp4 as unknown as BlobPart], { type: "video/mp4" });
  }

  // VP9 fallback path: build a minimal IVF wrapper around the raw frames so
  // ffmpeg can demux them, then remux to WebM alongside the source audio.
  async function muxToWebm(chunks: Chunk[], W: number, H: number, fps: number): Promise<Blob> {
    setPhase("transcoding"); setMsg("Loading ffmpeg…"); setPct(0);
    const ff = await getFFmpeg();
    const ffLog: string[] = [];
    setFFmpegCallbacks((m) => { ffLog.push(m); }, null);

    const ivf = buildIVF(chunks.map((c) => c.data), W, H, fps);
    await ff.writeFile("video.ivf", ivf);

    const hasAudio = await extractAudio(ff);

    setMsg("Muxing to WebM…");
    const muxArgs = hasAudio
      ? ["-f", "ivf", "-i", "video.ivf", "-i", "audio.aac",
         "-c:v", "copy", "-c:a", "copy", "-shortest", "-y", "out.webm"]
      : ["-f", "ivf", "-i", "video.ivf", "-c:v", "copy", "-y", "out.webm"];

    const ret = await ff.exec(muxArgs);
    if (ret !== 0) throw new Error(`ffmpeg mux failed (exit ${ret}): ${ffLog.slice(-5).join(" | ")}`);

    const webm = await ff.readFile("out.webm");
    return new Blob([webm as unknown as BlobPart], { type: "video/webm" });
  }

  // ── Realtime pipeline — Anime4K only (captureStream + MediaRecorder → WebM) ─

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
      // Record at the 4K-capped size — capture a blit canvas when the WebSR
      // output overshoots the cap, otherwise capture it directly.
      const recW = outW ?? canvas.width;
      const recH = outH ?? canvas.height;
      const needsDownscale = canvas.width !== recW || canvas.height !== recH;
      const recCanvas = document.createElement("canvas");
      recCanvas.width = recW; recCanvas.height = recH;
      const recCtx = recCanvas.getContext("2d")!;
      recCtx.imageSmoothingEnabled = true;
      recCtx.imageSmoothingQuality = "high";
      const captureSrc = needsDownscale ? recCanvas : canvas;

      const stream = new MediaStream([
        ...captureSrc.captureStream(fps).getVideoTracks(),
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
        try {
          await renderAnime4K(ws1, ws2, video, canvas1);
          if (needsDownscale) recCtx.drawImage(canvas, 0, 0, recW, recH);
        } catch {}
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

  // ── Fast pipeline — Anime4K, seek + VideoEncoder → MP4 ─────────────────────

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

      // Encode at the 4K-capped size. When the WebSR canvas is within the cap
      // we encode it directly; when it overshoots (e.g. 4x on a 720p+ source)
      // we blit through a capped canvas — smaller frames encode faster too.
      const W = outW ?? canvas.width;
      const H = outH ?? canvas.height;
      const needsDownscale = canvas.width !== W || canvas.height !== H;
      const encCanvas = document.createElement("canvas");
      encCanvas.width = W; encCanvas.height = H;
      const encCtx = encCanvas.getContext("2d")!;
      encCtx.imageSmoothingEnabled = true;
      encCtx.imageSmoothingQuality = "high";

      const duration = video.duration || 1;
      const totalFrames = Math.ceil(duration * fps);

      setMsg("Checking GPU encoder…");
      const picked = await pickVideoCodec(W, H, fps);
      if (!picked) throw new Error(`Your browser can't encode video at ${W}×${H} — try a lower scale, or use Real-time mode.`);
      const { codec, container } = picked;

      const encodedChunks: Chunk[] = [];
      let encoderErr: Error | null = null;
      const encoder = makeEncoder(codec, container, W, H, fps, (c) => encodedChunks.push(c), (e) => { encoderErr = e; });

      setPhase("processing"); setMsg("Rendering frames on GPU…");
      startRef.current = Date.now();

      for (let i = 0; i < totalFrames; i++) {
        if (abortRef.current || encoderErr) break;

        await seekToFrame(video, i / fps);
        await renderAnime4K(ws1, ws2, video, canvas1);

        const src = needsDownscale
          ? (encCtx.drawImage(canvas, 0, 0, W, H), encCanvas)
          : canvas;
        const ts = Math.round((i / fps) * 1_000_000);
        const frame = new (window as any).VideoFrame(src, { timestamp: ts });
        encoder.encode(frame, { keyFrame: i % 60 === 0 });
        frame.close();

        const elapsed = (Date.now() - startRef.current) / 1000;
        setPct(Math.min(99, Math.round((i / totalFrames) * 100)));
        if (i > 5 && elapsed > 0) setSpeed((i / fps) / elapsed);

        while (encoder.encodeQueueSize > 10) {
          await new Promise((r) => setTimeout(r, 5));
        }
      }

      if (encoderErr) throw encoderErr;
      await encoder.flush();
      encoder.close();

      const blob = container === "mp4"
        ? await muxToMp4(encodedChunks, fps)
        : await muxToWebm(encodedChunks, W, H, fps);
      setOutUrl(URL.createObjectURL(blob));
      setOutSize(blob.size);
      setOutExt(container);
      setPct(100);
      setPhase("done");
      setMsg(`Done — ${fmtBytes(blob.size)}`);
    } catch (e: any) {
      console.error(e);
      setMsg(e?.message ?? "Something went wrong");
      setPhase("error");
    }
  }

  // ── Quality pipeline — Swin2SR, seek + per-frame reconstruct → MP4 ─────────
  // No realtime option here: the model is a full transformer running tiled
  // inference per frame, which cannot keep up with playback speed. This is
  // the tradeoff for genuinely reconstructed detail on real footage instead
  // of Anime4K's lightweight (and anime-tuned) upsampling.

  async function startQuality() {
    try {
      setPhase("init"); setMsg("Loading AI model…"); setPct(0); setSpeed(0);
      setTileStats({ done: 0, skipped: 0 });
      abortRef.current = false;

      const video = videoRef.current!;
      const canvas = canvasRef.current!;
      // Swin2SR reconstructs every output frame from scratch via tiled inference —
      // there's no cheap way to interpolate between frames. 30fps here would mean
      // 3x the tiles (and time) of what's actually needed for a smooth-looking
      // result, so Quality mode samples at a lower rate by default.
      const fps = 12;

      video.src = input.url;
      video.muted = true;
      video.playsInline = true;
      await new Promise<void>((r) => { video.onloadeddata = () => r(); });
      await primeVideoFrame(video);

      // Encode at the 4K-capped size — the Swin2SR output (at mul×) is drawn
      // into this canvas with scaling, so oversized results land at exactly 4K.
      canvas.width = outW ?? video.videoWidth * mul;
      canvas.height = outH ?? video.videoHeight * mul;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";

      await loadSR((p) => {
        if (p.phase === "download") setMsg(`Loading AI model… ${p.pct}%`);
      });

      const W = canvas.width;
      const H = canvas.height;
      const duration = video.duration || 1;
      const totalFrames = Math.ceil(duration * fps);

      setMsg("Checking GPU encoder…");
      const picked = await pickVideoCodec(W, H, fps);
      if (!picked) throw new Error(`Your browser can't encode video at ${W}×${H} — try a lower scale or a smaller source video.`);
      const { codec, container } = picked;

      const encodedChunks: Chunk[] = [];
      let encoderErr: Error | null = null;
      const encoder = makeEncoder(codec, container, W, H, fps, (c) => encodedChunks.push(c), (e) => { encoderErr = e; });

      setPhase("processing"); setMsg("Reconstructing detail on your GPU…");
      startRef.current = Date.now();

      let cache: FrameCache | undefined;
      let tilesDone = 0;
      let tilesSkipped = 0;

      for (let i = 0; i < totalFrames; i++) {
        if (abortRef.current || encoderErr) break;

        await seekToFrame(video, i / fps);
        const { canvas: out, cache: nextCache } = await upscaleToCanvas(video, mul as 2 | 4, (p) => {
          if (p.phase === "tile") {
            const frameFraction = p.done / p.total;
            const pctVal = ((i + frameFraction) / totalFrames) * 100;
            setPct(Math.min(99, Math.round(pctVal * 10) / 10)); // decimal precision, so the bar visibly moves within a frame's tiles
            if (p.skipped) tilesSkipped++;
            tilesDone++;
            setTileStats({ done: tilesDone, skipped: tilesSkipped });
            setMsg(
              `Reconstructing detail… frame ${i + 1}/${totalFrames} · tile ${p.done}/${p.total}` +
              (p.skipped ? " (reused — unchanged)" : "") +
              ` · ${(p.timing.readbackMs + p.timing.inferenceMs + p.timing.stitchMs).toFixed(0)}ms`
            );
          }
        }, cache);
        cache = nextCache;
        ctx.drawImage(out, 0, 0, canvas.width, canvas.height);

        const ts = Math.round((i / fps) * 1_000_000);
        const frame = new (window as any).VideoFrame(canvas, { timestamp: ts });
        encoder.encode(frame, { keyFrame: i % 60 === 0 });
        frame.close();

        while (encoder.encodeQueueSize > 10) {
          await new Promise((r) => setTimeout(r, 5));
        }
      }

      if (encoderErr) throw encoderErr;
      await encoder.flush();
      encoder.close();

      const blob = container === "mp4"
        ? await muxToMp4(encodedChunks, fps)
        : await muxToWebm(encodedChunks, W, H, fps);
      setOutUrl(URL.createObjectURL(blob));
      setOutSize(blob.size);
      setOutExt(container);
      setPct(100);
      setPhase("done");
      setMsg(`Done — ${fmtBytes(blob.size)}`);
    } catch (e: any) {
      console.error(e);
      setMsg(e?.message ?? "Something went wrong");
      setPhase("error");
    }
  }

  function start() {
    if (engine === "swin2sr") return startQuality();
    return fastMode ? startFast() : startRealtime();
  }

  function download() {
    if (!outUrl) return;
    const a = document.createElement("a");
    a.href = outUrl;
    a.download = `upscaled_${scale}_${input.file.name.replace(/\.[^.]+$/, "")}.${outExt}`;
    a.click();
  }

  const busy = phase === "init" || phase === "processing" || phase === "transcoding";
  const elapsed = startRef.current ? (Date.now() - startRef.current) / 1000 : 0;

  // Rough pre-flight estimate for Quality mode, so users aren't surprised by a
  // multi-hour run: Swin2SR reconstructs every sampled frame tile-by-tile, with
  // no cheap interpolation between frames. ~0.4s/tile is a representative figure
  // for Real-ESRGAN 112px cores on WebGPU; actual speed varies by GPU.
  const qualityEstimate = (() => {
    if (engine !== "swin2sr" || !meta) return null;
    const qualityFps = 12;
    const frames = Math.ceil(meta.duration * qualityFps);
    const tiles = estimateTiles(meta.w, meta.h);
    const totalSeconds = frames * tiles * 0.4;
    return { frames, tilesPerFrame: tiles, totalSeconds };
  })();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>

      {/* File info + reset */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {input.file.name} · {fmtBytes(input.file.size)}
          {meta && ` · ${meta.w}×${meta.h}`}
          {outW && <span style={{ color: "var(--accent)" }}> → {outW}×{outH}{capInfo?.capped ? " (4K cap)" : ""}</span>}
        </p>
        {!busy && (
          <button onClick={onReset} style={ghostBtn}>← New video</button>
        )}
      </div>

      {/* Pre-start controls */}
      {phase === "idle" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {/* Content type — this picks the engine */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
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
            <span className="mono" style={{
              fontSize: 11, color: "var(--text-dim)", padding: "4px 10px",
              border: "0.5px solid var(--border)", borderRadius: 20,
            }}>
              engine: {engine === "swin2sr" ? "Real-ESRGAN (photo-real)" : "Anime4K (fast)"}
            </span>
          </div>

          {/* Engine picker — only for real-life content; anime always uses Anime4K */}
          {content === "rl" && (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "var(--text-muted)", minWidth: 60 }}>Engine:</span>
              {([
                [true, "Quality", "Real-ESRGAN · photo-real texture"],
                [false, "Fast", "Anime4K · much quicker · far less detail"],
              ] as [boolean, string, string][]).map(([v, label, sub]) => (
                <button key={String(v)} onClick={() => setQualityPreferred(v)}
                  style={{
                    padding: "7px 14px", borderRadius: 8, fontSize: 13, fontWeight: 500,
                    cursor: "pointer", textAlign: "left",
                    border: qualityPreferred === v ? "0.5px solid var(--accent)" : "0.5px solid var(--border)",
                    background: qualityPreferred === v ? "var(--accent-dim)" : "transparent",
                    color: qualityPreferred === v ? "var(--accent)" : "var(--text-muted)",
                  }}>
                  {label}
                  <span style={{ fontSize: 11, display: "block", opacity: 0.65, marginTop: 1 }}>{sub}</span>
                </button>
              ))}
            </div>
          )}

          {/* Mode picker — only meaningful for the Anime4K engine; Swin2SR has no realtime path */}
          {hasVE && engine === "anime4k" && (
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

          {engine === "swin2sr" && (
            <p style={{ fontSize: 12, color: "var(--text-muted)" }}>
              Real detail reconstruction, not interpolation — processes frame-by-frame and is much slower than real-time. Best for shorter clips.
            </p>
          )}

          {engine === "swin2sr" && qualityEstimate && (
            <div style={{
              background: qualityEstimate.totalSeconds > 300 ? "rgba(239,68,68,0.1)" : "var(--surface)",
              border: `0.5px solid ${qualityEstimate.totalSeconds > 300 ? "rgba(239,68,68,0.3)" : "var(--border)"}`,
              borderRadius: 10, padding: "10px 14px",
            }}>
              <p style={{ fontSize: 13, color: qualityEstimate.totalSeconds > 300 ? "#ef4444" : "var(--text-secondary)" }}>
                Estimated time: <strong>~{formatDuration(qualityEstimate.totalSeconds)}</strong>
                {" "}({qualityEstimate.frames} frames × {qualityEstimate.tilesPerFrame} tiles each)
              </p>
              {qualityEstimate.totalSeconds > 300 && (
                <p style={{ fontSize: 12, color: "rgba(239,68,68,0.85)", marginTop: 4 }}>
                  That's a long run for a browser tab. Switch the Engine above to "Fast" for a result in minutes instead of hours — it'll do far less to the image, but it'll actually finish. Quality mode is best kept for short clips (a few seconds) at this resolution.
                </p>
              )}
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
                  background: "var(--accent)", color: "var(--on-accent)", border: "none",
                  borderRadius: 12, padding: "14px 32px", fontSize: 16, fontWeight: 500, cursor: "pointer",
                  display: "inline-flex", alignItems: "center", gap: 9,
                }}>
                  <SparkleIcon size={17} /> Upscale {scale} with AI
                </button>
                <p className="mono" style={{ fontSize: 12, color: "rgba(255,255,255,0.65)" }}>
                  {engine === "swin2sr"
                    ? "Real-ESRGAN · photo-real texture · runs on your GPU"
                    : `Anime4K CNN · ${fastMode ? "GPU-encoded MP4" : "real-time WebM"} · runs on your GPU`}
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
                display: "flex", flexDirection: "column", gap: 6,
                background: "rgba(10,10,11,0.75)", borderRadius: 10, padding: "10px 14px",
              }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{
                    width: 7, height: 7, borderRadius: "50%",
                    background: "var(--accent)", animation: "pulse 1s ease-in-out infinite", flexShrink: 0,
                  }} />
                  <span style={{ fontSize: 13, color: "#fff", flex: 1 }}>
                    {engine === "swin2sr" ? msg : `Upscaling… ${pct.toFixed(0)}%`}
                  </span>
                  <span className="mono" style={{ fontSize: 12, color: "rgba(255,255,255,0.65)", flexShrink: 0 }}>
                    {engine === "swin2sr"
                      ? `${pct.toFixed(1)}%${pct > 2 ? ` · ~${formatDuration((elapsed / pct) * (100 - pct))} left` : ""}`
                      : fastMode && speed > 0
                        ? `${speed.toFixed(1)}× realtime`
                        : !fastMode && pct > 2
                          ? `~${formatDuration((elapsed / pct) * (100 - pct))} left`
                          : ""}
                  </span>
                </div>
                {engine === "swin2sr" && tileStats.done > 0 && (
                  <p className="mono" style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", paddingLeft: 17 }}>
                    {tileStats.done - tileStats.skipped} reconstructed with AI · {tileStats.skipped} reused unchanged from the previous frame
                    {tileStats.skipped > 0 && ` (${Math.round((tileStats.skipped / tileStats.done) * 100)}% skipped so far)`}
                  </p>
                )}
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
                    background: "var(--accent)", color: "var(--on-accent)", border: "none",
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
            flex: 1, background: "var(--accent)", color: "var(--on-accent)", border: "none",
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
          {(capInfo?.capped ? "Output is capped at 4K (3840×2160) — beyond that, processing time and file size balloon for detail almost no screen can show. " : "") +
            (engine === "swin2sr"
              ? `Real AI texture reconstruction (Real-ESRGAN) on your GPU — rebuilds skin, hair and surface detail instead of just resizing. ${mul === 4 ? "Native 4× model. " : "Runs 4× then downsamples, which also denoises. "}Audio preserved from original.`
              : fastMode
                ? `Fast mode: seeks each frame, GPU-encodes on your GPU, muxes via ffmpeg. ${mul === 4 ? "Two-pass 4× AI upscale. " : ""}Audio preserved from original.`
                : `Real-time: Anime4K CNN upscale. ${mul === 4 ? "Two-pass 4× — doubles twice through the neural net. " : ""}Processes at video playback speed.`)}
        </p>
      )}
    </div>
  );
}
