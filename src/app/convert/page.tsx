"use client";

/**
 * File converter — ffmpeg.wasm, fully local.
 *
 * The web is full of "free online converter" sites that upload your file to
 * someone's server, wrap it in ads and sell the traffic. This is the same
 * conversion, in your browser, with nothing leaving the machine.
 */

import { useRef, useState } from "react";
import Nav from "@/components/Nav";
import ModelLoader from "@/components/ModelLoader";
import { ConvertIcon } from "@/components/Icons";
import { getFFmpeg, setFFmpegCallbacks, fileToUint8 } from "@/lib/ffmpeg";

type Phase = "idle" | "working" | "done" | "error";

interface Preset {
  id: string;
  name: string;
  desc: string;
  ext: string;
  mime: string;
  accepts: (f: File) => boolean;
  args: (inName: string, outName: string) => string[];
}

const PRESETS: Preset[] = [
  {
    id: "mp3", name: "To MP3", desc: "Pull the audio out of any video, or convert any audio file.",
    ext: "mp3", mime: "audio/mpeg",
    accepts: () => true,
    args: (i, o) => ["-i", i, "-vn", "-c:a", "libmp3lame", "-b:a", "192k", o],
  },
  {
    id: "wav", name: "To WAV", desc: "Uncompressed audio for editing or sampling.",
    ext: "wav", mime: "audio/wav",
    accepts: () => true,
    args: (i, o) => ["-i", i, "-vn", "-c:a", "pcm_s16le", o],
  },
  {
    id: "gif", name: "To GIF", desc: "Proper palette-optimized GIF. Best for clips under ~15s.",
    ext: "gif", mime: "image/gif",
    accepts: (f) => f.type.startsWith("video/"),
    args: (i, o) => ["-i", i,
      "-vf", "fps=12,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse",
      "-f", "gif", o],
  },
  {
    id: "mp4", name: "To MP4", desc: "The format that plays everywhere. WebM, MOV, MKV in — MP4 out.",
    ext: "mp4", mime: "video/mp4",
    accepts: (f) => f.type.startsWith("video/"),
    args: (i, o) => ["-i", i, "-c:v", "libx264", "-crf", "20", "-preset", "veryfast",
      "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "160k", o],
  },
  {
    id: "compress", name: "Compress video", desc: "Shrink for WhatsApp / email — usually 3–5× smaller.",
    ext: "mp4", mime: "video/mp4",
    accepts: (f) => f.type.startsWith("video/"),
    args: (i, o) => ["-i", i, "-c:v", "libx264", "-crf", "28", "-preset", "veryfast",
      "-vf", "scale='min(1280,iw)':-2", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "112k", o],
  },
];

function fmtSize(b: number) {
  if (b > 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(b / 1e3))} KB`;
}

export default function ConvertPage() {
  const [file, setFile] = useState<File | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [active, setActive] = useState<Preset | null>(null);
  const [pct, setPct] = useState(0);
  const [logLine, setLogLine] = useState("");
  const [errMsg, setErrMsg] = useState("");
  const [result, setResult] = useState<{ url: string; name: string; size: number } | null>(null);
  const [engineLoading, setEngineLoading] = useState(false);
  const runId = useRef(0);

  function handleFile(f: File) {
    if (!f.type.startsWith("video/") && !f.type.startsWith("audio/"))
      return alert("Please choose a video or audio file.");
    if (result) URL.revokeObjectURL(result.url);
    setFile(f); setResult(null); setPhase("idle"); setActive(null);
  }

  async function run(preset: Preset) {
    if (!file || phase === "working") return;
    const id = ++runId.current;
    try {
      setPhase("working"); setActive(preset); setPct(0);
      setLogLine("Loading ffmpeg… (~30MB, once)");
      if (result) { URL.revokeObjectURL(result.url); setResult(null); }

      setEngineLoading(true);
      const ff = await getFFmpeg();
      setEngineLoading(false);
      setFFmpegCallbacks(
        (m) => { if (runId.current === id && m && !m.startsWith("frame=")) setLogLine(m.slice(0, 120)); },
        (p) => { if (runId.current === id) setPct(Math.min(99, Math.round(p * 100))); }
      );

      const inName = `in.${file.name.split(".").pop() || "bin"}`;
      const outName = `out.${preset.ext}`;
      await ff.writeFile(inName, await fileToUint8(file));
      await ff.exec(preset.args(inName, outName));
      const data = await ff.readFile(outName);
      if (!data?.byteLength) throw new Error("Conversion produced no output — try a different format.");

      const blob = new Blob([data as BlobPart], { type: preset.mime });
      setResult({
        url: URL.createObjectURL(blob),
        name: `${file.name.replace(/\.[^.]+$/, "")}.${preset.ext}`,
        size: blob.size,
      });
      setPct(100);
      setPhase("done");
    } catch (e: any) {
      console.error(e);
      setErrMsg(e?.message ?? "Conversion failed");
      setPhase("error");
    } finally {
      setEngineLoading(false);
      setFFmpegCallbacks(null, null);
    }
  }

  const busy = phase === "working";

  return (
    <div style={{ minHeight: "100vh" }}>
      <Nav />
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "100px 24px 80px" }}>
        <div style={{ marginBottom: 36 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.15em", color: "var(--accent)", textTransform: "uppercase" }}>
            webgpu.in / convert
          </span>
          <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 500, letterSpacing: "-0.03em", marginTop: 12, marginBottom: 10 }}>
            File Converter
          </h1>
          <p style={{ fontSize: 16, color: "var(--text-muted)", maxWidth: 560, lineHeight: 1.6 }}>
            MP4, MP3, WAV, GIF, compress — the stuff those ad-riddled
            &quot;free converter&quot; sites do after uploading your file to
            their servers. Same result here, except your file never leaves
            your machine.
          </p>
        </div>

        {!file ? (
          <Dropzone onFile={handleFile} />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                {file.name} <span className="mono" style={{ color: "var(--text-dim)" }}>· {fmtSize(file.size)}</span>
              </p>
              {!busy && (
                <button onClick={() => { if (result) URL.revokeObjectURL(result.url); setFile(null); setResult(null); setActive(null); setPhase("idle"); }} style={ghost}>
                  ← New file
                </button>
              )}
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 10 }}>
              {PRESETS.filter((p) => p.accepts(file)).map((p) => {
                const isActive = active?.id === p.id;
                return (
                  <button key={p.id} onClick={() => run(p)} disabled={busy} style={{
                    textAlign: "left", background: isActive ? "var(--accent-dim)" : "var(--surface)",
                    border: isActive ? "0.5px solid var(--accent)" : "0.5px solid var(--border)",
                    borderRadius: 14, padding: "16px 18px", cursor: busy ? "default" : "pointer",
                    opacity: busy && !isActive ? 0.45 : 1, transition: "all 0.15s",
                  }}>
                    <span style={{ display: "block", fontSize: 14.5, fontWeight: 500, color: isActive ? "var(--accent)" : "var(--text)", marginBottom: 5 }}>{p.name}</span>
                    <span style={{ display: "block", fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.45 }}>{p.desc}</span>
                  </button>
                );
              })}
            </div>

            {busy && engineLoading && (
              <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, overflow: "hidden" }}>
                <ModelLoader pct={-1} title="The converter is waking up" sub="~31MB · downloads once, cached forever" />
              </div>
            )}
            {busy && !engineLoading && (
              <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "14px 18px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 10 }}>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", animation: "pulse 1s ease-in-out infinite", flexShrink: 0 }} />
                  <span style={{ fontSize: 13, color: "var(--text)" }}>{active?.name}… {pct}%</span>
                </div>
                <div style={{ height: 4, background: "rgba(255,255,255,0.07)", borderRadius: 4, overflow: "hidden", marginBottom: 8 }}>
                  <div style={{ height: "100%", width: `${pct}%`, background: "var(--accent)", transition: "width 0.3s" }} />
                </div>
                <p className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{logLine}</p>
              </div>
            )}

            {phase === "error" && <p style={{ color: "#ef4444", fontSize: 13 }}>{errMsg}</p>}

            {phase === "done" && result && (
              <div style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--surface)", border: "0.5px solid var(--accent)", borderRadius: 12, padding: "14px 18px", flexWrap: "wrap" }}>
                <p style={{ fontSize: 13.5, flex: 1, minWidth: 200 }}>
                  {result.name} <span className="mono" style={{ color: "var(--text-dim)" }}>· {fmtSize(result.size)}</span>
                  {active?.id === "compress" && file.size > result.size && (
                    <span style={{ color: "var(--green)" }}> · {(file.size / result.size).toFixed(1)}× smaller</span>
                  )}
                </p>
                <a href={result.url} download={result.name} style={{ ...primaryLink }}>↓ Download</a>
              </div>
            )}
          </div>
        )}
      </div>
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
      <input type="file" accept="video/*,audio/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      <div style={{ width: 56, height: 56, borderRadius: 14, background: "var(--surface-2)", border: "0.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", color: "var(--accent)" }}><ConvertIcon size={26} /></div>
      <p style={{ fontSize: 17, fontWeight: 500, marginBottom: 8 }}>Drop a video or audio file</p>
      <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 20 }}>MP4, MOV, WebM, MKV · MP3, WAV, M4A, FLAC</p>
      <span style={{ display: "inline-block", padding: "9px 22px", background: "var(--accent)", color: "#fff", borderRadius: 8, fontSize: 14, fontWeight: 500 }}>Choose file</span>
      <p className="mono" style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 24 }}>Processed locally · Nothing uploaded · No ads, no watermark, no limit</p>
    </label>
  );
}

const ghost: React.CSSProperties = {
  fontSize: 13, color: "var(--text-muted)", background: "transparent",
  border: "0.5px solid var(--border)", borderRadius: 8, padding: "7px 14px", cursor: "pointer",
};
const primaryLink: React.CSSProperties = {
  background: "var(--accent)", color: "#fff", borderRadius: 10,
  padding: "10px 20px", fontSize: 14, fontWeight: 500, textDecoration: "none",
};
