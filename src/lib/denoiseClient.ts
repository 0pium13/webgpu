"use client";

/**
 * Main-thread side of the noise remover: decode any audio/video to 48 kHz,
 * hand the samples to denoise.worker.ts (main-thread fallback if a worker
 * can't start), and remux cleaned audio back into the original video with
 * ffmpeg.wasm (video stream copied, never re-encoded).
 */
import { denoiseChannels, encodeWav, SAMPLE_RATE, type ChunkSink, type DenoiseProgress } from "./denoise";
import { registerModel } from "./modelRegistry";
import { keepModelsCached } from "./storage";
import { uiYield } from "./bgYield";
import { getFFmpeg, setFFmpegCallbacks, fileToUint8 } from "./ffmpeg";

export const MAX_SECONDS = 30 * 60;

let worker: Worker | null = null;
let seq = 0;

registerModel(["/noise-remover"], () => {
  worker?.terminate();
  worker = null;
  return null;
});

export class CancelledError extends Error {
  constructor() { super("Cancelled"); this.name = "CancelledError"; }
}

export interface DecodedMedia {
  /** Channels to process and play: 1 (mono / near-mono / one-sided) or 2. */
  channels: Float32Array[];
  duration: number;
  /** How the source channels were folded, for the UI. */
  layout: "mono" | "stereo" | "folded";
}

async function decodeBytes(bytes: ArrayBuffer): Promise<AudioBuffer> {
  // decodeAudioData resamples to the context rate — 48 kHz is the model's native rate
  const ctx = new OfflineAudioContext(1, 1, SAMPLE_RATE);
  return ctx.decodeAudioData(bytes);
}

/** ffmpeg pulls the audio out of containers/codecs Web Audio can't open (MKV, AVI, odd codecs). */
async function extractWithFFmpeg(file: File): Promise<AudioBuffer> {
  const ff = await getFFmpeg();
  const inName = `nr-src.${file.name.split(".").pop()?.toLowerCase() || "bin"}`;
  await ff.writeFile(inName, await fileToUint8(file));
  try {
    const ret = await ff.exec(["-i", inName, "-vn", "-ac", "2", "-ar", String(SAMPLE_RATE), "-c:a", "pcm_s16le", "-f", "wav", "nr-src.wav"]);
    if (ret !== 0) throw new Error("no audio track");
    const wav = await ff.readFile("nr-src.wav");
    return await decodeBytes(wav.slice().buffer as ArrayBuffer);
  } finally {
    void ffDelete(inName);
    void ffDelete("nr-src.wav");
  }
}

export async function decodeMedia(file: File): Promise<DecodedMedia> {
  let buf: AudioBuffer;
  try {
    buf = await decodeBytes(await file.arrayBuffer());
  } catch {
    try {
      buf = await extractWithFFmpeg(file);
    } catch {
      throw new Error("Couldn't find an audio track in this file. Try an MP3, WAV, M4A or MP4.");
    }
  }
  if (buf.duration > MAX_SECONDS + 1)
    throw new Error(`This file is ${Math.round(buf.duration / 60)} minutes long — up to 30 minutes per file for now. Trim it first.`);
  if (buf.numberOfChannels === 1) return { channels: [buf.getChannelData(0)], duration: buf.duration, layout: "mono" };

  // Voice recordings are almost always near-mono; processing one channel
  // halves the work. Real stereo (and anything long) keeps both / folds.
  const l = buf.getChannelData(0), r = buf.getChannelData(1);
  let el = 0, er = 0, side = 0;
  for (let i = 0; i < l.length; i += 4) {
    el += l[i] * l[i];
    er += r[i] * r[i];
    const d = l[i] - r[i];
    side += d * d;
  }
  const mid = (el + er) / 2;
  if (el < er * 1e-3) return { channels: [r.slice()], duration: buf.duration, layout: "folded" }; // lav mic on one side
  if (er < el * 1e-3) return { channels: [l.slice()], duration: buf.duration, layout: "folded" };
  if (side < mid * 0.02 || buf.duration > 10 * 60) {
    const m = new Float32Array(l.length);
    for (let i = 0; i < m.length; i++) m[i] = (l[i] + r[i]) * 0.5;
    return { channels: [m], duration: buf.duration, layout: "folded" };
  }
  return { channels: [l, r], duration: buf.duration, layout: "stereo" };
}

export interface DenoiseJob {
  promise: Promise<void>;
  cancel: () => void;
}

/**
 * Run the denoiser. `sink` receives finished samples progressively; the
 * caller owns the output buffers. Input arrays are copied, never detached.
 */
