"use client";

import { useEffect, useRef } from "react";

/**
 * Mirrored-bar waveform from a precomputed level envelope. The unplayed part
 * sits under a dimming veil whose left edge (the playhead) the parent moves
 * per frame through `veilRef` — no React render per frame. While a stem is
 * still being separated, bars past `filled` show as a faint baseline.
 */
export default function Waveform({
  levels,
  norm,
  color,
  height = 52,
  filled = 1,
  muted = false,
  veilRef,
  onSeek,
}: {
  /** may be mutated in place — the canvas redraws on every render */
  levels: Float32Array;
  /** level drawn at full height */
  norm: number;
  color: string;
  height?: number;
  filled?: number;
  muted?: boolean;
  veilRef?: (el: HTMLDivElement | null) => void;
  onSeek?: (frac: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const drawRef = useRef<() => void>(() => {});

  const draw = () => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const w = wrap.clientWidth;
    if (!w) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);

    const step = 3;
    const bars = Math.max(1, Math.floor(w / step));
    const mid = height / 2;
    const B = levels.length;
    for (let j = 0; j < bars; j++) {
      const x = j * step + (w - bars * step) / 2;
      if ((j + 0.5) / bars > filled) {
        ctx.fillStyle = "rgba(245,240,225,0.12)";
        ctx.fillRect(x, mid - 0.5, 2, 1);
        continue;
      }
      let p = 0;
      const b1 = Math.max(Math.floor((j * B) / bars) + 1, Math.floor(((j + 1) * B) / bars));
      for (let b = Math.floor((j * B) / bars); b < b1; b++) if (levels[b] > p) p = levels[b];
      const h = Math.max(1, Math.pow(Math.min(1, p / norm), 0.75) * (mid - 2));
      ctx.fillStyle = color;
      ctx.fillRect(x, mid - h, 2, h * 2);
    }
  };

  useEffect(() => {
    drawRef.current = draw;
    draw();
  });

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => drawRef.current());
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  const seekAt = (e: React.PointerEvent) => {
    const r = wrapRef.current!.getBoundingClientRect();
    onSeek?.(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)));
  };

  return (
    <div
      ref={wrapRef}
      onPointerDown={onSeek ? (e) => { e.currentTarget.setPointerCapture(e.pointerId); seekAt(e); } : undefined}
      onPointerMove={onSeek ? (e) => { if (e.buttons & 1) seekAt(e); } : undefined}
      style={{
        position: "relative", height, width: "100%", minWidth: 0,
        cursor: onSeek ? "pointer" : "default", touchAction: onSeek ? "none" : "auto",
        opacity: muted ? 0.28 : 1, filter: muted ? "grayscale(1)" : "none",
        transition: "opacity 0.25s var(--ease-lux), filter 0.25s var(--ease-lux)",
      }}
    >
      <canvas ref={canvasRef} aria-hidden style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      {veilRef && (
        <div
          ref={veilRef}
          aria-hidden
          style={{
            position: "absolute", top: 0, bottom: 0, left: 0, right: 0,
            background: "rgba(20,18,14,0.62)", borderLeft: "1px solid rgba(245,240,225,0.85)",
            pointerEvents: "none",
          }}
        />
      )}
      {filled < 1 && (
        <div
          aria-hidden
          style={{
            position: "absolute", top: 4, bottom: 4, left: `${filled * 100}%`, width: 2, marginLeft: -1,
            background: color, boxShadow: `0 0 12px 2px ${color}`, borderRadius: 2,
            animation: "pulse 1.2s ease-in-out infinite", transition: "left 0.6s var(--ease-lux)",
          }}
        />
      )}
    </div>
  );
}
