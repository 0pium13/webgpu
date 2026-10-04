"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Waveform from "./Waveform";
import { StemPlayer, encodeWavStereo, saveBlob } from "@/lib/stemsAudio";
import type { StemId } from "@/lib/stems";

export const STEM_UI: Record<StemId, { label: string; hint: string; color: string }> = {
  vocals: { label: "Vocals", hint: "Acapella — for covers & remixes", color: "#e4c078" },
  instrumental: { label: "Instrumental", hint: "Karaoke track — everything but the voice", color: "#7fc8a9" },
  drums: { label: "Drums", hint: "Kick, snare, cymbals", color: "#ec8f6a" },
  bass: { label: "Bass", hint: "Bass guitar & synth bass", color: "#a491f2" },
  other: { label: "Other", hint: "Guitars, keys, strings, pads", color: "#6db7dc" },
};

export type StemTrack = { id: StemId; buffer: AudioBuffer; levels: Float32Array };

export function fmtTime(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Lanes for each stem. While `live` the waveforms fill in as chunks arrive
 * and the transport is locked; once done it becomes a sample-locked mixer:
 * play/seek, mute/solo per stem, A/B against the original mix.
 */
export default function StemMixer({
  tracks,
  original,
  norm,
  filled,
  live,
  baseName,
}: {
  tracks: StemTrack[];
  original: AudioBuffer;
  norm: number;
  filled: number;
  live: boolean;
  baseName: string;
}) {
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState<Set<StemId>>(new Set());
  const [solo, setSolo] = useState<Set<StemId>>(new Set());
  const [ab, setAb] = useState<"stems" | "original">("stems");
  const playerRef = useRef<StemPlayer | null>(null);
  const veils = useRef<(HTMLDivElement | null)[]>([]);
  const timeRef = useRef<HTMLSpanElement>(null);

  // player exists only once separation is complete
  const ids = tracks.map((t) => t.id).join(",");
  useEffect(() => {
    if (live) return;
    const p = new StemPlayer([original, ...tracks.map((t) => t.buffer)]);
    p.onEnded = () => setPlaying(false);
    playerRef.current = p;
    return () => { p.dispose(); playerRef.current = null; setPlaying(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, original, ids]);

  const audible = (id: StemId) => (solo.size ? solo.has(id) : !muted.has(id));
  useEffect(() => {
    const p = playerRef.current;
    if (!p) return;
    p.setLevel(0, ab === "original" ? 1 : 0);
    tracks.forEach((t, i) => p.setLevel(i + 1, ab === "stems" && audible(t.id) ? 1 : 0));
  });

  // playhead: one rAF loop moves every lane's veil + the clock, no re-renders
  useEffect(() => {
    if (live) return;
    let raf = 0;
    const tick = () => {
      const p = playerRef.current;
      if (p) {
        const pct = p.duration ? (p.position() / p.duration) * 100 : 0;
        for (const v of veils.current) if (v) v.style.left = `${pct}%`;
        if (timeRef.current) timeRef.current.textContent = fmtTime(p.position());
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [live]);

  function toggle() {
    const p = playerRef.current;
    if (!p) return;
    if (p.playing) { p.pause(); setPlaying(false); }
    else { void p.play(); setPlaying(true); }
  }

  // space = play/pause, like every audio editor
  useEffect(() => {
    if (live) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const el = e.target as HTMLElement;
      if (el.closest("input, textarea, select, button, [contenteditable]")) return;
      e.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const seek = (frac: number) => playerRef.current?.seek(frac * original.duration);

  const flip = (set: Set<StemId>, id: StemId) => {
    const n = new Set(set);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  };

  const sizeMB = useMemo(() => (original.length * 4) / 1048576, [original]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {/* transport */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "4px 0 14px" }}>
        <button
          onClick={toggle}
          disabled={live}
          aria-label={playing ? "Pause" : "Play"}
          style={{
            width: 46, height: 46, borderRadius: "50%", border: "none", flexShrink: 0,
            background: live ? "var(--surface-2)" : "var(--accent)", color: live ? "var(--text-dim)" : "var(--on-accent)",
            display: "flex", alignItems: "center", justifyContent: "center", cursor: live ? "default" : "pointer",
            boxShadow: live ? "none" : "0 6px 24px -8px rgba(228,192,120,0.6)", transition: "all 0.3s var(--ease-lux)",
          }}
        >
          {playing ? (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><rect x="3" y="2" width="3.5" height="12" rx="1" fill="currentColor" /><rect x="9.5" y="2" width="3.5" height="12" rx="1" fill="currentColor" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden><path d="M4 2.5v11a.7.7 0 0 0 1.05.6l9-5.5a.7.7 0 0 0 0-1.2l-9-5.5A.7.7 0 0 0 4 2.5z" fill="currentColor" /></svg>
          )}
        </button>
        <p className="mono" style={{ fontSize: 13, color: "var(--text-muted)", fontVariantNumeric: "tabular-nums" }}>
          <span ref={timeRef} style={{ color: "var(--text)" }}>0:00</span> / {fmtTime(Math.round(original.duration))}
        </p>
        <div style={{ flex: 1 }} />
        <div role="group" aria-label="Compare with original" style={{ display: "inline-flex", background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 10, padding: 3 }}>
          {(["stems", "original"] as const).map((v) => (
            <button
              key={v}
              disabled={live}
              onClick={() => setAb(v)}
              aria-pressed={ab === v}
              style={{
                border: "none", borderRadius: 7, padding: "7px 11px", fontSize: 12.5, fontWeight: 500,
                cursor: live ? "default" : "pointer",
                background: ab === v ? "var(--accent-dim)" : "transparent",
                color: ab === v ? "var(--accent)" : "var(--text-muted)",
                transition: "background 0.2s, color 0.2s",
              }}
            >
              {v === "stems" ? "Stems" : "Original"}
            </button>
          ))}
        </div>
      </div>

      {tracks.map((t, i) => {
        const ui = STEM_UI[t.id];
        const on = ab === "stems" && audible(t.id);
        return (
          <div key={t.id} style={{ borderTop: "0.5px solid var(--border)", padding: "12px 0 10px", animation: "fadein 0.5s var(--ease-lux) both", animationDelay: `${i * 60}ms` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, minWidth: 0 }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: ui.color, boxShadow: `0 0 10px ${ui.color}66`, flexShrink: 0 }} />
              <div style={{ minWidth: 0, flex: 1 }}>
                <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text)", lineHeight: 1.2 }}>{ui.label}</p>
                <p style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{ui.hint}</p>
              </div>
              {!live && (
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <LaneBtn active={muted.has(t.id)} onClick={() => setMuted(flip(muted, t.id))} label={`Mute ${ui.label}`}>M</LaneBtn>
                  <LaneBtn active={solo.has(t.id)} onClick={() => setSolo(flip(solo, t.id))} label={`Solo ${ui.label}`} accent>S</LaneBtn>
                  <button
                    onClick={() => saveBlob(encodeWavStereo(t.buffer), `${baseName} - ${ui.label}.wav`)}
                    aria-label={`Download ${ui.label} WAV`}
                    style={{ ...laneBtn, width: "auto", padding: "0 10px", gap: 5, display: "inline-flex", alignItems: "center", color: "var(--text)" }}
                  >
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M6 1.5v6.5M3.2 5.5 6 8.2l2.8-2.7M2 10.5h8" /></svg>
                    <span style={{ fontSize: 11.5 }}>WAV</span>
                  </button>
                </div>
              )}
            </div>
            <Waveform
              levels={t.levels}
              norm={norm}
              color={ui.color}
              filled={live ? filled : 1}
              muted={!live && !on}
              veilRef={live ? undefined : (el) => { veils.current[i] = el; }}
              onSeek={live ? undefined : seek}
            />
          </div>
        );
      })}
      {!live && (
        <p className="mono" style={{ fontSize: 11, color: "var(--text-dim)", paddingTop: 6 }}>
          Click a waveform to seek · space plays · each WAV ≈ {sizeMB.toFixed(0)}MB (16-bit · 44.1kHz · stereo)
        </p>
      )}
    </div>
  );
}

const laneBtn: React.CSSProperties = {
  height: 30, width: 30, borderRadius: 8, border: "0.5px solid var(--border)", background: "var(--surface-2)",
  fontSize: 12, fontWeight: 600, cursor: "pointer", transition: "all 0.2s var(--ease-lux)",
};

function LaneBtn({ active, onClick, label, accent, children }: { active: boolean; onClick: () => void; label: string; accent?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className="mono"
      style={{
        ...laneBtn,
        background: active ? (accent ? "var(--accent)" : "var(--text-secondary)") : "var(--surface-2)",
        color: active ? "var(--on-accent)" : "var(--text-muted)",
        borderColor: active ? "transparent" : "var(--border)",
      }}
    >
      {children}
    </button>
  );
}
