"use client";

const TASKS = [
  { icon: "🖼", name: "Upscale image to 4K", time: "~3s", minTier: 0, link: "https://useyourgpu.com/upscale" },
  { icon: "✂️", name: "Remove background (real-time)", time: "~1s", minTier: 0, link: "https://useyourgpu.com/bg-remove" },
  { icon: "🎙", name: "Live meeting transcription", time: "real-time", minTier: 0, link: "https://useyourgpu.com/transcribe" },
  { icon: "🔬", name: "Upscale image to 8K", time: "~45s", minTier: 1, link: "https://useyourgpu.com/upscale" },
  { icon: "🤖", name: "Local 7B chat model", time: "~8 tok/s", minTier: 1, link: "https://useyourgpu.com/chat" },
  { icon: "🎬", name: "Video upscale & repair", time: "~4 min/min", minTier: 2, link: "https://useyourgpu.com/video" },
  { icon: "✨", name: "Generate video (LTX / Wan)", time: "cloud only", minTier: 99, link: "https://useyourgpu.com/generate" },
];

const TIER_NAMES = ["Entry", "Solid", "Strong", "Beast"];

function verdict(tier: number, minTier: number) {
  if (minTier === 99) return { label: "Cloud Pro", cls: "pill-accent" };
  if (tier >= minTier + 1) return { label: "Smooth", cls: "pill-green" };
  if (tier >= minTier) return { label: "Usable", cls: "pill-amber" };
  return { label: "Cloud Pro", cls: "pill-accent" };
}

export default function CapabilityMatrix() {
  const tier = 2;

  return (
    <section
      id="tools"
      style={{ maxWidth: 760, margin: "0 auto", padding: "80px 24px" }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 24, marginBottom: 40 }}>
        <span
          className="mono"
          style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-muted)", textTransform: "uppercase", whiteSpace: "nowrap" }}
        >
          capabilities
        </span>
        <div style={{ flex: 1, height: "0.5px", background: "var(--border)" }} />
      </div>

      <h2 style={{ fontSize: "clamp(24px,4vw,36px)", fontWeight: 500, letterSpacing: "-0.02em", marginBottom: 12 }}>
        What runs on your hardware
      </h2>
      <p style={{ fontSize: 15, color: "var(--text-muted)", marginBottom: 40 }}>
        Based on your detected GPU tier.{" "}
        <span style={{ color: "var(--accent)", cursor: "pointer" }}>Cloud Pro</span> handles what your device can&apos;t.
      </p>

      <div className="stagger" style={{ display: "flex", flexDirection: "column" }}>
        {TASKS.map((task, i) => {
          const v = verdict(tier, task.minTier);
          return (
            <a
              key={i}
              href={task.link}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "16px 0 16px 16px",
                borderBottom: "0.5px solid var(--border)",
                textDecoration: "none",
                borderLeft: "2px solid transparent",
                transition: "background 0.12s, border-left-color 0.12s",
                borderRadius: "0 6px 6px 0",
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.025)";
                (e.currentTarget as HTMLElement).style.borderLeftColor = "var(--accent)";
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.background = "transparent";
                (e.currentTarget as HTMLElement).style.borderLeftColor = "transparent";
              }}
            >
              <span style={{ fontSize: 18, width: 24, textAlign: "center", flexShrink: 0 }}>{task.icon}</span>
              <span style={{ fontSize: 15, color: "var(--text)", flex: 1 }}>{task.name}</span>
              <span className="mono" style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 80, textAlign: "right" }}>
                {task.time}
              </span>
              <span className={`pill ${v.cls}`} style={{ minWidth: 80, justifyContent: "center" }}>
                {v.label}
              </span>
            </a>
          );
        })}
      </div>
    </section>
  );
}
