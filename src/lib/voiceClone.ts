"use client";

/**
 * Voice cloning — fully in-browser, built from parts nobody shipped together:
 *
 *   1. reference audio → 24kHz mono
 *   2. OUR WavTokenizer-encoder ONNX (/models/wavtok_encoder.onnx — exported
 *      from OuteAI's checkpoint because no public export existed) → 75Hz codes
 *   3. whisper-base word timestamps → per-word code slices
 *   4. OuteTTS-0.2-500M (outetts.js) speaks any text as that speaker
 *
 * The encoder runs on wasm deliberately: it's 44MB and a 15s clip encodes in
 * ~1s — not worth risking WebGPU op quirks for.
 */

import { loadOrt, createSession } from "./ortRuntime";
import { loadWhisper } from "./whisper";
import { alignWords } from "./forcedAlign";

const ENCODER_URL = "/models/wavtok_encoder.onnx";
const CODE_RATE = 75; // tokens per second
const MAX_REF_SECONDS = 20;

export interface ClonedSpeaker {
  text: string;
  words: { word: string; duration: number; codes: number[] }[];
  language: string;
}

export type ClonePhase =
  | { step: "encoder"; pct: number }   // downloading our encoder
  | { step: "whisper"; pct: number }   // downloading whisper
  | { step: "aligner"; pct: number }   // downloading the CTC aligner
  | { step: "listening" }              // transcribing the reference
  | { step: "encoding" }               // audio → codes
  | { step: "model"; pct: number }     // downloading OuteTTS
  | { step: "speaking" };

async function decodeMono(file: File, sampleRate: number): Promise<Float32Array> {
  const buf = await file.arrayBuffer();
  const probe = new (window.AudioContext || (window as any).webkitAudioContext)();
  const decoded = await probe.decodeAudioData(buf);
  probe.close();
  const secs = Math.min(decoded.duration, MAX_REF_SECONDS);
  const frames = Math.ceil(secs * sampleRate);
  const off = new OfflineAudioContext(1, frames, sampleRate);
  const src = off.createBufferSource();
  src.buffer = decoded;
  src.connect(off.destination);
  src.start();
  const mono = await off.startRendering();
  return mono.getChannelData(0).slice();
}

let encoderPromise: Promise<any> | null = null;
function getEncoder(onPct: (p: number) => void) {
  if (encoderPromise) return encoderPromise;
  encoderPromise = (async () => {
    const ort = await loadOrt();
    return {
      ort,
      session: await createSession(ort, ENCODER_URL, (l, t) => {
        if (t) onPct(Math.round((l / t) * 100));
      }, ["wasm"]),
    };
  })();
  encoderPromise.catch(() => { encoderPromise = null; });
  return encoderPromise;
}