export function runDenoise(
  channels: Float32Array[],
  onProgress: (p: DenoiseProgress) => void,
  sink: ChunkSink,
): DenoiseJob {
  void keepModelsCached();
  let cancelled = false;
  let cancelFn = () => { cancelled = true; };

  const mainThread = () =>
    denoiseChannels(channels, onProgress, sink, {
      between: async () => {
        await uiYield();
        if (cancelled) throw new CancelledError();
      },
    });

  let w: Worker | null = null;
  try {
    if (!worker) worker = new Worker(new URL("./denoise.worker.ts", import.meta.url), { type: "module" });
    w = worker;
  } catch {
    w = null;
  }
  if (!w) return { promise: mainThread(), cancel: () => cancelFn() };

  const promise = new Promise<void>((resolve, reject) => {
    const id = ++seq;
    const ww = w!;
    const cleanup = () => {
      ww.removeEventListener("message", onMsg);
      ww.removeEventListener("error", onErr);
    };
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (d?.id !== id) return;
      if (d.type === "progress") onProgress(d.p);
      else if (d.type === "chunk") sink(d.ch, d.offset, d.samples);
      else if (d.type === "done") { cleanup(); resolve(); }
      else if (d.type === "error") { cleanup(); reject(new Error(d.message)); }
    };
    const onErr = (ev: ErrorEvent) => {
      cleanup();
      console.warn("[noise-remover] worker failed, running on main thread", ev.message);
      ww.terminate();
      if (worker === ww) worker = null;
      mainThread().then(resolve, reject);
    };
    cancelFn = () => {
      cancelled = true;
      cleanup();
      ww.terminate();
      if (worker === ww) worker = null;
      reject(new CancelledError());
    };
    ww.addEventListener("message", onMsg);
    ww.addEventListener("error", onErr);
    const copies = channels.map((c) => c.slice());
    ww.postMessage({ id, channels: copies }, copies.map((c) => c.buffer));
  });
  return { promise, cancel: () => cancelFn() };
}

/* ── video remux ───────────────────────────────────────────────────────── */

async function ffDelete(path: string) {
  try {
    const ff = await getFFmpeg();
    await (ff as unknown as { send(t: string, d: unknown): Promise<unknown> }).send("DELETE_FILE", { path });
  } catch { /* not there */ }
}

/** Container for the rebuilt video: same as the source where it can hold a copied stream, else MP4. */
export function videoOutExt(file: File): "mp4" | "mov" | "webm" | "mkv" {
  const e = file.name.split(".").pop()?.toLowerCase();
  return e === "webm" || e === "mov" || e === "mkv" ? e : "mp4";
}

export type RemuxPhase = { step: "engine" } | { step: "mux"; pct: number };

/**
 * Put the cleaned audio back into the video: video stream copied bit-for-bit
 * (no quality loss, fast), audio encoded to AAC (Opus for WebM).
 */
export async function remuxVideo(
  file: File,
  cleaned: Float32Array[],
  onPhase: (p: RemuxPhase) => void,
): Promise<{ blob: Blob; ext: string }> {
  onPhase({ step: "engine" });
  const ff = await getFFmpeg();
  onPhase({ step: "mux", pct: 0 });
  const srcExt = file.name.split(".").pop()?.toLowerCase() || "mp4";
  const ext = videoOutExt(file);
  const inName = `nr-in.${srcExt}`;
  const outName = `nr-out.${ext}`;
  const audioArgs = ext === "webm" ? ["-c:a", "libopus", "-b:a", "128k"] : ["-c:a", "aac", "-b:a", "192k"];
  setFFmpegCallbacks(null, (p) => onPhase({ step: "mux", pct: Math.max(0, Math.min(99, Math.round(p * 100))) }));
  try {
    await ff.writeFile(inName, await fileToUint8(file));
    await ff.writeFile("nr-clean.wav", new Uint8Array(await encodeWav(cleaned, SAMPLE_RATE).arrayBuffer()));
    const ret = await ff.exec([
      "-i", inName, "-i", "nr-clean.wav",
      "-map", "0:v:0", "-map", "1:a:0",
      "-c:v", "copy", ...audioArgs,
      ...(ext === "mp4" || ext === "mov" ? ["-movflags", "+faststart"] : []),
      outName,
    ]);
    const data = ret === 0 ? await ff.readFile(outName) : null;
    if (!data?.byteLength) throw new Error("Couldn't rebuild this video format — download the clean WAV and swap it in your editor.");
    const mime = ext === "webm" ? "video/webm" : ext === "mov" ? "video/quicktime" : ext === "mkv" ? "video/x-matroska" : "video/mp4";
    return { blob: new Blob([data as BlobPart], { type: mime }), ext };
  } finally {
    setFFmpegCallbacks(null, null);
    void ffDelete(inName);
    void ffDelete("nr-clean.wav");
    void ffDelete(outName);
  }
}
