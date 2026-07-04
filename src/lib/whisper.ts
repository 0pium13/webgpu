"use client";

/**
 * Local speech-to-text (Whisper) for auto-subtitles — transformers.js on
 * WebGPU, wasm fallback. Works on audio AND video files (we only decode the
 * audio track).
 *
 * We chunk the audio ourselves (28s windows, 2s overlap) instead of relying
 * on the pipeline's internal chunker so lines can stream into the UI as each
 * window finishes — waiting feels alive instead of frozen. Overlap seams can
 * occasionally duplicate a word at boundaries; v1 trades that for live
 * streaming and simple, predictable code.
 */

const MODEL_ID = "onnx-community/whisper-base";
const SAMPLE_RATE = 16000;
const WINDOW_S = 28;
const OVERLAP_S = 2;

export interface SubtitleLine {
  start: number; // seconds
  end: number;
  text: string;
}

export type WhisperPhase =
  | { step: "download"; pct: number }
  | { step: "decode" }
  | { step: "transcribe"; doneSec: number; totalSec: number; lines: SubtitleLine[] };

let asrPromise: Promise<any> | null = null;
let usedDevice: "webgpu" | "wasm" = "webgpu";

export function whisperDevice() {
  return usedDevice;
}

export async function loadWhisper(onProgress?: (p: WhisperPhase) => void) {
  if (asrPromise) return asrPromise;
  asrPromise = (async () => {
    const tj: any = await import("@huggingface/transformers");
    const { pipeline, env } = tj;
    env.allowLocalModels = false;
    const cb = (p: any) => {
      if (p?.status === "progress" && p.total) {
        onProgress?.({ step: "download", pct: Math.round((p.loaded / p.total) * 100) });
      }
    };
    try {
      const asr = await pipeline("automatic-speech-recognition", MODEL_ID, {
        device: "webgpu", dtype: "fp32", progress_callback: cb,
      });
      usedDevice = "webgpu";
      return asr;
    } catch (e) {
      console.warn("[whisper] webgpu failed, wasm fallback", e);
      const asr = await pipeline("automatic-speech-recognition", MODEL_ID, {
        device: "wasm", progress_callback: cb,
      });
      usedDevice = "wasm";
      return asr;
    }
  })();
  asrPromise.catch(() => { asrPromise = null; });
  return asrPromise;
}

/** Decode any audio/video file to 16kHz mono Float32. */
export async function decodeAudio(file: File): Promise<Float32Array> {
  const buf = await file.arrayBuffer();
  const probe = new (window.AudioContext || (window as any).webkitAudioContext)();
  const decoded = await probe.decodeAudioData(buf);
  probe.close();

  const frames = Math.ceil(decoded.duration * SAMPLE_RATE);
  const off = new OfflineAudioContext(1, frames, SAMPLE_RATE);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const mono = await off.startRendering();
  return mono.getChannelData(0).slice();
}

/** Transcribe with live per-window streaming. Returns the final line list. */
export async function transcribe(
  audio: Float32Array,
  onProgress: (p: WhisperPhase) => void
): Promise<SubtitleLine[]> {
  const asr = await loadWhisper(onProgress);
  const totalSec = audio.length / SAMPLE_RATE;
  const lines: SubtitleLine[] = [];

  const step = (WINDOW_S - OVERLAP_S) * SAMPLE_RATE;
  const win = WINDOW_S * SAMPLE_RATE;

  for (let start = 0; start < audio.length; start += step) {
    const chunk = audio.subarray(start, Math.min(start + win, audio.length));
    const offsetSec = start / SAMPLE_RATE;

    const out = await asr(chunk, { return_timestamps: true });
    const rawChunks: any[] = out?.chunks ?? [];

    for (const c of rawChunks) {
      const [s, e] = c.timestamp ?? [0, null];
      const text = String(c.text ?? "").trim();
      if (!text) continue;
      const lineStart = offsetSec + (s ?? 0);
      const lineEnd = offsetSec + (e ?? (s ?? 0) + 4);
      // overlap-seam handling: drop lines already fully covered, and if the
      // previous line is a truncated prefix of this one (same sentence heard
      // twice across the window boundary), replace it with the fuller take
      const last = lines[lines.length - 1];
      if (last && lineEnd <= last.end + 0.2) continue;
      if (last && Math.abs(last.start - lineStart) < 1.5 &&
          text.toLowerCase().startsWith(last.text.toLowerCase().replace(/[.,…]+$/, "").slice(0, 40))) {
        lines[lines.length - 1] = { start: last.start, end: Math.min(lineEnd, totalSec), text };
        continue;
      }
      lines.push({ start: lineStart, end: Math.min(lineEnd, totalSec), text });
    }

    onProgress({
      step: "transcribe",
      doneSec: Math.min(totalSec, (start + win) / SAMPLE_RATE),
      totalSec,
      lines: [...lines],
    });

    if (start + win >= audio.length) break;
  }

  return lines;
}

// ── exporters ────────────────────────────────────────────────────────────────

function ts(t: number, sep: "," | "."): string {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const ms = Math.round((t % 1) * 1000);
  const p = (n: number, l = 2) => String(n).padStart(l, "0");
  return `${p(h)}:${p(m)}:${p(s)}${sep}${p(ms, 3)}`;
}

export function toSRT(lines: SubtitleLine[]): string {
  return lines
    .map((l, i) => `${i + 1}\n${ts(l.start, ",")} --> ${ts(l.end, ",")}\n${l.text}`)
    .join("\n\n") + "\n";
}

export function toVTT(lines: SubtitleLine[]): string {
  return "WEBVTT\n\n" + lines
    .map((l) => `${ts(l.start, ".")} --> ${ts(l.end, ".")}\n${l.text}`)
    .join("\n\n") + "\n";
}

export function toTXT(lines: SubtitleLine[]): string {
  return lines.map((l) => l.text).join("\n") + "\n";
}
