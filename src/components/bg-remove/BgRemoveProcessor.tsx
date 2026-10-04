"use client";

import { useEffect, useRef, useState } from "react";
import type { ImgFile } from "@/app/bg-remove/page";
import { BgRemoveIcon } from "@/components/Icons";
import { computeMask } from "@/lib/rmbgClient";
import OutputOptionsPanel from "./OutputOptions";
import {
  cutoutCanvas, encodeOutput, formatBytes, optionsKey, outputDims, outputExt, outputName,
  releaseCanvas, triggerDownload, type CutMeta, type OutputOptions,
} from "./compose";

type Phase = "idle" | "loading-model" | "processing" | "done" | "error";

const CHECKER =
  "repeating-conic-gradient(#2a2a2e 0% 25%, #18181b 0% 50%) 50% / 20px 20px";

export default function BgRemoveProcessor({
  input,
  onReset,
  options,
  onOptionsChange,
  onAddMore,
}: {
  input: ImgFile;
  onReset: () => void;
  options: OutputOptions;
  onOptionsChange: (o: OutputOptions) => void;
  /** switch to batch mode with this image plus the new files */
  onAddMore: (files: File[]) => void;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [dlPct, setDlPct] = useState(0);
  const [msg, setMsg] = useState("");
  const [out, setOut] = useState<{ url: string; blob: Blob; w: number; h: number; key: string } | null>(null);
  const [rendering, setRendering] = useState(false);
  // the one full-size cutout stays decoded so option changes re-render live
  const cutRef = useRef<{ canvas: HTMLCanvasElement; meta: CutMeta } | null>(null);
  const outRef = useRef(out);
  const key = optionsKey(options);
  const keyRef = useRef(key);
  useEffect(() => { outRef.current = out; keyRef.current = key; });

  useEffect(() => () => {
    if (cutRef.current) releaseCanvas(cutRef.current.canvas);
    cutRef.current = null;
    if (outRef.current) URL.revokeObjectURL(outRef.current.url);
  }, []);

  async function render(o: OutputOptions) {
    const cut = cutRef.current;
    if (!cut) return;
    const blob = await encodeOutput(cut.canvas, cut.meta, o);
    if (optionsKey(o) !== keyRef.current) return; // superseded by a newer render
    const [w, h] = outputDims(cut.meta, o);
    setOut((prev) => {
      if (prev) URL.revokeObjectURL(prev.url);
      return { url: URL.createObjectURL(blob), blob, w, h, key: optionsKey(o) };
    });
  }

  // live re-render when output options change after processing
  useEffect(() => {
    if (phase !== "done" || !cutRef.current || outRef.current?.key === key) return;
    let live = true;
    setRendering(true);
    const t = window.setTimeout(() => {
      render(options).catch(console.error).finally(() => live && setRendering(false));
    }, 140);
    return () => { live = false; window.clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, phase]);

  async function run() {
    try {
      setPhase("loading-model");
      setMsg("Loading AI model…");

      const progress = (p: { status?: string; loaded?: number; total?: number }) => {
        if (p.status === "progress" && p.total && p.loaded != null) {
          setDlPct(Math.round((p.loaded / p.total) * 100));
          setMsg(`Downloading model… ${Math.round((p.loaded / p.total) * 100)}%`);
        }
      };

      // model load + inference run in a Web Worker (rmbgClient), so the
      // page stays responsive; compositing stays here (needs the DOM)
      const mask = await computeMask(input.file, {
        progress,
        onFallback: () => setMsg("Falling back to CPU…"),
        onProcessing: () => { setPhase("processing"); setMsg("Removing background…"); },
      });

      if (cutRef.current) releaseCanvas(cutRef.current.canvas);
      cutRef.current = await cutoutCanvas(input.file, mask);
      await render(options);
      setPhase("done");
    } catch (err) {
      console.error(err);
      setMsg(err instanceof Error ? err.message : "Something went wrong");
      setPhase("error");
    }
  }

  function download() {
    if (!out) return;
    triggerDownload(out.blob, outputName(input.file.name, options));
  }

  const busy = phase === "loading-model" || phase === "processing";
  const opaque = options.mode !== "transparent" && phase === "done";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "100%" }}>
          {input.file.name} · {formatBytes(input.file.size)}
        </p>
        <div style={{ display: "flex", gap: 8 }}>
          <label title="Add more images — switches to batch mode" style={{ ...ghostSm, display: "inline-flex", alignItems: "center", gap: 6, cursor: busy ? "default" : "pointer", opacity: busy ? 0.4 : 1 }}>
            <input
              type="file" accept="image/*" multiple disabled={busy} style={{ display: "none" }}
              onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) onAddMore(f); }}
            />
            <svg width="11" height="11" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden><path d="M7 2v10M2 7h10" /></svg>
            Batch
          </label>
          <button onClick={onReset} style={ghostSm}>
            ← New image
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* original */}
        <div style={{ background: "#000", border: "0.5px solid var(--border)", borderRadius: 12, overflow: "hidden", aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
          <img src={input.url} alt="original" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          <span style={tag}>Original</span>
        </div>

        {/* result */}
        <div style={{ background: opaque ? "#0d0c0a" : CHECKER, border: "0.5px solid var(--border)", borderRadius: 12, overflow: "hidden", aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center", position: "relative" }}>
          {phase === "done" && out ? (
            <>
              <img src={out.url} alt="result" style={{ width: "100%", height: "100%", objectFit: "contain", opacity: rendering ? 0.55 : 1, transition: "opacity 0.2s" }} />
              <span style={tag}>Result</span>
              <span className="mono" style={{ ...tag, top: "auto", left: "auto", bottom: 10, right: 10, textTransform: "none", letterSpacing: 0 }}>
                {out.w}×{out.h} · {outputExt(options).toUpperCase()}
              </span>
            </>
          ) : (
            <div style={{ textAlign: "center", padding: 20 }}>
              {busy ? (
                <>
                  <div style={{ position: "relative", width: 48, height: 48, margin: "0 auto 12px" }}>
                    <svg viewBox="0 0 48 48" style={{ transform: "rotate(-90deg)" }}>
                      <circle cx="24" cy="24" r="20" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="3" />
                      <circle cx="24" cy="24" r="20" fill="none" stroke="var(--accent)" strokeWidth="3" strokeLinecap="round"
                        strokeDasharray={2 * Math.PI * 20}
                        strokeDashoffset={phase === "loading-model" ? 2 * Math.PI * 20 * (1 - dlPct / 100) : 2 * Math.PI * 20 * 0.25}
                        style={{ transition: "stroke-dashoffset 0.3s", animation: phase === "processing" ? "spin 1s linear infinite" : undefined, transformOrigin: "center" }}
                      />
                    </svg>
                  </div>
                  <p style={{ fontSize: 13, color: "var(--text-muted)" }}>{msg}</p>
                </>
              ) : phase === "error" ? (
                <p style={{ fontSize: 13, color: "#ef4444" }}>{msg}</p>
              ) : (
                <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Result will appear here</p>
              )}
            </div>
          )}
        </div>
      </div>

      {phase === "idle" && (
        <button onClick={run} style={{ background: "var(--accent)", color: "var(--on-accent)", border: "none", borderRadius: 10, padding: "14px", fontSize: 15, fontWeight: 500, cursor: "pointer", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 9 }}>
          <BgRemoveIcon size={17} /> Remove background
        </button>
      )}

      {phase === "error" && (
        <button onClick={run} style={{ background: "var(--accent)", color: "var(--on-accent)", border: "none", borderRadius: 10, padding: "14px", fontSize: 15, fontWeight: 500, cursor: "pointer" }}>
          Try again
        </button>
      )}

      {phase === "done" && (
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={download} disabled={!out || rendering} style={{ flex: 1, background: "var(--accent)", color: "var(--on-accent)", border: "none", borderRadius: 10, padding: "13px", fontSize: 15, fontWeight: 500, cursor: "pointer", opacity: rendering ? 0.7 : 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            ↓ Download {outputExt(options).toUpperCase()}
            {out && !rendering && <span className="mono" style={{ fontSize: 12, opacity: 0.65, marginLeft: 7 }}>{formatBytes(out.blob.size)}</span>}
          </button>
          <button onClick={onReset} style={{ padding: "13px 16px", background: "transparent", border: "0.5px solid var(--border)", borderRadius: 10, fontSize: 15, color: "var(--text-muted)", cursor: "pointer", whiteSpace: "nowrap" }}>
            New image
          </button>
        </div>
      )}

      <OutputOptionsPanel value={options} onChange={onOptionsChange} />
    </div>
  );
}

const tag: React.CSSProperties = {
  position: "absolute", top: 10, left: 10, fontSize: 10, background: "rgba(0,0,0,0.6)", color: "#fff",
  padding: "3px 8px", borderRadius: 12, textTransform: "uppercase", letterSpacing: "0.06em",
};

const ghostSm: React.CSSProperties = {
  fontSize: 13, color: "var(--text-muted)", background: "transparent", border: "0.5px solid var(--border)",
  borderRadius: 8, padding: "6px 14px", cursor: "pointer",
};
