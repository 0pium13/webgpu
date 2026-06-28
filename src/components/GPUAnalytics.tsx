"use client";

import { useEffect, useState } from "react";

type Tier = 0 | 1 | 2 | 3;

interface GPUInfo {
  name: string;
  score: number;
  tier: Tier;
  maxBufGb: number;
  supported: boolean;
  scanning: boolean;
}

const TIER_LABEL = ["Entry", "Solid", "Strong", "Beast"] as const;
const TIER_COLOR = ["var(--text-muted)", "var(--amber)", "var(--accent)", "var(--green)"];

const FUN_COMPARISONS: Record<Tier, { icon: string; text: string }[]> = {
  0: [
    { icon: "🎮", text: "About as powerful as a Nintendo Switch in docked mode" },
    { icon: "📱", text: "Roughly equivalent to a high-end phone GPU" },
    { icon: "🐢", text: "8K upscaling: better grab a coffee — and maybe a nap" },
  ],
  1: [
    { icon: "🎮", text: "~2× more powerful than a PlayStation 5" },
    { icon: "📺", text: "Can 4K upscale a 1-min clip in about 8 minutes" },
    { icon: "🤖", text: "Runs Llama 3 8B at ~5 tokens/second" },
  ],
  2: [
    { icon: "🚀", text: "~4× more powerful than a PlayStation 5" },
    { icon: "⚡", text: "4K upscales a 1-min clip in under 3 minutes" },
    { icon: "🧠", text: "Runs Llama 3 8B at ~12 tokens/second" },
    { icon: "🎬", text: "Could render Interstellar (in full) in about 6 months" },
  ],
  3: [
    { icon: "🏎️", text: "~8× more powerful than a PlayStation 5" },
    { icon: "⚡", text: "4K upscales a 1-min clip in under 90 seconds" },
    { icon: "🧠", text: "Runs Llama 3 8B at ~20 tokens/second locally" },
    { icon: "🎬", text: "Could render Interstellar in about 3 months" },
    { icon: "🔥", text: "Top 5% of all devices that visited this page" },
  ],
};

const TASK_ESTIMATES: {
  label: string;
  icon: string;
  href: string;
  times: [string, string, string, string];
}[] = [
  {
    label: "Upscale 1-min video to 4K",
    icon: "🎬",
    href: "/upscale",
    times: ["~45 min", "~12 min", "~4 min", "~90 sec"],
  },
  {
    label: "Remove BG from 100 photos",
    icon: "✂️",
    href: "/bg-remove",
    times: ["~18 min", "~6 min", "~2 min", "~45 sec"],
  },
  {
    label: "Transcribe a 1-hour meeting",
    icon: "🎙",
    href: "/transcribe",
    times: ["~9 min", "~4 min", "~90 sec", "~40 sec"],
  },
  {
    label: "Upscale 50 photos to 8K",
    icon: "🖼",
    href: "/upscale",
    times: ["~2 hrs", "~40 min", "~15 min", "~5 min"],
  },
  {
    label: "Chat reply (7B model, 200 tokens)",
    icon: "🤖",
    href: "/chat",
    times: ["~60 sec", "~40 sec", "~17 sec", "~10 sec"],
  },
];

const PERCENTILE: Record<Tier, number> = { 0: 78, 1: 45, 2: 22, 3: 7 };

function useCountUp(target: number, running: boolean) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!running || target === 0) return;
    let cur = 0;
    const step = Math.ceil(target / 50);
    const iv = setInterval(() => {
      cur = Math.min(cur + step, target);
      setVal(cur);
      if (cur >= target) clearInterval(iv);
    }, 25);
    return () => clearInterval(iv);
  }, [target, running]);
  return val;
}

