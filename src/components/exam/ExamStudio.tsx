"use client";

import { useEffect, useMemo, useState } from "react";
import PresetPicker from "./PresetPicker";
import SpecCard from "./SpecCard";
import Workspace from "./Workspace";
import { card, eyebrow, input } from "./ui";
import { ExamPhotoIcon, SignatureIcon, ThumbprintIcon, PdfIcon } from "@/components/Icons";
import {
  CUSTOM_DEFAULTS, CUSTOM_ID, MODE_LABEL, counterpart, customPreset, findPreset,
  type CustomSpec, type ExamMode,
} from "@/lib/examPresets";

const MODES: { id: ExamMode; Icon: typeof ExamPhotoIcon }[] = [
  { id: "photo", Icon: ExamPhotoIcon },
  { id: "signature", Icon: SignatureIcon },
  { id: "thumb", Icon: ThumbprintIcon },
  { id: "declaration", Icon: PdfIcon },
];

const STORE = "exam-photo:v1";
const DEFAULT_EXAM = "upsc";

function presetsForExam(examId: string): Record<ExamMode, string> {
  return {
    photo: counterpart(examId, "photo"),
    signature: counterpart(examId, "signature"),
    thumb: counterpart(examId, "thumb"),
    declaration: counterpart(examId, "declaration"),
  };
}

export default function ExamStudio() {
  const [mode, setMode] = useState<ExamMode>("photo");
  const [picked, setPicked] = useState<Record<ExamMode, string>>(() => presetsForExam(DEFAULT_EXAM));
  const [custom, setCustom] = useState<Record<ExamMode, CustomSpec>>(CUSTOM_DEFAULTS);
  const [visited, setVisited] = useState<Set<ExamMode>>(() => new Set(["photo"]));

  // ?exam=ibps&mode=signature deep links win over the remembered choice
  useEffect(() => {
    let exam: string | null = null;
    let m: string | null = null;
    try {
      const qs = new URLSearchParams(window.location.search);
      exam = qs.get("exam");
      m = qs.get("mode");
      if (!exam && !m) {
        const saved = JSON.parse(localStorage.getItem(STORE) ?? "null");
        exam = saved?.exam ?? null;
        m = saved?.mode ?? null;
      }
    } catch { /* storage blocked — defaults are fine */ }
    // URL + storage only exist after hydration, so this can't be initial state
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (exam && findPreset(counterpart(exam, "photo"))?.examId === exam) setPicked(presetsForExam(exam));
    if (m && MODES.some((x) => x.id === m)) switchMode(m as ExamMode);
  }, []);

  const examId = findPreset(picked[mode])?.examId ?? CUSTOM_ID;
  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify({ exam: examId, mode })); } catch { /* ignore */ }
  }, [examId, mode]);

  function switchMode(m: ExamMode) {
    setMode(m);
    setVisited((v) => (v.has(m) ? v : new Set(v).add(m)));
  }

  function pick(id: string) {
    const p = findPreset(id);
    // keep the other modes on the same exam when it has them
    if (p) setPicked((cur) => {
      const next = { ...cur, [mode]: id };
      for (const m of MODES) if (m.id !== mode) {
        const twin = counterpart(p.examId, m.id);
        if (findPreset(twin)?.examId === p.examId) next[m.id] = twin;
      }
      return next;
    });
    else setPicked((cur) => ({ ...cur, [mode]: id }));
  }

  const resolved = useMemo(() => {
    const r = {} as Record<ExamMode, ReturnType<typeof customPreset>>;
    for (const m of MODES) r[m.id] = findPreset(picked[m.id]) ?? customPreset(m.id, custom[m.id]);
    return r;
  }, [picked, custom]);
  const preset = resolved[mode];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div role="tablist" aria-label="What are you resizing?" style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 3, background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 14, padding: 4 }}>
        {MODES.map(({ id, Icon }) => {
          const on = id === mode;
          return (
            <button
              key={id}
              role="tab"
              aria-selected={on}
              onClick={() => switchMode(id)}
              style={{
                minWidth: 0, display: "flex", flexDirection: "column", alignItems: "center", gap: 5,
                padding: "10px 2px 9px", borderRadius: 10, border: "none", cursor: "pointer",
                background: on ? "var(--surface-2)" : "transparent",
                boxShadow: on ? "inset 0 0 0 0.5px var(--border-strong), 0 8px 20px -12px rgba(0,0,0,0.9)" : "none",
                color: on ? "var(--accent)" : "var(--text-muted)",
                transition: "background 0.2s var(--ease-lux), color 0.2s",
              }}
            >
              <Icon size={19} />
              <span style={{ fontSize: 12, fontWeight: 500, color: on ? "var(--text)" : "var(--text-muted)", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {MODE_LABEL[id]}
              </span>
            </button>
          );
        })}
      </div>

      <PresetPicker mode={mode} value={picked[mode]} current={preset} onChange={pick} />

      {picked[mode] === CUSTOM_ID && (
        <CustomFields
          key={mode}
          mode={mode}
          value={custom[mode]}
          onChange={(c) => setCustom((cur) => ({ ...cur, [mode]: c }))}
        />
      )}

      <SpecCard preset={preset} />

      {MODES.map(({ id }) => visited.has(id) && (
        <div key={id} role="tabpanel" hidden={id !== mode}>
          <Workspace mode={id} preset={resolved[id]} />
        </div>
      ))}
    </div>
  );
}

