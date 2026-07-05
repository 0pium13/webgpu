"use client";

import { useRef, useState } from "react";
import Nav from "@/components/Nav";
import ModelLoader from "@/components/ModelLoader";
import { useGPU } from "@/lib/useGPU";
import { CaptionsIcon, SparkleIcon } from "@/components/Icons";
import {
  decodeAudio, transcribe, whisperDevice, toSRT, toVTT, toTXT,
  WHISPER_MODELS, LANGUAGES,
  type SubtitleLine, type WhisperPhase, type WhisperTier,
} from "@/lib/whisper";

const TIER_HINTS: Record<WhisperTier, string> = {
  fast: "Great for English",
  accurate: "Good for Hindi & Indian languages",
  max: "Best possible — every Indian language",
};

type OutputStyle = "hinglish" | "native" | "english";

const OUTPUT_STYLES: { id: OutputStyle; label: string; hint: string }[] = [
  { id: "hinglish", label: "Hinglish", hint: "kya kar rahe ho — Roman script" },
  { id: "native", label: "Native script", hint: "क्या कर रहे हो — as spoken" },
  { id: "english", label: "English", hint: "translated by Whisper" },
];

type Phase = "idle" | "working" | "done" | "error";
type MediaFile = { file: File; url: string };

function fmtT(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function SubtitlesPage() {
  const [input, setInput] = useState<MediaFile | null>(null);
  const gpu = useGPU();

  function handleFile(file: File) {
    if (!file.type.startsWith("audio/") && !file.type.startsWith("video/"))
      return alert("Please choose an audio or video file.");
    setInput({ file, url: URL.createObjectURL(file) });
  }

  function reset() {
    if (input) URL.revokeObjectURL(input.url);
    setInput(null);
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <Nav />
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "100px 24px 80px" }}>
        <div style={{ marginBottom: 36 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.15em", color: "var(--accent)", textTransform: "uppercase" }}>
            webgpu.in / subtitles
          </span>
          <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 500, letterSpacing: "-0.03em", marginTop: 12, marginBottom: 10 }}>
            Auto Subtitles
          </h1>
          <p style={{ fontSize: 16, color: "var(--text-muted)", maxWidth: 560, lineHeight: 1.6 }}>
            Drop any video or audio — Whisper transcribes it on your GPU, lines
            appear live as they&apos;re heard, export SRT for any editor.
            <span style={{ color: "var(--text)" }}> Hinglish captions built in,</span>{" "}
            plus Hindi, Tamil, Telugu, Bengali, Urdu &amp; every Indian language
            Whisper knows. Nothing uploaded.
          </p>
        </div>

        {!input && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "14px 18px", marginBottom: 20 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: gpu.supported ? "var(--green)" : "var(--amber)", flexShrink: 0 }} />
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {gpu.scanning ? "Detecting your GPU…" : (
                <>Whisper runs on <span className="mono" style={{ color: "var(--text)" }}>{gpu.supported ? "your GPU (WebGPU)" : "CPU (slower)"}</span> · model downloads once, cached after</>
              )}
            </p>
          </div>
        )}

        {!input ? <Dropzone onFile={handleFile} /> : <SubtitleStudio input={input} onReset={reset} />}
      </div>
    </div>
  );
}

