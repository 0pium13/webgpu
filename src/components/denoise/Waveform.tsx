"use client";

/**
 * Level-over-time view on a dB scale (−54…0 dBFS), so the noise floor that a
 * linear waveform would hide is visible — and you can watch it collapse. The
 * original sits behind as a soft silhouette; the cleaned mix (at the chosen
 * strength) is drawn over it in the accent, sweeping in while processing.
 */
import { useEffect, useRef } from "react";
import type { Meter } from "@/lib/denoise";
import type { ABPlayer, ABMode } from "./abPlayer";

const FLOOR_DB = -54;

export default function Waveform({
  meter, lim, mode, processing, totalSamples, player, height = 128,
}: {
  meter: Meter;
  /** Bump to repaint after the meter gains new cleaned audio (it mutates in place). */
  version: number;
  lim: number;
  mode: ABMode;
  processing: boolean;
  totalSamples: number;
  player: ABPlayer | null;
  height?: number;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const head = useRef<HTMLDivElement>(null);
  const opts = useRef<PaintOpts | null>(null);

  // repaint after every render (props only change on real updates) and on resize
  useEffect(() => {
    opts.current = { meter, lim, mode, processing, totalSamples, height };
    if (canvas.current && wrap.current) paint(canvas.current, wrap.current, opts.current);
  });

  useEffect(() => {
    const w = wrap.current;
    if (!w) return;
    const ro = new ResizeObserver(() => {
      if (canvas.current && opts.current) paint(canvas.current, w, opts.current);
    });
    ro.observe(w);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!player) return;
    return player.subscribe((t) => {
      if (head.current) head.current.style.left = `${(t / player.duration) * 100}%`;
    });
  }, [player]);

  const seekFrom = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!player || !wrap.current) return;
    const r = wrap.current.getBoundingClientRect();
    player.seek(((e.clientX - r.left) / r.width) * player.duration);
  };

  return (
    <div
      ref={wrap}
      onPointerDown={(e) => { if (!player) return; e.currentTarget.setPointerCapture(e.pointerId); seekFrom(e); }}
      onPointerMove={(e) => { if (e.buttons && player) seekFrom(e); }}
      style={{ position: "relative", height, cursor: player ? "pointer" : "default", touchAction: player ? "none" : "auto" }}
      role={player ? "slider" : undefined}
      aria-label={player ? "Seek" : undefined}
      aria-valuemin={player ? 0 : undefined}
      aria-valuemax={player ? Math.round(player.duration) : undefined}
    >
      <canvas ref={canvas} style={{ width: "100%", height: "100%", display: "block" }} />
      {player && (
        <div ref={head} style={{
          position: "absolute", top: 0, bottom: 0, left: 0, width: 2, marginLeft: -1,
          background: "var(--text)", borderRadius: 2, boxShadow: "0 0 10px rgba(245,242,234,0.5)", pointerEvents: "none",
        }} />
      )}
    </div>
  );
}

type PaintOpts = { meter: Meter; lim: number; mode: ABMode; processing: boolean; totalSamples: number; height: number };

function paint(c: HTMLCanvasElement, w: HTMLDivElement, { meter, lim, mode, processing, totalSamples, height }: PaintOpts) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = Math.max(1, Math.round(w.clientWidth * dpr));
  const H = Math.round(height * dpr);
  if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
  const g = c.getContext("2d")!;
  g.clearRect(0, 0, W, H);
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue("--accent").trim() || "#e4c078";
  const text = css.getPropertyValue("--text").trim() || "#f5f2ea";

  const cols = Math.max(1, Math.round(W / (2 * dpr))); // one level column per 2 css px
  const colW = W / cols;
  const F = meter.frames;
  const cleanCols = Math.floor((meter.cleanedUntil / totalSamples) * cols);
  const mid = H / 2;
  const amp = (ms: number) => {
    const db = 10 * Math.log10(ms + 1e-12);
    return Math.max(0, Math.min(1, (db - FLOOR_DB) / -FLOOR_DB)) * (mid - 2 * dpr);
  };
  const shape = (upTo: number, levelLim: number | null) => {
    g.beginPath();
    g.moveTo(0, mid);
    for (let x = 0; x < upTo; x++) {
      const f0 = Math.floor((x * F) / cols), f1 = Math.max(f0 + 1, Math.floor(((x + 1) * F) / cols));
      const a = amp(meter.level(f0, Math.min(F, f1), levelLim));
      g.lineTo(x * colW, mid - a);
      g.lineTo((x + 1) * colW, mid - a);
    }
    for (let x = upTo - 1; x >= 0; x--) {
      const f0 = Math.floor((x * F) / cols), f1 = Math.max(f0 + 1, Math.floor(((x + 1) * F) / cols));
      const a = amp(meter.level(f0, Math.min(F, f1), levelLim));
      g.lineTo((x + 1) * colW, mid + a);
      g.lineTo(x * colW, mid + a);
    }
    g.closePath();
    g.fill();
  };

  g.fillStyle = text;
  g.globalAlpha = mode === "before" && !processing ? 0.42 : 0.13;
  shape(cols, null);
  if (cleanCols > 0) {
    g.fillStyle = accent;
    g.globalAlpha = mode === "before" && !processing ? 0.35 : 0.95;
    shape(cleanCols, lim);
  }
  g.globalAlpha = 1;
  if (processing && cleanCols < cols) {
    const x = cleanCols * colW;
    const grad = g.createLinearGradient(x - 40 * dpr, 0, x, 0);
    grad.addColorStop(0, "rgba(228,192,120,0)");
    grad.addColorStop(1, "rgba(228,192,120,0.28)");
    g.fillStyle = grad;
    g.fillRect(Math.max(0, x - 40 * dpr), 0, Math.min(40 * dpr, x), H);
    g.fillStyle = accent;
    g.fillRect(x, 0, Math.max(1, dpr), H);
  }
}
