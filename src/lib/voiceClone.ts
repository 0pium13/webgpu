"use client";

/**
 * Main-thread facade for voice cloning (engine: voiceEngine.ts, run in
 * voiceClone.worker.ts). Decodes the reference clip here (AudioContext is
 * main-thread only) and posts samples to the worker. If a worker can't be
 * created, the engine runs on the main thread instead.
 */
import { encodeSpeaker, speakAs, type ClonePhase, type SpeakerCond } from "./voiceEngine";
import { registerModel } from "@/lib/modelRegistry";

export { CLONE_LANGUAGES, type ClonePhase } from "./voiceEngine";

const SR = 24000;
const MAX_REF_SECONDS = 10; // upstream conditions the decoder on 10s
const MIN_REF_SECONDS = 3;

export interface ClonedSpeaker {
  seconds: number;
  key: number;        // id of the voice inside the worker
  local?: SpeakerCond; // set when running without a worker
}

let worker: Worker | null = null;
let seq = 0;

registerModel(["/voice"], () => {
  worker?.terminate();
  worker = null;
  return null;
});

function getWorker(): Worker | null {
  if (!worker) {
    try {
      worker = new Worker(new URL("./voiceClone.worker.ts", import.meta.url), { type: "module" });
    } catch {
      return null;
    }
  }
  return worker;
}

function call<T>(msg: Record<string, unknown>, onPhase: (p: ClonePhase) => void, transfer: Transferable[] = []): Promise<T> {
  const w = getWorker()!;
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const cleanup = () => { w.removeEventListener("message", onMsg); w.removeEventListener("error", onErr); };
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (d?.id !== id) return;
      if (d.type === "progress") onPhase(d.p);
      else if (d.type === "done") { cleanup(); resolve(d as T); }
      else if (d.type === "error") { cleanup(); reject(new Error(d.message)); }
    };
    const onErr = (ev: ErrorEvent) => {
      cleanup();
      w.terminate();
      if (worker === w) worker = null;
      reject(new Error(ev.message || "The voice engine crashed — try again."));
    };
    w.addEventListener("message", onMsg);
    w.addEventListener("error", onErr);
    w.postMessage({ id, ...msg }, transfer);
  });
}

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

/** Learn a voice from a reference clip (first ~10s are used). */
export async function buildSpeaker(file: File, onPhase: (p: ClonePhase) => void): Promise<ClonedSpeaker> {
  const samples = await decodeMono(file, SR);
  if (samples.length < SR * MIN_REF_SECONDS) throw new Error("Reference is too short — give it at least ~5 seconds of clear speech.");
  const seconds = samples.length / SR;
  if (!getWorker()) return { seconds, key: 0, local: await encodeSpeaker(samples, onPhase) };
  const key = seq + 1;
  const r = await call<{ device: string; fallbackReason: string }>({ type: "build", samples }, onPhase, [samples.buffer]);
  if (r.device !== "webgpu") console.warn("[clone] running on", r.device, r.fallbackReason);
  return { seconds, key };
}

/** Speak `text` in the cloned voice. Returns 24kHz float samples. */
export async function cloneSpeak(
  text: string,
  speaker: ClonedSpeaker,
  lang: string,
  exaggeration: number,
  onPhase: (p: ClonePhase) => void
): Promise<{ samples: Float32Array; sampleRate: number }> {
  if (speaker.local) return { samples: await speakAs(text, speaker.local, lang, exaggeration, onPhase), sampleRate: SR };
  const { samples } = await call<{ samples: Float32Array }>(
    { type: "speak", speaker: speaker.key, text, lang, exaggeration },
    onPhase
  );
  return { samples, sampleRate: SR };
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
