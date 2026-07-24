"use client";

/**
 * Voice Studio — Kokoro-82M on your GPU: the best open TTS that runs in a
 * browser, with a proper Hindi voice. ElevenLabs charges for this; here the
 * only cost is your own silicon.
 *
 * Voice CLONING (reference audio → your voice) is not here yet, honestly:
 * every browser port of the cloning models ships only the audio DECODER —
 * encoding a reference voice needs a WavTokenizer-encoder ONNX that nobody
 * has published. It's on the build-from-scratch list, not faked with presets.
 */

import { useRef, useState } from "react";
import Nav from "@/components/Nav";
import ModelLoader from "@/components/ModelLoader";
import CloneStudio from "@/components/voice/CloneStudio";
import { useGPU } from "@/lib/useGPU";
import { SparkleIcon, VoiceIcon } from "@/components/Icons";

// Kokoro's v1.0 ONNX release ships English only — these ids are the ones the
// engine actually has. (The Hindi/multilingual voices exist upstream but have
// no browser export yet; that slot is what voice cloning will fill.)
const VOICES = [
  { id: "af_heart", label: "Heart", lang: "English (US)", g: "F", star: true },
  { id: "af_bella", label: "Bella", lang: "English (US)", g: "F" },
  { id: "af_nicole", label: "Nicole", lang: "English (US)", g: "F" },
  { id: "af_sky", label: "Sky", lang: "English (US)", g: "F" },
  { id: "af_nova", label: "Nova", lang: "English (US)", g: "F" },
  { id: "am_michael", label: "Michael", lang: "English (US)", g: "M" },
  { id: "am_fenrir", label: "Fenrir", lang: "English (US)", g: "M" },
  { id: "am_puck", label: "Puck", lang: "English (US)", g: "M" },
  { id: "am_onyx", label: "Onyx", lang: "English (US)", g: "M" },
  { id: "bf_emma", label: "Emma", lang: "English (UK)", g: "F", star: true },
  { id: "bf_isabella", label: "Isabella", lang: "English (UK)", g: "F" },
  { id: "bf_lily", label: "Lily", lang: "English (UK)", g: "F" },
  { id: "bm_george", label: "George", lang: "English (UK)", g: "M" },
  { id: "bm_daniel", label: "Daniel", lang: "English (UK)", g: "M" },
  { id: "bm_fable", label: "Fable", lang: "English (UK)", g: "M" },
];

type Phase = "idle" | "loading" | "ready" | "generating" | "error";

/** 16-bit PCM WAV from float samples. */
function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); ws(8, "WAVE");
  ws(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: "audio/wav" });
}

/** split long text into sentence-ish chunks Kokoro handles comfortably */
function chunkText(text: string, max = 350): string[] {
  const parts = text.replace(/\s+/g, " ").trim().match(/[^.!?।]+[.!?।]*\s*/g) ?? [text];
  const out: string[] = [];
  let cur = "";
  for (const p of parts) {
    if ((cur + p).length > max && cur) { out.push(cur.trim()); cur = p; }
    else cur += p;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

let ttsPromise: Promise<any> | null = null;

function loadTTS(onPct: (p: number) => void): Promise<any> {
  if (ttsPromise) return ttsPromise;
  ttsPromise = (async () => {
    const { KokoroTTS } = await import("kokoro-js");
    const cb = (p: any) => {
      if (p?.status === "progress" && p.total) onPct(Math.round((p.loaded / p.total) * 100));
    };
    try {
      return await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
        dtype: "fp32", device: "webgpu", progress_callback: cb,
      });
    } catch (e) {
      console.warn("[voice] webgpu failed, wasm q8 fallback", e);
      return await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", {
        dtype: "q8", device: "wasm", progress_callback: cb,
      });
    }
  })();
  ttsPromise.catch(() => { ttsPromise = null; });
  return ttsPromise;
}