function SubtitleStudio({ input, onReset }: { input: MediaFile; onReset: () => void }) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [msg, setMsg] = useState("");
  const [pct, setPct] = useState(0);
  const [lines, setLines] = useState<SubtitleLine[]>([]);
  const [errMsg, setErrMsg] = useState("");
  const [tier, setTier] = useState<WhisperTier>("fast");
  const [language, setLanguage] = useState("auto");
  const [output, setOutput] = useState<OutputStyle>("hinglish");
  const [downloading, setDownloading] = useState(false);
  const linesBox = useRef<HTMLDivElement>(null);

  async function start() {
    try {
      setPhase("working");
      setLines([]);
      setMsg("Reading audio…");
      setPct(0);

      const onProgress = (p: WhisperPhase) => {
        if (p.step === "download") { setMsg(`Loading Whisper… ${p.pct}%`); setPct(p.pct); setDownloading(true); }
        else if (p.step === "decode") { setMsg("Reading audio…"); setPct(0); }
        else {
          setDownloading(false);
          setMsg(`Listening… ${fmtT(p.doneSec)} / ${fmtT(p.totalSec)}`);
          setPct(Math.min(99, Math.round((p.doneSec / p.totalSec) * 100)));
          setLines(p.lines);
          // keep the newest line in view — text appearing live is the dopamine
          requestAnimationFrame(() => {
            linesBox.current?.scrollTo({ top: linesBox.current.scrollHeight, behavior: "smooth" });
          });
        }
      };

      const audio = await decodeAudio(input.file);
      // transformers.js "auto" actually defaults to English, not detection —
      // for Hinglish the sane assumption is Hindi unless the user says otherwise
      const effLanguage = output === "hinglish" && language === "auto" ? "hindi" : language;
      const finalLines = await transcribe(audio, onProgress, {
        tier, language: effLanguage,
        translate: output === "english",
        romanize: output === "hinglish",
      });
      setLines(finalLines);
      setPct(100);
      setPhase("done");
    } catch (e: any) {
      console.error(e);
      setErrMsg(e?.message ?? "Something went wrong");
      setPhase("error");
    }
  }

  function save(text: string, ext: string) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = `${input.file.name.replace(/\.[^.]+$/, "")}.${ext}`;
    a.click();
  }

  const busy = phase === "working";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {input.file.name}
          {lines.length > 0 && <span style={{ color: "var(--accent)" }}> · {lines.length} lines</span>}
          {phase === "done" && <span className="mono" style={{ color: "var(--text-dim)" }}> · Whisper · {whisperDevice() === "webgpu" ? "GPU" : "CPU"}</span>}
        </p>
        {!busy && <button onClick={onReset} style={ghost}>← New file</button>}
      </div>

      {/* transcript surface */}
      <div style={{ position: "relative", background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 16, overflow: "hidden", minHeight: 320 }}>
        {phase === "idle" && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 22, minHeight: 320, padding: "36px 24px" }}>
            {/* model tier — bigger model = dramatically better Indic accuracy */}
            <div style={{ width: "100%", maxWidth: 520 }}>
              <p className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 8 }}>Model</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {(Object.keys(WHISPER_MODELS) as WhisperTier[]).map((t) => {
                  const m = WHISPER_MODELS[t];
                  const active = tier === t;
                  return (
                    <button key={t} onClick={() => setTier(t)} style={{
                      background: active ? "var(--accent-dim)" : "var(--surface-2)",
                      border: active ? "0.5px solid var(--accent)" : "0.5px solid var(--border)",
                      borderRadius: 10, padding: "10px 8px", cursor: "pointer", textAlign: "left",
                    }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 500, color: active ? "var(--accent)" : "var(--text)" }}>
                        {m.label} <span className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)", fontWeight: 400 }}>{m.size}</span>
                      </span>
                      <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.35 }}>{TIER_HINTS[t]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* language */}
            <div style={{ width: "100%", maxWidth: 520 }}>
              <p className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 8 }}>Spoken language</p>
              <select value={language} onChange={(e) => setLanguage(e.target.value)} style={{
                width: "100%", background: "var(--surface-2)", color: "var(--text)",
                border: "0.5px solid var(--border)", borderRadius: 10, padding: "10px 12px",
                fontSize: 13.5, cursor: "pointer", appearance: "none",
              }}>
                {LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
              </select>
            </div>

            {/* output style — Hinglish is the whole point for Indian creators */}
            <div style={{ width: "100%", maxWidth: 520 }}>
              <p className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 8 }}>Subtitle style</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                {OUTPUT_STYLES.map((o) => {
                  const active = output === o.id;
                  return (
                    <button key={o.id} onClick={() => setOutput(o.id)} style={{
                      background: active ? "var(--accent-dim)" : "var(--surface-2)",
                      border: active ? "0.5px solid var(--accent)" : "0.5px solid var(--border)",
                      borderRadius: 10, padding: "10px 8px", cursor: "pointer", textAlign: "left",
                    }}>
                      <span style={{ display: "block", fontSize: 13, fontWeight: 500, color: active ? "var(--accent)" : "var(--text)" }}>{o.label}</span>
                      <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.35 }}>{o.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>
            {output === "hinglish" && (
              <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -12, maxWidth: 520 }}>
                Whisper hears in native script (its most accurate mode) — we convert to
                Hinglish live. Auto assumes Hindi here; the Accurate and Max models
                write much cleaner Hindi than Fast.
              </p>
            )}

            <button onClick={start} style={{
              background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12,
              padding: "14px 32px", fontSize: 16, fontWeight: 500, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 9,
            }}>
              <SparkleIcon size={17} /> Transcribe
            </button>
            <p className="mono" style={{ fontSize: 12, color: "var(--text-muted)", marginTop: -8 }}>
              Whisper {WHISPER_MODELS[tier].label} · lines stream in live · runs on your GPU
            </p>
          </div>
        )}

        {(busy || phase === "done") && (
          <div ref={linesBox} style={{ maxHeight: 420, overflowY: "auto", padding: "18px 22px 60px" }}>
            {lines.map((l, i) => (
              <div key={i} style={{ display: "flex", gap: 14, padding: "7px 0", borderBottom: "0.5px solid var(--border)", animation: "fadein 0.4s ease-out" }}>
                <span className="mono" style={{ fontSize: 12, color: "var(--accent)", flexShrink: 0, paddingTop: 2 }}>{fmtT(l.start)}</span>
                <p style={{ fontSize: 14, color: "var(--text)", lineHeight: 1.55 }}>{l.text}</p>
              </div>
            ))}
            {busy && lines.length === 0 && (
              downloading ? (
                <ModelLoader
                  pct={pct}
                  title={`Whisper ${WHISPER_MODELS[tier].label} is waking up`}
                  sub={`${WHISPER_MODELS[tier].size} · downloads once, cached forever`}
                />
              ) : (
                <p style={{ fontSize: 13, color: "var(--text-muted)", padding: "40px 0", textAlign: "center" }}>{msg}</p>
              )
            )}
          </div>
        )}

        {busy && (
          <div style={{ position: "absolute", bottom: 0, left: 0, right: 0, background: "rgba(10,10,11,0.85)", backdropFilter: "blur(6px)", padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, borderTop: "0.5px solid var(--border)" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", animation: "pulse 1s ease-in-out infinite", flexShrink: 0 }} />
            <span style={{ fontSize: 13, color: "#fff", flex: 1 }}>{msg}</span>
            <div style={{ width: 140, height: 3, background: "rgba(255,255,255,0.1)", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)", transition: "width 0.3s" }} />
            </div>
          </div>
        )}

        {phase === "error" && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, minHeight: 320 }}>
            <p style={{ color: "#ef4444", fontSize: 14 }}>{errMsg}</p>
            <button onClick={start} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, cursor: "pointer" }}>Try again</button>
          </div>
        )}
      </div>

      {phase === "done" && lines.length > 0 && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => save(toSRT(lines), "srt")} style={primary}>↓ SRT <span style={sub}>· Premiere, Resolve, CapCut</span></button>
          <button onClick={() => save(toVTT(lines), "vtt")} style={secondary}>↓ VTT <span style={sub}>· web players</span></button>
          <button onClick={() => save(toTXT(lines), "txt")} style={secondary}>↓ TXT <span style={sub}>· plain transcript</span></button>
        </div>
      )}
    </div>
  );
}

