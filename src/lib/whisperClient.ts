"use client";

/**
 * Main-thread facade for whisper.worker.ts. Same signature as
 * whisper.transcribe, so the page only swaps its import. If a worker can't
 * be created or dies (old browser, CSP, OOM), the job transparently reruns on
 * the main thread — slower to interact with, but it still finishes.
 */
import {
  transcribe as transcribeOnMain,
  type SubtitleLine,
  type TranscribeOptions,
  type WhisperPhase,
} from "./whisper";
import { registerModel } from "@/lib/modelRegistry";
import { keepModelsCached, roomFor } from "@/lib/storage";

let worker: Worker | null = null;
let seq = 0;
let device: "webgpu" | "wasm" = "webgpu";

// Leaving /subtitles: terminating the worker frees its models in one shot.
registerModel(["/subtitles"], () => {
  worker?.terminate();
  worker = null;
  return null;
});

export function whisperDevice() {
  return device;
}

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("./whisper.worker.ts", import.meta.url), { type: "module" });
  }
  return worker;
}

export async function transcribe(
  audio: Float32Array,
  onProgress: (p: WhisperPhase) => void,
  opts: TranscribeOptions = {}
): Promise<SubtitleLine[]> {
  void keepModelsCached();
  if (opts.tier === "max" && !opts.hinglishSpecialist) {
    const { ok, freeMB } = await roomFor(1.7e9);
    if (!ok) {
      throw new Error(
        `Not enough free browser storage for the 1.6GB Max model (${freeMB}MB free). ` +
          `Try the Fast tier, or free up disk space and retry.`
      );
    }
  }

  let w: Worker;
  try {
    w = getWorker();
  } catch {
    return transcribeOnMain(audio, onProgress, opts);
  }

  return new Promise((resolve, reject) => {
    const id = ++seq;
    const cleanup = () => {
      w.removeEventListener("message", onMsg);
      w.removeEventListener("error", onErr);
    };
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (d?.id !== id) return;
      if (d.device) device = d.device;
      if (d.type === "progress") onProgress(d.p);
      else if (d.type === "done") { cleanup(); resolve(d.lines); }
      else if (d.type === "error") { cleanup(); reject(new Error(d.message)); }
    };
    const onErr = (ev: ErrorEvent) => {
      cleanup();
      console.warn("[whisper] worker failed, running on main thread", ev.message);
      w.terminate();
      if (worker === w) worker = null;
      transcribeOnMain(audio, onProgress, opts).then(resolve, reject);
    };
    w.addEventListener("message", onMsg);
    w.addEventListener("error", onErr);
    // copied, not transferred: the main-thread fallback may still need it
    w.postMessage({ id, audio, opts });
  });
}