export default function VoicePage() {
  const gpu = useGPU();
  const [mode, setMode] = useState<"studio" | "clone">("studio");
  const [phase, setPhase] = useState<Phase>("idle");
  const [voice, setVoice] = useState("af_heart");
  const [text, setText] = useState("");
  const [pct, setPct] = useState(0);
  const [genMsg, setGenMsg] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [result, setResult] = useState<{ url: string; secs: number } | null>(null);
  const resultRef = useRef<string | null>(null);

  async function generate() {
    const t = text.trim();
    if (!t || phase === "generating" || phase === "loading") return;
    try {
      if (!ttsPromise) setPhase("loading");
      setErrMsg("");
      const tts = await loadTTS(setPct);
      setPhase("generating");

      const chunks = chunkText(t);
      const pieces: Float32Array[] = [];
      let rate = 24000;
      for (let i = 0; i < chunks.length; i++) {
        setGenMsg(chunks.length > 1 ? `Speaking… part ${i + 1} of ${chunks.length}` : "Speaking…");
        const audio = await tts.generate(chunks[i], { voice });
        rate = audio.sampling_rate ?? rate;
        pieces.push(audio.audio as Float32Array);
      }
      const totalLen = pieces.reduce((a, p) => a + p.length, 0);
      const all = new Float32Array(totalLen);
      let off = 0;
      for (const p of pieces) { all.set(p, off); off += p.length; }

      if (resultRef.current) URL.revokeObjectURL(resultRef.current);
      const url = URL.createObjectURL(encodeWav(all, rate));
      resultRef.current = url;
      setResult({ url, secs: totalLen / rate });
      setPhase("ready");
    } catch (e: any) {
      console.error(e);
      setErrMsg(e?.message ?? "Generation failed");
      setPhase("error");
    }
  }

  const busy = phase === "loading" || phase === "generating";
  const grouped = VOICES.reduce<Record<string, typeof VOICES>>((acc, v) => {
    (acc[v.lang] = acc[v.lang] ?? []).push(v);
    return acc;
  }, {});

  return (
    <div style={{ minHeight: "100vh" }}>
      <Nav />
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "100px 24px 80px" }}>
        <div style={{ marginBottom: 32 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.15em", color: "var(--accent)", textTransform: "uppercase" }}>
            webgpu.in / voice
          </span>
          <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 500, letterSpacing: "-0.03em", marginTop: 12, marginBottom: 10 }}>
            Voice Studio
          </h1>
          <p style={{ fontSize: 16, color: "var(--text-muted)", maxWidth: 560, lineHeight: 1.6 }}>
            Studio-grade text-to-speech on your own GPU. Voiceovers for reels,
            videos, apps — no credits, no character limits, nothing uploaded.
          </p>
        </div>

        {/* mode tabs */}
        <div style={{ display: "flex", gap: 8, marginBottom: 22 }}>
          {([
            { id: "studio", label: "Studio voices", hint: "15 polished voices" },
            { id: "clone", label: "Clone a voice", hint: "from your reference clip" },
          ] as const).map((m) => {
            const active = mode === m.id;
            return (
              <button key={m.id} onClick={() => setMode(m.id)} style={{
                background: active ? "var(--accent-dim)" : "var(--surface)",
                border: active ? "0.5px solid var(--accent)" : "0.5px solid var(--border)",
                borderRadius: 12, padding: "10px 18px", cursor: "pointer", textAlign: "left",
              }}>
                <span style={{ display: "block", fontSize: 14, fontWeight: 500, color: active ? "var(--accent)" : "var(--text)" }}>{m.label}</span>
                <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{m.hint}</span>
              </button>
            );
          })}
        </div>

        {mode === "clone" && <CloneStudio />}

        {mode === "studio" && phase === "idle" && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "14px 18px", marginBottom: 20 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: gpu.supported ? "var(--green)" : "var(--amber)", flexShrink: 0 }} />
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              Kokoro-82M runs on <span className="mono" style={{ color: "var(--text)" }}>{gpu.supported ? "your GPU (WebGPU)" : "CPU (slower)"}</span> · ~{gpu.supported ? "330MB" : "92MB"} model, downloads once
            </p>
          </div>
        )}

        <div style={{ display: mode === "studio" ? "flex" : "none", flexDirection: "column", gap: 16 }}>
          {/* voice picker */}
          <div>
            <p className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 8 }}>Voice</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {Object.entries(grouped).map(([lang, vs]) => (
                <div key={lang} style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)", width: 88, flexShrink: 0 }}>{lang}</span>
                  {vs.map((v) => {
                    const active = voice === v.id;
                    return (
                      <button key={v.id} onClick={() => setVoice(v.id)} disabled={busy} style={{
                        background: active ? "var(--accent-dim)" : "var(--surface)",
                        border: active ? "0.5px solid var(--accent)" : "0.5px solid var(--border)",
                        borderRadius: 999, padding: "6px 14px", fontSize: 12.5, cursor: "pointer",
                        color: active ? "var(--accent)" : "var(--text)",
                      }}>
                        {v.star ? "★ " : ""}{v.label} <span style={{ color: "var(--text-dim)", fontSize: 10.5 }}>{v.g}</span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>

          {/* text */}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Type what you want spoken…"
            rows={5}
            style={{
              width: "100%", resize: "vertical", background: "var(--surface)", color: "var(--text)",
              border: "0.5px solid var(--border)", borderRadius: 14, padding: "16px 18px",
              fontSize: 15, lineHeight: 1.6, outline: "none", fontFamily: "inherit",
            }}
          />

          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <button onClick={generate} disabled={!text.trim() || busy} style={{
              background: "var(--accent)", color: "var(--on-accent)", border: "none", borderRadius: 12,
              padding: "13px 30px", fontSize: 15, fontWeight: 500,
              cursor: !text.trim() || busy ? "default" : "pointer",
              opacity: !text.trim() || busy ? 0.5 : 1,
              display: "inline-flex", alignItems: "center", gap: 9,
            }}>
              <SparkleIcon size={16} /> {phase === "generating" ? genMsg || "Speaking…" : "Generate speech"}
            </button>
            <span className="mono" style={{ fontSize: 11.5, color: "var(--text-dim)" }}>
              {text.length > 0 && `${text.length} chars · `}free forever · runs on your GPU
            </span>
          </div>

          {phase === "loading" && (
            <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
              <ModelLoader pct={pct} title="Kokoro is warming up its voice" sub="downloads once, cached forever" />
            </div>
          )}

          {errMsg && <p style={{ color: "#ef4444", fontSize: 13 }}>{errMsg}</p>}

          {result && phase !== "loading" && (
            <div style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--surface)", border: "0.5px solid var(--accent)", borderRadius: 14, padding: "14px 18px", flexWrap: "wrap" }}>
              <VoiceIcon size={18} />
              <audio controls src={result.url} style={{ flex: 1, minWidth: 220, height: 38 }} />
              <span className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>{result.secs.toFixed(1)}s</span>
              <a href={result.url} download="voiceover.wav" style={{
                background: "var(--accent)", color: "var(--on-accent)", borderRadius: 10,
                padding: "9px 18px", fontSize: 13.5, fontWeight: 500, textDecoration: "none",
              }}>
                ↓ WAV
              </a>
            </div>
          )}

          <p className="mono" style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.7 }}>
            Want it in a specific person&apos;s voice? Switch to Clone a voice —
            we built the in-browser encoder for it because none existed.
          </p>
        </div>
      </div>
    </div>
  );
}
