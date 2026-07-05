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

/**
 * Model tiers. Indian/South-Asian language accuracy scales hard with model
 * size — base is fine for English, but Hindi/Tamil/Telugu/Bengali etc. need
 * small at minimum and are dramatically better on large-v3-turbo.
 */
export const WHISPER_MODELS = {
  fast:     { id: "onnx-community/whisper-base",           label: "Fast",     size: "~145MB", dtype: "fp32" as const },
  accurate: { id: "onnx-community/whisper-small",          label: "Accurate", size: "~470MB", dtype: "fp32" as const },
  max:      { id: "onnx-community/whisper-large-v3-turbo", label: "Max",      size: "~1.6GB", dtype: "fp16" as const },
};
export type WhisperTier = keyof typeof WHISPER_MODELS;

/** Languages Whisper genuinely supports, South Asia first. */
export const LANGUAGES: { code: string; label: string }[] = [
  { code: "auto", label: "Auto-detect" },
  { code: "hindi", label: "Hindi — हिन्दी" },
  { code: "urdu", label: "Urdu — اردو" },
  { code: "bengali", label: "Bengali — বাংলা" },
  { code: "tamil", label: "Tamil — தமிழ்" },
  { code: "telugu", label: "Telugu — తెలుగు" },
  { code: "kannada", label: "Kannada — ಕನ್ನಡ" },
  { code: "malayalam", label: "Malayalam — മലയാളം" },
  { code: "marathi", label: "Marathi — मराठी" },
  { code: "gujarati", label: "Gujarati — ગુજરાતી" },
  { code: "punjabi", label: "Punjabi — ਪੰਜਾਬੀ" },
  { code: "nepali", label: "Nepali — नेपाली" },
  { code: "sinhala", label: "Sinhala — සිංහල" },
  { code: "assamese", label: "Assamese — অসমীয়া" },
  { code: "sanskrit", label: "Sanskrit — संस्कृतम्" },
  { code: "pashto", label: "Pashto — پښتو" },
  { code: "persian", label: "Persian — فارسی" },
  { code: "english", label: "English" },
  { code: "spanish", label: "Spanish" },
  { code: "french", label: "French" },
  { code: "german", label: "German" },
  { code: "arabic", label: "Arabic" },
  { code: "chinese", label: "Chinese" },
  { code: "japanese", label: "Japanese" },
  { code: "korean", label: "Korean" },
  { code: "russian", label: "Russian" },
  { code: "portuguese", label: "Portuguese" },
  { code: "indonesian", label: "Indonesian" },
];

import { toHinglish } from "./hinglish";

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

const asrCache = new Map<WhisperTier, Promise<any>>();
let usedDevice: "webgpu" | "wasm" = "webgpu";

export function whisperDevice() {
  return usedDevice;
}

export async function loadWhisper(tier: WhisperTier = "fast", onProgress?: (p: WhisperPhase) => void) {
  const cached = asrCache.get(tier);
  if (cached) return cached;
  // switching tiers: release the old pipeline's GPU/wasm memory — large-v3-turbo
  // alone is ~1.6GB, keeping several resident kills small-VRAM machines
  for (const [t, p] of asrCache) {
    asrCache.delete(t);
    p.then((asr) => asr?.dispose?.()).catch(() => {});
  }
  const { id, dtype } = WHISPER_MODELS[tier];
  const promise = (async () => {
    const tj: any = await import("@huggingface/transformers");
    const { pipeline, env } = tj;
    env.allowLocalModels = false;
    const cb = (p: any) => {
      if (p?.status === "progress" && p.total) {
        onProgress?.({ step: "download", pct: Math.round((p.loaded / p.total) * 100) });
      }
    };
    try {
      const asr = await pipeline("automatic-speech-recognition", id, {
        device: "webgpu", dtype, progress_callback: cb,
      });
      usedDevice = "webgpu";
      return asr;
    } catch (e) {
      console.warn("[whisper] webgpu failed, wasm fallback", e);
      const asr = await pipeline("automatic-speech-recognition", id, {
        device: "wasm", progress_callback: cb,
      });
      usedDevice = "wasm";
      return asr;
    }
  })();
  asrCache.set(tier, promise);
  promise.catch(() => asrCache.delete(tier));
  return promise;
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

export interface TranscribeOptions {
  tier?: WhisperTier;
  /** whisper language name ("hindi", "tamil"…) or "auto" — forcing the
   *  language noticeably beats auto-detect on Indic speech */
  language?: string;
  /** true = translate everything to English instead of native-script output */
  translate?: boolean;
  /** true = Hinglish: Whisper transcribes natively (its most accurate mode),
   *  we romanize Devanagari to chat-style Latin. Latin text passes through,
   *  so it's safe to leave on for English / code-switched audio. */
  romanize?: boolean;
}

/** Transcribe with live per-window streaming. Returns the final line list. */
export async function transcribe(
  audio: Float32Array,
  onProgress: (p: WhisperPhase) => void,
  opts: TranscribeOptions = {}
): Promise<SubtitleLine[]> {
  const asr = await loadWhisper(opts.tier ?? "fast", onProgress);
  const genOpts: any = { return_timestamps: true };
  if (opts.language && opts.language !== "auto") genOpts.language = opts.language;
  if (opts.translate) genOpts.task = "translate";
  const totalSec = audio.length / SAMPLE_RATE;
  const lines: SubtitleLine[] = [];

  const step = (WINDOW_S - OVERLAP_S) * SAMPLE_RATE;
  const win = WINDOW_S * SAMPLE_RATE;

  for (let start = 0; start < audio.length; start += step) {
    const chunk = audio.subarray(start, Math.min(start + win, audio.length));
    const offsetSec = start / SAMPLE_RATE;

    const out = await asr(chunk, genOpts);
    const rawChunks: any[] = out?.chunks ?? [];

    for (const c of rawChunks) {
      const [s, e] = c.timestamp ?? [0, null];
      let text = String(c.text ?? "").trim();
      if (!text) continue;
      if (opts.romanize) text = toHinglish(text);
      // repetition-loop guard: greedy whisper sometimes locks onto one token
      // on music/noise ("oooooo…") — collapse absurd runs, drop degenerate lines
      text = text.replace(/(.)\1{5,}/g, "$1$1");
      if (text.length > 400) text = text.slice(0, 400) + "…";
      // uniq<=2 keeps real degenerate loops ("oo oo oo") out while letting
      // legitimate repetitive lyrics ("la la la la…", 3 uniques) through
      const uniq = new Set(text.toLowerCase().replace(/\s/g, "")).size;
      if (text.length > 24 && uniq <= 2) continue;
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
