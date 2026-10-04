/**
 * OCR off the main thread: image decode, both models and all pre/post
 * processing run here; the page only renders boxes and text.
 */
import { ocrImage } from "./ocr";

type Req = { id: number; src: Blob | ImageBitmap; wasm: boolean } | { id: number; cancel: true };

const ctx = self as unknown as {
  postMessage(msg: unknown): void;
  onmessage: ((e: MessageEvent<Req>) => void) | null;
};

const dropped = new Set<number>();

ctx.onmessage = async (e) => {
  const req = e.data;
  if ("cancel" in req) { dropped.add(req.id); return; }
  const { id, src, wasm } = req;
  try {
    const result = await ocrImage(src, (p) => ctx.postMessage({ id, type: "progress", p }), { wasm, cancelled: () => dropped.has(id) });
    ctx.postMessage({ id, type: "done", result });
  } catch (err) {
    ctx.postMessage({ id, type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    dropped.delete(id);
  }
};