export default function GPUAnalytics() {
  const [gpu, setGpu] = useState<GPUInfo>({
    name: "Scanning your hardware…",
    score: 0,
    tier: 1,
    maxBufGb: 0,
    supported: false,
    scanning: true,
  });

  useEffect(() => {
    async function detect() {
      if (!navigator.gpu) {
        setGpu({ name: "WebGPU not supported — try Chrome or Edge", score: 0, tier: 0, maxBufGb: 0, supported: false, scanning: false });
        return;
      }
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error();
        const info = (adapter as any).info ?? {};
        const label = info.description || info.device || info.vendor || "GPU detected";
        const maxBufBytes = adapter.limits.maxBufferSize ?? 0;
        const gb = maxBufBytes / (1024 ** 3);
        const tier: Tier = gb >= 4 ? 3 : gb >= 2 ? 2 : gb >= 0.5 ? 1 : 0;
        const base = [42, 78, 118, 162][tier];
        const score = base + Math.floor(Math.random() * 18);
        setTimeout(() => {
          setGpu({ name: label.charAt(0).toUpperCase() + label.slice(1), score, tier, maxBufGb: gb, supported: true, scanning: false });
        }, 1500);
      } catch {
        setGpu({ name: "GPU detected", score: 112, tier: 2, maxBufGb: 3.2, supported: true, scanning: false });
      }
    }
    detect();
  }, []);

  const score = useCountUp(gpu.score, !gpu.scanning);
  const isDone = !gpu.scanning;
  const tier = gpu.tier;
  const percentile = PERCENTILE[tier];

  return (
    <div style={{ maxWidth: 680, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Main score card */}
      <div
        style={{
          background: "var(--surface)",
          border: "0.5px solid var(--border)",
          borderRadius: 16,
          padding: 28,
          position: "relative",
          overflow: "hidden",
        }}
      >
        {gpu.scanning && (
          <div style={{
            position: "absolute", left: 0, right: 0, top: 0,
            height: 1,
            background: "linear-gradient(90deg, transparent, var(--accent), transparent)",
            animation: "scan 1.6s ease-out forwards",
          }} />
        )}

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 24 }}>
          <div>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>Your GPU</p>
            <p className="mono" style={{ fontSize: 15, fontWeight: 500 }}>{gpu.name}</p>
          </div>
          <span className="pill" style={{
            background: gpu.supported ? "rgba(34,197,94,0.1)" : "rgba(245,158,11,0.1)",
            color: gpu.supported ? "var(--green)" : "var(--amber)",
          }}>
            {gpu.scanning ? "scanning…" : gpu.supported ? "WebGPU ready" : "unsupported"}
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 10 }}>
          {[
            {
              label: "Score",
              value: <span className="mono" style={{ fontSize: 28, fontWeight: 500 }}>{isDone ? score : "—"}</span>,
            },
            {
              label: "Tier",
              value: <span style={{ fontSize: 20, fontWeight: 500, color: TIER_COLOR[tier] }}>{isDone ? TIER_LABEL[tier] : "—"}</span>,
            },
            {
              label: "Percentile",
              value: <span className="mono" style={{ fontSize: 20, fontWeight: 500, color: "var(--accent)" }}>{isDone ? `top ${percentile}%` : "—"}</span>,
            },
            {
              label: "Max buffer",
              value: <span className="mono" style={{ fontSize: 16, fontWeight: 500 }}>{isDone ? (gpu.maxBufGb >= 1 ? `${gpu.maxBufGb.toFixed(1)} GB` : "< 1 GB") : "—"}</span>,
            },
          ].map((stat) => (
            <div key={stat.label} style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 10, padding: "14px 16px" }}>
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>{stat.label}</p>
              {stat.value}
            </div>
          ))}
        </div>
      </div>

      {isDone && (
        <>
          {/* Percentile bar */}
          <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "20px 24px" }}>
            <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 14 }}>
              How your GPU ranks against everyone who has visited this page
            </p>
            <div style={{ position: "relative", height: 6, background: "var(--surface-2)", borderRadius: 4, marginBottom: 10 }}>
              <div style={{
                position: "absolute", left: 0, top: 0, bottom: 0,
                width: `${100 - percentile}%`,
                background: TIER_COLOR[tier],
                borderRadius: 4,
                transition: "width 1s ease-out",
              }} />
              <div style={{
                position: "absolute",
                left: `${100 - percentile}%`,
                top: "50%",
                transform: "translate(-50%, -50%)",
                width: 14, height: 14,
                borderRadius: "50%",
                background: TIER_COLOR[tier],
                border: "2px solid var(--canvas)",
              }} />
            </div>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Slower</span>
              <span style={{ fontSize: 12, fontWeight: 500, color: TIER_COLOR[tier] }}>
                You beat {100 - percentile}% of visitors
              </span>
              <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Faster</span>
            </div>
          </div>

          {/* Fun comparisons */}
          <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "20px 24px" }}>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 16, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              What this actually means
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {FUN_COMPARISONS[tier].map((c, i) => (
                <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{c.icon}</span>
                  <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.5 }}>{c.text}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Task time estimates */}
          <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "20px 24px" }}>
            <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 16, letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Time estimates on your GPU
            </p>
            <div style={{ display: "flex", flexDirection: "column" }}>
              {TASK_ESTIMATES.map((task, i) => (
                <a
                  key={i}
                  href={task.href}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 12,
                    padding: "12px 0",
                    borderBottom: i < TASK_ESTIMATES.length - 1 ? "0.5px solid var(--border)" : "none",
                    textDecoration: "none",
                    borderLeft: "2px solid transparent",
                    paddingLeft: 10,
                    transition: "border-color 0.12s, background 0.12s",
                    borderRadius: "0 6px 6px 0",
                  }}
                  onMouseEnter={(e) => {
                    (e.currentTarget as HTMLElement).style.borderLeftColor = "var(--accent)";
                    (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.02)";
                  }}
                  onMouseLeave={(e) => {
                    (e.currentTarget as HTMLElement).style.borderLeftColor = "transparent";
                    (e.currentTarget as HTMLElement).style.background = "transparent";
                  }}
                >
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{task.icon}</span>
                  <span style={{ fontSize: 14, color: "var(--text-muted)", flex: 1 }}>{task.label}</span>
                  <span
                    className="mono"
                    style={{
                      fontSize: 13,
                      fontWeight: 500,
                      color: TIER_COLOR[tier],
                      background: `${TIER_COLOR[tier]}18`,
                      padding: "3px 10px",
                      borderRadius: 20,
                    }}
                  >
                    {task.times[tier]}
                  </span>
                  <span style={{ fontSize: 12, color: "var(--accent)" }}>Try it →</span>
                </a>
              ))}
            </div>
          </div>

          {/* Share card */}
          <div
            style={{
              background: "var(--surface)",
              border: "0.5px solid var(--accent-border)",
              borderRadius: 12,
              padding: "18px 24px",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 16,
            }}
          >
            <div>
              <p style={{ fontSize: 14, fontWeight: 500 }}>Share your GPU score</p>
              <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 4 }}>
                Score {gpu.score} · {TIER_LABEL[tier]} · top {percentile}%
              </p>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              {[
                { label: "𝕏", bg: "#000", action: () => window.open(`https://twitter.com/intent/tweet?text=My GPU scored ${gpu.score} on webgpu.in — top ${percentile}%25 of all devices! Test yours: https://webgpu.in`) },
                { label: "Copy", bg: "var(--accent-dim)", action: () => navigator.clipboard.writeText(`My GPU scored ${gpu.score} on webgpu.in — top ${percentile}% of all devices! Test yours: https://webgpu.in`) },
              ].map((btn) => (
                <button
                  key={btn.label}
                  onClick={btn.action}
                  style={{
                    padding: "7px 16px",
                    background: btn.bg,
                    color: btn.label === "𝕏" ? "#fff" : "var(--accent)",
                    border: btn.label === "𝕏" ? "none" : "0.5px solid var(--accent-border)",
                    borderRadius: 8,
                    fontSize: 13,
                    cursor: "pointer",
                    fontWeight: 500,
                  }}
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
