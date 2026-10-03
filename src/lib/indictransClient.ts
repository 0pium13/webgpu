"use client";

/**
 * Main-thread facade for indictrans.worker.ts, with a main-thread fallback
 * if the worker can't start or dies.
 */
import { translateLines as translateOnMain, type TranslateProgress } from "./indictrans";
import { registerModel } from "./modelRegistry";
import { keepModelsCached } from "./storage";

let worker: Worker | null = null;
let seq = 0;

registerModel(["/subtitles"], () => {
  worker?.terminate();
  worker = null;
  return null;
});

export async function translateSubtitles(
  lines: string[],
  target: string,
  onProgress: (p: TranslateProgress) => void
): Promise<string[]> {
  void keepModelsCached();
  let w: Worker;
  try {
    if (!worker) worker = new Worker(new URL("./indictrans.worker.ts", import.meta.url), { type: "module" });
    w = worker;
  } catch {
    return translateOnMain(lines, target, onProgress);
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
      if (d.type === "progress") onProgress(d.p);
      else if (d.type === "done") { cleanup(); resolve(d.lines); }
      else if (d.type === "error") { cleanup(); reject(new Error(d.message)); }
    };
    const onErr = (ev: ErrorEvent) => {
      cleanup();
      console.warn("[translate] worker failed, running on main thread", ev.message);
      w.terminate();
      if (worker === w) worker = null;
      translateOnMain(lines, target, onProgress).then(resolve, reject);
    };
    w.addEventListener("message", onMsg);
    w.addEventListener("error", onErr);
    w.postMessage({ id, lines, target });
  });
}
