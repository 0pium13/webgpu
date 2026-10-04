"use client";

import { productLayout, shadowGeometry, type CutMeta, type OutputOptions } from "./compose";

const CHECKER = "repeating-conic-gradient(#2a2a2e 0% 25%, #18181b 0% 50%) 50% / 14px 14px";

/**
 * CSS-composited preview of the final file, drawn from a small cutout
 * thumbnail — same geometry as compose.ts, so a hundred tiles follow option
 * changes instantly without touching a canvas. Fills a square parent.
 */
export default function ResultPreview({ src, meta, options: o }: { src: string; meta: CutMeta; options: OutputOptions }) {
  const img = { position: "absolute" as const, maxWidth: "none", display: "block" };

  if (o.mode === "product") {
    const L = productLayout(meta, 1, o.margin);
    const g = shadowGeometry(meta, 1, o.margin);
    return (
      <div style={{ position: "absolute", inset: 0, background: o.backdrop, overflow: "hidden" }}>
        {o.shadow && (
          <div style={{
            position: "absolute", left: `${(g.cx - g.rx) * 100}%`, top: `${(g.baseY - g.ry) * 100}%`,
            width: `${g.rx * 200}%`, height: `${g.ry * 200}%`,
            background: "radial-gradient(closest-side, rgba(0,0,0,0.3), rgba(0,0,0,0.1) 55%, transparent)",
          }} />
        )}
        <div style={{ position: "absolute", left: `${L.dx * 100}%`, top: `${L.dy * 100}%`, width: `${L.dw * 100}%`, height: `${L.dh * 100}%`, overflow: "hidden" }}>
          <img
            src={src}
            alt=""
            draggable={false}
            style={{
              ...img,
              width: `${(meta.w / L.box.w) * 100}%`,
              height: `${(meta.h / L.box.h) * 100}%`,
              left: `${(-L.box.x / L.box.w) * 100}%`,
              top: `${(-L.box.y / L.box.h) * 100}%`,
            }}
          />
        </div>
      </div>
    );
  }

  const landscape = meta.w >= meta.h;
  const frame = {
    position: "absolute" as const,
    left: "50%", top: "50%", transform: "translate(-50%, -50%)",
    width: landscape ? "100%" : `${(meta.w / meta.h) * 100}%`,
    height: landscape ? `${(meta.h / meta.w) * 100}%` : "100%",
    background: o.mode === "color" ? o.color : CHECKER,
  };
  return (
    <div style={{ position: "absolute", inset: 0, background: o.mode === "color" ? "var(--surface-2)" : CHECKER }}>
      <div style={frame}>
        <img src={src} alt="" draggable={false} style={{ ...img, inset: 0, width: "100%", height: "100%" }} />
      </div>
    </div>
  );
}
