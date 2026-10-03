/**
 * Background removal off the main thread: RMBG model loading and inference
 * run here so the page stays responsive. The mask buffer is transferred back
 * (zero-copy) for compositing.
 */
import { rmbgMask } from "./rmbg";

type Req = { id: number; blob: Blob };

const ctx = self as unknown as {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<Req>) => void) | null;
};

ctx.onmessage = async (e) => {
  const { id, blob } = e.data;
  try {
    const mask = await rmbgMask(
      blob,
      (p) => ctx.postMessage({ id, type: "progress", p: { status: p.status, loaded: p.loaded, total: p.total } }),
      () => ctx.postMessage({ id, type: "fallback" }),
      () => ctx.postMessage({ id, type: "processing" })
    );
    ctx.postMessage({ id, type: "done", mask }, [mask.data.buffer]);
  } catch (err) {
    ctx.postMessage({ id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
