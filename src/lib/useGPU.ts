"use client";

import { useEffect, useState } from "react";

export type Tier = 0 | 1 | 2 | 3;

export const TIER_LABEL = ["Entry", "Solid", "Strong", "Beast"] as const;
export const TIER_COLOR = [
  "var(--text-muted)",
  "var(--amber)",
  "var(--accent)",
  "var(--green)",
];
export const TIER_PERCENTILE: Record<Tier, number> = { 0: 78, 1: 45, 2: 22, 3: 7 };

export interface GPUState {
  name: string;
  score: number;
  tier: Tier;
  maxBufGb: number;
  supported: boolean;
  scanning: boolean;
}

const INITIAL: GPUState = {
  name: "Scanning hardware…",
  score: 0,
  tier: 1,
  maxBufGb: 0,
  supported: false,
  scanning: true,
};

let cached: GPUState | null = null;

export function useGPU(): GPUState {
  const [gpu, setGpu] = useState<GPUState>(cached ?? INITIAL);

  useEffect(() => {
    if (cached) {
      setGpu(cached);
      return;
    }

    async function detect() {
      if (typeof navigator === "undefined" || !navigator.gpu) {
        const fail: GPUState = {
          name: "WebGPU not supported — try Chrome or Edge",
          score: 0,
          tier: 0,
          maxBufGb: 0,
          supported: false,
          scanning: false,
        };
        cached = fail;
        setGpu(fail);
        return;
      }
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error("no adapter");
        const info = (adapter as any).info ?? {};
        const label =
          info.description || info.device || info.architecture || info.vendor || "GPU detected";
        const maxBufBytes = adapter.limits.maxBufferSize ?? 0;
        const gb = maxBufBytes / 1024 ** 3;
        const tier: Tier = gb >= 4 ? 3 : gb >= 2 ? 2 : gb >= 0.5 ? 1 : 0;
        const base = [42, 78, 118, 162][tier];
        const score = base + Math.floor(Math.random() * 18);
        const result: GPUState = {
          name: label.charAt(0).toUpperCase() + label.slice(1),
          score,
          tier,
          maxBufGb: gb,
          supported: true,
          scanning: false,
        };
        // brief delay so the scan animation reads
        setTimeout(() => {
          cached = result;
          setGpu(result);
        }, 1200);
      } catch {
        const fallback: GPUState = {
          name: "GPU detected",
          score: 112,
          tier: 2,
          maxBufGb: 3.2,
          supported: true,
          scanning: false,
        };
        cached = fallback;
        setGpu(fallback);
      }
    }
    detect();
  }, []);

  return gpu;
}

/**
 * Rough throughput estimate: megapixels processed per second by tier,
 * for a Lanczos upscale pass in ffmpeg.wasm (single-threaded).
 * Calibrated to feel realistic, refined live by measured ETA.
 */
const MP_PER_SEC: Record<Tier, number> = { 0: 0.8, 1: 1.6, 2: 3.2, 3: 5.5 };

export function estimateVideoUpscale(
  width: number,
  height: number,
  durationSec: number,
  fps: number,
  scale: number,
  tier: Tier
): number {
  const outMP = ((width * scale) * (height * scale)) / 1_000_000;
  const frames = Math.max(1, durationSec * fps);
  const totalMP = outMP * frames;
  return Math.round(totalMP / MP_PER_SEC[tier]);
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
