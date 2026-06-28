"use client";

import { useEffect, useState } from "react";
import { generateReport, TIER_LABEL, TIER_COLOR, type Tier } from "./deviceReport";

export { TIER_LABEL, TIER_COLOR };
export type { Tier };

export interface GPUState {
  name: string;
  tier: Tier;
  score: number;
  supported: boolean;
  scanning: boolean;
}

/**
 * Lightweight hook for tool pages — delegates to the cached real benchmark
 * (deviceReport) so every page reports the SAME accurate tier.
 */
export function useGPU(): GPUState {
  const [state, setState] = useState<GPUState>({
    name: "Detecting…",
    tier: 1,
    score: 0,
    supported: false,
    scanning: true,
  });

  useEffect(() => {
    let mounted = true;
    generateReport().then((r) => {
      if (!mounted) return;
      setState({ name: r.gpu, tier: r.tier, score: r.score, supported: r.supported, scanning: false });
    });
    return () => { mounted = false; };
  }, []);

  return state;
}

const MP_PER_SEC: Record<Tier, number> = { 0: 0.8, 1: 1.6, 2: 3.2, 3: 5.5 };

export function estimateVideoUpscale(
  width: number,
  height: number,
  durationSec: number,
  fps: number,
  scale: number,
  tier: Tier
): number {
  const outMP = (width * scale) * (height * scale) / 1_000_000;
  const frames = Math.max(1, durationSec * fps);
  return Math.round((outMP * frames) / MP_PER_SEC[tier]);
}

export function formatDuration(sec: number): string {
  if (!isFinite(sec) || sec <= 0) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
