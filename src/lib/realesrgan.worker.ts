/**
 * Real-ESRGAN image upscaling off the main thread. The page sends an
 * ImageBitmap; tiles are inferred here on OffscreenCanvas, each finished tile
 * streams back as a transferred ImageBitmap for the live preview, and the
 * final PNG blob is encoded here too, so a 6000px job never janks the page.
 */
import { upscaleToCanvas, srDevice } from "./realesrgan";

type Req = { id: number; bitmap: ImageBitmap; scale: 2 | 4 };

const ctx = self as unknown as {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<Req>) => void) | null;
};

ctx.onmessage = async (e) => {
  const { id, bitmap, scale } = e.data;
  try {
    const { canvas } = await upscaleToCanvas(bitmap, scale, async (p) => {
      if (p.phase === "download") {
        ctx.postMessage({ id, type: "download", pct: p.pct });
        return;
      }
      const t = p.tile;
      if (!t) return;
      const bmp = await createImageBitmap(t.core as unknown as OffscreenCanvas);
      ctx.postMessage(
        { id, type: "tile", done: p.done, total: p.total, x: t.x, y: t.y, outW: t.outW, outH: t.outH, bmp, device: srDevice() },
        [bmp]
      );
    });
    bitmap.close();
    const out = canvas as unknown as OffscreenCanvas;
    const blob = await out.convertToBlob({ type: "image/png" });
    ctx.postMessage({ id, type: "done", blob, width: out.width, height: out.height, device: srDevice() });
  } catch (err) {
    ctx.postMessage({ id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
