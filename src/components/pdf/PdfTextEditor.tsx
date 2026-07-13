"use client";

/**
 * Click-to-edit text inside a PDF. Hover shows the clickable runs; click one,
 * retype it, done — the live preview patches instantly, and Save burns every
 * edit into a real PDF. "Add text" drops brand-new text anywhere.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { renderEditorPage, sampleBackground, cssFontFor, applyEdits, type TextRun, type PdfEdit, type EditorPage } from "@/lib/pdfEdit";
import { downloadBytes } from "@/lib/pdf";

export default function PdfTextEditor({ data, fileName, onBack }: { data: ArrayBuffer; fileName: string; onBack: () => void }) {
  const [pageIdx, setPageIdx] = useState(0);
  const [page, setPage] = useState<EditorPage | null>(null);
  const [edits, setEdits] = useState<PdfEdit[]>([]);
  const [editing, setEditing] = useState<{ run: TextRun; value: string } | null>(null);
  const [addMode, setAddMode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState("");
  const holderRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (idx: number) => {
    try {
      setErrMsg("");
      setEditing(null);
      const p = await renderEditorPage(data, idx);
      setPage(p);
      const holder = holderRef.current;
      if (holder) {
        holder.innerHTML = "";
        p.canvas.style.width = "100%";
        p.canvas.style.borderRadius = "8px";
        holder.appendChild(p.canvas);
      }
    } catch (e: any) {
      console.error(e);
      setErrMsg(e?.message ?? "Couldn't render this page");
    }
  }, [data]);

  useEffect(() => { load(pageIdx); }, [pageIdx, load]);

  function startEdit(run: TextRun) {
    if (addMode) return;
    setEditing({ run, value: run.str });
  }

  function commitEdit() {
    if (!editing || !page) return;
    const { run, value } = editing;
    if (value !== run.str) {
      setEdits((prev) => [...prev, {
        page: pageIdx,
        pdfX: run.pdfX, pdfY: run.pdfY, pdfW: run.pdfW, pdfSize: run.pdfSize,
        newText: value,
        origStr: run.str,
        fontKey: run.fontKey,
        color: run.color,
        bg: sampleBackground(page.canvas, run),
      }]);
    }
    setEditing(null);
  }

  function addTextAt(e: React.MouseEvent<HTMLDivElement>) {
    if (!addMode || !page) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const relX = (e.clientX - rect.left) / rect.width;
    const relY = (e.clientY - rect.top) / rect.height;
    const pdfX = relX * page.pdfW;
    const pdfY = page.pdfH - relY * page.pdfH;
    const text = window.prompt("Text to add:");
    if (text?.trim()) {
      setEdits((prev) => [...prev, {
        page: pageIdx, pdfX, pdfY, pdfW: 0, pdfSize: 12,
        newText: text, origStr: "", fontKey: "Helvetica", color: [0, 0, 0],
        bg: [1, 1, 1], isNew: true,
      }]);
    }
    setAddMode(false);
  }

  async function save() {
    try {
      setBusy(true);
      const bytes = await applyEdits(data, edits);
      downloadBytes(bytes, `${fileName.replace(/\.pdf$/i, "")}-edited.pdf`);
    } catch (e: any) {
      console.error(e);
      setErrMsg(e?.message ?? "Save failed");
    } finally {
      setBusy(false);
    }
  }

  const pageEdits = edits.filter((ed) => ed.page === pageIdx);
  const displayScale = 1; // canvas is styled to 100% width; overlay uses % positioning

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button onClick={onBack} style={ghost}>← Pages</button>
        <span style={{ fontSize: 13.5, fontWeight: 500 }}>Edit text</span>
        {page && page.numPages > 1 && (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <button style={mini} disabled={pageIdx === 0} onClick={() => setPageIdx(pageIdx - 1)}>‹</button>
            <span className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>{pageIdx + 1} / {page.numPages}</span>
            <button style={mini} disabled={pageIdx >= page.numPages - 1} onClick={() => setPageIdx(pageIdx + 1)}>›</button>
          </span>
        )}
        <button onClick={() => setAddMode(!addMode)} style={{ ...ghost, borderColor: addMode ? "var(--accent)" : "var(--border)", color: addMode ? "var(--accent)" : "var(--text-muted)" }}>
          {addMode ? "Click the page to place text…" : "+ Add text"}
        </button>
        <span style={{ flex: 1 }} />
        {edits.length > 0 && (
          <>
            <button onClick={() => setEdits([])} style={ghost}>Reset ({edits.length})</button>
            <button onClick={save} disabled={busy} style={primary}>{busy ? "Saving…" : `↓ Save edited PDF (${edits.length})`}</button>
          </>
        )}
      </div>
      <p className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>
        Hover to see editable text · click a line to retype it · font, colour and spacing are matched automatically
      </p>

      <div
        onClick={addTextAt}
        style={{ position: "relative", lineHeight: 0, background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: 10, cursor: addMode ? "crosshair" : "default" }}
      >
        <div ref={holderRef} style={{ position: "relative" }} />
        {/* clickable run overlay — positioned in % of the rendered canvas */}
        {page && !addMode && (
          <div style={{ position: "absolute", inset: 10, pointerEvents: editing ? "none" : "auto" }}>
            {page.runs.map((r, i) => (
              <div
                key={i}
                onClick={(e) => { e.stopPropagation(); startEdit(r); }}
                title={r.str}
                style={{
                  position: "absolute",
                  left: `${(r.x / page.canvas.width) * 100}%`,
                  top: `${(r.y / page.canvas.height) * 100}%`,
                  width: `${(r.w / page.canvas.width) * 100}%`,
                  height: `${(r.h / page.canvas.height) * 100}%`,
                  cursor: "text",
                  borderRadius: 3,
                  border: "1px solid transparent",
                  transition: "border-color 0.12s, background 0.12s",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; e.currentTarget.style.background = "rgba(99,102,241,0.10)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = "transparent"; e.currentTarget.style.background = "transparent"; }}
              />
            ))}
            {/* live previews of committed edits on this page — matched font + colour */}
            {pageEdits.map((ed, i) => {
              if (ed.isNew || !page) return null;
              const css = cssFontFor(ed.fontKey);
              return (
                <div key={"ed" + i} style={{
                  position: "absolute",
                  left: `${(ed.pdfX * page.scale / page.canvas.width) * 100}%`,
                  top: `${((page.pdfH - ed.pdfY - ed.pdfSize) * page.scale / page.canvas.height) * 100}%`,
                  minWidth: `${(Math.max(ed.pdfW, ed.pdfSize * ed.newText.length * 0.55) * page.scale / page.canvas.width) * 100}%`,
                  height: `${(ed.pdfSize * 1.35 * page.scale / page.canvas.height) * 100}%`,
                  display: "flex",
                  alignItems: "center",
                  paddingLeft: 1,
                  background: `rgb(${ed.bg.map((v) => Math.round(v * 255)).join(",")})`,
                  color: `rgb(${ed.color.map((v) => Math.round(v * 255)).join(",")})`,
                  fontSize: `${ed.pdfSize * page.scale * displayScale}px`,
                  lineHeight: 1,
                  whiteSpace: "nowrap",
                  overflow: "visible",
                  fontFamily: css.fontFamily,
                  fontWeight: css.fontWeight,
                  fontStyle: css.fontStyle,
                }}>{ed.newText}</div>
              );
            })}
          </div>
        )}

        {/* inline editor input */}
        {editing && page && (
          <input
            autoFocus
            value={editing.value}
            onChange={(e) => setEditing({ ...editing, value: e.target.value })}
            onKeyDown={(e) => { if (e.key === "Enter") commitEdit(); if (e.key === "Escape") setEditing(null); }}
            onBlur={commitEdit}
            style={{
              position: "absolute",
              left: 10 + (editing.run.x / page.canvas.width) * (holderRef.current?.clientWidth ?? page.canvas.width),
              top: 10 + (editing.run.y / page.canvas.height) * (holderRef.current?.clientHeight ?? page.canvas.height) - 4,
              minWidth: 160,
              background: "#fff",
              color: "#111",
              border: "1.5px solid var(--accent)",
              borderRadius: 6,
              padding: "4px 8px",
              fontSize: 14,
              zIndex: 20,
              boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            }}
          />
        )}
      </div>
      {errMsg && <p style={{ color: "#ef4444", fontSize: 13 }}>{errMsg}</p>}
    </div>
  );
}

const ghost: React.CSSProperties = {
  fontSize: 13, color: "var(--text-muted)", background: "transparent",
  border: "0.5px solid var(--border)", borderRadius: 8, padding: "7px 14px", cursor: "pointer",
};
const primary: React.CSSProperties = {
  background: "var(--accent)", color: "#fff", border: "none", borderRadius: 10,
  padding: "9px 16px", fontSize: 13.5, fontWeight: 500, cursor: "pointer",
};
const mini: React.CSSProperties = {
  background: "transparent", color: "var(--text-muted)", border: "0.5px solid var(--border)",
  borderRadius: 6, padding: "3px 10px", fontSize: 13, cursor: "pointer",
};
