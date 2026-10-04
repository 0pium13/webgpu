"use client";

import type { ReactNode } from "react";
import { MODE_LABEL, presetFilename, type ExamPreset } from "@/lib/examPresets";
import { fmtKB, type FitStatus } from "@/lib/examImage";

export interface ExamResult {
  url: string;
  bytes: number;
  width: number;
  height: number;
  quality: number;
  status: FitStatus;
  /** size at quality 100 — explains a too-small file */
  maxQualityBytes: number;
  dpi: number | null;
  /** border pixels look dark/coloured (photo mode, no white-bg) */
  bgWarn: boolean;
  /** bytes of JPEG comment padding added to reach the minimum */
  padded: number;
}

type Row = { ok: boolean | "warn"; label: string; value: ReactNode };

export default function ResultCard({
  preset,
  result,
  busy,
  nameDateOk,
  whiteBg,
  onWhiteBg,
  onGrow,
}: {
  preset: ExamPreset;
  result: ExamResult | null;
  busy: boolean;
  /** null when the preset doesn't ask for name + date */
  nameDateOk: boolean | null;
  whiteBg: boolean;
  onWhiteBg?: () => void;
  /** switch between padding (false) and larger pixels (true) */
  onGrow?: (grow: boolean) => void;
}) {
  const what = `${preset.exam === "Custom" ? "your" : preset.exam} ${MODE_LABEL[preset.mode].toLowerCase()}`;
  const sizeOk = result?.status === "ok";
  const meets = !!result && sizeOk && nameDateOk !== false;
  const grown = !!result && (result.width !== preset.width || result.height !== preset.height);
  const filename = presetFilename(preset, result?.width, result?.height);

  const rows: Row[] = result ? [
    {
      ok: true, label: "Dimensions",
      value: grown
        ? <>{result.width} × {result.height} px <span style={{ color: "var(--text-dim)" }}>/ {preset.width}×{preset.height} shape</span></>
        : `${result.width} × ${result.height} px`,
    },
    { ok: sizeOk, label: "File size", value: <>{fmtKB(result.bytes)}{result.padded > 0 ? " · padded" : ""} <span style={{ color: "var(--text-dim)" }}>/ {preset.minKB}–{preset.maxKB} KB</span></> },
    { ok: true, label: "Format", value: `JPEG (.${preset.ext ?? "jpg"})` },
  ] : [];
  if (result && preset.dpi) rows.push({ ok: result.dpi === preset.dpi, label: "Resolution", value: `${result.dpi ?? "—"} DPI` });
  if (result && nameDateOk !== null) rows.push({ ok: nameDateOk, label: "Name & date", value: nameDateOk ? "Printed on photo" : "Fill in both" });
  if (result && preset.mode === "photo") {
    rows.push(whiteBg
      ? { ok: true, label: "Background", value: "White (AI)" }
      : result.bgWarn
        ? { ok: "warn", label: "Background", value: "Not white?" }
        : { ok: true, label: "Background", value: "Looks light" });
  }

  return (
    <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 16, padding: 16, display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10 }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.14em", color: "var(--accent)", textTransform: "uppercase" }}>Output</span>
        {result && (
          <span className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)" }}>
            JPEG q{result.quality}{busy ? " · updating…" : ""}
          </span>
        )}
      </div>

      {/* the actual file, on a neutral mat */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", background: "var(--canvas)", border: "0.5px solid var(--border)", borderRadius: 12, padding: 18, minHeight: 150 }}>
        {result ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={result.url}
            alt={`${what} output`}
            data-exam-output
            style={{
              display: "block", width: "auto", height: "auto",
              maxWidth: "100%", maxHeight: 230,
              // tiny outputs (140×60 signature) get a 2× preview so they're legible
              minWidth: result.width < 160 ? Math.min(160, result.width * 2) : undefined,
              boxShadow: "0 0 0 0.5px rgba(255,255,255,0.12), 0 14px 34px -16px rgba(0,0,0,0.9)",
              opacity: busy ? 0.75 : 1, transition: "opacity 0.2s",
            }}
          />
        ) : (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Preparing…</p>
        )}
      </div>

      {result && (
        <>
          <div
            role="status"
            style={{
              display: "flex", alignItems: "flex-start", gap: 10, borderRadius: 11, padding: "11px 12px",
              background: meets ? "var(--green-dim)" : "var(--amber-dim)",
              border: `0.5px solid ${meets ? "rgba(63,178,127,0.35)" : "rgba(245,158,11,0.35)"}`,
            }}
          >
            <span style={{ flexShrink: 0, marginTop: 1, color: meets ? "var(--green)" : "var(--amber)" }}>
              {meets ? <Check /> : <Warn />}
            </span>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: 14, fontWeight: 600, color: meets ? "var(--green)" : "var(--amber)", lineHeight: 1.35 }}>
                {meets ? `Meets ${what} requirements` : sizeOk ? "Almost there" : "Can't hit the size limit"}
              </p>
              <p style={{ fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.5, marginTop: 3 }}>
                {explain(preset, result, nameDateOk, grown)}
              </p>
            </div>
          </div>

          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column" }}>
            {rows.map((r) => (
              <li key={r.label} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", borderBottom: "0.5px solid var(--border)", fontSize: 13 }}>
                <span style={{ width: 18, height: 18, borderRadius: 6, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: r.ok === true ? "var(--green-dim)" : "var(--amber-dim)", color: r.ok === true ? "var(--green)" : "var(--amber)" }}>
                  {r.ok === true ? <Check size={11} /> : <Warn size={11} />}
                </span>
                <span style={{ color: "var(--text-muted)" }}>{r.label}</span>
                <span className="mono" style={{ marginLeft: "auto", color: "var(--text)", fontSize: 12, textAlign: "right" }}>{r.value}</span>
              </li>
            ))}
          </ul>

          {result.padded > 0 && (
            <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5, marginTop: -4 }}>
              Padded to meet the {preset.minKB} KB minimum — image unchanged.
            </p>
          )}

          {onGrow && (result.padded > 0 || grown) && (
            <button onClick={() => onGrow(!grown)} style={{ alignSelf: "flex-start", fontSize: 12.5, color: "var(--text-secondary)", background: "transparent", border: "0.5px solid var(--border-strong)", borderRadius: 8, padding: "7px 12px", cursor: "pointer" }}>
              {grown ? `Keep exact ${preset.width}×${preset.height} (pad instead)` : "Use larger pixels instead (same shape)"}
            </button>
          )}

          {result.bgWarn && !whiteBg && onWhiteBg && (
            <button onClick={onWhiteBg} style={{ alignSelf: "flex-start", fontSize: 12.5, color: "var(--accent)", background: "var(--accent-dim)", border: "0.5px solid var(--accent-border)", borderRadius: 8, padding: "7px 12px", cursor: "pointer" }}>
              Make the background white
            </button>
          )}

          <a
            href={result.url}
            download={filename}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 9,
              background: "var(--accent)", color: "var(--on-accent)", borderRadius: 11,
              padding: "14px 16px", fontSize: 15, fontWeight: 600, textDecoration: "none",
              boxShadow: "0 10px 30px -12px rgba(228,192,120,0.55)",
            }}
          >
            <DownloadGlyph />
            Download · {fmtKB(result.bytes)}
          </a>
          <p className="mono" style={{ fontSize: 11, color: "var(--text-dim)", textAlign: "center", marginTop: -6, wordBreak: "break-all" }}>{filename}</p>
        </>
      )}
    </div>
  );
}

