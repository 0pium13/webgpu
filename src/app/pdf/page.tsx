"use client";

/**
 * PDF Studio — the tools everyone needs weekly and currently rents from
 * ad-farms that upload the file: merge, page surgery (select / delete /
 * rotate / extract), images→PDF, PDF→images, compress. All in the tab.
 */

import { useRef, useState } from "react";
import Nav from "@/components/Nav";
import Dropzone from "@/components/Dropzone";
import PdfTextEditor from "@/components/pdf/PdfTextEditor";
import { PdfIcon } from "@/components/Icons";
import {
  renderThumbs, mergePdfs, rebuildPdf, imagesToPdf, pdfToImages, compressPdf,
  downloadBytes, type PageThumb,
} from "@/lib/pdf";

type Working = { label: string; pct: number } | null;

function baseName(f: File) {
  return f.name.replace(/\.[^.]+$/, "");
}

export default function PdfPage() {
  const [pdfs, setPdfs] = useState<File[]>([]);
  const [images, setImages] = useState<File[]>([]);
  const [thumbs, setThumbs] = useState<PageThumb[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deleted, setDeleted] = useState<Set<number>>(new Set());
  const [rotations, setRotations] = useState<Record<number, number>>({});
  const [working, setWorking] = useState<Working>(null);
  const [errMsg, setErrMsg] = useState("");
  const [editText, setEditText] = useState(false);
  const bufRef = useRef<ArrayBuffer | null>(null);

  async function handleFiles(files: File[]) {
    setErrMsg("");
    const imgs = files.filter((f) => f.type.startsWith("image/"));
    const docs = files.filter((f) => f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf"));
    if (!imgs.length && !docs.length) return alert("Drop PDFs or images.");
    if (imgs.length) { setImages((p) => [...p, ...imgs]); return; }

    const next = [...pdfs, ...docs];
    setPdfs(next);
    if (next.length === 1) {
      // single-PDF mode: load thumbnails for page surgery
      try {
        setThumbs([]); setSelected(new Set()); setDeleted(new Set()); setRotations({});
        const buf = await next[0].arrayBuffer();
        bufRef.current = buf;
        setWorking({ label: "Reading pages…", pct: 0 });
        await renderThumbs(buf, (t, n) => {
          setTotal(n);
          setThumbs((prev) => [...prev, t]);
          setWorking({ label: `Reading pages… ${t.index + 1}/${n}`, pct: Math.round(((t.index + 1) / n) * 100) });
        });
        setWorking(null);
      } catch (e: any) {
        console.error(e);
        setErrMsg(e?.message?.includes("password") ? "This PDF is password-protected." : "Couldn't read this PDF.");
        setWorking(null);
        setPdfs([]);
      }
    }
  }

  function reset() {
    setPdfs([]); setImages([]); setThumbs([]); setSelected(new Set());
    setDeleted(new Set()); setRotations({}); setWorking(null); setErrMsg("");
    setEditText(false);
    bufRef.current = null;
  }

  async function guard(label: string, fn: () => Promise<void>) {
    if (working) return;
    try {
      setErrMsg("");
      setWorking({ label, pct: -1 });
      await fn();
    } catch (e: any) {
      console.error(e);
      setErrMsg(e?.message ?? "Something went wrong");
    } finally {
      setWorking(null);
    }
  }

  const keepOrder = thumbs.map((t) => t.index).filter((i) => !deleted.has(i));
  const selOrder = keepOrder.filter((i) => selected.has(i));
  const file0 = pdfs[0];

  return (
    <div style={{ minHeight: "100vh" }}>
      <Nav />
      <div style={{ maxWidth: 980, margin: "0 auto", padding: "100px 24px 80px" }}>
        <div style={{ marginBottom: 36 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.15em", color: "var(--accent)", textTransform: "uppercase" }}>
            webgpu.in / pdf
          </span>
          <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 500, letterSpacing: "-0.03em", marginTop: 12, marginBottom: 10 }}>
            PDF Studio
          </h1>
          <p style={{ fontSize: 16, color: "var(--text-muted)", maxWidth: 580, lineHeight: 1.6 }}>
            Merge, split, rotate, compress, convert — everything the
            &quot;free PDF&quot; sites do after uploading your contract to their
            servers. Here the file never leaves this tab.
          </p>
        </div>

        {pdfs.length === 0 && images.length === 0 && (
          <Dropzone
            onFiles={handleFiles}
            accept="application/pdf,image/*"
            multiple
            icon={<PdfIcon size={26} />}
            title="Drop PDFs — or images to make one"
            subtitle="1 PDF = page tools · several = merge · JPG/PNG = images to PDF"
            cta="Choose files"
            footnote="Processed locally · Nothing uploaded · No page limits"
          />
        )}

        {/* images → PDF */}
        {images.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{images.length} image{images.length > 1 ? "s" : ""} → one PDF (in this order)</p>
              <button onClick={reset} style={ghost}>← Start over</button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {images.map((f, i) => (
                <span key={i} className="mono" style={{ fontSize: 11.5, background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 8, padding: "6px 10px" }}>
                  {i + 1}. {f.name.slice(0, 28)}
                </span>
              ))}
            </div>
            <div>
              <button
                disabled={!!working}
                onClick={() => guard("Building PDF…", async () => {
                  downloadBytes(await imagesToPdf(images), `${baseName(images[0])}.pdf`);
                })}
                style={primary}
              >
                ↓ Make PDF
              </button>
            </div>
          </div>
        )}

        {/* merge mode */}
        {pdfs.length > 1 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{pdfs.length} PDFs — merged in this order</p>
              <button onClick={reset} style={ghost}>← Start over</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {pdfs.map((f, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 10, padding: "10px 14px" }}>
                  <span className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>{i + 1}</span>
                  <span style={{ fontSize: 13.5, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{f.name}</span>
                  <button onClick={() => setPdfs((p) => { const n = [...p]; if (i > 0) [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })} style={mini}>↑</button>
                  <button onClick={() => setPdfs((p) => { const n = [...p]; if (i < n.length - 1) [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; })} style={mini}>↓</button>
                  <button onClick={() => setPdfs((p) => p.filter((_, k) => k !== i))} style={mini}>✕</button>
                </div>
              ))}
            </div>
            <div>
              <button
                disabled={!!working}
                onClick={() => guard("Merging…", async () => {
                  const bufs = await Promise.all(pdfs.map((f) => f.arrayBuffer()));
                  downloadBytes(await mergePdfs(bufs), `${baseName(pdfs[0])}-merged.pdf`);
                })}
                style={primary}
              >
                ↓ Merge {pdfs.length} PDFs
              </button>
            </div>
          </div>
        )}

        {/* single-PDF text editing */}
        {pdfs.length === 1 && editText && bufRef.current && (
          <PdfTextEditor
            data={bufRef.current}
            fileName={file0.name}
            onBack={() => setEditText(false)}
          />
        )}

        {/* single-PDF page surgery */}
        {pdfs.length === 1 && !editText && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 }}>
              <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
                {file0.name}
                {total > 0 && <span className="mono" style={{ color: "var(--text-dim)" }}> · {total} pages</span>}
                {selected.size > 0 && <span style={{ color: "var(--accent)" }}> · {selected.size} selected</span>}
              </p>
              <button onClick={reset} style={ghost}>← New file</button>
            </div>

            {/* toolbar */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                disabled={!!working || selOrder.length === 0}
                onClick={() => guard("Extracting…", async () => {
                  downloadBytes(await rebuildPdf(bufRef.current!, selOrder, rotations), `${baseName(file0)}-pages.pdf`);
                })}
                style={{ ...secondary, opacity: selOrder.length ? 1 : 0.45 }}
              >
                Extract selected
              </button>
              <button
                disabled={!!working || selected.size === 0}
                onClick={() => {
                  setDeleted((d) => new Set([...d, ...selected]));
                  setSelected(new Set());
                }}
                style={{ ...secondary, opacity: selected.size ? 1 : 0.45 }}
              >
                Delete selected
              </button>
              <button
                disabled={!!working || selected.size === 0}
                onClick={() => setRotations((r) => {
                  const n = { ...r };
                  for (const i of selected) n[i] = ((n[i] ?? 0) + 90) % 360;
                  return n;
                })}
                style={{ ...secondary, opacity: selected.size ? 1 : 0.45 }}
              >
                ⟳ Rotate selected
              </button>
              <button
                disabled={!!working || thumbs.length === 0}
                onClick={() => setEditText(true)}
                style={{ ...secondary, opacity: thumbs.length ? 1 : 0.45 }}
              >
                ✎ Edit text
              </button>
              <span style={{ flex: 1 }} />
              <button
                disabled={!!working}
                onClick={() => guard("Compressing…", async () => {
                  const out = await compressPdf(bufRef.current!, (d, n) => setWorking({ label: `Compressing… ${d}/${n}`, pct: Math.round((d / n) * 100) }));
                  const saved = out.byteLength < (bufRef.current!.byteLength) ? ` (${((bufRef.current!.byteLength) / out.byteLength).toFixed(1)}× smaller)` : "";
                  downloadBytes(out, `${baseName(file0)}-compressed.pdf`);
                  if (saved) setErrMsg("");
                })}
                style={secondary}
              >
                Compress
              </button>
              <button
                disabled={!!working}
                onClick={() => guard("Rendering…", async () => {
                  const zip = await pdfToImages(bufRef.current!, (d, n) => setWorking({ label: `Rendering… ${d}/${n}`, pct: Math.round((d / n) * 100) }));
                  downloadBytes(zip, `${baseName(file0)}-pages.zip`);
                })}
                style={secondary}
              >
                To images (ZIP)
              </button>
              <button
                disabled={!!working || (deleted.size === 0 && Object.keys(rotations).length === 0)}
                onClick={() => guard("Saving…", async () => {
                  downloadBytes(await rebuildPdf(bufRef.current!, keepOrder, rotations), `${baseName(file0)}-edited.pdf`);
                })}
                style={{ ...primary, opacity: deleted.size || Object.keys(rotations).length ? 1 : 0.45 }}
              >
                ↓ Save edited PDF
              </button>
            </div>
            <p className="mono" style={{ fontSize: 11, color: "var(--text-dim)" }}>
              Click pages to select · Compress rasterizes pages (great for scans, text becomes image)
            </p>

            {/* thumbnails */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
              {thumbs.map((t) => {
                const isSel = selected.has(t.index);
                const isDel = deleted.has(t.index);
                const rot = rotations[t.index] ?? 0;
                return (
                  <div
                    key={t.index}
                    onClick={() => {
                      if (isDel) { setDeleted((d) => { const n = new Set(d); n.delete(t.index); return n; }); return; }
                      setSelected((s) => { const n = new Set(s); if (n.has(t.index)) n.delete(t.index); else n.add(t.index); return n; });
                    }}
                    style={{
                      position: "relative", cursor: "pointer", borderRadius: 10, overflow: "hidden",
                      border: isSel ? "1.5px solid var(--accent)" : "0.5px solid var(--border)",
                      background: "var(--surface)", opacity: isDel ? 0.28 : 1, transition: "all 0.15s",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 8 }}>
                      <div
                        style={{ transform: `rotate(${rot}deg)`, transition: "transform 0.25s var(--ease-lux)", lineHeight: 0, maxWidth: "100%" }}
                        ref={(el) => { if (el && !el.hasChildNodes()) el.appendChild(t.canvas); }}
                      />
                    </div>
                    <span className="mono" style={{ position: "absolute", bottom: 6, left: 8, fontSize: 10, color: isSel ? "var(--accent)" : "var(--text-dim)", background: "rgba(10,10,11,0.7)", padding: "1px 6px", borderRadius: 5 }}>
                      {t.index + 1}{isDel ? " · deleted — click to restore" : ""}{rot ? ` · ${rot}°` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {working && (
          <div style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", background: "rgba(10,10,11,0.9)", backdropFilter: "blur(8px)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "10px 18px", display: "flex", alignItems: "center", gap: 12, zIndex: 50 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", animation: "pulse 1s ease-in-out infinite" }} />
            <span style={{ fontSize: 13 }}>{working.label}</span>
            {working.pct >= 0 && (
              <div style={{ width: 120, height: 3, background: "rgba(255,255,255,0.1)", borderRadius: 4, overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${working.pct}%`, background: "var(--accent)", transition: "width 0.3s" }} />
              </div>
            )}
          </div>
        )}
        {errMsg && <p style={{ color: "#ef4444", fontSize: 13, marginTop: 12 }}>{errMsg}</p>}
      </div>
    </div>
  );
}

const ghost: React.CSSProperties = {
  fontSize: 13, color: "var(--text-muted)", background: "transparent",
  border: "0.5px solid var(--border)", borderRadius: 8, padding: "7px 14px", cursor: "pointer",
};
const primary: React.CSSProperties = {
  background: "var(--accent)", color: "var(--on-accent)", border: "none", borderRadius: 10,
  padding: "11px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer",
};
const secondary: React.CSSProperties = {
  background: "var(--surface-2)", color: "var(--text)", border: "0.5px solid var(--border)",
  borderRadius: 10, padding: "11px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer",
};
const mini: React.CSSProperties = {
  background: "transparent", color: "var(--text-muted)", border: "0.5px solid var(--border)",
  borderRadius: 6, padding: "3px 9px", fontSize: 12, cursor: "pointer",
};