function CustomFields({ mode, value, onChange }: { mode: ExamMode; value: CustomSpec; onChange: (c: CustomSpec) => void }) {
  const [draft, setDraft] = useState(() => toDraft(value));

  // commit after typing settles so "350" doesn't reframe at "3" and "35"
  useEffect(() => {
    const id = setTimeout(() => {
      const n = (s: string, lo: number, hi: number, fb: number) => {
        const v = Math.round(Number(s));
        return Number.isFinite(v) && v >= lo ? Math.min(v, hi) : fb;
      };
      const width = n(draft.width, 16, 4000, value.width);
      const height = n(draft.height, 16, 4000, value.height);
      const minKB = n(draft.minKB, 1, 5000, value.minKB);
      const maxKB = Math.max(minKB, n(draft.maxKB, 1, 5000, value.maxKB));
      const dpiN = Math.round(Number(draft.dpi));
      const dpi = draft.dpi.trim() && Number.isFinite(dpiN) && dpiN >= 50 && dpiN <= 1200 ? dpiN : null;
      const next = { ...value, width, height, minKB, maxKB, dpi };
      if (JSON.stringify(next) !== JSON.stringify(value)) onChange(next);
    }, 450);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  const field = (k: keyof typeof draft, label: string, placeholder?: string) => (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
      <span className="mono" style={{ ...eyebrow, fontSize: 10 }}>{label}</span>
      <input
        value={draft[k]}
        placeholder={placeholder}
        inputMode="numeric"
        onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value.replace(/[^\d]/g, "") }))}
        style={{ ...input, fontFamily: "var(--font-geist-mono), ui-monospace, monospace" }}
      />
    </label>
  );

  return (
    <div style={{ ...card, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        {field("width", "Width px")}
        {field("height", "Height px")}
        {field("minKB", "Min KB")}
        {field("maxKB", "Max KB")}
        {field("dpi", "DPI (optional)", "e.g. 200")}
        <label style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
          <span className="mono" style={{ ...eyebrow, fontSize: 10 }}>File type</span>
          <select
            value={value.ext}
            onChange={(e) => onChange({ ...value, ext: e.target.value as CustomSpec["ext"] })}
            style={{ ...input, cursor: "pointer", appearance: "none" }}
          >
            <option value="jpg">.jpg</option>
            <option value="jpeg">.jpeg</option>
          </select>
        </label>
      </div>
      {mode === "photo" && (
        <label style={check}>
          <input type="checkbox" checked={value.nameDate} onChange={(e) => onChange({ ...value, nameDate: e.target.checked })} style={checkBox} />
          Notice asks for name & date on the photo
        </label>
      )}
      <label style={check}>
        <input type="checkbox" checked={value.allowGrow} onChange={(e) => onChange({ ...value, allowGrow: e.target.checked })} style={checkBox} />
        If the minimum KB is out of reach, use larger pixels (same shape) instead of padding the file
      </label>
    </div>
  );
}

const check: React.CSSProperties = { display: "flex", alignItems: "flex-start", gap: 9, fontSize: 13, color: "var(--text-secondary)", cursor: "pointer", lineHeight: 1.45 };
const checkBox: React.CSSProperties = { accentColor: "var(--accent)", width: 16, height: 16, flexShrink: 0, marginTop: 1 };

function toDraft(c: CustomSpec) {
  return {
    width: String(c.width), height: String(c.height), minKB: String(c.minKB),
    maxKB: String(c.maxKB), dpi: c.dpi ? String(c.dpi) : "",
  };
}
