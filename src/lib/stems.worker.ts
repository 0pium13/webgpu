/**
 * Stem separation off the main thread: HTDemucs loading, inference and the
 * JS STFT/iSTFT all run here. Finished audio streams back per chunk (buffers
 * transferred, zero-copy) so the page can draw stems as they appear.
 */
import { separate, CANCELLED, type StemMode } from "./stems";

type Req =
  | { type: "run"; id: number; left: Float32Array; right: Float32Array; mode: StemMode }
  | { type: "cancel"; id: number };

const ctx = self as unknown as {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<Req>) => void) | null;
};

const cancelled = new Set<number>();

ctx.onmessage = async (e) => {
  const d = e.data;
  if (d.type === "cancel") {
    cancelled.add(d.id);
    return;
  }
  const { id } = d;
  try {
    const r = await separate(d.left, d.right, d.mode, {
      onLoad: (loaded, total) => ctx.postMessage({ id, type: "load", loaded, total }),
      onReady: (device) => ctx.postMessage({ id, type: "ready", device }),
      onSegment: (done, total) => ctx.postMessage({ id, type: "segment", done, total }),
      onChunk: (offset, channels) =>
        ctx.postMessage({ id, type: "chunk", offset, channels }, channels.map((c) => c.buffer as ArrayBuffer)),
      isCancelled: () => cancelled.has(id),
    });
    ctx.postMessage({ id, type: "done", device: r.device });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ctx.postMessage({ id, type: message === CANCELLED ? "cancelled" : "error", message });
  } finally {
    cancelled.delete(id);
  }
};
