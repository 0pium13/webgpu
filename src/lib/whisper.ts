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

/**
 * Hinglish specialist: Oriserve's Whisper-Hindi2Hinglish-Swift (whisper-base
 * fine-tuned on ~550h of noisy Indian audio) writes romanized Hinglish
 * NATIVELY — "aaj main aapko" — instead of Devanagari we'd have to
 * transliterate. q8 ONNX (~100MB), Apache-2.0. q8 is wasm-safe, so Safari's
 * CPU path can run it too (unlike 4-bit). Used for Hinglish output on the
 * Fast tier; Accurate/Max keep the big models + transliteration.
 */
export const HINGLISH_MODEL = {
  id: "Hirecentive-D3l/Whisper-Hindi2Hinglish-Swift-ONNX",
  label: "Hinglish specialist",
  size: "~100MB",
  dtype: "q8" as const,
};
type ModelKey = WhisperTier | "hinglish";

function modelFor(key: ModelKey): { id: string; dtype: "fp32" | "fp16" | "q8" } {
  return key === "hinglish" ? HINGLISH_MODEL : WHISPER_MODELS[key];
}

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
import { tjsDevice } from "./gpuBackend";
import { configureTransformersCache } from "./modelCache";
import { registerModel } from "@/lib/modelRegistry";

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

const asrCache = new Map<ModelKey, Promise<any>>();
registerModel(["/subtitles"], () => {
  const all = [...asrCache.values()];
  asrCache.clear();
  return all.length ? Promise.all(all) : null;
});
let usedDevice: "webgpu" | "wasm" = "webgpu";

export function whisperDevice() {
  return usedDevice;
}

export async function loadWhisper(tier: ModelKey = "fast", onProgress?: (p: WhisperPhase) => void) {
  const cached = asrCache.get(tier);
  if (cached) return cached;
  // switching tiers: release the old pipeline's GPU/wasm memory — large-v3-turbo
  // alone is ~1.6GB, keeping several resident kills small-VRAM machines
  for (const [t, p] of asrCache) {
    asrCache.delete(t);
    p.then((asr) => asr?.dispose?.()).catch(() => {});
  }
  const { id, dtype } = modelFor(tier);
  const promise = (async () => {
    const tj: any = await import("@huggingface/transformers");
    const { pipeline, env } = tj;
    env.allowLocalModels = false;
    configureTransformersCache(env);
    const cb = (p: any) => {
      if (p?.status === "progress" && p.total) {
        onProgress?.({ step: "download", pct: Math.round((p.loaded / p.total) * 100) });
      }
    };
    // WebGPU on Chromium and Safari 26+ (transformers.js 4.3 runtime);
    // older/unknown WebKit goes straight to wasm.
    const want = await tjsDevice();
    // wasm/CPU can't run 4-bit (MatMulNBits) — that's WebGPU-only. Force a
    // wasm-safe precision (fp32; fp16 isn't a wasm dtype either) or ORT throws
    // "Missing required scale … DequantizeLinear" at session creation.
    const wasmDtype = dtype === "fp16" ? "fp32" : dtype;
    try {
      const asr = await pipeline("automatic-speech-recognition", id, {
        device: want, dtype: want === "wasm" ? wasmDtype : dtype, progress_callback: cb,
      });
      usedDevice = want;
      return asr;
    } catch (e) {
      console.warn("[whisper] load failed, wasm fp32 fallback", e);
      const asr = await pipeline("automatic-speech-recognition", id, {
        device: "wasm", dtype: wasmDtype, progress_callback: cb,
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
  /** true = use the Hinglish specialist model (native romanized output).
   *  Overrides tier; ignores translate. */
  hinglishSpecialist?: boolean;
}

/**
 * When a window comes back without usable timestamps (the Hinglish
 * fine-tune was trained without them), split its text into sentences and
 * pace them across the window by length — readers track roughly by
 * character count, so proportional timing lands close to the speech.
 */
function paceUntimed(text: string, windowSec: number): { timestamp: [number, number]; text: string }[] {
  const parts = text.split(/(?<=[.?!।|])\s+/).map((t) => t.trim()).filter(Boolean);
  const sentences = parts.length ? parts : [text.trim()];
  const total = sentences.reduce((n, t) => n + t.length, 0) || 1;
  let t0 = 0;
  return sentences.map((t) => {
    const dur = (t.length / total) * windowSec;
    const chunk = { timestamp: [t0, t0 + dur] as [number, number], text: t };
    t0 += dur;
    return chunk;
  });
}

/** Transcribe with live per-window streaming. Returns the final line list. */
export async function transcribe(
  audio: Float32Array,
  onProgress: (p: WhisperPhase) => void,
  opts: TranscribeOptions = {}
): Promise<SubtitleLine[]> {
  const specialist = !!opts.hinglishSpecialist;
  const asr = await loadWhisper(specialist ? "hinglish" : (opts.tier ?? "fast"), onProgress);
  const genOpts: any = { return_timestamps: true };
  if (specialist) {
    // the fine-tune expects Hindi in / transcribe; it emits Latin itself
    genOpts.language = "hindi";
    genOpts.task = "transcribe";
  } else {
    if (opts.language && opts.language !== "auto") genOpts.language = opts.language;
    if (opts.translate) genOpts.task = "translate";
  }
  const totalSec = audio.length / SAMPLE_RATE;
  const lines: SubtitleLine[] = [];

  const step = (WINDOW_S - OVERLAP_S) * SAMPLE_RATE;
  const win = WINDOW_S * SAMPLE_RATE;

  for (let start = 0; start < audio.length; start += step) {
    const chunk = audio.subarray(start, Math.min(start + win, audio.length));
    const offsetSec = start / SAMPLE_RATE;

    const out = await asr(chunk, genOpts);
    let rawChunks: any[] = out?.chunks ?? [];
    const timed = rawChunks.filter((c) => Array.isArray(c.timestamp) && c.timestamp[1] != null);
    const fullText = String(out?.text ?? "").trim();
    if (fullText && (timed.length === 0 || (rawChunks.length <= 1 && fullText.length > 80))) {
      rawChunks = paceUntimed(fullText, chunk.length / SAMPLE_RATE);
    }

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
