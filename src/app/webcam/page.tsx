"use client";

import Nav from "@/components/Nav";
import WebcamStudio from "@/components/webcam/WebcamStudio";

export default function WebcamPage() {
  return (
    <div style={{ minHeight: "100vh" }}>
      <Nav />
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "100px 24px 80px" }}>
        <div style={{ marginBottom: 28 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.15em", color: "var(--accent)", textTransform: "uppercase" }}>
            webgpu.in / webcam
          </span>
          <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 500, letterSpacing: "-0.03em", marginTop: 12, marginBottom: 10 }}>
            Webcam Studio
          </h1>
          <p style={{ fontSize: 16, color: "var(--text-muted)", maxWidth: 620, lineHeight: 1.6 }}>
            Make any webcam look pro, live — low-light lift, denoise, sharpen,
            skin retouch, and auto-framing, all on your GPU in real time. Record
            it or feed it to OBS. Camo and mmhmm charge for this; here it&apos;s free
            and nothing leaves your machine.
          </p>
        </div>
        <WebcamStudio />
      </div>
    </div>
  );
}
