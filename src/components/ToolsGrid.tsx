"use client";

const TOOLS = [
  { href: "/upscale", icon: "⚡", name: "Upscaler", desc: "Real AI detail reconstruction. Up to 4K." },
  { href: "/rotoscope", icon: "🎯", name: "Rotoscope", desc: "Cut out and track any object, even in video." },
  { href: "/bg-remove", icon: "✂️", name: "Background Remover", desc: "Instant, clean edges. One click." },
];

export default function ToolsGrid() {
  return (
    <section style={{ maxWidth: 720, margin: "0 auto", padding: "0 24px 100px" }}>
      <div
        className="stagger"
        style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12 }}
      >
        {TOOLS.map((t) => (
          <a
            key={t.href}
            href={t.href}
            style={{
              display: "block",
              background: "var(--surface)",
              border: "0.5px solid var(--border)",
              borderRadius: 16,
              padding: "26px 22px",
              textDecoration: "none",
              transition: "border-color 0.15s, transform 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-border)";
              (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
              (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
            }}
          >
            <span style={{ fontSize: 26, display: "block", marginBottom: 14 }}>{t.icon}</span>
            <p style={{ fontSize: 16, fontWeight: 500, color: "var(--text)", marginBottom: 5 }}>{t.name}</p>
            <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>{t.desc}</p>
          </a>
        ))}
      </div>
    </section>
  );
}
