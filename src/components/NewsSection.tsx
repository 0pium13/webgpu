"use client";

const NEWS = [
  {
    tag: "model drop",
    title: "SDXL-Turbo now runs in-browser at 2 seconds per image",
    date: "Jun 27, 2026",
    href: "#",
  },
  {
    tag: "tutorial",
    title: "Run a 7B LLM locally with WebLLM in 5 minutes",
    date: "Jun 21, 2026",
    href: "#",
  },
  {
    tag: "roundup",
    title: "This week: Safari ships subgroup support, faster inference across all browsers",
    date: "Jun 14, 2026",
    href: "#",
  },
];

export default function NewsSection() {
  return (
    <section id="news" style={{ padding: "80px 24px", maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 24, marginBottom: 40 }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-muted)", textTransform: "uppercase" }}>
          news
        </span>
        <div style={{ flex: 1, height: "0.5px", background: "var(--border)" }} />
        <a href="#" style={{ fontSize: 12, color: "var(--accent)", textDecoration: "none" }}>
          All articles →
        </a>
      </div>

      <h2 style={{ fontSize: "clamp(24px,4vw,36px)", fontWeight: 500, letterSpacing: "-0.02em", marginBottom: 40 }}>
        This week in WebGPU
      </h2>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        {NEWS.map((item, i) => (
          <a
            key={i}
            href={item.href}
            style={{
              display: "block",
              background: "var(--surface)",
              border: "0.5px solid var(--border)",
              borderRadius: 12,
              padding: "24px",
              textDecoration: "none",
              transition: "border-color 0.15s",
            }}
            onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)")}
            onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.borderColor = "var(--border)")}
          >
            <span className="pill pill-accent" style={{ marginBottom: 16, display: "inline-flex" }}>
              {item.tag}
            </span>
            <p style={{ fontSize: 16, fontWeight: 500, color: "var(--text)", lineHeight: 1.4, marginBottom: 16 }}>
              {item.title}
            </p>
            <p className="mono" style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.04em" }}>
              {item.date}
            </p>
          </a>
        ))}
      </div>
    </section>
  );
}
