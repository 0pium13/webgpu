"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";
import Nav from "@/components/Nav";
import BgRemoveProcessor from "@/components/bg-remove/BgRemoveProcessor";
import BatchProcessor, { MAX_BATCH } from "@/components/bg-remove/BatchProcessor";
import { collectDropped, isImageFile, DEFAULT_OPTIONS, type OutputOptions } from "@/components/bg-remove/compose";
import { useGPU, TIER_COLOR } from "@/lib/useGPU";
import { BgRemoveIcon } from "@/components/Icons";

export type ImgFile = { file: File; url: string };

const OPTS_KEY = "webgpu.bg-remove.output.v1";

function savedOptions(): OutputOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(OPTS_KEY) ?? "null");
    if (saved && typeof saved === "object") return { ...DEFAULT_OPTIONS, ...saved };
  } catch { /* storage blocked */ }
  return DEFAULT_OPTIONS;
}

/** Remembered per browser; only read once files arrive (no SSR mismatch). */
function useOutputOptions() {
  const [opts, setOpts] = useState<OutputOptions>(DEFAULT_OPTIONS);
  const loaded = useRef(false);
  const update = useCallback((o: OutputOptions) => {
    setOpts(o);
    try { localStorage.setItem(OPTS_KEY, JSON.stringify(o)); } catch { /* storage blocked */ }
  }, []);
  const restore = useCallback(() => {
    if (loaded.current) return;
    loaded.current = true;
    setOpts(savedOptions());
  }, []);
  return [opts, update, restore] as const;
}

export default function BgRemovePage() {
  const [input, setInput] = useState<ImgFile | null>(null);
  const [batch, setBatch] = useState<File[] | null>(null);
  const [opts, setOpts, restoreOpts] = useOutputOptions();
  const gpu = useGPU();

  function handleFiles(files: File[]) {
    const imgs = files.filter(isImageFile);
    if (!imgs.length) return alert("Please choose an image.");
    restoreOpts();
    if (imgs.length === 1) setInput({ file: imgs[0], url: URL.createObjectURL(imgs[0]) });
    else setBatch(imgs);
  }

  function reset() {
    if (input) URL.revokeObjectURL(input.url);
    setInput(null);
    setBatch(null);
  }

  function toBatch(more: File[]) {
    if (!input) return;
    URL.revokeObjectURL(input.url);
    setBatch([input.file, ...more]);
    setInput(null);
  }

  const empty = !input && !batch;

  return (
    <div style={{ minHeight: "100vh" }}>
      <Nav />
      <div style={{ maxWidth: batch ? 1120 : 860, margin: "0 auto", padding: "100px 24px 80px", transition: "max-width 0.5s var(--ease-lux)" }}>
        <div style={{ marginBottom: 40 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.15em", color: "var(--accent)", textTransform: "uppercase" }}>
            webgpu.in / remove background
          </span>
          <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 500, letterSpacing: "-0.03em", marginTop: 12, marginBottom: 10 }}>
            AI Background Remover
          </h1>
          <p style={{ fontSize: 16, color: "var(--text-muted)", maxWidth: 560, lineHeight: 1.6 }}>
            Real AI segmentation (RMBG) running on your GPU via WebGPU. One photo or a
            whole catalogue — batch up to {MAX_BATCH} images into marketplace-ready
            white-background JPGs. No upload, no account.
          </p>
        </div>

        {empty && (
          <div style={{ display: "flex", alignItems: "center", gap: 14, background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "14px 18px", marginBottom: 20 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: TIER_COLOR[gpu.tier], flexShrink: 0 }} />
            <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
              {gpu.scanning ? "Detecting your GPU…" : (
                <>Running on <span className="mono" style={{ color: "var(--text)" }}>{gpu.supported ? "WebGPU" : "CPU (WASM)"}</span> · first run downloads a ~44MB model, then it&apos;s instant</>
              )}
            </p>
          </div>
        )}

        {batch ? (
          <BatchProcessor initialFiles={batch} options={opts} onOptionsChange={setOpts} onReset={reset} />
        ) : input ? (
          <BgRemoveProcessor input={input} onReset={reset} options={opts} onOptionsChange={setOpts} onAddMore={toBatch} />
        ) : (
          <Dropzone onFiles={handleFiles} />
        )}
      </div>
    </div>
  );
}

function Dropzone({ onFiles }: { onFiles: (f: File[]) => void }) {
  const [drag, setDrag] = useState(false);
  // folder picking is a desktop affordance; phones don't expose folders
  const folders = useSyncExternalStore(
    () => () => {},
    () => window.matchMedia("(pointer: fine)").matches && "webkitdirectory" in document.createElement("input"),
    () => false,
  );
  const folderInput = useRef<HTMLInputElement>(null);

  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { e.preventDefault(); setDrag(false); void collectDropped(e.dataTransfer).then(onFiles); }}
      style={{
        display: "block", border: drag ? "0.5px solid var(--accent)" : "0.5px dashed var(--border-strong)",
        borderRadius: 16, background: drag ? "var(--accent-dim)" : "var(--surface)",
        padding: "64px 24px", textAlign: "center", cursor: "pointer", transition: "all 0.15s",
      }}
    >
      <input type="file" accept="image/*" multiple style={{ display: "none" }} onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) onFiles(f); }} />
      <input
        ref={(el) => { folderInput.current = el; el?.setAttribute("webkitdirectory", ""); }}
        type="file" multiple style={{ display: "none" }}
        onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ""; if (f.length) onFiles(f); }}
      />
      <div style={{ width: 56, height: 56, borderRadius: 14, background: "var(--surface-2)", border: "0.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", color: "var(--accent)" }}><BgRemoveIcon size={26} /></div>
      <p style={{ fontSize: 17, fontWeight: 500, marginBottom: 8 }}>Drop images here</p>
      <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 20, lineHeight: 1.5, textWrap: "balance" }}>
        One photo — or a whole batch at once
        <span style={{ display: "block", fontSize: 12.5, color: "var(--text-dim)", marginTop: 3 }}>PNG, JPG, WebP · up to {MAX_BATCH} images · folders too</span>
      </p>
      <span style={{ display: "inline-flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 10 }}>
        <span style={{ display: "inline-block", padding: "9px 22px", background: "var(--accent)", color: "var(--on-accent)", borderRadius: 8, fontSize: 14, fontWeight: 500 }}>Choose images</span>
        {folders && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); folderInput.current?.click(); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); folderInput.current?.click(); } }}
            style={{ display: "inline-block", padding: "9px 18px", border: "0.5px solid var(--border-strong)", color: "var(--text-secondary)", borderRadius: 8, fontSize: 14 }}
          >
            Choose folder
          </span>
        )}
      </span>
      <p className="mono" style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 24 }}>Processed locally · Nothing uploaded · Free</p>
    </label>
  );
}
