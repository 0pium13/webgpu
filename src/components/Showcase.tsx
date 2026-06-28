"use client";

const ITEMS = [
  { tag: "AI tool",     title: "Free 4K Image Upscaler",          desc: "Real-ESRGAN in your browser tab. No upload.",         href: "https://useyourgpu.com/upscale" },
  { tag: "AI tool",     title: "Background Remover",              desc: "RMBG-2.0 running locally on your GPU.",               href: "https://useyourgpu.com/bg-remove" },
  { tag: "demo",        title: "GPU Physics Simulation",          desc: "10,000 rigid bodies at 60fps via compute shaders.",   href: "#" },
  { tag: "AI tool",     title: "Local LLM Chat",                  desc: "Llama 3 8B running in your browser. Fully private.",  href: "https://useyourgpu.com/chat" },
  { tag: "demo",        title: "Real-time Fluid Dynamics",        desc: "Navier-Stokes on the GPU. No server needed.",         href: "#" },
  { tag: "AI tool",     title: "Meeting Transcriber",             desc: "Whisper. Your audio never leaves your machine.",      href: "https://useyourgpu.com/transcribe" },
  { tag: "library",     title: "WebLLM",                          desc: "High-performance in-browser LLM inference. 17k stars.", href: "https://github.com/mlc-ai/web-llm" },
  { tag: "library",     title: "Transformers.js",                 desc: "HuggingFace models in-browser. WebGPU backend.",     href: "https://github.com/xenova/transformers.js" },
];

export default function Showcase() {
  return (
    <section id="showcase" style={{ padding: "80px 24px", maxWidth: 1000, margin: "0 auto" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 24, marginBottom: 40 }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.12em", color: "var(--text-muted)", textTransform: "uppercase" }}>
          showcase
        </span>
        <div style={{ flex: 1, height: "0.5px", background: "var(--border)" }} />
      </div>

      <h2 style={{ fontSize: "clamp(24px,4vw,36px)", fontWeight: 500, letterSpacing: "-0.02em", marginBottom: 12 }}>
        Built with WebGPU
      </h2>
      <p style={{ fontSize: 15, color: "var(--text-muted)", marginBottom: 40 }}>
        Live demos, tools, and libraries running on your GPU. Right now.
      </p>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 12,
        }}
      >
        {ITEMS.map((item, i) => (
          <a
            key={i}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "block",
              background: "var(--surface)",
              border: "0.5px solid var(--border)",
              borderRadius: 12,
              padding: "20px",
              textDecoration: "none",
              transition: "border-color 0.15s, transform 0.15s",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)";
              (e.currentTarget as HTMLElement).style.transform = "translateY(-2px)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
              (e.currentTarget as HTMLElement).style.transform = "translateY(0)";
            }}
          >
            <span className="pill pill-accent" style={{ marginBottom: 14, display: "inline-flex" }}>
              {item.tag}
            </span>
            <p style={{ fontSize: 15, fontWeight: 500, color: "var(--text)", marginBottom: 8, lineHeight: 1.3 }}>
              {item.title}
            </p>
            <p style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>
              {item.desc}
            </p>
          </a>
        ))}

        <a
          href="#"
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            background: "transparent",
            border: "0.5px dashed var(--border-strong)",
            borderRadius: 12,
            padding: "20px",
            textDecoration: "none",
            minHeight: 140,
            transition: "border-color 0.15s, background 0.15s",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-border)";
            (e.currentTarget as HTMLElement).style.background = "var(--accent-dim)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.borderColor = "var(--border-strong)";
            (e.currentTarget as HTMLElement).style.background = "transparent";
          }}
        >
          <span style={{ fontSize: 22, color: "var(--text-muted)" }}>+</span>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>Submit your project</span>
        </a>
      </div>
    </section>
  );
}
