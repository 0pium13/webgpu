/**
 * Voice cloning engine — fully in-browser with Chatterbox Multilingual (Resemble AI,
 * MIT; 0.5B Llama backbone). Q4 ONNX export (~830MB), pinned to a commit so
 * the bytes users download can't change under us.
 *
 *   reference clip → 24kHz mono → speech encoder (once per voice) →
 *   [lang]text → LM speech tokens (greedy, rep-penalty 1.2, as upstream) →
 *   conditional decoder → 24kHz waveform
 *
 * Replaced our OuteTTS pipeline (WavTokenizer encoder + Whisper + CTC aligner
 * + OuteTTS, English only, monotone). No transcript needed, ~1-2x realtime on
 * WebGPU, and Hindi works. Languages needing extra text front-ends upstream
 * (zh Cangjie, ja kanji→kana, he diacritics) are left out.
 *
 * DOM-free: runs inside voiceClone.worker.ts (voiceClone.ts is the facade),
 * so loading ~830MB of sessions never freezes the page.
 */

import { tjsDevice } from "./gpuBackend";
import { registerModel } from "@/lib/modelRegistry";
import { keepModelsCached, roomFor } from "./storage";

const MODEL_ID = "BricksDisplay/chatterbox-multilingual-ONNX-q4";
const REVISION = "171d2d625bf424fd39847c10d4ebdd6612ea81f6";
const SR = 24000;

export const CLONE_LANGUAGES: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "hi", label: "Hindi — हिन्दी" },
  { code: "ar", label: "Arabic" },
  { code: "da", label: "Danish" },
  { code: "de", label: "German" },
  { code: "el", label: "Greek" },
  { code: "es", label: "Spanish" },
  { code: "fi", label: "Finnish" },
  { code: "fr", label: "French" },
  { code: "it", label: "Italian" },
  { code: "ko", label: "Korean" },
  { code: "ms", label: "Malay" },
  { code: "nl", label: "Dutch" },
  { code: "no", label: "Norwegian" },
  { code: "pl", label: "Polish" },
  { code: "pt", label: "Portuguese" },
  { code: "ru", label: "Russian" },
  { code: "sv", label: "Swedish" },
  { code: "sw", label: "Swahili" },
  { code: "tr", label: "Turkish" },
];

export type SpeakerCond = { audio_features: any; audio_tokens: any; speaker_embeddings: any; speaker_features: any };

export type ClonePhase =
  | { step: "model"; pct: number }     // downloading Chatterbox
  | { step: "encoding" }               // learning the reference voice
  | { step: "speaking"; part: number; parts: number };

let enginePromise: Promise<{ model: any; tokenizer: any; Tensor: any }> | null = null;
let device: "webgpu" | "wasm" = "webgpu";
let fallbackReason = "";
export const cloneDevice = () => ({ device, fallbackReason });
registerModel(["/voice"], () => { const p = enginePromise; enginePromise = null; return p; });

const FILES: [string, number][] = [
  ["onnx/speech_encoder.onnx", 180e6], ["onnx/embed_tokens.onnx", 68e6],
  ["onnx/language_model.onnx", 354e6], ["onnx/conditional_decoder.onnx", 226e6],
];

/** Bytes still to download (files already in transformers.js' cache are free). */
async function bytesMissing(): Promise<number> {
  let c: Cache | null = null;
  try { c = await caches.open("transformers-cache"); } catch { /* no Cache API */ }
  let need = 0;
  for (const [f, size] of FILES) {
    const hit = c && (await c.match(`https://huggingface.co/${MODEL_ID}/resolve/${REVISION}/${f}`).catch(() => undefined));
    if (!hit) need += size;
  }
  return need;
}

function getEngine(onPct: (p: number) => void) {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    void keepModelsCached();
    const need = await bytesMissing();
    if (need) {
      const { ok, freeMB } = await roomFor(need);
      if (!ok) throw new Error(`Not enough free browser storage for the voice model (needs ~${Math.round(need / 1e6)}MB, ${freeMB}MB free). Free up disk space and retry.`);
    }
    const tj: any = await import("@huggingface/transformers");
    const { ChatterboxModel, AutoTokenizer, Tensor, env } = tj;
    env.allowLocalModels = false;
    const cb = (p: any) => { if (p?.status === "progress_total") onPct(Math.round(p.progress)); };
    const tokenizer = await AutoTokenizer.from_pretrained(MODEL_ID, { revision: REVISION });
    // the repo's files are already q4 under the plain names, hence dtype fp32
    const opts = { revision: REVISION, dtype: "fp32", progress_callback: cb };
    const want = await tjsDevice(); // Safari <26 / unknown WebKit → wasm
    // A dropped connection mid-download is not a WebGPU failure — retry it on
    // the same device rather than falling back to (much slower) wasm.
    const isNetwork = (e: unknown) => /network|fetch|load failed/i.test(String(e));
    const load = async (dev: string) => {
      for (let attempt = 1; ; attempt++) {
        try {
          return await ChatterboxModel.from_pretrained(MODEL_ID, { ...opts, device: dev });
        } catch (e) {
          if (attempt >= 3 || !isNetwork(e)) throw e;
          console.warn(`[clone] download interrupted, retrying (${attempt})`, e);
        }
      }
    };
    let model;
    device = want;
    try {
      model = await load(want);
    } catch (e) {
      if (isNetwork(e)) throw new Error("The voice model download keeps failing — check your connection and try again.");
      if (want === "wasm") throw e;
      fallbackReason = e instanceof Error ? e.message : String(e);
      console.warn("[clone] webgpu failed, wasm fallback", e);
      device = "wasm";
      model = await load("wasm");
    }
    return { model, tokenizer, Tensor };
  })();
  enginePromise.catch(() => { enginePromise = null; });
  return enginePromise;
}

