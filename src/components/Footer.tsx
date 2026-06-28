"use client";

export default function Footer() {
  return (
    <footer
      style={{
        borderTop: "0.5px solid var(--border)",
        padding: "40px 32px",
        display: "flex",
        flexWrap: "wrap",
        gap: 32,
        justifyContent: "space-between",
        alignItems: "flex-start",
      }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="4" y="4" width="16" height="16" rx="2"/>
            <rect x="9" y="9" width="6" height="6"/>
            <path d="M15 2v2M9 2v2M15 20v2M9 20v2M2 15h2M2 9h2M20 15h2M20 9h2"/>
          </svg>
          <span className="mono" style={{ fontSize: 13, fontWeight: 500 }}>webgpu.in</span>
        </div>
        <p style={{ fontSize: 12, color: "var(--text-muted)", maxWidth: 260, lineHeight: 1.6 }}>
          Community resource. Not affiliated with W3C or Khronos.
        </p>
      </div>

      {[
        {
          label: "Tools",
          links: [
            { name: "4K Upscaler", href: "/upscale" },
            { name: "BG Remover", href: "/bg-remove" },
            { name: "Transcriber", href: "/transcribe" },
            { name: "Local LLM", href: "/chat" },
          ],
        },
        {
          label: "Community",
          links: [
            { name: "Showcase", href: "#showcase" },
            { name: "Discord", href: "#" },
            { name: "Newsletter", href: "#community" },
            { name: "Submit a project", href: "#" },
          ],
        },
        {
          label: "Learn",
          links: [
            { name: "What is WebGPU?", href: "#learn" },
            { name: "Getting started", href: "#" },
            { name: "API reference", href: "https://developer.mozilla.org/en-US/docs/Web/API/WebGPU_API" },
            { name: "GitHub", href: "https://github.com/0pium13/webgpu" },
          ],
        },
      ].map((col) => (
        <div key={col.label}>
          <p style={{ fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 14 }}>
            {col.label}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {col.links.map((link) => (
              <a
                key={link.name}
                href={link.href}
                style={{ fontSize: 13, color: "var(--text-muted)", textDecoration: "none", transition: "color 0.12s" }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text-muted)")}
              >
                {link.name}
              </a>
            ))}
          </div>
        </div>
      ))}

      <div style={{ width: "100%", borderTop: "0.5px solid var(--border)", paddingTop: 24, display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
        <p className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>
          © 2026 webgpu.in — built by the community
        </p>
        <p className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>
          This page scored 127 on an M3 Pro
        </p>
      </div>
    </footer>
  );
}
