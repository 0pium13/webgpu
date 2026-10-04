"use client";

import { useState } from "react";
import Nav from "@/components/Nav";
import Dropzone from "@/components/Dropzone";
import StemStudio from "@/components/stems/StemStudio";
import StemsIcon from "@/components/stems/StemsIcon";
import { useGPU, TIER_COLOR } from "@/lib/useGPU";
import { MODEL_SIZE } from "@/lib/stems";

const MEDIA_EXT = /\.(mp3|wav|m4a|aac|flac|ogg|oga|opus|wma|aiff?|mp4|m4v|mov|webm|mkv|avi|3gp)$/i;

export default function VocalRemoverPage() {
  const [file, setFile] = useState<File | null>(null);
  const gpu = useGPU();

  function handleFiles(files: File[]) {
    const f = files[0];
    if (!f) return;
    if (!/^(audio|video)\//.test(f.type) && !MEDIA_EXT.test(f.name))
      return alert("Please choose a song or a video file.");
    setFile(f);
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <Nav />
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "100px 24px 80px" }}>
        <div style={{ marginBottom: 36 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.15em", color: "var(--accent)", textTransform: "uppercase" }}>
            webgpu.in / vocal remover
          </span>
          <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 500, letterSpacing: "-0.03em", marginTop: 12, marginBottom: 10 }}>
            Vocal Remover &amp; Stem Splitter
          </h1>
          <p style={{ fontSize: 16, color: "var(--text-muted)", maxWidth: 580, lineHeight: 1.6 }}>
            Turn any song into a karaoke track, or split it into vocals, drums, bass
            and the rest. Meta&apos;s HTDemucs runs on your GPU —
            <span style={{ color: "var(--text)" }}> studio-grade separation, no upload, no watermark.</span>{" "}
            Gaane se awaaz hatao for covers, reels and riyaz.
          </p>
        </div>

        {!file && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "14px 18px", marginBottom: 20 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: gpu.scanning ? "var(--text-dim)" : gpu.supported ? TIER_COLOR[gpu.tier] : "var(--amber)", flexShrink: 0 }} />
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {gpu.scanning ? "Detecting your GPU…" : (
                <>Separates on <span className="mono" style={{ color: "var(--text)" }}>{gpu.supported ? "your GPU (WebGPU)" : "CPU (slower)"}</span> · {MODEL_SIZE} model downloads once, cached after</>
              )}
            </p>
          </div>
        )}

        {file ? (
          <StemStudio key={`${file.name}:${file.size}:${file.lastModified}`} file={file} gpuOk={gpu.scanning || gpu.supported} onReset={() => setFile(null)} />
        ) : (
          <Dropzone
            onFiles={handleFiles}
            accept="audio/*,video/*"
            icon={<StemsIcon size={26} />}
            title="Drop a song or a video"
            subtitle="MP3, WAV, M4A, FLAC · MP4, MOV, WebM"
            footnote="Processed locally · Nothing uploaded · WAV + ZIP export"
          />
        )}
      </div>
    </div>
  );
}
