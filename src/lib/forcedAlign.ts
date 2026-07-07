"use client";

/**
 * CTC forced alignment in the browser — wav2vec2-base-960h emissions + a
 * textbook Viterbi trellis. Whisper's word timestamps drift ±0.2s, which is
 * ±15 audio codes at 75Hz — fatal for voice cloning. Forced alignment against
 * the known transcript is frame-accurate, the same approach the original
 * OuteTTS pipeline uses (MMS_FA). Verified end-to-end: cloned output
 * transcribes back to the exact target sentence.
 */

const CTC_MODEL = "Xenova/wav2vec2-base-960h";
const VOCAB: Record<string, number> = {
  "'": 27, A: 7, B: 24, C: 19, D: 14, E: 5, F: 20, G: 21, H: 11, I: 10,
  J: 29, K: 26, L: 15, M: 17, N: 9, O: 8, P: 23, Q: 30, R: 13, S: 12,
  T: 6, U: 16, V: 25, W: 18, X: 28, Y: 22, Z: 31, "|": 4,
};
const BLANK = 0;

let alignerPromise: Promise<{ processor: any; model: any }> | null = null;

export function loadAligner(onPct?: (p: number) => void) {
  if (alignerPromise) return alignerPromise;
  alignerPromise = (async () => {
    const tj: any = await import("@huggingface/transformers");
    const { AutoProcessor, AutoModelForCTC, env } = tj;
    env.allowLocalModels = false;
    const cb = (p: any) => {
      if (p?.status === "progress" && p.total) onPct?.(Math.round((p.loaded / p.total) * 100));
    };
    const processor = await AutoProcessor.from_pretrained(CTC_MODEL);
    const model = await AutoModelForCTC.from_pretrained(CTC_MODEL, { dtype: "q8", progress_callback: cb });
    return { processor, model };
  })();
  alignerPromise.catch(() => { alignerPromise = null; });
  return alignerPromise;
}

function viterbi(logProbs: Float32Array, T: number, V: number, tokens: number[]) {
  const ext: number[] = [BLANK];
  for (const t of tokens) { ext.push(t); ext.push(BLANK); }
  const S = ext.length;
  const NEG = -1e30;
  const dp = new Float64Array(T * S).fill(NEG);
  const bp = new Int32Array(T * S).fill(-1);
  const lp = (t: number, v: number) => logProbs[t * V + v];
  dp[0] = lp(0, ext[0]);
  if (S > 1) dp[1] = lp(0, ext[1]);
  for (let t = 1; t < T; t++) {
    for (let s = 0; s < S; s++) {
      let best = dp[(t - 1) * S + s], from = s;
      if (s >= 1 && dp[(t - 1) * S + s - 1] > best) { best = dp[(t - 1) * S + s - 1]; from = s - 1; }
      if (s >= 2 && ext[s] !== BLANK && ext[s] !== ext[s - 2] && dp[(t - 1) * S + s - 2] > best) {
        best = dp[(t - 1) * S + s - 2]; from = s - 2;
      }
      if (best <= NEG / 2) continue;
      dp[t * S + s] = best + lp(t, ext[s]);
      bp[t * S + s] = from;
    }
  }
  let s = S - 1;
  if (S > 1 && dp[(T - 1) * S + S - 2] > dp[(T - 1) * S + S - 1]) s = S - 2;
  const path = new Int32Array(T);
  for (let t = T - 1; t >= 0; t--) { path[t] = s; s = bp[t * S + s] >= 0 ? bp[t * S + s] : s; }
  const spans = tokens.map(() => ({ a: -1, b: -1 }));
  for (let t = 0; t < T; t++) {
    const st = path[t];
    if (st % 2 === 1) {
      const ti = (st - 1) / 2;
      if (spans[ti].a < 0) spans[ti].a = t;
      spans[ti].b = t + 1;
    }
  }
  return spans;
}

export interface AlignedWord { word: string; s16: number; e16: number } // 16kHz sample offsets

/** Align normalized words ([a-z] only) against 16kHz mono audio. */
export async function alignWords(
  wav16: Float32Array,
  words: string[],
  onPct?: (p: number) => void
): Promise<AlignedWord[]> {
  const { processor, model } = await loadAligner(onPct);
  const inputs = await processor(wav16);
  const { logits } = await model(inputs);
  const [, T, V] = logits.dims as number[];
  const data = logits.data as Float32Array;

  const logProbs = new Float32Array(T * V);
  for (let t = 0; t < T; t++) {
    let mx = -Infinity;
    for (let v = 0; v < V; v++) mx = Math.max(mx, data[t * V + v]);
    let sum = 0;
    for (let v = 0; v < V; v++) sum += Math.exp(data[t * V + v] - mx);
    const lse = mx + Math.log(sum);
    for (let v = 0; v < V; v++) logProbs[t * V + v] = data[t * V + v] - lse;
  }

  const tokens: number[] = [];
  const range: [number, number][] = [];
  for (let w = 0; w < words.length; w++) {
    if (w > 0) tokens.push(VOCAB["|"]);
    const st = tokens.length;
    for (const ch of words[w].toUpperCase()) {
      const id = VOCAB[ch];
      if (id !== undefined) tokens.push(id);
    }
    range.push([st, tokens.length]);
  }

  const spans = viterbi(logProbs, T, V, tokens);
  const ratio = wav16.length / T;
  const out: AlignedWord[] = [];
  for (let w = 0; w < words.length; w++) {
    const chs = spans.slice(range[w][0], range[w][1]).filter((x) => x.a >= 0);
    if (!chs.length) continue;
    out.push({ word: words[w], s16: chs[0].a * ratio, e16: chs[chs.length - 1].b * ratio });
  }
  return out;
}
