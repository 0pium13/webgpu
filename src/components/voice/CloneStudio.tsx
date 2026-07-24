"use client";

/**
 * Clone a voice — two engines, you pick the tradeoff:
 *
 *  • On your GPU (OuteTTS): free forever, fully private (nothing leaves the
 *    tab), works offline. Recognisable resemblance, but flat/robotic prosody —
 *    a small browser-sized model.
 *  • Studio (ElevenLabs, your key): near-perfect human voice with real emotion.
 *    Needs your own ElevenLabs key + a paid plan; your clip + text are sent to
 *    ElevenLabs. This is the "no compromise" tier a browser can't run locally.
 */

import { useRef, useState, useEffect } from "react";
import ModelLoader from "@/components/ModelLoader";
import { SparkleIcon, VoiceIcon } from "@/components/Icons";
import {
  buildSpeaker, cloneSpeak, encodeWav,
  type ClonedSpeaker, type ClonePhase,
} from "@/lib/voiceClone";
import { createClonedVoice, speak as elSpeak, deleteVoice, EL_MODELS } from "@/lib/elevenlabs";

type Phase = "idle" | "building" | "ready" | "generating" | "error";
type Engine = "local" | "elevenlabs";

const DL_TITLES: Record<string, { title: string; sub: string }> = {
  encoder: { title: "Downloading the voice encoder", sub: "44MB · our own export — no cloud has this" },
  whisper: { title: "Whisper is coming to listen", sub: "~145MB · downloads once, cached forever" },
  aligner: { title: "Loading the word aligner", sub: "~95MB · finds each word to the frame" },
  model: { title: "The voice engine is waking up", sub: "~460MB · downloads once, cached forever" },
};

async function blobDuration(url: string): Promise<number> {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const dec = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
    ctx.close();
    return dec.duration;
  } catch { return 0; }
}

