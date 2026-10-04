"use client";

import type { CSSProperties, ReactNode } from "react";

export const card: CSSProperties = {
  background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 16, minWidth: 0,
};

export const eyebrow: CSSProperties = {
  fontSize: 11, letterSpacing: "0.14em", color: "var(--text-dim)", textTransform: "uppercase",
};

export const ghostBtn: CSSProperties = {
  fontSize: 12.5, color: "var(--text-secondary)", background: "transparent",
  border: "0.5px solid var(--border-strong)", borderRadius: 8, padding: "7px 12px",
  cursor: "pointer", whiteSpace: "nowrap",
};

export const input: CSSProperties = {
  width: "100%", minWidth: 0, background: "var(--canvas)", color: "var(--text)",
  border: "0.5px solid var(--border-strong)", borderRadius: 9, padding: "10px 11px",
  fontSize: 14, outline: "none",
};

/** iOS-style switch row: title + hint on the left, switch on the right. */
export function Toggle({
  on, onChange, title, hint, disabled, children,
}: {
  on: boolean;
  onChange: (v: boolean) => void;
  title: string;
  hint?: ReactNode;
  disabled?: boolean;
  children?: ReactNode;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <button
        role="switch"
        aria-checked={on}
        disabled={disabled}
        onClick={() => onChange(!on)}
        style={{
          display: "flex", alignItems: "center", gap: 14, width: "100%", textAlign: "left",
          background: "transparent", border: "none", padding: 0, cursor: disabled ? "default" : "pointer",
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 14, fontWeight: 500, color: "var(--text)" }}>{title}</span>
          {hint && <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.45 }}>{hint}</span>}
        </span>
        <span
          aria-hidden
          style={{
            position: "relative", width: 40, height: 24, borderRadius: 12, flexShrink: 0,
            background: on ? "var(--accent)" : "rgba(255,255,255,0.1)",
            boxShadow: on ? "0 0 0 0.5px var(--accent)" : "inset 0 0 0 0.5px var(--border-strong)",
            transition: "background 0.25s var(--ease-lux)",
          }}
        >
          <span
            style={{
              position: "absolute", top: 3, left: on ? 19 : 3, width: 18, height: 18, borderRadius: 9,
              background: on ? "var(--on-accent)" : "var(--text-secondary)",
              transition: "left 0.3s var(--ease-spring), background 0.25s",
            }}
          />
        </span>
      </button>
      {children}
    </div>
  );
}

export function Divider() {
  return <div style={{ height: 0.5, background: "var(--border)" }} />;
}

/** Thin progress bar with a label — for the one-time background model. */
export function Progress({ pct, label }: { pct: number; label: string }) {
  const indeterminate = pct < 0;
  return (
    <div>
      <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.07)", overflow: "hidden", position: "relative" }}>
        <div
          style={{
            position: "absolute", top: 0, bottom: 0, left: indeterminate ? "-30%" : 0,
            width: indeterminate ? "30%" : `${pct}%`, borderRadius: 2,
            background: "linear-gradient(90deg, var(--accent-3), var(--accent))",
            transition: "width 0.3s var(--ease-lux)",
            animation: indeterminate ? "exam-indet 1.2s var(--ease-lux) infinite" : undefined,
          }}
        />
      </div>
      <p className="mono" style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6 }}>{label}</p>
      <style>{`@keyframes exam-indet { from { left: -30%; } to { left: 100%; } }`}</style>
    </div>
  );
}
