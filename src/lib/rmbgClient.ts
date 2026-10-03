"use client";

/**
 * Main-thread facade for rmbg.worker.ts. If the worker can't start or dies,
 * the same job reruns on the main thread via rmbgMask.
 */
import { rmbgMask, type RmbgMask, type RmbgProgress } from "./rmbg";
import { registerModel } from "./modelRegistry";
import { keepModelsCached } from "./storage";

let worker: Worker | null = null;
let seq = 0;

registerModel(["/bg-remove"], () => {
  worker?.terminate();
  worker = null;
  return null;
});

export interface RmbgCallbacks {
  progress: RmbgProgress;
  onFallback: () => void;
  onProcessing: () => void;
}

export async function computeMask(blob: Blob, cb: RmbgCallbacks): Promise<RmbgMask> {
  void keepModelsCached();
  let w: Worker;
  try {
    if (!worker) worker = new Worker(new URL("./rmbg.worker.ts", import.meta.url), { type: "module" });
    w = worker;
  } catch {
    return rmbgMask(blob, cb.progress, cb.onFallback, cb.onProcessing);
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
      if (d.type === "progress") cb.progress(d.p);
      else if (d.type === "fallback") cb.onFallback();
      else if (d.type === "processing") cb.onProcessing();
      else if (d.type === "done") { cleanup(); resolve(d.mask); }
      else if (d.type === "error") { cleanup(); reject(new Error(d.message)); }
    };
    const onErr = (ev: ErrorEvent) => {
      cleanup();
      console.warn("[bg-remove] worker failed, running on main thread", ev.message);
      w.terminate();
      if (worker === w) worker = null;
      rmbgMask(blob, cb.progress, cb.onFallback, cb.onProcessing).then(resolve, reject);
    };
    w.addEventListener("message", onMsg);
    w.addEventListener("error", onErr);
    w.postMessage({ id, blob });
  });
}
