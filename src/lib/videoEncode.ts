"use client";

/**
 * Reusable browser video encoder: renders frames on the GPU-produced canvas,
 * encodes with WebCodecs VideoEncoder (H.264, or VP9 when the resolution
 * exceeds the H.264 encoder's ceiling), and muxes to MP4/WebM via ffmpeg.wasm.
 * Mirrors the proven pipeline in WebSRVideoProcessor, factored out so the
 * rotoscope video export can share it. Optional source-audio passthrough.
 */

import { getFFmpeg, setFFmpegCallbacks } from "@/lib/ffmpeg";

type Container = "mp4" | "webm";
type Chunk = { data: Uint8Array };

async function findH264Codec(w: number, h: number, fps: number): Promise<string | null> {
  if (!("VideoEncoder" in window)) return null;
  const levels = ["64003E", "64003C", "640034", "640033", "64002A", "640028", "4D401E"];
  for (const l of levels) {
    try {
      const { supported } = await (window as any).VideoEncoder.isConfigSupported({
        codec: `avc1.${l}`, width: w, height: h, bitrate: 16_000_000, framerate: fps, avc: { format: "annexb" },
      });
      if (supported) return `avc1.${l}`;
    } catch {}
  }
  return null;
}

async function findVP9Codec(w: number, h: number, fps: number): Promise<string | null> {
  if (!("VideoEncoder" in window)) return null;
  for (const c of ["vp09.00.10.08", "vp09.00.50.08", "vp8"]) {
    try {
      const { supported } = await (window as any).VideoEncoder.isConfigSupported({
        codec: c, width: w, height: h, bitrate: 16_000_000, framerate: fps,
      });
      if (supported) return c;
    } catch {}
  }
  return null;
}

async function pickCodec(
  w: number, h: number, fps: number, preferWebM: boolean
): Promise<{ codec: string; container: Container } | null> {
  // VP9/WebM muxes reliably from a raw IVF stream and supports alpha; raw
  // H.264 elementary-stream muxing is finicky (missing SPS/PPS -> ffmpeg
  // "does not contain any stream"). Callers that need robustness or alpha
  // (the rotoscope export) ask for WebM first; the upscaler prefers H.264/MP4
  // for player compatibility and only falls back to VP9 past its res ceiling.
  if (preferWebM) {
    const vp9 = await findVP9Codec(w, h, fps);
    if (vp9) return { codec: vp9, container: "webm" };
    const h264 = await findH264Codec(w, h, fps);
    if (h264) return { codec: h264, container: "mp4" };
    return null;
  }
  const h264 = await findH264Codec(w, h, fps);
  if (h264) return { codec: h264, container: "mp4" };
  const vp9 = await findVP9Codec(w, h, fps);
  if (vp9) return { codec: vp9, container: "webm" };
  return null;
}

function buildIVF(frames: Uint8Array[], width: number, height: number, fps: number): Uint8Array {
  const HEADER = 32, FRAME_HEADER = 12;
  let total = HEADER;
  for (const f of frames) total += FRAME_HEADER + f.byteLength;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  bytes.set([0x44, 0x4b, 0x49, 0x46], 0);
  view.setUint16(4, 0, true); view.setUint16(6, HEADER, true);
  bytes.set([0x56, 0x50, 0x39, 0x30], 8);
  view.setUint16(12, width, true); view.setUint16(14, height, true);
  view.setUint32(16, fps, true); view.setUint32(20, 1, true);
  view.setUint32(24, frames.length, true); view.setUint32(28, 0, true);
  let offset = HEADER;
  frames.forEach((f, i) => {
    view.setUint32(offset, f.byteLength, true);
    view.setUint32(offset + 4, i, true);
    view.setUint32(offset + 8, 0, true);
    bytes.set(f, offset + FRAME_HEADER);
    offset += FRAME_HEADER + f.byteLength;
  });
  return bytes;
}

