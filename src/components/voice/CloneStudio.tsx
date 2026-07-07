"use client";

/**
 * Clone a voice — upload ~10–20s of someone speaking, the pipeline learns the
 * voice (whisper words + our WavTokenizer-encoder codes), then OuteTTS says
 * anything as that speaker. English v1.
 */

import { useRef, useState } from "react";
import ModelLoader from "@/components/ModelLoader";
import { SparkleIcon, VoiceIcon } from "@/components/Icons";
import {
  buildSpeaker, cloneSpeak, encodeWav,
  type ClonedSpeaker, type ClonePhase,
} from "@/lib/voiceClone";

type Phase = "idle" | "building" | "ready" | "generating" | "error";

const DL_TITLES: Record<string, { title: string; sub: string }> = {
  encoder: { title: "Downloading the voice encoder", sub: "44MB · our own export — no cloud has this" },
  whisper: { title: "Whisper is coming to listen", sub: "~145MB · downloads once, cached forever" },
  aligner: { title: "Loading the word aligner", sub: "~95MB · finds each word to the frame" },
  model: { title: "The voice engine is waking up", sub: "~460MB · downloads once, cached forever" },
};

export default function CloneStudio() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [refName, setRefName] = useState("");
  const [speaker, setSpeaker] = useState<ClonedSpeaker | null>(null);
  const [dl, setDl] = useState<{ kind: string; pct: number } | null>(null);
  const [statusMsg, setStatusMsg] = useState("");
  const [text, setText] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [result, setResult] = useState<{ url: string; secs: number } | null>(null);
  const [drag, setDrag] = useState(false);
  const resultRef = useRef<string | null>(null);

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

  async function handleRef(file: File) {
    if (!file.type.startsWith("audio/") && !file.type.startsWith("video/"))
      return alert("Drop an audio clip (or a video — we take its audio).");
    try {
      setPhase("building");
      setErrMsg("");
      setSpeaker(null);
      setRefName(file.name);
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
    if (!t || !speaker || phase === "generating" || phase === "building") return;
    try {
      setPhase("generating");
      setErrMsg("");
      const { samples, sampleRate } = await cloneSpeak(t, speaker, onPhase);
      if (resultRef.current) URL.revokeObjectURL(resultRef.current);
      const url = URL.createObjectURL(encodeWav(samples, sampleRate));
      resultRef.current = url;
      setResult({ url, secs: samples.length / sampleRate });
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

  const busy = phase === "building" || phase === "generating";
  const refSecs = speaker ? speaker.words.reduce((a, w) => a + w.duration, 0) : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* reference upload */}
      {!speaker && phase !== "building" && (
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
            10–20 seconds of one REAL person speaking clearly · English v1
            <br />
            <span style={{ fontSize: 12, color: "var(--text-dim)" }}>
              (synthetic/robotic voices don&apos;t clone well — the model learned from humans)
            </span>
          </p>
          <span style={{ display: "inline-block", padding: "8px 20px", background: "var(--accent)", color: "#fff", borderRadius: 8, fontSize: 13.5, fontWeight: 500 }}>Choose clip</span>
          <p className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 18 }}>
            The voice never leaves this tab · clone responsibly — only voices you have the right to use
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

      {/* learned speaker */}
      {speaker && (
        <div style={{ background: "var(--surface)", border: "0.5px solid var(--accent-border)", borderRadius: 14, padding: "14px 18px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--green)" }} />
            <p style={{ fontSize: 13.5, fontWeight: 500, flex: 1 }}>
              Voice learned from {refName} <span className="mono" style={{ color: "var(--text-dim)", fontWeight: 400 }}>· {speaker.words.length} words · {refSecs.toFixed(1)}s</span>
            </p>
            {!busy && (
              <button onClick={() => { setSpeaker(null); setResult(null); setPhase("idle"); }} style={{
                fontSize: 12, color: "var(--text-muted)", background: "transparent",
                border: "0.5px solid var(--border)", borderRadius: 7, padding: "5px 12px", cursor: "pointer",
              }}>
                ← Different voice
              </button>
            )}
          </div>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, fontStyle: "italic", lineHeight: 1.5 }}>
            heard: &quot;{speaker.text.slice(0, 140)}{speaker.text.length > 140 ? "…" : ""}&quot;
          </p>
        </div>
      )}

      {speaker && (
        <>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Now type anything — it comes out in that voice… (English v1)"
            rows={4}
            style={{
              width: "100%", resize: "vertical", background: "var(--surface)", color: "var(--text)",
              border: "0.5px solid var(--border)", borderRadius: 14, padding: "16px 18px",
              fontSize: 15, lineHeight: 1.6, outline: "none", fontFamily: "inherit",
            }}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <button onClick={generate} disabled={!text.trim() || busy} style={{
              background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12,
              padding: "13px 30px", fontSize: 15, fontWeight: 500,
              cursor: !text.trim() || busy ? "default" : "pointer",
              opacity: !text.trim() || busy ? 0.5 : 1,
              display: "inline-flex", alignItems: "center", gap: 9,
            }}>
              <SparkleIcon size={16} /> {phase === "generating" ? "Cloning…" : "Speak as this voice"}
            </button>
            <span className="mono" style={{ fontSize: 11.5, color: "var(--text-dim)" }}>
              best under ~40 words per take
            </span>
          </div>
        </>
      )}

      {errMsg && (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <p style={{ color: "#ef4444", fontSize: 13, flex: 1 }}>{errMsg}</p>
          {phase === "error" && !speaker && (
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
          <span className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>{result.secs.toFixed(1)}s</span>
          <a href={result.url} download="cloned-voice.wav" style={{
            background: "var(--accent)", color: "#fff", borderRadius: 10,
            padding: "9px 18px", fontSize: 13.5, fontWeight: 500, textDecoration: "none",
          }}>
            ↓ WAV
          </a>
        </div>
      )}
    </div>
  );
}
