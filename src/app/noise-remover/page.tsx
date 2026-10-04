"use client";

/**
 * Background noise remover — DeepFilterNet3 on the device's CPU (wasm).
 * Built for phone recordings: fan, AC, traffic, hiss, hum. Audio or video in,
 * clean WAV or the same video with clean audio out. Nothing is uploaded.
 */

import { useEffect, useState } from "react";
import Nav from "@/components/Nav";
import Dropzone from "@/components/Dropzone";
import DenoiseIcon from "@/components/denoise/DenoiseIcon";
import NoiseStudio from "@/components/denoise/NoiseStudio";

export default function NoiseRemoverPage() {
  const [input, setInput] = useState<{ file: File; url: string; key: number } | null>(null);
  // revoke only after the studio (and its <video>) has unmounted, or the element errors on a dead blob
  const url = input?.url;
  useEffect(() => () => { if (url) URL.revokeObjectURL(url); }, [url]);

  function handleFiles(fs: File[]) {
    const f = fs[0];
    if (!f) return;
    const ok = f.type.startsWith("audio/") || f.type.startsWith("video/") || /\.(mp3|wav|m4a|aac|ogg|opus|flac|mp4|mov|webm|mkv|m4v|3gp)$/i.test(f.name);
    if (!ok) return alert("Please choose an audio or video file.");
    // fresh key per pick so choosing the same file again restarts cleanly
    setInput({ file: f, url: URL.createObjectURL(f), key: (input?.key ?? 0) + 1 });
  }

  const reset = () => setInput(null);

  return (
    <div style={{ minHeight: "100vh" }}>
      <Nav />
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "100px 24px 80px" }}>
        <div style={{ marginBottom: 36 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.15em", color: "var(--accent)", textTransform: "uppercase" }}>
            webgpu.in / noise-remover
          </span>
          <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 500, letterSpacing: "-0.03em", marginTop: 12, marginBottom: 10 }}>
            Background Noise Remover
          </h1>
          <p style={{ fontSize: 16, color: "var(--text-muted)", maxWidth: 560, lineHeight: 1.6 }}>
            Ceiling fan, AC hum, traffic, hiss — gone from your voice. Drop a
            recording or a video; the AI cleans it right here on your phone or
            laptop and hands back a clean WAV or the same video with clean
            audio. <span style={{ color: "var(--text)" }}>Nothing is uploaded.</span>
          </p>
        </div>

        {!input ? (
          <Dropzone
            onFiles={handleFiles}
            accept="audio/*,video/*"
            icon={<DenoiseIcon size={26} />}
            title="Drop a voice recording or video"
            subtitle="MP3, WAV, M4A · MP4, MOV, WebM · up to 30 min"
            footnote="Processed locally · Nothing uploaded · Before/after preview"
          />
        ) : (
          <NoiseStudio key={input.key} file={input.file} url={input.url} onReset={reset} />
        )}
      </div>
    </div>
  );
}
