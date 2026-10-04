"use client";

/**
 * Main-thread facade for stems.worker.ts. If the worker can't start or dies,
 * the job reruns on the main thread via the same separate().
 */
import type { StemMode, StemDevice } from "./stems";
import { registerModel } from "./modelRegistry";
import { keepModelsCached } from "./storage";

let worker: Worker | null = null;
let seq = 0;

registerModel(["/vocal-remover"], () => {
  worker?.terminate();
  worker = null;
  return null;
});

export interface StemJobEvents {
  onLoad: (loaded: number, total: number) => void;
  onReady: (device: StemDevice) => void;
  onSegment: (done: number, total: number) => void;
  onChunk: (offset: number, channels: Float32Array<ArrayBuffer>[]) => void;
}

export type StemJobResult = { device: StemDevice } | "cancelled";

export interface StemJob {
  promise: Promise<StemJobResult>;
  cancel: () => void;
}

/** `left`/`right` are copied to the worker, never transferred: the main-thread fallback may need them. */
export function separateStems(left: Float32Array, right: Float32Array, mode: StemMode, ev: StemJobEvents): StemJob {
  void keepModelsCached();
  let stopped = false;
  let settle: ((r: StemJobResult) => void) | null = null;
  let onCancel = () => {};

  // the fallback loads the model code on demand; the worker path never pulls it into the page
  const onMain = async (): Promise<StemJobResult> => {
    const { separate, CANCELLED } = await import("./stems");
    try {
      return await separate(left, right, mode, { ...ev, isCancelled: () => stopped });
    } catch (e) {
      if ((e as Error)?.message === CANCELLED) return "cancelled";
      throw e;
    }
  };

  const promise = new Promise<StemJobResult>((resolve, reject) => {
    settle = resolve;
    let w: Worker;
    try {
      if (!worker) worker = new Worker(new URL("./stems.worker.ts", import.meta.url), { type: "module" });
      w = worker;
    } catch {
      onMain().then(resolve, reject);
      return;
    }
    const id = ++seq;
    const cleanup = () => {
      w.removeEventListener("message", onMsg);
      w.removeEventListener("error", onErr);
    };
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (d?.id !== id || stopped) return;
      if (d.type === "load") ev.onLoad(d.loaded, d.total);
      else if (d.type === "ready") ev.onReady(d.device);
      else if (d.type === "segment") ev.onSegment(d.done, d.total);
      else if (d.type === "chunk") ev.onChunk(d.offset, d.channels);
      else if (d.type === "done") { cleanup(); resolve({ device: d.device }); }
      else if (d.type === "cancelled") { cleanup(); resolve("cancelled"); }
      else if (d.type === "error") { cleanup(); reject(new Error(d.message)); }
    };
    const onErr = (e: ErrorEvent) => {
      cleanup();
      console.warn("[stems] worker failed, running on main thread", e.message);
      w.terminate();
      if (worker === w) worker = null;
      if (!stopped) onMain().then(resolve, reject);
    };
    w.addEventListener("message", onMsg);
    w.addEventListener("error", onErr);
    onCancel = () => {
      cleanup();
      w.postMessage({ type: "cancel", id });
    };
    w.postMessage({ type: "run", id, left, right, mode });
  });

  return {
    promise,
    cancel: () => {
      if (stopped) return;
      stopped = true;
      onCancel();
      settle?.("cancelled");
    },
  };
}
