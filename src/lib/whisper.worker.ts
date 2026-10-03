/**
 * Whisper inference off the main thread. The page decodes audio (needs
 * AudioContext, main-thread only) and posts the 16kHz samples here; model
 * loading, every window's decode loop and the Hinglish romanizer run in this
 * worker, so the UI never janks during long transcriptions.
 */
import { transcribe, whisperDevice, type TranscribeOptions } from "./whisper";

type Req = { id: number; audio: Float32Array; opts: TranscribeOptions };

const ctx = self as unknown as {
  postMessage(msg: unknown): void;
  onmessage: ((e: MessageEvent<Req>) => void) | null;
};

ctx.onmessage = async (e) => {
  const { id, audio, opts } = e.data;
  try {
    const lines = await transcribe(
      audio,
      (p) => ctx.postMessage({ id, type: "progress", p, device: whisperDevice() }),
      opts
    );
    ctx.postMessage({ id, type: "done", lines, device: whisperDevice() });
  } catch (err) {
    ctx.postMessage({ id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
