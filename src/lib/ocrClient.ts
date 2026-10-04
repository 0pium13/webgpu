"use client";

/**
 * Main-thread facade for ocr.worker.ts. If the worker can't start or dies,
 * the same job reruns on the main thread via ocrImage.
 */
import { ocrImage, type OcrProgress, type OcrResult } from "./ocr";
import { registerModel } from "./modelRegistry";
import { keepModelsCached } from "./storage";

let worker: Worker | null = null;
let seq = 0;

registerModel(["/ocr"], () => {
  worker?.terminate();
  worker = null;
  return null;
});

/** `?ep=wasm` forces the CPU path — a support/diagnostics switch for flaky GPU drivers. */
function wantWasm(): boolean {
  return typeof location !== "undefined" && /[?&]ep=wasm\b/.test(location.search);
}

/**
 * OCR one image. ImageBitmaps are cloned, not transferred — the caller closes
 * them. Aborting stops the job at its next step (a page left mid-run).
 */
export async function runOcr(
  src: Blob | ImageBitmap,
  onProgress: (p: OcrProgress) => void,
  signal?: AbortSignal
): Promise<OcrResult> {
  void keepModelsCached();
  const wasm = wantWasm();
  const cancelled = () => !!signal?.aborted;
  let w: Worker;
  try {
    if (!worker) worker = new Worker(new URL("./ocr.worker.ts", import.meta.url), { type: "module" });
    w = worker;
  } catch {
    return ocrImage(src, onProgress, { wasm, cancelled });
  }
  return new Promise((resolve, reject) => {
    const id = ++seq;
    const onAbort = () => {
      cleanup();
      w.postMessage({ id, cancel: true });
      reject(new Error("cancelled"));
    };
    const cleanup = () => {
      w.removeEventListener("message", onMsg);
      w.removeEventListener("error", onErr);
      signal?.removeEventListener("abort", onAbort);
    };
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (d?.id !== id) return;
      if (d.type === "progress") onProgress(d.p);
      else if (d.type === "done") { cleanup(); resolve(d.result); }
      else if (d.type === "error") { cleanup(); reject(new Error(d.message)); }
    };
    const onErr = (ev: ErrorEvent) => {
      cleanup();
      console.warn("[ocr] worker failed, running on main thread", ev.message);
      w.terminate();
      if (worker === w) worker = null;
      ocrImage(src, onProgress, { wasm, cancelled }).then(resolve, reject);
    };
    if (signal?.aborted) { reject(new Error("cancelled")); return; }
    signal?.addEventListener("abort", onAbort);
    w.addEventListener("message", onMsg);
    w.addEventListener("error", onErr);
    w.postMessage({ id, src, wasm });
  });
}
