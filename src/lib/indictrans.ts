/**
 * English → Indian-language subtitle translation: AI4Bharat IndicTrans2
 * (distilled 200M, MIT), int8 ONNX export by hari31416 (~280MB). DOM-free so
 * it runs in indictrans.worker.ts.
 *
 * The model is a fairseq-style encoder/decoder with a KV cache; we run greedy
 * decoding on ORT's wasm backend (int8 is wasm-safe; ~0.5s per subtitle line
 * on a laptop). IndicTrans2 writes every language in a unified Devanagari
 * space; non-Devanagari targets are mapped back by Unicode offset — the
 * Brahmic blocks are aligned (same scheme IndicNLP uses), e.g. ऩ→ன, ऴ→ழ.
 */
import { loadOrt, fetchModelBytes } from "./ortRuntime";
import { registerModel } from "./modelRegistry";

const REPO = "https://huggingface.co/hari31416/indictrans2-en-indic-dist-200M-ONNX-int8/resolve/main/";
const SRC_VOCAB = 32322; // ids at or above this are clamped to <unk>, as the reference does
const UNK = 3;
const MAX_NEW_TOKENS = 160;

/** Target languages: model tag + Devanagari→script offset (0 = stays Devanagari). */
export const TRANSLATE_TARGETS: { code: string; label: string; tag: string; offset: number }[] = [
  { code: "hi", label: "Hindi — हिन्दी", tag: "hin_Deva", offset: 0 },
  { code: "mr", label: "Marathi — मराठी", tag: "mar_Deva", offset: 0 },
  { code: "bn", label: "Bengali — বাংলা", tag: "ben_Beng", offset: 0x0980 - 0x0900 },
  { code: "ta", label: "Tamil — தமிழ்", tag: "tam_Taml", offset: 0x0b80 - 0x0900 },
  { code: "te", label: "Telugu — తెలుగు", tag: "tel_Telu", offset: 0x0c00 - 0x0900 },
  { code: "kn", label: "Kannada — ಕನ್ನಡ", tag: "kan_Knda", offset: 0x0c80 - 0x0900 },
  { code: "ml", label: "Malayalam — മലയാളം", tag: "mal_Mlym", offset: 0x0d00 - 0x0900 },
  { code: "gu", label: "Gujarati — ગુજરાતી", tag: "guj_Gujr", offset: 0x0a80 - 0x0900 },
  { code: "pa", label: "Punjabi — ਪੰਜਾਬੀ", tag: "pan_Guru", offset: 0x0a00 - 0x0900 },
  { code: "or", label: "Odia — ଓଡ଼ିଆ", tag: "ory_Orya", offset: 0x0b00 - 0x0900 },
  { code: "as", label: "Assamese — অসমীয়া", tag: "asm_Beng", offset: 0x0980 - 0x0900 },
  { code: "ne", label: "Nepali — नेपाली", tag: "npi_Deva", offset: 0 },
];

export type TranslateProgress =
  | { step: "download"; pct: number }
  | { step: "translate"; done: number; total: number };

type Engine = {
  ort: any;
  src: any;
  tgt: any;
  enc: any;
  dec: any;
  decp: any;
  start: number;
  eos: number;
};

let enginePromise: Promise<Engine> | null = null;
registerModel(["/subtitles"], () => { const p = enginePromise; enginePromise = null; return p; });

async function loadEngine(onProgress?: (p: TranslateProgress) => void): Promise<Engine> {
  if (enginePromise) return enginePromise;
  enginePromise = (async () => {
    const ort = await loadOrt();
    const { PreTrainedTokenizer } = await import("@huggingface/transformers");
    const json = async (f: string) => (await fetch(REPO + f)).json();
    const [cfg, srcJson, tgtJson, gen] = await Promise.all([
      json("tokenizer_config.json"),
      json("tokenizer_src.json"),
      json("tokenizer_tgt.json"),
      json("generation_config.json"),
    ]);

    // ~280MB across three files: report one combined percentage
    const files = ["encoder_model.onnx", "encoder_model.onnx.data", "decoder_model.onnx", "decoder_with_past_model.onnx", "decoder_shared.onnx.data"];
    const sizes = [0.8e6, 73.8e6, 2.0e6, 1.9e6, 203e6];
    const totalBytes = sizes.reduce((a, b) => a + b, 0);
    const loaded = new Array(files.length).fill(0);
    const bytes: Uint8Array[] = [];
    for (let i = 0; i < files.length; i++) {
      const { buf } = await fetchModelBytes(REPO + files[i], (l) => {
        loaded[i] = l;
        onProgress?.({ step: "download", pct: Math.min(99, Math.round((loaded.reduce((a, b) => a + b, 0) / totalBytes) * 100)) });
      }, false);
      bytes.push(buf);
    }
    const [encOnnx, encData, decOnnx, decpOnnx, decData] = bytes;
    const opts = (path: string, data: Uint8Array) => ({ executionProviders: ["wasm"], externalData: [{ path, data }] });
    const enc = await ort.InferenceSession.create(encOnnx, opts("encoder_model.onnx.data", encData));
    const dec = await ort.InferenceSession.create(decOnnx, opts("decoder_shared.onnx.data", decData));
    const decp = await ort.InferenceSession.create(decpOnnx, opts("decoder_shared.onnx.data", decData));
    onProgress?.({ step: "download", pct: 100 });

    return {
      ort,
      src: new PreTrainedTokenizer(srcJson, cfg),
      tgt: new PreTrainedTokenizer(tgtJson, cfg),
      enc, dec, decp,
      start: gen.decoder_start_token_id ?? 2,
      eos: gen.eos_token_id ?? 2,
    };
  })();
  enginePromise.catch(() => { enginePromise = null; });
  return enginePromise;
}

