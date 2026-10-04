"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CUSTOM_ID, GROUP_ORDER, presetsFor, type ExamMode, type ExamPreset } from "@/lib/examPresets";

type Option = { id: string; label: string; group: string; spec: string; verified: boolean; hay: string };

const spec = (p: Pick<ExamPreset, "width" | "height" | "minKB" | "maxKB">) =>
  `${p.width}×${p.height} · ${p.minKB}–${p.maxKB} KB`;

/** Searchable, grouped exam picker (combobox + listbox). */
export default function PresetPicker({
  mode,
  value,
  current,
  onChange,
}: {
  mode: ExamMode;
  value: string;
  /** resolved preset (for the custom spec line) */
  current: ExamPreset;
  onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const options = useMemo<Option[]>(() => {
    const list = presetsFor(mode)
      .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
      .map((p) => ({
        id: p.id, label: p.label, group: p.group, spec: spec(p), verified: p.verified,
        hay: `${p.label} ${p.group} ${p.exam} ${p.aliases ?? ""}`.toLowerCase(),
      }));
    list.push({ id: CUSTOM_ID, label: "Custom size", group: "Other", spec: "your own px & KB", verified: false, hay: "custom other own size manual" });
    return list;
  }, [mode]);

  const filtered = useMemo(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    return terms.length ? options.filter((o) => terms.every((t) => o.hay.includes(t))) : options;
  }, [q, options]);

  useEffect(() => {
    if (!open) return;
    // focus search without scrolling the page on mobile
    searchRef.current?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent) => { if (!rootRef.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function choose(id: string) {
    onChange(id);
    setOpen(false);
    setQ("");
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((i) => Math.min(filtered.length - 1, i + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === "Enter") { e.preventDefault(); if (filtered[active]) choose(filtered[active].id); }
    else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
  }

  const sel = options.find((o) => o.id === value);
  const heads = filtered.map((o, i) => i === 0 || filtered[i - 1].group !== o.group);

  function toggle() {
    if (!open) setActive(Math.max(0, options.findIndex((o) => o.id === value)));
    setOpen(!open);
  }

  return (
    <div ref={rootRef} style={{ position: "relative" }}>
      <button
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        style={{
          width: "100%", display: "flex", alignItems: "center", gap: 12, textAlign: "left", cursor: "pointer",
          background: "var(--surface)", border: `0.5px solid ${open ? "var(--accent-border)" : "var(--border-strong)"}`,
          borderRadius: 14, padding: "12px 14px", transition: "border-color 0.2s",
          boxShadow: open ? "0 0 0 3px rgba(228,192,120,0.08)" : "none",
        }}
      >
        <span style={{ flex: 1, minWidth: 0 }}>
          <span className="mono" style={{ display: "block", fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-dim)" }}>
            Exam · {sel?.group ?? "Custom"}
          </span>
          <span style={{ display: "block", fontSize: 15.5, fontWeight: 500, color: "var(--text)", marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {sel?.label ?? "Custom size"}
          </span>
          <span className="mono" style={{ display: "block", fontSize: 11, color: "var(--accent)", marginTop: 3 }}>{spec(current)}</span>
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden
          style={{ flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.3s var(--ease-lux)" }}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div
          style={{
            position: "absolute", left: 0, right: 0, top: "calc(100% + 6px)", zIndex: 40,
            background: "var(--surface-2)", border: "0.5px solid var(--border-strong)", borderRadius: 14,
            boxShadow: "0 30px 60px -20px rgba(0,0,0,0.9)", overflow: "hidden", animation: "fadein 0.18s ease-out",
          }}
        >
          <div style={{ padding: 10, borderBottom: "0.5px solid var(--border)" }}>
            <input
              ref={searchRef}
              role="combobox"
              aria-expanded
              aria-controls="exam-preset-list"
              aria-activedescendant={filtered[active] ? `exam-opt-${filtered[active].id}` : undefined}
              value={q}
              onChange={(e) => { setQ(e.target.value); setActive(0); }}
              onKeyDown={onKey}
              placeholder="Search — UPSC, SSC CGL, IBPS clerk, NEET…"
              style={{
                width: "100%", background: "var(--canvas)", color: "var(--text)", fontSize: 14,
                border: "0.5px solid var(--border-strong)", borderRadius: 9, padding: "10px 12px", outline: "none",
              }}
            />
          </div>
          <div ref={listRef} id="exam-preset-list" role="listbox" style={{ maxHeight: "min(360px, 52vh)", overflowY: "auto", padding: "4px 6px 8px", overscrollBehavior: "contain" }}>
            {filtered.length === 0 && (
              <p style={{ padding: "14px 10px", fontSize: 13, color: "var(--text-muted)" }}>
                No match — pick <button onClick={() => choose(CUSTOM_ID)} style={{ color: "var(--accent)", background: "none", border: "none", padding: 0, cursor: "pointer", fontSize: 13 }}>Custom size</button> and type your notice&apos;s numbers.
              </p>
            )}
            {filtered.map((o, i) => {
              const head = heads[i];
              const on = o.id === value;
              return (
                <div key={o.id}>
                  {head && (
                    <p className="mono" style={{ fontSize: 10, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-dim)", padding: "10px 8px 4px" }}>{o.group}</p>
                  )}
                  <div
                    id={`exam-opt-${o.id}`}
                    role="option"
                    aria-selected={on}
                    data-idx={i}
                    onPointerEnter={() => setActive(i)}
                    onClick={() => choose(o.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 10, padding: "9px 10px", borderRadius: 9, cursor: "pointer",
                      background: i === active ? "rgba(255,255,255,0.05)" : "transparent",
                    }}
                  >
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: "block", fontSize: 13.5, color: on ? "var(--accent)" : "var(--text)", fontWeight: on ? 500 : 400, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{o.label}</span>
                      <span className="mono" style={{ display: "block", fontSize: 10.5, color: "var(--text-dim)", marginTop: 2 }}>{o.spec}</span>
                    </span>
                    {o.id !== CUSTOM_ID && (
                      <span title={o.verified ? "Checked against the official notice" : "From secondary sources — verify"}
                        style={{ width: 6, height: 6, borderRadius: 3, flexShrink: 0, background: o.verified ? "var(--green)" : "var(--amber)" }} />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
