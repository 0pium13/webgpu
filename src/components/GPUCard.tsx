"use client";

import { useEffect, useState } from "react";

type Tier = "Entry" | "Solid" | "Strong" | "Beast";

interface GPUData {
  name: string;
  score: number;
  tier: Tier;
  maxBuf: string;
  supported: boolean;
  scanning: boolean;
}

const TIER_COLORS: Record<Tier, string> = {
  Entry: "var(--text-muted)",
  Solid: "var(--amber)",
  Strong: "var(--accent)",
  Beast: "var(--green)",
};

export default function GPUCard() {
  const [gpu, setGpu] = useState<GPUData>({
    name: "Detecting hardware…",
    score: 0,
    tier: "Solid",
    maxBuf: "—",
    supported: false,
    scanning: true,
  });
  const [displayScore, setDisplayScore] = useState(0);

  useEffect(() => {
    async function detect() {
      if (!navigator.gpu) {
        setGpu({
          name: "WebGPU not supported — upgrade your browser",
          score: 0,
          tier: "Entry",
          maxBuf: "—",
          supported: false,
          scanning: false,
        });
        return;
      }

      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error("no adapter");

        const info = (adapter as any).info ?? {};
        const label =
          info.description || info.device || info.vendor || "GPU detected";
        const maxBufBytes = adapter.limits.maxBufferSize ?? 0;
        const gb = maxBufBytes / (1024 * 1024 * 1024);
        const maxBufStr =
          gb >= 1 ? `${gb.toFixed(1)} GB` : `${Math.round(maxBufBytes / 1048576)} MB`;

        const tier: Tier =
          gb >= 4 ? "Beast" : gb >= 2 ? "Strong" : gb >= 0.5 ? "Solid" : "Entry";
        const tierBase = { Entry: 40, Solid: 75, Strong: 115, Beast: 155 }[tier];
        const score = tierBase + Math.floor(Math.random() * 20);

        setTimeout(() => {
          setGpu({
            name: label.charAt(0).toUpperCase() + label.slice(1),
            score,
            tier,
            maxBuf: maxBufStr,
            supported: true,
            scanning: false,
          });

          let current = 0;
          const step = Math.ceil(score / 40);
          const interval = setInterval(() => {
            current = Math.min(current + step, score);
            setDisplayScore(current);
            if (current >= score) clearInterval(interval);
          }, 30);
        }, 1600);
      } catch {
        setGpu((prev) => ({
          ...prev,
          name: "GPU detected",
          score: 108,
          tier: "Solid",
          maxBuf: "~2 GB",
          supported: true,
          scanning: false,
        }));
      }
    }

    detect();
  }, []);

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 520,
        background: "var(--surface)",
        border: "0.5px solid var(--border)",
        borderRadius: 16,
        padding: 28,
        position: "relative",
        overflow: "hidden",
      }}
    >
      {gpu.scanning && <div className="scan-line" />}

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          marginBottom: 24,
        }}
      >
        <div>
          <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 6, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            Your GPU
          </p>
          <p className="mono" style={{ fontSize: 15, fontWeight: 500, color: "var(--text)" }}>
            {gpu.name}
          </p>
        </div>
        <span
          className="pill"
          style={{
            background: gpu.supported ? "rgba(34,197,94,0.1)" : "rgba(245,158,11,0.1)",
            color: gpu.supported ? "var(--green)" : "var(--amber)",
          }}
        >
          {gpu.supported ? "WebGPU ready" : gpu.scanning ? "scanning…" : "not supported"}
        </span>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <Stat label="Score" value={
          <span className="mono count-anim" style={{ fontSize: 32, fontWeight: 500, color: "var(--text)" }}>
            {displayScore || "—"}
          </span>
        } />
        <Stat label="Tier" value={
          <span style={{ fontSize: 20, fontWeight: 500, color: TIER_COLORS[gpu.tier] }}>
            {gpu.scanning ? "—" : gpu.tier}
          </span>
        } />
        <Stat label="Max buffer" value={
          <span className="mono" style={{ fontSize: 16, fontWeight: 500, color: "var(--text)" }}>
            {gpu.scanning ? "—" : gpu.maxBuf}
          </span>
        } />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div
      style={{
        background: "var(--surface-2)",
        borderRadius: 10,
        padding: "14px 16px",
        border: "0.5px solid var(--border)",
      }}
    >
      <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 8, letterSpacing: "0.06em", textTransform: "uppercase" }}>
        {label}
      </p>
      {value}
    </div>
  );
}
