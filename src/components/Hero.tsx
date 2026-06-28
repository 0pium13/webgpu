"use client";

import GPUAnalytics from "./GPUAnalytics";

export default function Hero() {
  return (
    <section
      style={{
        padding: "120px 24px 80px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      <div style={{ textAlign: "center", marginBottom: 56 }}>
        <span
          className="mono"
          style={{
            fontSize: 11,
            letterSpacing: "0.15em",
            color: "var(--accent)",
            textTransform: "uppercase",
            display: "block",
            marginBottom: 24,
          }}
        >
          Your browser. Your GPU. Your AI.
        </span>

        <h1
          style={{
            fontSize: "clamp(40px, 7vw, 72px)",
            fontWeight: 500,
            lineHeight: 1.1,
            letterSpacing: "-0.03em",
            maxWidth: 680,
            margin: "0 auto 20px",
          }}
        >
          See what your GPU can really do
        </h1>

        <p style={{ fontSize: 17, color: "var(--text-muted)", maxWidth: 460, margin: "0 auto", lineHeight: 1.6 }}>
          We benchmark your GPU in the browser — no install, no upload — then
          show you exactly what it can run, how fast, and how you compare.
        </p>
      </div>

      <GPUAnalytics />
    </section>
  );
}
