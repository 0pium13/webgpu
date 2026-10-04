"use client";

import type { CSSProperties, ReactNode } from "react";
import { DEFAULT_OPTIONS, type BgMode, type OutputOptions } from "./compose";

const SWATCHES: { c: string; name: string }[] = [
  { c: "#ffffff", name: "White" },
  { c: "#f0f0f0", name: "Light grey" },
  { c: "#f5efe6", name: "Cream" },
  { c: "#f6e3e1", name: "Blush" },
  { c: "#e3eef8", name: "Sky" },
  { c: "#e4ede4", name: "Sage" },
  { c: "#000000", name: "Black" },
];

const SIZES: { px: number; note: string }[] = [
  { px: 1000, note: "minimum" },
  { px: 1500, note: "balanced" },
  { px: 2000, note: "zoom-ready" },
];

const BACKDROPS: { c: string; name: string; note: string }[] = [
  { c: "#ffffff", name: "Pure white", note: "#FFFFFF · all main images" },
  { c: "#f0f0f0", name: "Light grey", note: "Flipkart apparel" },
];

const MODES: { id: BgMode; label: string; sub: string }[] = [
  { id: "transparent", label: "Transparent", sub: "PNG · alpha" },
  { id: "color", label: "Colour", sub: "any backdrop" },
  { id: "product", label: "Marketplace", sub: "1:1 · white" },
];

export function optionsSummary(o: OutputOptions): string {
  if (o.mode === "transparent") return "Transparent PNG · full size";
  const fmt = o.format === "jpeg" ? `JPG ${Math.round(o.quality * 100)}` : "PNG";
  if (o.mode === "color") return `${o.color.toUpperCase()} backdrop · ${fmt}`;
  return `${o.size}×${o.size} · ${Math.round((1 - 2 * o.margin) * 100)}% fill · ${fmt}`;
}

