"use client";

export default function Nav() {
  return (
    <nav
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        height: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 32px",
        background: "rgba(10,10,11,0.7)",
        backdropFilter: "blur(20px)",
        borderBottom: "0.5px solid var(--border)",
        zIndex: 100,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="4" width="16" height="16" rx="2"/>
          <rect x="9" y="9" width="6" height="6"/>
          <path d="M15 2v2M9 2v2M15 20v2M9 20v2M2 15h2M2 9h2M20 15h2M20 9h2"/>
        </svg>
        <span className="mono" style={{ fontSize: 15, fontWeight: 500, letterSpacing: "-0.01em" }}>
          webgpu.in
        </span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <a
          href="/upscale"
          style={{
            fontSize: 13, color: "var(--accent)", textDecoration: "none",
            padding: "5px 12px", background: "var(--accent-dim)", borderRadius: 6, fontWeight: 500,
          }}
        >
          ⚡ Upscaler
        </a>
        <a
          href="/rotoscope"
          style={{
            fontSize: 13, color: "var(--accent)", textDecoration: "none",
            padding: "5px 12px", background: "var(--accent-dim)", borderRadius: 6, fontWeight: 500,
          }}
        >
          🎯 Rotoscope
        </a>
        <a
          href="/bg-remove"
          style={{
            fontSize: 13, color: "var(--accent)", textDecoration: "none",
            padding: "5px 12px", background: "var(--accent-dim)", borderRadius: 6, fontWeight: 500,
          }}
        >
          ✂️ BG Remover
        </a>
      </div>
    </nav>
  );
}