export default function CloneStudio() {
  const [engine, setEngine] = useState<Engine>("local");
  const [phase, setPhase] = useState<Phase>("idle");
  const [refName, setRefName] = useState("");
  const [speaker, setSpeaker] = useState<ClonedSpeaker | null>(null);
  const [dl, setDl] = useState<{ kind: string; pct: number } | null>(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [text, setText] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [result, setResult] = useState<{ url: string; secs: number; ext: string } | null>(null);
  const [drag, setDrag] = useState(false);

  // ElevenLabs (BYOK) state
  const [elKey, setElKey] = useState("");
  const [elModel, setElModel] = useState(EL_MODELS[0].id);
  const [elFile, setElFile] = useState<File | null>(null);
  const elVoiceRef = useRef<string | null>(null); // cached cloned voice_id for elFile
  const resultRef = useRef<string | null>(null);

  useEffect(() => { setElKey(localStorage.getItem("el_key") ?? ""); }, []);
  function saveKey(k: string) { setElKey(k); localStorage.setItem("el_key", k); }

  const onPhase = (p: ClonePhase) => {
    if (p.step === "encoder" || p.step === "whisper" || p.step === "aligner" || p.step === "model") {
      setDl({ kind: p.step, pct: p.pct });
      setStatusMsg("");
    } else {
      setDl(null);
      setStatusMsg(
        p.step === "listening" ? "Listening to the reference…" :
        p.step === "encoding" ? "Learning the voice…" :
        "Speaking in the cloned voice…"
      );
    }
  };

  function isAudioish(file: File) {
    return file.type.startsWith("audio/") || file.type.startsWith("video/");
  }

  async function handleRef(file: File) {
    if (!isAudioish(file)) return alert("Drop an audio clip (or a video — we take its audio).");
    setErrMsg("");
    setResult(null);
    setRefName(file.name);

    if (engine === "elevenlabs") {
      // no local learning — the clip is cloned server-side on first "Speak"
      if (elVoiceRef.current) { deleteVoice(elKey, elVoiceRef.current); elVoiceRef.current = null; }
      setElFile(file);
      setSpeaker(null);
      setPhase("ready");
      return;
    }

    try {
      setPhase("building");
      setSpeaker(null);
      const sp = await buildSpeaker(file, onPhase);
      setSpeaker(sp);
      setPhase("ready");
      setDl(null);
      setStatusMsg("");
    } catch (e: any) {
      console.error(e);
      setErrMsg(e?.message ?? "Couldn't learn this voice");
      setPhase("error");
      setDl(null);
    }
  }

  async function generate() {
    const t = text.trim();
    if (!t || phase === "generating" || phase === "building") return;

    try {
      setErrMsg("");
      setPhase("generating");
      let url: string, secs: number, ext: string;

      if (engine === "elevenlabs") {
        if (!elKey.trim()) throw new Error("Paste your ElevenLabs API key first.");
        if (!elFile) throw new Error("Add a reference clip first.");
        if (!elVoiceRef.current) {
          setStatusMsg("Cloning the voice on ElevenLabs…");
          elVoiceRef.current = await createClonedVoice(elKey.trim(), refName || "clone", elFile);
        }
        setStatusMsg("Speaking in the cloned voice…");
        const mp3 = await elSpeak(elKey.trim(), elVoiceRef.current, t, elModel);
        url = URL.createObjectURL(mp3);
        secs = await blobDuration(url);
        ext = "mp3";
      } else {
        if (!speaker) throw new Error("Learn a voice first.");
        const { samples, sampleRate } = await cloneSpeak(t, speaker, onPhase);
        url = URL.createObjectURL(encodeWav(samples, sampleRate));
        secs = samples.length / sampleRate;
        ext = "wav";
      }

      if (resultRef.current) URL.revokeObjectURL(resultRef.current);
      resultRef.current = url;
      setResult({ url, secs, ext });
      setPhase("ready");
      setDl(null);
      setStatusMsg("");
    } catch (e: any) {
      console.error(e);
      setErrMsg(e?.message ?? "Generation failed");
      setPhase("error");
      setDl(null);
    }
  }

  function resetVoice() {
    if (elVoiceRef.current) { deleteVoice(elKey, elVoiceRef.current); elVoiceRef.current = null; }
    setSpeaker(null); setElFile(null); setResult(null); setPhase("idle"); setErrMsg("");
  }

  function switchEngine(e: Engine) {
    if (e === engine || busy) return;
    resetVoice();
    setEngine(e);
  }

  const busy = phase === "building" || phase === "generating";
  const hasVoice = engine === "local" ? !!speaker : !!elFile;
  const refSecs = speaker ? speaker.words.reduce((a, w) => a + w.duration, 0) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* engine picker — the capability tradeoff, stated up front */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button onClick={() => switchEngine("local")} style={{ ...engineCard, borderColor: engine === "local" ? "var(--accent)" : "var(--border)" }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>On your GPU · free</span>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)", lineHeight: 1.5 }}>
            Private, offline, $0 · resemblance clone, a little robotic
          </span>
        </button>
        <button onClick={() => switchEngine("elevenlabs")} style={{ ...engineCard, borderColor: engine === "elevenlabs" ? "var(--accent)" : "var(--border)" }}>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>Studio · ElevenLabs key</span>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)", lineHeight: 1.5 }}>
            Near-perfect human voice · your key + paid plan · clip is sent to ElevenLabs
          </span>
        </button>
      </div>

      {/* ElevenLabs key + model */}
      {engine === "elevenlabs" && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <input
            type="password"
            placeholder="ElevenLabs API key (elevenlabs.io → Profile → API key)"
            value={elKey}
            onChange={(e) => saveKey(e.target.value)}
            style={{ ...field, flex: 1, minWidth: 240 }}
          />
          <select value={elModel} onChange={(e) => setElModel(e.target.value)} style={{ ...field, minWidth: 190 }}>
            {EL_MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)", flexBasis: "100%" }}>
            {EL_MODELS.find((m) => m.id === elModel)?.hint} · key stays in your browser, sent only to ElevenLabs
          </span>
        </div>
      )}

      {/* reference upload */}
      {!hasVoice && phase !== "building" && (
        <label
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) handleRef(f); }}
          style={{
            display: "block", border: drag ? "0.5px solid var(--accent)" : "0.5px dashed var(--border-strong)",
            borderRadius: 16, background: drag ? "var(--accent-dim)" : "var(--surface)",
            padding: "48px 32px", textAlign: "center", cursor: "pointer", transition: "all 0.15s",
          }}
        >
          <input type="file" accept="audio/*,video/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleRef(f); }} />
          <div style={{ width: 52, height: 52, borderRadius: 13, background: "var(--surface-2)", border: "0.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px", color: "var(--accent)" }}>
            <VoiceIcon size={24} />
          </div>
          <p style={{ fontSize: 16.5, fontWeight: 500, marginBottom: 6 }}>Drop a voice to clone</p>
          <p style={{ fontSize: 13.5, color: "var(--text-muted)", marginBottom: 16 }}>
            10–30 seconds of one REAL person speaking clearly
            <br />
            <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
              (synthetic/robotic voices don&apos;t clone well — the models learned from humans)
            </span>
          </p>
          <span style={{ display: "inline-block", padding: "8px 20px", background: "var(--accent)", color: "var(--on-accent)", borderRadius: 8, fontSize: 13.5, fontWeight: 500 }}>Choose clip</span>
          <p className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 18 }}>
            {engine === "local"
              ? "The voice never leaves this tab · clone responsibly — only voices you have the right to use"
              : "Sent to ElevenLabs to build the clone · only clone voices you have the right to use"}
          </p>
        </label>
      )}

      {/* download / working states */}
      {busy && dl && DL_TITLES[dl.kind] && (
        <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
          <ModelLoader pct={dl.pct} title={DL_TITLES[dl.kind].title} sub={DL_TITLES[dl.kind].sub} />
        </div>
      )}
      {busy && !dl && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "14px 18px" }}>
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", animation: "pulse 1s ease-in-out infinite", flexShrink: 0 }} />
          <span style={{ fontSize: 13.5 }}>{statusMsg || "Working…"}</span>
        </div>
      )}

      {/* ready voice indicator */}
      {hasVoice && !busy && (
        <div style={{ background: "var(--surface)", border: "0.5px solid var(--accent-border)", borderRadius: 14, padding: "14px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--green)" }} />
            <p style={{ fontSize: 13.5, fontWeight: 500, flex: 1 }}>
              {engine === "local"
                ? <>Voice learned from {refName} <span className="mono" style={{ color: "var(--text-dim)", fontWeight: 400 }}>· {speaker!.words.length} words · {refSecs.toFixed(1)}s</span></>
                : <>Reference ready: {refName} <span className="mono" style={{ color: "var(--text-dim)", fontWeight: 400 }}>· ElevenLabs clones it on first take</span></>}
            </p>
            <button onClick={resetVoice} style={{
              fontSize: 12, color: "var(--text-muted)", background: "transparent",
              border: "0.5px solid var(--border)", borderRadius: 7, padding: "5px 12px", cursor: "pointer",
            }}>
              ← Different voice
            </button>
          </div>
          {engine === "local" && (
            <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, fontStyle: "italic", lineHeight: 1.5 }}>
              heard: &quot;{speaker!.text.slice(0, 140)}{speaker!.text.length > 140 ? "…" : ""}&quot;
            </p>
          )}
        </div>
      )}

      {hasVoice && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={engine === "local" ? "Now type anything — it comes out in that voice… (English v1)" : "Type anything — 29 languages supported…"}
            rows={4}
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
              <SparkleIcon size={16} /> {phase === "generating" ? "Cloning…" : "Speak as this voice"}
            </button>
            <span className="mono" style={{ fontSize: 11.5, color: "var(--text-dim)" }}>
              {engine === "local" ? "best under ~40 words per take" : "billed to your ElevenLabs credits"}
            </span>
          </div>
        </>
      )}

      {errMsg && (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <p style={{ color: "#ef4444", fontSize: 13, flex: 1 }}>{errMsg}</p>
          {phase === "error" && !hasVoice && (
            <button onClick={() => { setPhase("idle"); setErrMsg(""); }} style={{
              background: "var(--surface-2)", color: "var(--text)", border: "0.5px solid var(--border)",
              borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer",
            }}>
              Try another clip
            </button>
          )}
        </div>
      )}

      {result && !busy && (
        <div style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--surface)", border: "0.5px solid var(--accent)", borderRadius: 14, padding: "14px 18px", flexWrap: "wrap" }}>
          <VoiceIcon size={18} />
          <audio controls src={result.url} style={{ flex: 1, minWidth: 220, height: 38 }} />
          {result.secs > 0 && <span className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>{result.secs.toFixed(1)}s</span>}
          <a href={result.url} download={`cloned-voice.${result.ext}`} style={{
            background: "var(--accent)", color: "var(--on-accent)", borderRadius: 10,
            padding: "9px 18px", fontSize: 13.5, fontWeight: 500, textDecoration: "none",
          }}>
            ↓ {result.ext.toUpperCase()}
          </a>
        </div>
      )}
    </div>
  );
}

const engineCard: React.CSSProperties = {
  flex: 1, minWidth: 240, display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4,
  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12,
  padding: "12px 16px", cursor: "pointer", textAlign: "left",
};
const field: React.CSSProperties = {
  background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 10,
  padding: "10px 14px", fontSize: 13.5, color: "var(--text)", outline: "none",
};