export default function OutputOptionsPanel({
  value: o,
  onChange,
  collapsed = false,
  onToggleCollapsed,
}: {
  value: OutputOptions;
  onChange: (o: OutputOptions) => void;
  collapsed?: boolean;
  /** when set, the header folds the panel down to its one-line summary */
  onToggleCollapsed?: () => void;
}) {
  const set = (p: Partial<OutputOptions>) => onChange({ ...o, ...p });
  const fill = Math.round((1 - 2 * o.margin) * 100);
  const custom = !SWATCHES.some((s) => s.c === o.color.toLowerCase());

  return (
    <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 14, padding: 16, display: "flex", flexDirection: "column", gap: 16, minWidth: 0 }}>
      {onToggleCollapsed ? (
        <button
          type="button"
          aria-expanded={!collapsed}
          onClick={onToggleCollapsed}
          style={{ display: "flex", alignItems: "center", gap: 10, background: "none", border: "none", padding: 0, margin: collapsed ? 0 : "0 0 -2px", cursor: "pointer", textAlign: "left", minWidth: 0 }}
        >
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.14em", color: "var(--accent)", textTransform: "uppercase", flexShrink: 0 }}>Output</span>
          <span className="mono" style={{ flex: 1, minWidth: 0, fontSize: 10.5, color: collapsed ? "var(--text-secondary)" : "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{optionsSummary(o)}</span>
          <span style={{ fontSize: 11.5, color: "var(--text-muted)", flexShrink: 0, display: "inline-flex", alignItems: "center", gap: 5 }}>
            {collapsed ? "Edit" : "Hide"}
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden style={{ transform: collapsed ? "none" : "rotate(180deg)", transition: "transform 0.3s var(--ease-lux)" }}><path d="M2 3.5l3 3 3-3" /></svg>
          </span>
        </button>
      ) : (
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.14em", color: "var(--accent)", textTransform: "uppercase" }}>Output</span>
          <span className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)" }}>{optionsSummary(o)}</span>
        </div>
      )}

      {!collapsed && (
        <>
          <div role="radiogroup" aria-label="Background" style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 3, background: "var(--canvas)", border: "0.5px solid var(--border)", borderRadius: 11, padding: 3 }}>
            {MODES.map((m) => {
              const on = o.mode === m.id;
              return (
                <button
                  key={m.id}
                  role="radio"
                  aria-checked={on}
                  onClick={() => set({ mode: m.id })}
                  style={{
                    minWidth: 0, padding: "8px 4px 7px", borderRadius: 8, cursor: "pointer",
                    border: "none", textAlign: "center",
                    background: on ? "var(--surface-2)" : "transparent",
                    boxShadow: on ? "inset 0 0 0 0.5px var(--border-strong), 0 6px 18px -10px rgba(0,0,0,0.8)" : "none",
                    transition: "background 0.2s var(--ease-lux), box-shadow 0.2s var(--ease-lux)",
                  }}
                >
                  <span style={{ display: "block", fontSize: 13, fontWeight: 500, color: on ? "var(--text)" : "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.label}</span>
                  <span className="mono" style={{ display: "block", fontSize: 9.5, marginTop: 2, color: on ? "var(--accent)" : "var(--text-dim)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{m.sub}</span>
                </button>
              );
            })}
          </div>

          {o.mode === "transparent" && (
            <p style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.55 }}>
              Full-resolution PNG with a clean alpha channel — drop it into Canva, Photoshop or a story.
            </p>
          )}

          {o.mode === "color" && (
            <Field label="Backdrop">
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {SWATCHES.map((s) => (
                  <Swatch key={s.c} color={s.c} title={s.name} on={o.color.toLowerCase() === s.c} onClick={() => set({ color: s.c })} />
                ))}
                <label
                  title="Custom colour"
                  style={{ ...swatchStyle(custom), position: "relative", overflow: "hidden", background: custom ? o.color : "conic-gradient(from 90deg, #f87171, #fbbf24, #34d399, #60a5fa, #a78bfa, #f472b6, #f87171)" }}
                >
                  <input
                    type="color"
                    aria-label="Custom colour"
                    value={o.color}
                    onChange={(e) => set({ color: e.target.value })}
                    style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer", border: "none", padding: 0 }}
                  />
                </label>
              </div>
            </Field>
          )}

          {o.mode === "product" && (
            <>
              <Field label="Canvas">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 6 }}>
                  {SIZES.map((s) => (
                    <Chip key={s.px} on={o.size === s.px} onClick={() => set({ size: s.px })}>
                      <span className="mono" style={{ fontSize: 12.5 }}>{s.px}²</span>
                      <span style={{ display: "block", fontSize: 10, color: o.size === s.px ? "var(--accent)" : "var(--text-dim)", marginTop: 1 }}>{s.note}</span>
                    </Chip>
                  ))}
                </div>
              </Field>

              <Field label="Backdrop">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 6 }}>
                  {BACKDROPS.map((b) => (
                    <Chip key={b.c} on={o.backdrop === b.c} onClick={() => set({ backdrop: b.c })} align="left">
                      <span style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12.5 }}>
                        <span style={{ width: 12, height: 12, borderRadius: "50%", background: b.c, flexShrink: 0, boxShadow: "0 0 0 2px var(--surface-2), 0 0 0 2.5px var(--border-strong)" }} />
                        {b.name}
                      </span>
                      <span className="mono" style={{ display: "block", fontSize: 9.5, color: o.backdrop === b.c ? "var(--accent)" : "var(--text-dim)", marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.note}</span>
                    </Chip>
                  ))}
                </div>
              </Field>

              <Field
                label="Margin"
                aside={
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                    <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>{Math.round(o.margin * 100)}% · fills {fill}%</span>
                    <span className={fill >= 85 ? "pill pill-green" : "pill pill-amber"} style={{ fontSize: 9.5, padding: "1px 7px" }}>{fill >= 85 ? "≥85% ✓" : "under 85%"}</span>
                  </span>
                }
              >
                <input
                  type="range" min={0} max={15} step={0.5}
                  value={o.margin * 100}
                  aria-label="Margin around product"
                  onChange={(e) => set({ margin: Number(e.target.value) / 100 })}
                  style={{ width: "100%", accentColor: "var(--accent)" }}
                />
              </Field>

              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <p style={{ fontSize: 13, color: "var(--text)" }}>Contact shadow</p>
                  <p className="mono" style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 1 }}>soft ground shadow under the product</p>
                </div>
                <Switch on={o.shadow} onToggle={() => set({ shadow: !o.shadow })} label="Contact shadow" />
              </div>
            </>
          )}

          {o.mode !== "transparent" && (
            <Field
              label="Format"
              aside={o.format === "jpeg" ? <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>quality {Math.round(o.quality * 100)}</span> : null}
            >
              <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, width: 132, flexShrink: 0 }}>
                  <Chip on={o.format === "jpeg"} onClick={() => set({ format: "jpeg" })}><span className="mono" style={{ fontSize: 12 }}>JPG</span></Chip>
                  <Chip on={o.format === "png"} onClick={() => set({ format: "png" })}><span className="mono" style={{ fontSize: 12 }}>PNG</span></Chip>
                </div>
                {o.format === "jpeg" && (
                  <input
                    type="range" min={70} max={100} step={1}
                    value={Math.round(o.quality * 100)}
                    aria-label="JPEG quality"
                    onChange={(e) => set({ quality: Number(e.target.value) / 100 })}
                    style={{ flex: 1, minWidth: 0, accentColor: "var(--accent)" }}
                  />
                )}
              </div>
            </Field>
          )}

          {o.mode === "product" && (
            <div style={{ borderTop: "0.5px solid var(--border)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
              <p className="mono" style={{ fontSize: 10.5, color: "var(--text-muted)", lineHeight: 1.65 }}>
                <span style={{ color: "var(--text-secondary)" }}>Amazon.in · Flipkart</span> main image: pure white #FFFFFF, product fills ≥85% of the frame, at least 1000 px (2000 px for sharp zoom), JPG.
                <br />
                <span style={{ color: "var(--text-secondary)" }}>Flipkart apparel</span>: light grey with a soft shadow. <span style={{ color: "var(--text-secondary)" }}>Meesho</span>: square, 1000 px+, keep files under ~5 MB.
              </p>
              {(o.size !== DEFAULT_OPTIONS.size || o.margin !== DEFAULT_OPTIONS.margin || o.backdrop !== DEFAULT_OPTIONS.backdrop || o.format !== "jpeg") && (
                <button
                  onClick={() => set({ size: DEFAULT_OPTIONS.size, margin: DEFAULT_OPTIONS.margin, backdrop: DEFAULT_OPTIONS.backdrop, format: "jpeg", quality: DEFAULT_OPTIONS.quality })}
                  style={{ alignSelf: "flex-start", fontSize: 11.5, color: "var(--accent)", background: "transparent", border: "none", padding: 0, cursor: "pointer" }}
                >
                  Reset to marketplace defaults
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Field({ label, aside, children }: { label: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, minHeight: 18 }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>{label}</span>
        {aside}
      </div>
      {children}
    </div>
  );
}

function Chip({ on, onClick, children, align = "center" }: { on: boolean; onClick: () => void; children: ReactNode; align?: "center" | "left" }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      style={{
        minWidth: 0, padding: "8px 10px", borderRadius: 9, cursor: "pointer", textAlign: align,
        background: on ? "var(--accent-dim)" : "var(--surface-2)",
        border: on ? "0.5px solid var(--accent-border)" : "0.5px solid var(--border)",
        color: on ? "var(--text)" : "var(--text-muted)",
        transition: "background 0.18s var(--ease-lux), border-color 0.18s var(--ease-lux), color 0.18s",
      }}
    >
      {children}
    </button>
  );
}

function swatchStyle(on: boolean): CSSProperties {
  return {
    width: 30, height: 30, borderRadius: "50%", cursor: "pointer", padding: 0, flexShrink: 0,
    border: "none",
    boxShadow: on
      ? "0 0 0 2px var(--surface), 0 0 0 3.5px var(--accent)"
      : "inset 0 0 0 0.5px rgba(255,255,255,0.18), 0 0 0 0.5px rgba(0,0,0,0.4)",
    transition: "box-shadow 0.18s var(--ease-lux), transform 0.18s var(--ease-spring)",
    transform: on ? "scale(1.04)" : "none",
  };
}

function Swatch({ color, title, on, onClick }: { color: string; title: string; on: boolean; onClick: () => void }) {
  return <button type="button" title={title} aria-label={title} aria-pressed={on} onClick={onClick} style={{ ...swatchStyle(on), background: color }} />;
}

export function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onToggle} style={{ width: 40, height: 23, borderRadius: 999, border: "none", cursor: "pointer", background: on ? "var(--accent)" : "var(--surface-2)", boxShadow: on ? "none" : "inset 0 0 0 0.5px var(--border-strong)", position: "relative", transition: "background 0.18s", flexShrink: 0 }}>
      <span style={{ position: "absolute", top: 2.5, left: on ? 20 : 2.5, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left 0.2s var(--ease-lux)" }} />
    </button>
  );
}
