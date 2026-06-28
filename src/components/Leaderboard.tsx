"use client";

import { useGPU, TIER_LABEL, TIER_COLOR, type Tier } from "@/lib/useGPU";

// Representative effective-GFLOPS on the same scale as our compute benchmark.
const KNOWN: { gpu: string; score: number; tier: Tier }[] = [
  { gpu: "RTX 4090", score: 9200, tier: 3 },
  { gpu: "RTX 4080", score: 7100, tier: 3 },
  { gpu: "RTX 3080", score: 3800, tier: 3 },
  { gpu: "M3 Max", score: 3400, tier: 3 },
  { gpu: "RTX 4060", score: 2400, tier: 2 },
  { gpu: "RTX 3060", score: 1600, tier: 2 },
  { gpu: "M2 Pro", score: 1500, tier: 2 },
  { gpu: "Apple M2", score: 900, tier: 1 },
  { gpu: "Iris Xe", score: 360, tier: 1 },
  { gpu: "Intel UHD 620", score: 140, tier: 0 },
];

const DOT = ["var(--text-dim)", "var(--amber)", "var(--accent)", "var(--green)"];

export default function Leaderboard() {
  const gpu = useGPU();

  let rows = KNOWN.map((k) => ({ ...k, yours: false }));

  if (!gpu.scanning && gpu.score > 0) {
    // drop any known entry that matches the user's GPU, then insert the real one
    const short = gpu.name.replace(/Apple|NVIDIA|AMD|Intel|GeForce|Radeon/gi, "").trim();
    rows = rows.filter((r) => !gpu.name.includes(r.gpu) && !r.gpu.includes(short) || short.length < 3);
    rows.push({ gpu: gpu.name, score: gpu.score, tier: gpu.tier, yours: true });
    rows.sort((a, b) => b.score - a.score);
  }

  return (
    <section style={{ padding: "0 24px 80px", maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 24, marginBottom: 32 }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-muted)", textTransform: "uppercase" }}>
          leaderboard
        </span>
        <div style={{ flex: 1, height: "0.5px", background: "var(--border)" }} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Representative scores</span>
      </div>

      <p style={{ fontSize: 15, color: "var(--text-muted)", marginBottom: 28 }}>
        {gpu.scanning
          ? "Benchmarking your GPU to place it…"
          : "Your measured score, placed against common GPUs."}
      </p>

      <div style={{ display: "flex", flexDirection: "column" }}>
        {rows.map((e, i) => (
          <div
            key={i}
            style={{
              display: "flex", alignItems: "center", gap: 16, padding: "13px 16px",
              background: e.yours ? "rgba(99,102,241,0.06)" : "transparent",
              ...(e.yours
                ? { border: "0.5px solid var(--accent-border)", borderRadius: 8 }
                : { borderBottom: "0.5px solid var(--border)" }),
            }}
          >
            <span className="mono" style={{ fontSize: 12, color: "var(--text-dim)", width: 20, textAlign: "right" }}>{i + 1}</span>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: DOT[e.tier], flexShrink: 0 }} />
            <span style={{ flex: 1, fontSize: 14, color: e.yours ? "var(--text)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {e.gpu}
              {e.yours && <span className="mono" style={{ fontSize: 10, color: "var(--accent)", marginLeft: 10, letterSpacing: "0.08em" }}>YOU</span>}
            </span>
            <span className="mono" style={{ fontSize: 15, fontWeight: 500, color: e.yours ? "var(--text)" : "var(--text-secondary)" }}>
              {e.score.toLocaleString()}
            </span>
            <span className="pill pill-muted">{TIER_LABEL[e.tier]}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