/** Learn a voice from 24kHz mono reference samples. */
export async function encodeSpeaker(samples: Float32Array, onPhase: (p: ClonePhase) => void): Promise<SpeakerCond> {
  if (!enginePromise) onPhase({ step: "model", pct: 0 });
  const e = await getEngine((pct) => onPhase({ step: "model", pct }));
  onPhase({ step: "encoding" });
  return e.model.encode_speech(new e.Tensor("float32", samples, [1, samples.length]));
}

/**
 * One sentence per generation (short ones merged). Multi-sentence prompts
 * made the LM drop a sentence and then emit silence tokens up to the cap.
 */
function chunkText(text: string, mergeBelow = 90, maxChars = 160): string[] {
  const sentences = (text.replace(/\s+/g, " ").trim().match(/[^.!?।]+[.!?।]*\s*/g) ?? [text]).map((x) => x.trim()).filter(Boolean);
  const pieces: string[] = [];
  for (const s of sentences) {
    if (s.length <= maxChars) { pieces.push(s); continue; }
    // a very long sentence: split on commas, then spaces
    let cur = "";
    for (const w of s.split(/(?<=,)\s*|\s+/)) {
      if (cur && (cur + " " + w).length > maxChars) { pieces.push(cur); cur = ""; }
      cur += (cur ? " " : "") + w;
    }
    if (cur) pieces.push(cur);
  }
  const out: string[] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last && (last + " " + p).length <= mergeBelow) out[out.length - 1] = last + " " + p;
    else out.push(p);
  }
  return out;
}

/** Cap pauses: leading/trailing silence and any gap longer than ~0.5s. */
function tightenSilence(x: Float32Array, sr: number): Float32Array {
  let peak = 0;
  for (let i = 0; i < x.length; i++) peak = Math.max(peak, Math.abs(x[i]));
  if (!peak) return x;
  const hop = Math.round(sr * 0.02), thr = peak * 0.02;
  const n = Math.ceil(x.length / hop);
  const loud = new Uint8Array(n);
  for (let f = 0; f < n; f++) {
    let e = 0;
    const a = f * hop, b = Math.min(x.length, a + hop);
    for (let i = a; i < b; i++) e += x[i] * x[i];
    loud[f] = Math.sqrt(e / (b - a)) > thr ? 1 : 0;
  }
  const first = loud.indexOf(1), last = loud.lastIndexOf(1);
  if (first < 0) return x;
  const keepGap = 15, edge = 5; // frames: 0.3s inside, 0.1s at the edges
  const keep: [number, number][] = [];
  let f = Math.max(0, first - edge);
  while (f <= last) {
    if (loud[f]) { const s0 = f; while (f <= last && loud[f]) f++; keep.push([s0, f]); continue; }
    const s0 = f; while (f <= last && !loud[f]) f++;
    keep.push([s0, s0 + Math.min(f - s0, keepGap)]);
  }
  keep.push([last + 1, Math.min(n, last + 1 + edge)]);
  const parts = keep.map(([a, b]) => x.subarray(a * hop, Math.min(x.length, b * hop)));
  const out = new Float32Array(parts.reduce((t, p) => t + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** Korean is tokenized as decomposed jamo upstream. */
function prepareText(text: string, lang: string): string {
  let t = text;
  if (lang === "ko") {
    t = Array.from(t, (ch) => {
      const c = ch.codePointAt(0)!;
      if (c < 0xac00 || c > 0xd7a3) return ch;
      const b = c - 0xac00;
      const fin = b % 28;
      return String.fromCodePoint(0x1100 + Math.floor(b / 588), 0x1161 + Math.floor((b % 588) / 28)) + (fin ? String.fromCodePoint(0x11a7 + fin) : "");
    }).join("");
  }
  return `[${lang}]${t}`;
}

/** Speak `text` in a learned voice. Returns 24kHz float samples. */
export async function speakAs(
  text: string,
  cond: SpeakerCond,
  lang: string,
  exaggeration: number,
  onPhase: (p: ClonePhase) => void
): Promise<Float32Array> {
  const chunks = chunkText(text);
  if (!chunks.length) throw new Error("Give me some words to say.");
  if (!enginePromise) onPhase({ step: "model", pct: 0 });
  const e = await getEngine((pct) => onPhase({ step: "model", pct }));

  const pieces: Float32Array[] = [];
  const gap = new Float32Array(Math.round(SR * 0.25));
  for (let i = 0; i < chunks.length; i++) {
    onPhase({ step: "speaking", part: i + 1, parts: chunks.length });
    const enc = e.tokenizer(prepareText(chunks[i], lang));
    // ~25 speech tokens/s ≈ 1.7 per character; allow slow delivery, but cap
    // so a stalled generation can't pad minutes of silence
    const maxNew = Math.min(800, 60 + Math.round(chunks[i].length * 2.6));
    const wav = await e.model.generate({
      ...enc,
      ...cond,
      exaggeration,
      max_new_tokens: maxNew,
      repetition_penalty: 1.2,
      do_sample: false,
    });
    pieces.push(tightenSilence(wav.data as Float32Array, SR));
    if (i < chunks.length - 1) pieces.push(gap);
  }

  const total = pieces.reduce((a, p) => a + p.length, 0);
  const samples = new Float32Array(total);
  let off = 0;
  for (const p of pieces) { samples.set(p, off); off += p.length; }
  if (!total) throw new Error("The model produced no audio — try different text.");

  let peak = 0;
  for (let i = 0; i < samples.length; i++) { const a = Math.abs(samples[i]); if (a > peak) peak = a; }
  if (peak > 0.02) {
    const gain = 0.95 / peak;
    for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  }
  return samples;
}
