"use client";

/**
 * Segment Anything 2 (SAM 2.1 Hiera-tiny) in-browser on WebGPU via
 * transformers.js. Drop-in replacement for the SlimSAM (v1) engine in sam.ts,
 * with the same interface — SAM2 produces noticeably cleaner mattes, which is
 * what the pro rotoscope output needs.
 *
 * NOTE: these ONNX exports ship the image path only (vision_encoder +
 * prompt_encoder_mask_decoder). The memory_attention / memory_encoder graphs
 * that drive SAM2's *learned* video propagation are not exported, so video
 * tracking is done by our own hybrid tracker (detection re-association +
 * mask propagation) on top of this per-frame segmenter — see track.ts.
 */

import { ortDevice } from "./gpuBackend";

const MODEL_ID = "onnx-community/sam2.1-hiera-tiny-ONNX";

export interface SamPoint {
  x: number; // normalized 0..1 (relative to image width)
  y: number; // normalized 0..1 (relative to image height)
  label: 0 | 1; // 1 = include, 0 = exclude
}

export interface SamSession {
  embeddings: any;
  originalSizes: any;
  reshapedSizes: any;
  reshaped: number[]; // [h, w] the encoder resized to
}

export interface MaskResult {
  data: Uint8Array; // width*height, 0 or 255
  width: number;
  height: number;
  score: number;
}

let modelPromise: Promise<{ model: any; processor: any; Tensor: any; RawImage: any }> | null = null;
let usedDevice: "webgpu" | "wasm" = "webgpu";

export function samDevice() {
  return usedDevice;
}

export async function loadSAM(onProgress?: (p: any) => void) {
  if (modelPromise) return modelPromise;
  modelPromise = (async () => {
    const tj: any = await import("@huggingface/transformers");
    const { Sam2Model, AutoProcessor, Tensor, RawImage, env } = tj;
    env.allowLocalModels = false;

    let model;
    const want = await ortDevice(); // Safari/WebKit → wasm (ORT webgpu broken there)
    try {
      model = await Sam2Model.from_pretrained(MODEL_ID, {
        dtype: want === "wasm" ? "fp32" : { vision_encoder: "fp16", prompt_encoder_mask_decoder: "fp32" },
        device: want,
        progress_callback: onProgress,
      });
      usedDevice = want;
    } catch (e) {
      console.warn("[sam2] webgpu load failed, falling back to wasm", e);
      model = await Sam2Model.from_pretrained(MODEL_ID, {
        dtype: "fp32",
        device: "wasm",
        progress_callback: onProgress,
      });
      usedDevice = "wasm";
    }
    const processor = await AutoProcessor.from_pretrained(MODEL_ID);
    return { model, processor, Tensor, RawImage };
  })();
  return modelPromise;
}

/** Build a transformers.js RawImage from a canvas. */
export async function rawImageFromCanvas(canvas: HTMLCanvasElement) {
  const { RawImage } = await loadSAM();
  return RawImage.fromURL(canvas.toDataURL("image/png"));
}

/** Heavy step: run the image encoder once for this frame. */
export async function embedImage(raw: any): Promise<SamSession> {
  const { model, processor } = await loadSAM();
  const inputs = await processor(raw);
  const embeddings = await model.get_image_embeddings(inputs);
  return {
    embeddings,
    originalSizes: inputs.original_sizes,
    reshapedSizes: inputs.reshaped_input_sizes,
    reshaped: inputs.reshaped_input_sizes[0],
  };
}

/** Shared: pick the highest-IoU mask from a decoder output and flatten it. */
async function extractBestMask(session: SamSession, outputs: any): Promise<MaskResult> {
  const { processor } = await loadSAM();
  const masks = await processor.post_process_masks(
    outputs.pred_masks,
    session.originalSizes,
    session.reshapedSizes
  );

  const scores: Float32Array = outputs.iou_scores.data;
  let best = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[best]) best = i;

  const m = masks[0]; // Tensor [1, num, H, W] or [num, H, W]
  const dims = m.dims;
  const H = dims[dims.length - 2];
  const W = dims[dims.length - 1];
  const num = dims[dims.length - 3];
  const src = m.data as Uint8Array | Float32Array | boolean[] | any;
  const offset = (best % num) * H * W;

  const out = new Uint8Array(H * W);
  for (let i = 0; i < H * W; i++) out[i] = src[offset + i] ? 255 : 0;

  return { data: out, width: W, height: H, score: scores[best] };
}

/** Fast step: decode a mask from the current set of click points. */
export async function decodeMask(session: SamSession, points: SamPoint[]): Promise<MaskResult> {
  const { model, Tensor } = await loadSAM();
  const [rh, rw] = session.reshaped;

  const coords: number[] = [];
  for (const p of points) coords.push(p.x * rw, p.y * rh);

  const input_points = new Tensor("float32", coords, [1, 1, points.length, 2]);
  const input_labels = new Tensor("int64", points.map((p) => BigInt(p.label)), [1, 1, points.length]);

  const outputs = await model({ ...session.embeddings, input_points, input_labels });
  return extractBestMask(session, outputs);
}

/** Decode a mask from a bounding box (normalized 0..1) — the tracker's prompt. */
export async function decodeFromBox(
  session: SamSession,
  box: { x1: number; y1: number; x2: number; y2: number }
): Promise<MaskResult> {
  const { model, Tensor } = await loadSAM();
  const [rh, rw] = session.reshaped;
  const coords = [box.x1 * rw, box.y1 * rh, box.x2 * rw, box.y2 * rh];
  const input_boxes = new Tensor("float32", coords, [1, 1, 4]);
  const outputs = await model({ ...session.embeddings, input_boxes });
  return extractBestMask(session, outputs);
}