/** Letters where the aligned-block offset lands on the wrong code point. */
const SCRIPT_FIXES: Record<string, Record<number, number>> = {
  asm_Beng: { 0x09b0: 0x09f0, 0x09b5: 0x09f1 }, // Assamese RA ৰ, WA ৱ
  ben_Beng: { 0x09b5: 0x09ac },                 // Bengali has no VA → ব
};

/** Map unified-Devanagari output into the target script and tidy spacing. */
function toScript(text: string, offset: number, tag: string): string {
  let out = text;
  if (offset) {
    const fix = SCRIPT_FIXES[tag] ?? {};
    out = Array.from(out, (ch) => {
      const c = ch.codePointAt(0)!;
      // shift only Devanagari letters/signs; keep the shared danda (U+0964/5)
      if (c < 0x0900 || c > 0x097f || c === 0x0964 || c === 0x0965) return ch;
      const t = c + offset;
      return String.fromCodePoint(fix[t] ?? t);
    }).join("");
  }
  return out.replace(/\s+([।॥.,!?;:])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

async function translateOne(e: Engine, sentence: string, tag: string): Promise<string> {
  const { ort } = e;
  const ids: number[] = e.src.encode(`eng_Latn ${tag} ${sentence}`).map((i: number) => (i < SRC_VOCAB ? i : UNK));
  const I64 = (a: number[], shape: number[]) => new ort.Tensor("int64", BigInt64Array.from(a.map(BigInt)), shape);
  const mask = I64(ids.map(() => 1), [1, ids.length]);
  const { last_hidden_state } = await e.enc.run({ input_ids: I64(ids, [1, ids.length]), attention_mask: mask });
  let out = await e.dec.run({ input_ids: I64([e.start], [1, 1]), encoder_attention_mask: mask, encoder_hidden_states: last_hidden_state });

  const past: Record<string, any> = {};
  const take = (o: Record<string, any>) => {
    for (const k of Object.keys(o)) if (k.startsWith("present.")) past[k.replace("present.", "past_key_values.")] = o[k];
  };
  const argmax = (logits: any) => {
    const v = logits.data as Float32Array, V = logits.dims[2], off = v.length - V;
    let best = -Infinity, bi = 0;
    for (let i = 0; i < V; i++) if (v[off + i] > best) { best = v[off + i]; bi = i; }
    return bi;
  };
  take(out);
  const toks: number[] = [];
  for (let step = 0; step < MAX_NEW_TOKENS; step++) {
    const next = argmax(out.logits);
    if (next === e.eos) break;
    toks.push(next);
    out = await e.decp.run({ input_ids: I64([next], [1, 1]), encoder_attention_mask: mask, ...past });
    take(out);
  }
  return e.tgt.decode(toks, { skip_special_tokens: true });
}

/** Translate English subtitle lines (text only; timing is kept by the caller). */
export async function translateLines(
  lines: string[],
  targetCode: string,
  onProgress?: (p: TranslateProgress) => void
): Promise<string[]> {
  const target = TRANSLATE_TARGETS.find((t) => t.code === targetCode);
  if (!target) throw new Error(`Unsupported language: ${targetCode}`);
  const e = await loadEngine(onProgress);
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i].trim();
    out.push(text ? toScript(await translateOne(e, text, target.tag), target.offset, target.tag) : "");
    onProgress?.({ step: "translate", done: i + 1, total: lines.length });
  }
  return out;
}
