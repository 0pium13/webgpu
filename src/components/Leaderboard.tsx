"use client";

const ENTRIES = [
  { gpu: "RTX 4090",      score: 198, tier: "Beast",  yours: false },
  { gpu: "RTX 4070 Ti",   score: 171, tier: "Beast",  yours: false },
  { gpu: "M3 Max",        score: 163, tier: "Beast",  yours: false },
  { gpu: "RTX 3080",      score: 148, tier: "Strong", yours: false },
  { gpu: "RX 7900 XTX",   score: 144, tier: "Strong", yours: false },
  { gpu: "M2 Pro",        score: 131, tier: "Strong", yours: true  },
  { gpu: "RTX 3060",      score: 118, tier: "Solid",  yours: false },
  { gpu: "GTX 1080 Ti",   score: 89,  tier: "Solid",  yours: false },
];

const TIER_DOT: Record<string, string> = {
  Beast:  "var(--green)",
  Strong: "var(--accent)",
  Solid:  "var(--amber)",
  Entry:  "var(--text-dim)",
};

export default function Leaderboard() {
  return (
    <section style={{ padding: "0 24px 80px", maxWidth: 760, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 24, marginBottom: 32 }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-muted)", textTransform: "uppercase" }}>
          leaderboard
        </span>
        <div style={{ flex: 1, height: "0.5px", background: "var(--border)" }} />
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Updated weekly</span>
      </div>

      <p style={{ fontSize: 15, color: "var(--text-muted)", marginBottom: 28 }}>
        Top GPUs benchmarked this week — your result is highlighted.
      </p>

      <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
        {ENTRIES.map((e, i) => (
          <div
            key={i}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 16,
              padding: "13px 16px",
              background: e.yours ? "rgba(99,102,241,0.06)" : "transparent",
              border: e.yours ? "0.5px solid var(--accent-border)" : "0.5px solid transparent",
              borderBottom: "0.5px solid var(--border)",
              borderRadius: e.yours ? 8 : 0,
              marginBottom: e.yours ? 1 : 0,
              transition: "background 0.12s",
            }}
          >
            <span className="mono" style={{ fontSize: 12, color: "var(--text-dim)", width: 20, textAlign: "right" }}>
              {i + 1}
            </span>
            <span
              style={{
                width: 7, height: 7, borderRadius: "50%",
                background: TIER_DOT[e.tier],
                flexShrink: 0,
              }}
            />
            <span style={{ flex: 1, fontSize: 14, color: e.yours ? "var(--text)" : "var(--text-muted)" }}>
              {e.gpu}
              {e.yours && (
                <span className="mono" style={{ fontSize: 10, color: "var(--accent)", marginLeft: 10, letterSpacing: "0.08em" }}>
                  YOU
                </span>
              )}
            </span>
            <span className="mono" style={{ fontSize: 15, fontWeight: 500, color: "var(--text)" }}>
              {e.score}
            </span>
            <span className="pill pill-muted">{e.tier}</span>
          </div>
        ))}
      </div>

      <button
        style={{
          marginTop: 20,
          fontSize: 13,
          color: "var(--accent)",
          background: "transparent",
          border: "0.5px solid var(--accent-border)",
          borderRadius: 20,
          padding: "7px 18px",
          cursor: "pointer",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-dim)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
      >
        View full leaderboard →
      </button>
    </section>
  );
}
