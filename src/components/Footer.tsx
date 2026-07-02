"use client";

const TOOLS = [
  { name: "Upscaler", href: "/upscale" },
  { name: "Rotoscope", href: "/rotoscope" },
  { name: "BG Remover", href: "/bg-remove" },
];

export default function Footer() {
  return (
    <footer
      style={{
        borderTop: "0.5px solid var(--border)",
        padding: "28px 32px",
        display: "flex",
        flexWrap: "wrap",
        gap: 16,
        justifyContent: "space-between",
        alignItems: "center",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="4" width="16" height="16" rx="2"/>
          <rect x="9" y="9" width="6" height="6"/>
          <path d="M15 2v2M9 2v2M15 20v2M9 20v2M2 15h2M2 9h2M20 15h2M20 9h2"/>
        </svg>
        <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>webgpu.in</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
        {TOOLS.map((t) => (
          <a
            key={t.href}
            href={t.href}
            style={{ fontSize: 13, color: "var(--text-muted)", textDecoration: "none", transition: "color 0.12s" }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text-muted)")}
          >
            {t.name}
          </a>
        ))}
        <a
          href="https://github.com/0pium13/webgpu"
          style={{ fontSize: 13, color: "var(--text-muted)", textDecoration: "none", transition: "color 0.12s" }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text-muted)")}
        >
          GitHub
        </a>
      </div>

      <p className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>
        Nothing uploaded, ever.
      </p>
    </footer>
  );
}
