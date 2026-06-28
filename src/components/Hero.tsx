"use client";

import { useEffect, useState, useRef } from "react";
import GPUCard from "./GPUCard";

export default function Hero() {
  return (
    <section
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "120px 24px 80px",
        textAlign: "center",
      }}
    >
      <span
        className="mono"
        style={{
          fontSize: 11,
          letterSpacing: "0.15em",
          color: "var(--accent)",
          textTransform: "uppercase",
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
          maxWidth: 700,
          marginBottom: 20,
          color: "var(--text)",
        }}
      >
        See what your GPU can really do
      </h1>

      <p
        style={{
          fontSize: 17,
          color: "var(--text-muted)",
          maxWidth: 480,
          lineHeight: 1.6,
          marginBottom: 56,
        }}
      >
        We benchmark your GPU right in the browser — no install, no upload — and
        show you exactly what it can run.
      </p>

      <GPUCard />

      <a
        href="#"
        style={{
          marginTop: 20,
          fontSize: 13,
          color: "var(--text-muted)",
          textDecoration: "none",
          display: "flex",
          alignItems: "center",
          gap: 6,
          transition: "color 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.color = "var(--accent)")}
        onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
      >
        Share your score →
      </a>
    </section>
  );
}