/** Turn a reference clip into an OuteTTS speaker. */
export async function buildSpeaker(
  file: File,
  onPhase: (p: ClonePhase) => void
): Promise<ClonedSpeaker> {
  // decode at both rates up front (whisper wants 16k, the codec 24k)
  const [wav24, wav16] = await Promise.all([
    decodeMono(file, 24000),
    decodeMono(file, 16000),
  ]);
  if (wav24.length < 24000 * 2) throw new Error("Reference is too short — give it at least ~5 seconds of clear speech.");

  // The verified recipe (each step matters; deviations produce mumble):
  //   1. whisper for the TRANSCRIPT TEXT only — its word timestamps drift
  //      ±0.2s (±15 codes at 75Hz), which corrupts word↔code pairing
  //   2. CTC forced alignment for frame-accurate word boundaries
  //   3. words TILE the audio contiguously: word i spans [its start → next
  //      word's start), pauses attached to the preceding word, first word
  //      from sample 0 — the concatenation reconstructs the audio unbroken
  //   4. encode once; assign codes contiguously; duration := codes/75
  const asr = await loadWhisper("fast", (p) => {
    if (p.step === "download") onPhase({ step: "whisper", pct: p.pct });
  });
  onPhase({ step: "listening" });
  const out = await asr(wav16, { language: "english" });
  const transcriptWords = String(out?.text ?? "")
    .toLowerCase()
    .replace(/[-_/,.\\]/g, " ")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (transcriptWords.length < 3) throw new Error("Couldn't hear clear speech in the reference. Try a cleaner clip.");

  const aligned = await alignWords(wav16, transcriptWords, (pct) => onPhase({ step: "aligner", pct }));
  if (aligned.length < 3) throw new Error("Reference too noisy to align — try a clip with clearer speech.");

  type Seg = { word: string; from: number; to: number };
  const segs: Seg[] = [];
  for (let i = 0; i < aligned.length; i++) {
    const from = i === 0 ? 0 : Math.floor(aligned[i].s16 * 1.5); // 16k → 24k samples
    const to = i === aligned.length - 1
      ? Math.min(wav24.length, Math.ceil(aligned[i].e16 * 1.5))
      : Math.floor(aligned[i + 1].s16 * 1.5);
    if (to <= from) continue;
    segs.push({ word: aligned[i].word, from, to });
    if (to / 24000 > 11) break; // ~11s of reference conditions best
  }
  if (segs.length < 3) throw new Error("Reference too noisy to align — try a clip with clearer speech.");

  // words-only concatenated audio + each word's cumulative end sample
  const totalLen = segs.reduce((a, s) => a + (s.to - s.from), 0);
  const concat = new Float32Array(totalLen);
  const ends: number[] = [];
  let off = 0;
  for (const s of segs) {
    concat.set(wav24.subarray(s.from, s.to), off);
    off += s.to - s.from;
    ends.push(off);
  }

  const { ort, session } = await getEncoder((pct) => onPhase({ step: "encoder", pct }));
  onPhase({ step: "encoding" });
  // the exported graph is STATIC at 15s (legacy trace bakes pad sizes):
  // zero-pad to exactly FIXED_SAMPLES and slice the real frames back out
  const FIXED_SAMPLES = 360000;
  const padded = new Float32Array(FIXED_SAMPLES);
  padded.set(concat.subarray(0, Math.min(concat.length, FIXED_SAMPLES)));
  const res = await session.run({ audio: new ort.Tensor("float32", padded, [1, FIXED_SAMPLES]) });
  const codesAll = res[session.outputNames[0]].data as BigInt64Array | Int32Array;
  const nFrames = Math.min(codesAll.length, Math.ceil(Math.min(concat.length, FIXED_SAMPLES) / 320));
  const codesData = codesAll;

  const words: ClonedSpeaker["words"] = [];
  let start = 0;
  for (let w = 0; w < segs.length; w++) {
    const end = Math.min(nFrames, Math.round((ends[w] / 24000) * CODE_RATE));
    const codes: number[] = [];
    for (let i = start; i < end; i++) codes.push(Number(codesData[i]));
    start = Math.max(start, end);
    if (!codes.length) codes.push(1); // their empty-word fallback
    words.push({ word: segs[w].word, duration: Math.round((codes.length / CODE_RATE) * 100) / 100, codes });
  }

  return { text: words.map((w) => w.word).join(" "), words, language: "en" };
}

