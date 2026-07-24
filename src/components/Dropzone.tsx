"use client";

/**
 * Shared dropzone — the review flagged three copy-pasted variants; new tools
 * use this one. (Existing pages migrate as they're touched.)
 */

import { useState } from "react";

export default function Dropzone({
  onFiles,
  accept,
  multiple = false,
  icon,
  title,
  subtitle,
  cta = "Choose file",
  footnote = "Processed locally · Nothing uploaded",
}: {
  onFiles: (files: File[]) => void;
  accept: string;
  multiple?: boolean;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  cta?: string;
  footnote?: string;
}) {
  const [drag, setDrag] = useState(false);
  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault(); setDrag(false);
        const fs = Array.from(e.dataTransfer.files);
        if (fs.length) onFiles(multiple ? fs : fs.slice(0, 1));
      }}
      style={{
        display: "block", border: drag ? "0.5px solid var(--accent)" : "0.5px dashed var(--border-strong)",
        borderRadius: 16, background: drag ? "var(--accent-dim)" : "var(--surface)",
        padding: "64px 32px", textAlign: "center", cursor: "pointer", transition: "all 0.15s",
      }}
    >
      <input
        type="file" accept={accept} multiple={multiple} style={{ display: "none" }}
        onChange={(e) => { const fs = Array.from(e.target.files ?? []); if (fs.length) onFiles(fs); }}
      />
      <div style={{ width: 56, height: 56, borderRadius: 14, background: "var(--surface-2)", border: "0.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", color: "var(--accent)" }}>
        {icon}
      </div>
      <p style={{ fontSize: 17, fontWeight: 500, marginBottom: 8 }}>{title}</p>
      <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 20 }}>{subtitle}</p>
      <span style={{ display: "inline-block", padding: "9px 22px", background: "var(--accent)", color: "var(--on-accent)", borderRadius: 8, fontSize: 14, fontWeight: 500 }}>{cta}</span>
      <p className="mono" style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 24 }}>{footnote}</p>
    </label>
  );
}
