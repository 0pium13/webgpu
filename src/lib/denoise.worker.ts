/**
 * Noise removal off the main thread: DeepFilterNet3 inference plus all the
 * STFT/filtering DSP. Finished audio streams back chunk by chunk (transferred)
 * so the page can paint the cleaned waveform as it arrives. Cancel = the page
 * terminates this worker.
 */
import { denoiseChannels } from "./denoise";

type Req = { id: number; channels: Float32Array[] };

const ctx = self as unknown as {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<Req>) => void) | null;
};

ctx.onmessage = async (e) => {
  const { id, channels } = e.data;
  try {
    await denoiseChannels(
      channels,
      (p) => ctx.postMessage({ id, type: "progress", p }),
      (ch, offset, samples) => ctx.postMessage({ id, type: "chunk", ch, offset, samples }, [samples.buffer]),
    );
    ctx.postMessage({ id, type: "done" });
  } catch (err) {
    ctx.postMessage({ id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