/** 16-bit PCM WAV from float samples (shared by both voice modes). */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); ws(8, "WAVE");
  ws(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

// ── OuteTTS generation, implemented natively ────────────────────────────────
// We drive the OuteTTS LLM + WavTokenizer decoder directly on our own
// transformers.js (the outetts wrapper's floating nested dependency produced
// runaway generations). Prompt format replicated from its PromptProcessor;
// unlike the original we stop on <|audio_end|> too and hard-cap new tokens,
// so a confused generation can't babble for 38 seconds.

const LLM_ID = "onnx-community/OuteTTS-0.2-500M";
const DECODER_ID = "onnx-community/WavTokenizer-large-speech-75token_decode";

/** the same text normalization the model was trained with */
function normText(t: string): string[] {
  return t
    .toLowerCase()
    .replace(/[-_/,.\\]/g, " ")
    .replace(/[^a-z\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function buildPrompt(speaker: ClonedSpeaker, text: string) {
  const targetWords = normText(text);
  if (!targetWords.length) throw new Error("Give me some words to say.");
  const allWords = [...speaker.words.map((w) => w.word), ...targetWords].join("<|text_sep|>");
  let p = `<|im_start|>\n<|text_start|>${allWords}<|text_end|>\n<|audio_start|>\n`;
  for (const w of speaker.words) {
    p += `${w.word}<|t_${w.duration.toFixed(2)}|><|code_start|>${w.codes.map((c) => `<|${c}|>`).join("")}<|code_end|>\n`;
  }
  return { prompt: p, nTargetWords: targetWords.length };
}

let genPromise: Promise<any> | null = null;
function getGenerator(onPct: (p: number) => void) {
  if (genPromise) return genPromise;
  genPromise = (async () => {
    const tj: any = await import("@huggingface/transformers");
    const { AutoTokenizer, AutoModelForCausalLM, PreTrainedModel, Tensor, env } = tj;
    env.allowLocalModels = false;
    const cb = (p: any) => {
      if (p?.status === "progress" && p.total) onPct(Math.round((p.loaded / p.total) * 100));
    };
    const tokenizer = await AutoTokenizer.from_pretrained(LLM_ID);
    let lm;
    try {
      // q4 (fp32 accumulation), not q4f16 — the f16 variant generated
      // well-formed but near-silent audio codes on WebGPU
      lm = await AutoModelForCausalLM.from_pretrained(LLM_ID, { device: "webgpu", dtype: "q4", progress_callback: cb });
    } catch (e) {
      console.warn("[clone] webgpu LLM failed, wasm q4 fallback", e);
      lm = await AutoModelForCausalLM.from_pretrained(LLM_ID, { device: "wasm", dtype: "q4", progress_callback: cb });
    }
    // decoder is wasm-only upstream (webgpu unsupported for its ops)
    const decoder = await PreTrainedModel.from_pretrained(DECODER_ID, { dtype: "fp32", progress_callback: cb });

    // token id ↔ audio code maps (note: 0 is a VALID code — no falsy checks)
    const idToCode = new Map<number, number>();
    for (let i = 0; i < 4096; i++) {
      const ids = tokenizer.encode(`<|${i}|>`, { add_special_tokens: false });
      if (ids.length === 1) idToCode.set(Number(ids[0]), i);
    }
    const one = (s: string) => Number(tokenizer.encode(s, { add_special_tokens: false })[0]);
    return {
      tokenizer, lm, decoder, Tensor, idToCode,
      audioEndId: one("<|audio_end|>"),
      imEndId: one("<|im_end|>"),
    };
  })();
  genPromise.catch(() => { genPromise = null; });
  return genPromise;
}

/** Speak `text` in the cloned voice. Returns 24kHz float samples. */
export async function cloneSpeak(
  text: string,
  speaker: ClonedSpeaker,
  onPhase: (p: ClonePhase) => void
): Promise<{ samples: Float32Array; sampleRate: number }> {
  if (!genPromise) onPhase({ step: "model", pct: -1 });
  const g = await getGenerator((pct) => onPhase({ step: "model", pct }));
  onPhase({ step: "speaking" });

  const { prompt, nTargetWords } = buildPrompt(speaker, text);
  const inputs = g.tokenizer(prompt, { add_special_tokens: false });
  const promptLen = inputs.input_ids.dims[1] as number;
  // ~22 codes/word is typical at 75Hz; 60/word + slack is a generous ceiling
  const maxNew = Math.min(3500, 120 + nTargetWords * 60);

  // NO repetition penalty: audio codes repeat by nature (held sounds), and a
  // global penalty over the code-heavy prompt bans real speech codes — the
  // Python original patches the penalty to a 64-token window for this reason.
  const outIds = await g.lm.generate({
    ...inputs,
    max_new_tokens: maxNew,
    do_sample: true,
    temperature: 0.1,
    repetition_penalty: 1.0,
    eos_token_id: [g.imEndId, g.audioEndId],
  });

  const seq: number[] = outIds.tolist()[0].slice(promptLen).map(Number);
  const codes: bigint[] = [];
  for (const t of seq) {
    const c = g.idToCode.get(t);
    if (c !== undefined) codes.push(BigInt(c));
  }
  if (codes.length < 12) throw new Error("The model produced no usable audio — try different text.");

  const codesTensor = new g.Tensor("int64", BigInt64Array.from(codes), [1, codes.length]);
  const { waveform } = await g.decoder({ codes: codesTensor });
  const samples = waveform.data as Float32Array;
  if (!samples?.length) throw new Error("Decoding produced no audio.");
  return { samples: Float32Array.from(samples), sampleRate: 24000 };
}
