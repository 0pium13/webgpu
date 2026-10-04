"use client";

import Nav from "@/components/Nav";
import ExamStudio from "@/components/exam/ExamStudio";
import { LockIcon } from "@/components/Icons";

const TRUST = ["Nothing uploaded", "Exact KB, every time", "No watermark · free"];

export default function ExamPhotoPage() {
  return (
    <div style={{ minHeight: "100vh" }}>
      <Nav />
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "96px clamp(16px, 4vw, 24px) 72px" }}>
        <div style={{ marginBottom: 28 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.15em", color: "var(--accent)", textTransform: "uppercase" }}>
            webgpu.in / exam photo
          </span>
          <h1 style={{ fontSize: "clamp(30px, 5vw, 52px)", fontWeight: 500, letterSpacing: "-0.03em", lineHeight: 1.08, marginTop: 12, marginBottom: 12 }}>
            Exam Photo &amp; Signature Resizer
          </h1>
          <p style={{ fontSize: 16, color: "var(--text-muted)", maxWidth: 560, lineHeight: 1.6 }}>
            Exact pixels and exact KB for UPSC, SSC, IBPS, SBI, RRB, NEET, JEE and GATE forms.
            It frames your face, whitens the background, cleans your signature — and
            your photo never leaves this phone.
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
            {TRUST.map((t, i) => (
              <span key={t} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-secondary)", background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 20, padding: "5px 11px" }}>
                {i === 0 ? <LockIcon size={13} style={{ color: "var(--accent)" }} /> : <span style={{ width: 5, height: 5, borderRadius: 3, background: "var(--accent)" }} />}
                {t}
              </span>
            ))}
          </div>
        </div>

        <ExamStudio />
      </div>
    </div>
  );
}
