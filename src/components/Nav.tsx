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

      <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
        <a
          href="/upscale"
          style={{
            fontSize: 13,
            color: "var(--accent)",
            textDecoration: "none",
            padding: "5px 12px",
            background: "var(--accent-dim)",
            borderRadius: 6,
            fontWeight: 500,
          }}
        >
          ⚡ Upscaler
        </a>
        {["Showcase", "Tools", "News", "Learn"].map((item) => (
          <a
            key={item}
            href={`#${item.toLowerCase()}`}
            style={{
              fontSize: 13,
              color: "var(--text-muted)",
              textDecoration: "none",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
          >
            {item}
          </a>
        ))}
        <a
          href="#community"
          style={{
            fontSize: 13,
            color: "var(--accent)",
            textDecoration: "none",
            padding: "6px 14px",
            border: "0.5px solid var(--accent-border)",
            borderRadius: 20,
            transition: "background 0.15s",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = "var(--accent-dim)")}
          onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
        >
          Join community
        </a>
      </div>
    </nav>
  );
}
