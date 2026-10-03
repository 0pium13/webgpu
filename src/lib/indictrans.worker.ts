/**
 * Subtitle translation off the main thread: IndicTrans2 loading and the
 * per-line greedy decode loop run here so the page stays responsive.
 */
import { translateLines } from "./indictrans";

type Req = { id: number; lines: string[]; target: string };

const ctx = self as unknown as {
  postMessage(msg: unknown): void;
  onmessage: ((e: MessageEvent<Req>) => void) | null;
};

ctx.onmessage = async (e) => {
  const { id, lines, target } = e.data;
  try {
    const out = await translateLines(lines, target, (p) => ctx.postMessage({ id, type: "progress", p }));
    ctx.postMessage({ id, type: "done", lines: out });
  } catch (err) {
    ctx.postMessage({ id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
