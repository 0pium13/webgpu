"use client";

import { CUSTOM_ID, MODE_LABEL, type ExamPreset } from "@/lib/examPresets";
import { card } from "./ui";

/** What the selected exam asks for, where that came from, and the caveat. */
export default function SpecCard({ preset }: { preset: ExamPreset }) {
  const custom = preset.id === CUSTOM_ID;
  const tiles: { k: string; v: string; sub?: string }[] = [
    { k: "Pixels", v: `${preset.width} × ${preset.height}`, sub: preset.pxChosen ? "our pick — notice gives no px" : "width × height" },
    { k: "File size", v: `${preset.minKB}–${preset.maxKB} KB`, sub: "we land inside it" },
    { k: "Format", v: (preset.ext ?? "jpg").toUpperCase(), sub: "JPEG, no EXIF" },
  ];
  if (preset.physical || preset.dpi) {
    tiles.push({ k: preset.physical ? "Print size" : "Resolution", v: preset.physical ?? `${preset.dpi} DPI`, sub: preset.physical && preset.dpi ? `${preset.dpi} DPI in file` : undefined });
  }

  return (
    <div style={{ ...card, padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.14em", color: "var(--accent)", textTransform: "uppercase" }}>
          {custom ? "Custom" : preset.exam} · {MODE_LABEL[preset.mode]}
        </span>
        <span style={{ flex: 1 }} />
        {!custom && (
          <span className={`pill ${preset.verified ? "pill-green" : "pill-amber"}`} title={preset.verified ? "Numbers read from the official notice" : "Official notice couldn't be opened — numbers from coaching / news sites"}>
            {preset.verified ? "✓ From official notice" : "Unverified — double-check"}
          </span>
        )}
        {preset.nameDate && <span className="pill pill-accent">Name + date on photo</span>}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(118px, 1fr))", gap: 8 }}>
        {tiles.map((t) => (
          <div key={t.k} style={{ background: "var(--canvas)", border: "0.5px solid var(--border)", borderRadius: 11, padding: "10px 12px", minWidth: 0 }}>
            <p className="mono" style={{ fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-dim)" }}>{t.k}</p>
            <p className="mono" style={{ fontSize: 15, color: "var(--text)", marginTop: 4, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{t.v}</p>
            {t.sub && <p style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.35 }}>{t.sub}</p>}
          </div>
        ))}
      </div>

      {preset.notes.length > 0 && (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 7 }}>
          {preset.notes.map((n) => (
            <li key={n} style={{ display: "flex", gap: 9, fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.5 }}>
              <span aria-hidden style={{ width: 4, height: 4, borderRadius: 2, background: "var(--accent)", marginTop: 8, flexShrink: 0 }} />
              <span style={{ minWidth: 0 }}>{n}</span>
            </li>
          ))}
        </ul>
      )}

      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, padding: "10px 12px", borderRadius: 11, background: "var(--amber-dim)", border: "0.5px solid rgba(245,158,11,0.25)" }}>
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="var(--amber)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ flexShrink: 0, marginTop: 2 }}>
          <circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5" /><circle cx="12" cy="16.5" r="0.5" fill="var(--amber)" />
        </svg>
        <p style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5, minWidth: 0 }}>
          <strong style={{ color: "var(--amber)", fontWeight: 600 }}>Check your official notification — requirements change.</strong>{" "}
          {preset.source.url ? (
            <>
              Source:{" "}
              <a href={preset.source.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text)", textDecorationColor: "var(--text-dim)", textUnderlineOffset: 3, wordBreak: "break-word" }}>
                {preset.source.label} ↗
              </a>
            </>
          ) : (
            "Enter the numbers exactly as your notice prints them."
          )}
        </p>
      </div>
    </div>
  );
}
