"use client";

import { useRef, useState, useSyncExternalStore } from "react";
import OcrIcon from "./OcrIcon";

export const isOcrFile = (f: File) =>
  f.type.startsWith("image/") || f.type === "application/pdf" || /\.pdf$/i.test(f.name);

const noop = () => () => {};

/** Phones get a "Take photo" button; desktops get the paste hint. */
function usePointer() {
  const coarse = useSyncExternalStore(noop, () => window.matchMedia("(pointer: coarse)").matches, () => false);
  const mac = useSyncExternalStore(noop, () => /Mac|iPhone|iPad/.test(navigator.platform), () => false);
  return { coarse, mac };
}

export default function OcrDropzone({ onFiles }: { onFiles: (f: File[]) => void }) {
  const [drag, setDrag] = useState(false);
  const [making, setMaking] = useState(false);
  const camera = useRef<HTMLInputElement>(null);
  const { coarse, mac } = usePointer();
  const take = (list: FileList | null) => { const f = Array.from(list ?? []); if (f.length) onFiles(f); };

  async function sample() {
    setMaking(true);
    try { onFiles([await makeSample()]); } finally { setMaking(false); }
  }

  return (
    <div>
      <label
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); take(e.dataTransfer.files); }}
        style={{
          display: "block", border: drag ? "0.5px solid var(--accent)" : "0.5px dashed var(--border-strong)",
          borderRadius: 16, background: drag ? "var(--accent-dim)" : "var(--surface)",
          padding: "56px 20px", textAlign: "center", cursor: "pointer", transition: "all 0.15s",
        }}
      >
        <input type="file" accept="image/*,application/pdf,.pdf" multiple style={{ display: "none" }} onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
        <input ref={camera} type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
        <div style={{ width: 56, height: 56, borderRadius: 14, background: "var(--surface-2)", border: "0.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px", color: "var(--accent)" }}>
          <OcrIcon size={26} />
        </div>
        <p style={{ fontSize: 17, fontWeight: 500, marginBottom: 8 }}>Drop an image or PDF</p>
        <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 20, lineHeight: 1.5, textWrap: "balance" }}>
          Photos, screenshots, scans, bills — Hindi, English or both
          <span style={{ display: "block", fontSize: 12.5, color: "var(--text-dim)", marginTop: 3 }}>JPG, PNG, WebP · multi-page PDF · printed text</span>
        </p>
        <span style={{ display: "inline-flex", flexWrap: "wrap", justifyContent: "center", alignItems: "center", gap: 10 }}>
          <span style={{ display: "inline-block", padding: "9px 22px", background: "var(--accent)", color: "var(--on-accent)", borderRadius: 8, fontSize: 14, fontWeight: 500 }}>Choose file</span>
          {coarse && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); camera.current?.click(); }}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); camera.current?.click(); } }}
              style={{ display: "inline-block", padding: "9px 18px", border: "0.5px solid var(--border-strong)", color: "var(--text-secondary)", borderRadius: 8, fontSize: 14 }}
            >
              Take photo
            </span>
          )}
        </span>
        {!coarse && (
          <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginTop: 14 }}>
            or paste a screenshot with <span className="mono" style={{ color: "var(--text-secondary)" }}>{mac ? "⌘V" : "Ctrl+V"}</span>
          </p>
        )}
        <p className="mono" style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 22 }}>Processed locally · Nothing uploaded · Copy or .txt</p>
      </label>
      <div style={{ textAlign: "center", marginTop: 14 }}>
        <button onClick={sample} disabled={making} style={{ background: "transparent", border: "none", color: "var(--text-muted)", fontSize: 13, cursor: "pointer", padding: 6 }}>
          No image handy? <span style={{ color: "var(--accent)" }}>Try a Hindi + English sample →</span>
        </button>
      </div>
    </div>
  );
}

const SAMPLE = [
  "सूचना / NOTICE",
  "सभी निवासियों को सूचित किया जाता है कि",
  "रविवार, 12 अक्टूबर को सुबह 10 बजे से",
  "दोपहर 2 बजे तक पानी की आपूर्ति बंद रहेगी।",
  "मरम्मत शुल्क: ₹1,250 प्रति फ्लैट",
  "Contact: Society Office, 98100 12345",
  "धन्यवाद — प्रबंधन समिति",
];

/** A society-notice style card drawn with the device's own Devanagari font. */
async function makeSample(): Promise<File> {
  const W = 1100, H = 720;
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f7f3ea";
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#c9bfa8";
  ctx.lineWidth = 3;
  ctx.strokeRect(28, 28, W - 56, H - 56);
  const fam = `"Noto Sans Devanagari", "Kohinoor Devanagari", "Nirmala UI", "Mangal", sans-serif`;
  ctx.fillStyle = "#1d1a14";
  ctx.textBaseline = "alphabetic";
  SAMPLE.forEach((line, i) => {
    ctx.font = i === 0 ? `600 46px ${fam}` : `400 34px ${fam}`;
    ctx.fillText(line, 84, 128 + i * 82 + (i ? 24 : 0));
  });
  const blob: Blob = await new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
  return new File([blob], "hindi-sample.png", { type: "image/png" });
}
