/**
 * RMBG-1.4 background-removal mask, DOM-free so the exact same code runs in
 * rmbg.worker.ts (normal path) and on the main thread (fallback when a
 * worker can't start). Returns the alpha mask at the image's full size; the
 * page composites it onto the original pixels.
 */
import { tjsDevice } from "./gpuBackend";
import { configureTransformersCache } from "./modelCache";
import { registerModel } from "./modelRegistry";

export type RmbgProgress = (p: { status?: string; loaded?: number; total?: number }) => void;
export interface RmbgMask { data: Uint8Array; width: number; height: number }

let rmbgPromise: Promise<{ model: any; processor: any; RawImage: any }> | null = null;
registerModel(["/bg-remove"], () => { const p = rmbgPromise; rmbgPromise = null; return p; });

function loadRmbg(progress: RmbgProgress, onFallback: () => void) {
  if (rmbgPromise) return rmbgPromise;
  rmbgPromise = (async () => {
    const { AutoModel, AutoProcessor, RawImage, env } = await import("@huggingface/transformers");
    env.allowLocalModels = false;
    configureTransformersCache(env);
    // WebGPU on Chromium + Safari 26+; older WebKit → wasm (fp32: wasm can't
    // run 4-bit, and a quantized default throws "Missing required scale").
    const dev = await tjsDevice();
    let model: any;
    try {
      model = await AutoModel.from_pretrained("briaai/RMBG-1.4", {
        config: { model_type: "custom" } as any,
        device: dev,
        dtype: dev === "wasm" ? "fp32" : undefined,
        progress_callback: progress,
      });
    } catch {
      onFallback();
      model = await AutoModel.from_pretrained("briaai/RMBG-1.4", {
        config: { model_type: "custom" } as any,
        device: "wasm",
        dtype: "fp32",
        progress_callback: progress,
      });
    }
    const processor = await AutoProcessor.from_pretrained("briaai/RMBG-1.4", {
      config: {
        do_normalize: true,
        do_pad: false,
        do_rescale: true,
        do_resize: true,
        image_mean: [0.5, 0.5, 0.5],
        image_std: [1, 1, 1],
        resample: 2,
        rescale_factor: 0.00392156862745098,
        size: { width: 1024, height: 1024 },
      } as any,
    });
    return { model, processor, RawImage };
  })();
  rmbgPromise.catch(() => { rmbgPromise = null; });
  return rmbgPromise;
}

/** Load (once) and run RMBG on an image blob. */
export async function rmbgMask(
  blob: Blob,
  progress: RmbgProgress,
  onFallback: () => void,
  onProcessing: () => void
): Promise<RmbgMask> {
  const { model, processor, RawImage } = await loadRmbg(progress, onFallback);
  onProcessing();
  const image = await RawImage.fromBlob(blob);
  const { pixel_values } = await processor(image);
  const { output } = await model({ input: pixel_values });
  const mask = await RawImage.fromTensor(output[0].mul(255).to("uint8")).resize(image.width, image.height);
  return { data: mask.data as Uint8Array, width: image.width, height: image.height };
}