function explain(p: ExamPreset, r: ExamResult, nameDateOk: boolean | null, grown: boolean): string {
  if (r.status === "too-small") {
    return `Even at maximum JPEG quality a ${r.width}×${r.height} image only reaches ${fmtKB(r.maxQualityBytes)}, and the minimum is ${p.minKB} KB`
      + (p.pxFixed ? " (these pixels are fixed). " : grown ? `, even after growing it from ${p.width}×${p.height}. ` : ". ")
      + (p.mode === "photo"
        ? "Zoom out a little or turn off White background so there is more detail to keep."
        : "Turn Auto-clean off (paper texture adds detail) or zoom out so more of the page is in frame.")
      + (p.pxFixed && p.id === "custom" ? " Or tick “allow larger pixels” above." : "");
  }
  if (r.status === "too-big") {
    return `Even at ${r.quality}% quality the file is ${fmtKB(r.bytes)} — over ${p.maxKB} KB. Turn on White background or zoom in to simplify the picture.`;
  }
  if (nameDateOk === false) return "Type your name and the date the photo was taken — this exam needs both printed on the photo.";
  if (r.padded > 0) {
    return `A clean ${r.width}×${r.height} ${MODE_LABEL[p.mode].toLowerCase()} is only ${fmtKB(r.maxQualityBytes)} even at top quality, so the file carries an empty JPEG comment to reach ${p.minKB} KB. Exact pixels, image unchanged.`;
  }
  if (grown) {
    return `A clean ${p.width}×${p.height} ${MODE_LABEL[p.mode].toLowerCase()} can't reach ${p.minKB} KB even at top quality, so it's saved at ${r.width}×${r.height} — same shape, sharper. `
      + (p.id === "custom"
        ? "You allowed larger pixels; untick it to keep the exact size."
        : "You chose larger pixels; the notice's size is a preference (or a range) and the KB limit is what the portal enforces.");
  }
  return `${p.width}×${p.height} px at the highest quality that fits ${p.minKB}–${p.maxKB} KB. Still compare with your notification before submitting.`;
}

function Check({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </svg>
  );
}

function Warn({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 8v5" />
      <circle cx="12" cy="16.6" r="0.6" fill="currentColor" />
      <path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
    </svg>
  );
}

function DownloadGlyph() {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
    </svg>
  );
}