function Dropzone({ onFile }: { onFile: (f: File) => void }) {
  const [drag, setDrag] = useState(false);
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      style={{
        display: "block", border: drag ? "0.5px solid var(--accent)" : "0.5px dashed var(--border-strong)",
        borderRadius: 16, background: drag ? "var(--accent-dim)" : "var(--surface)",
        padding: "64px 32px", textAlign: "center", cursor: "pointer", transition: "all 0.15s",
      }}
    >
      <input type="file" accept="audio/*,video/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      <div style={{ width: 56, height: 56, borderRadius: 14, background: "var(--surface-2)", border: "0.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", color: "var(--accent)" }}><CaptionsIcon size={26} /></div>
      <p style={{ fontSize: 17, fontWeight: 500, marginBottom: 8 }}>Drop a video or audio file</p>
      <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 20 }}>MP4, MOV, WebM · MP3, WAV, M4A</p>
      <span style={{ display: "inline-block", padding: "9px 22px", background: "var(--accent)", color: "#fff", borderRadius: 8, fontSize: 14, fontWeight: 500 }}>Choose file</span>
      <p className="mono" style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 24 }}>Processed locally · Nothing uploaded · SRT / VTT / TXT</p>
    </label>
  );
}

const ghost: React.CSSProperties = {
  fontSize: 13, color: "var(--text-muted)", background: "transparent",
  border: "0.5px solid var(--border)", borderRadius: 8, padding: "7px 14px", cursor: "pointer",
};
const primary: React.CSSProperties = {
  background: "var(--accent)", color: "#fff", border: "none", borderRadius: 10,
  padding: "11px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer",
};
const secondary: React.CSSProperties = {
  background: "var(--surface-2)", color: "var(--text)", border: "0.5px solid var(--border)",
  borderRadius: 10, padding: "11px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer",
};
const sub: React.CSSProperties = { fontSize: 11, color: "rgba(255,255,255,0.55)", fontWeight: 400 };