export interface EncodeOptions {
  width: number;
  height: number;
  fps: number;
  totalFrames: number;
  /** Draw frame i onto `canvas` (already sized w×h). Return when it's ready. */
  renderFrame: (canvas: HTMLCanvasElement, i: number) => void | Promise<void>;
  /** Optional: source file to lift an audio track from (muxed into the output). */
  audioSource?: File;
  /** Prefer VP9/WebM output (reliable mux, alpha support). Default false = H.264/MP4 first. */
  preferWebM?: boolean;
  onProgress?: (phase: "encoding" | "muxing", pct: number) => void;
  shouldAbort?: () => boolean;
}

export interface EncodeResult { blob: Blob; ext: "mp4" | "webm" }

export async function encodeFramesToVideo(opts: EncodeOptions): Promise<EncodeResult> {
  const { width, height, fps, totalFrames, renderFrame, audioSource, onProgress, shouldAbort } = opts;

  const picked = await pickCodec(width, height, fps, opts.preferWebM ?? false);
  if (!picked) throw new Error(`Your browser can't encode video at ${width}×${height}.`);
  const { codec, container } = picked;

  const canvas = document.createElement("canvas");
  canvas.width = width; canvas.height = height;

  const chunks: Chunk[] = [];
  let encoderErr: Error | null = null;
  const encoder = new (window as any).VideoEncoder({
    output: (chunk: any) => {
      const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d); chunks.push({ data: d });
    },
    error: (e: Error) => { encoderErr = e; },
  });
  const config: any = { codec, width, height, bitrate: 14_000_000, framerate: fps, latencyMode: "quality" };
  if (container === "mp4") config.avc = { format: "annexb" };
  encoder.configure(config);

  for (let i = 0; i < totalFrames; i++) {
    if (shouldAbort?.() || encoderErr) break;
    await renderFrame(canvas, i);
    const ts = Math.round((i / fps) * 1_000_000);
    const frame = new (window as any).VideoFrame(canvas, { timestamp: ts });
    encoder.encode(frame, { keyFrame: i % 60 === 0 });
    frame.close();
    onProgress?.("encoding", Math.round((i / totalFrames) * 100));
    while (encoder.encodeQueueSize > 10) await new Promise((r) => setTimeout(r, 5));
  }
  if (encoderErr) throw encoderErr;
  await encoder.flush();
  encoder.close();

  onProgress?.("muxing", 0);
  const ff = await getFFmpeg();
  const ffLog: string[] = [];
  setFFmpegCallbacks((m) => { ffLog.push(m); }, null);

  let hasAudio = false;
  if (audioSource) {
    try {
      await ff.writeFile("src_a", new Uint8Array(await audioSource.arrayBuffer()));
      hasAudio = (await ff.exec(["-i", "src_a", "-vn", "-c:a", "aac", "-b:a", "192k", "-y", "audio.aac"])) === 0;
    } catch { hasAudio = false; }
  }

  let outName: string, muxArgs: string[];
  if (container === "mp4") {
    const total = chunks.reduce((s, c) => s + c.data.byteLength, 0);
    const h264 = new Uint8Array(total); let off = 0;
    for (const c of chunks) { h264.set(c.data, off); off += c.data.byteLength; }
    await ff.writeFile("video.h264", h264);
    outName = "out.mp4";
    muxArgs = hasAudio
      ? ["-f", "h264", "-framerate", String(fps), "-i", "video.h264", "-i", "audio.aac", "-c:v", "copy", "-c:a", "copy", "-shortest", "-y", outName]
      : ["-f", "h264", "-framerate", String(fps), "-i", "video.h264", "-c:v", "copy", "-y", outName];
  } else {
    await ff.writeFile("video.ivf", buildIVF(chunks.map((c) => c.data), width, height, fps));
    outName = "out.webm";
    muxArgs = hasAudio
      ? ["-f", "ivf", "-i", "video.ivf", "-i", "audio.aac", "-c:v", "copy", "-c:a", "copy", "-shortest", "-y", outName]
      : ["-f", "ivf", "-i", "video.ivf", "-c:v", "copy", "-y", outName];
  }

  const ret = await ff.exec(muxArgs);
  if (ret !== 0) throw new Error(`ffmpeg mux failed (exit ${ret}): ${ffLog.slice(-5).join(" | ")}`);
  const data = await ff.readFile(outName);
  return { blob: new Blob([data as unknown as BlobPart], { type: container === "mp4" ? "video/mp4" : "video/webm" }), ext: container };
}
