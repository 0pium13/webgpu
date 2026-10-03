/**
 * Voice cloning off the main thread: Chatterbox loading, speaker encoding and
 * generation run here. Learned voices stay in this worker, keyed by id.
 */
import { encodeSpeaker, speakAs, cloneDevice, type SpeakerCond } from "./voiceEngine";

type Req =
  | { id: number; type: "build"; samples: Float32Array }
  | { id: number; type: "speak"; speaker: number; text: string; lang: string; exaggeration: number };

const ctx = self as unknown as {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  onmessage: ((e: MessageEvent<Req>) => void) | null;
};

const speakers = new Map<number, SpeakerCond>();

ctx.onmessage = async (e) => {
  const req = e.data;
  const progress = (p: unknown) => ctx.postMessage({ id: req.id, type: "progress", p });
  try {
    if (req.type === "build") {
      speakers.clear(); // one voice at a time; frees the previous tensors' refs
      speakers.set(req.id, await encodeSpeaker(req.samples, progress));
      ctx.postMessage({ id: req.id, type: "done", ...cloneDevice() });
    } else {
      const cond = speakers.get(req.speaker);
      if (!cond) throw new Error("That voice is no longer loaded — add the clip again.");
      const samples = await speakAs(req.text, cond, req.lang, req.exaggeration, progress);
      ctx.postMessage({ id: req.id, type: "done", samples }, [samples.buffer]);
    }
  } catch (err) {
    ctx.postMessage({ id: req.id, type: "error", message: err instanceof Error ? err.message : String(err) });
  }
};
