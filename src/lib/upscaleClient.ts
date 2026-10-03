"use client";

/**
 * Main-thread facade for realesrgan.worker.ts (image upscaling). Mirrors the
 * SRProgress callback shape so ImageProcessor's live tile preview keeps
 * working: tile.core arrives as an ImageBitmap, which drawImage accepts and
 * which is closed right after the callback. If the worker can't start or
 * dies, the job reruns on the main thread.
 */
import { upscaleToCanvas, srDevice as mainSrDevice, type SRProgress } from "./realesrgan";
import { registerModel } from "./modelRegistry";
import { keepModelsCached } from "./storage";

let worker: Worker | null = null;
let seq = 0;
let device: "webgpu" | "wasm" | null = null;

registerModel(["/upscale"], () => {
  worker?.terminate();
  worker = null;
  return null;
});

export function upscaleDevice(): "webgpu" | "wasm" {
  return device ?? mainSrDevice();
}

async function onMain(
  img: HTMLImageElement,
  scale: 2 | 4,
  onProgress: (p: SRProgress) => void
): Promise<{ blob: Blob; width: number; height: number }> {
  const { canvas } = await upscaleToCanvas(img, scale, onProgress);
  device = mainSrDevice();
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), "image/png"));
  return { blob, width: canvas.width, height: canvas.height };
}

export async function upscaleImage(
  img: HTMLImageElement,
  scale: 2 | 4,
  onProgress: (p: SRProgress) => void
): Promise<{ blob: Blob; width: number; height: number }> {
  void keepModelsCached();
  let w: Worker;
  let bitmap: ImageBitmap;
  try {
    if (!worker) worker = new Worker(new URL("./realesrgan.worker.ts", import.meta.url), { type: "module" });
    w = worker;
    bitmap = await createImageBitmap(img);
  } catch {
    return onMain(img, scale, onProgress);
  }
  return new Promise((resolve, reject) => {
    const id = ++seq;
    let finished = false;
    const cleanup = () => {
      finished = true;
      w.removeEventListener("message", onMsg);
      w.removeEventListener("error", onErr);
    };
    const onMsg = (e: MessageEvent) => {
      const d = e.data;
      if (d?.id !== id || finished) return;
      if (d.device) device = d.device;
      if (d.type === "download") onProgress({ phase: "download", pct: d.pct });
      else if (d.type === "tile") {
        onProgress({
          phase: "tile", done: d.done, total: d.total, skipped: false,
          timing: { readbackMs: 0, inferenceMs: 0, stitchMs: 0 },
          tile: { core: d.bmp as unknown as HTMLCanvasElement, x: d.x, y: d.y, outW: d.outW, outH: d.outH },
        });
        (d.bmp as ImageBitmap).close();
      } else if (d.type === "done") { cleanup(); resolve({ blob: d.blob, width: d.width, height: d.height }); }
      else if (d.type === "error") { cleanup(); reject(new Error(d.message)); }
    };
    const onErr = (ev: ErrorEvent) => {
      cleanup();
      console.warn("[upscale] worker failed, running on main thread", ev.message);
      w.terminate();
      if (worker === w) worker = null;
      onMain(img, scale, onProgress).then(resolve, reject);
    };
    w.addEventListener("message", onMsg);
    w.addEventListener("error", onErr);
    w.postMessage({ id, bitmap, scale }, [bitmap]);
  });
}
