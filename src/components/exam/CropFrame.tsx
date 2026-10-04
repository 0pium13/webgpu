"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { clampCrop, type Crop, type CropLimits } from "@/lib/examImage";

type Pt = { x: number; y: number };

/**
 * Pan/zoom crop window. The frame IS the output aspect; the image moves
 * underneath it. Drag (mouse or one finger), pinch, wheel, or arrow keys.
 * Crop is in source-canvas pixels; the image is shown with a CSS transform
 * so dragging never re-renders pixels.
 */
export default function CropFrame({
  source,
  aspect,
  totalAspect,
  crop,
  limits,
  contain,
  onChange,
  faceGuide,
  footer,
  maxHeight = 460,
}: {
  source: HTMLCanvasElement;
  /** width / height of the cropped (photo) area */
  aspect: number;
  /** width / height of the whole output, incl. any name strip */
  totalAspect: number;
  crop: Crop;
  limits: CropLimits;
  contain: boolean;
  onChange: (c: Crop) => void;
  /** head fraction → draws the oval guide */
  faceGuide?: number;
  /** rendered under the frame, inside the "paper" (the name strip) */
  footer?: (width: number, height: number) => ReactNode;
  maxHeight?: number;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<HTMLCanvasElement>(null);
  const [wrapW, setWrapW] = useState(0);
  const [dragging, setDragging] = useState(false);
  const pointers = useRef(new Map<number, Pt>());
  const live = useRef({ crop, onChange, aspect, limits, contain, source });
  useLayoutEffect(() => { live.current = { crop, onChange, aspect, limits, contain, source }; });

  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const ro = new ResizeObserver(() => setWrapW(el.clientWidth));
    ro.observe(el);
    setWrapW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const v = viewRef.current!;
    v.width = source.width;
    v.height = source.height;
    v.getContext("2d")!.drawImage(source, 0, 0);
  }, [source]);

  const paperW = Math.max(1, Math.min(wrapW, maxHeight * totalAspect));
  const frameH = paperW / aspect;
  const footH = paperW / totalAspect - frameH;
  const k = paperW / crop.w;

  function apply(next: Crop) {
    const L = live.current;
    const c = clampCrop(next, L.aspect, L.source.width, L.source.height, L.limits, L.contain);
    L.crop = c;
    L.onChange(c);
  }

  /** Zoom by factor f (new w = w·f) keeping the source point under a0 under a1. */
  function zoomAt(f: number, a0: Pt, a1: Pt = a0) {
    const L = live.current;
    const r = frameRef.current!.getBoundingClientRect();
    const k0 = r.width / L.crop.w;
    const sx = L.crop.x + (a0.x - r.left) / k0;
    const sy = L.crop.y + (a0.y - r.top) / k0;
    const w = Math.min(Math.max(L.crop.w * f, L.limits.minW), L.limits.maxW);
    const k1 = r.width / w;
    apply({ x: sx - (a1.x - r.left) / k1, y: sy - (a1.y - r.top) / k1, w });
  }

  // wheel needs a non-passive listener to stop the page scrolling
  useEffect(() => {
    const el = frameRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomAt(Math.exp(e.deltaY * 0.0015), { x: e.clientX, y: e.clientY });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // zoomAt only reads refs, so the first closure stays correct
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onPointerDown(e: React.PointerEvent) {
    try { frameRef.current!.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setDragging(true);
  }

  function onPointerMove(e: React.PointerEvent) {
    const ps = pointers.current;
    const prev = ps.get(e.pointerId);
    if (!prev) return;
    const now = { x: e.clientX, y: e.clientY };
    if (ps.size === 1) {
      const L = live.current;
      const kk = frameRef.current!.getBoundingClientRect().width / L.crop.w;
      apply({ ...L.crop, x: L.crop.x - (now.x - prev.x) / kk, y: L.crop.y - (now.y - prev.y) / kk });
    } else {
      const other = [...ps.entries()].find(([id]) => id !== e.pointerId)?.[1];
      if (other) {
        const d0 = Math.hypot(prev.x - other.x, prev.y - other.y);
        const d1 = Math.hypot(now.x - other.x, now.y - other.y);
        if (d0 > 4 && d1 > 4) {
          zoomAt(d0 / d1,
            { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 },
            { x: (now.x + other.x) / 2, y: (now.y + other.y) / 2 });
        }
      }
    }
    ps.set(e.pointerId, now);
  }

  function onPointerUp(e: React.PointerEvent) {
    pointers.current.delete(e.pointerId);
    if (!pointers.current.size) setDragging(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const L = live.current;
    const step = L.crop.w * 0.03;
    const r = frameRef.current!.getBoundingClientRect();
    const mid = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    const map: Record<string, () => void> = {
      ArrowLeft: () => apply({ ...L.crop, x: L.crop.x + step }),
      ArrowRight: () => apply({ ...L.crop, x: L.crop.x - step }),
      ArrowUp: () => apply({ ...L.crop, y: L.crop.y + step }),
      ArrowDown: () => apply({ ...L.crop, y: L.crop.y - step }),
      "+": () => zoomAt(0.92, mid),
      "=": () => zoomAt(0.92, mid),
      "-": () => zoomAt(1.08, mid),
    };
    const fn = map[e.key];
    if (fn) { e.preventDefault(); fn(); }
  }

  // oval guide: head spans `faceGuide` of the frame, 40% of the spare air above it
  const guide = faceGuide ? (() => {
    const head = faceGuide * frameH;
    const top = (frameH - head) * 0.4;
    return { cx: paperW / 2, cy: top + head / 2, rx: head * 0.37, ry: head / 2 };
  })() : null;

  return (
    <div ref={wrapRef} style={{ width: "100%", display: "flex", justifyContent: "center" }}>
      <div
        style={{
          width: paperW, background: "#fff", borderRadius: 6, overflow: "hidden",
          boxShadow: "0 0 0 0.5px rgba(255,255,255,0.14), 0 24px 60px -24px rgba(0,0,0,0.85), 0 8px 20px -12px rgba(0,0,0,0.6)",
          opacity: wrapW ? 1 : 0, transition: "opacity 0.3s var(--ease-lux)",
        }}
      >
        <div
          ref={frameRef}
          role="application"
          tabIndex={0}
          aria-label="Crop area — drag to move, pinch or scroll to zoom, arrow keys to nudge"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onKeyDown={onKeyDown}
          style={{
            position: "relative", width: paperW, height: frameH, overflow: "hidden",
            cursor: dragging ? "grabbing" : "grab", touchAction: "none", userSelect: "none",
            background: "#fff", outlineOffset: -2,
          }}
        >
          <canvas
            ref={viewRef}
            style={{
              position: "absolute", left: 0, top: 0,
              width: source.width, height: source.height, maxWidth: "none",
              transformOrigin: "0 0",
              transform: `translate3d(${-crop.x * k}px, ${-crop.y * k}px, 0) scale(${k})`,
              willChange: "transform", pointerEvents: "none",
            }}
          />

          {/* rule of thirds while dragging */}
          <svg
            width={paperW} height={frameH} aria-hidden
            style={{ position: "absolute", inset: 0, pointerEvents: "none", opacity: dragging ? 1 : 0, transition: "opacity 0.25s var(--ease-lux)" }}
          >
            {[1, 2].map((i) => (
              <g key={i} stroke="rgba(255,255,255,0.55)" strokeWidth={0.75}>
                <line x1={(paperW * i) / 3} x2={(paperW * i) / 3} y1={0} y2={frameH} />
                <line y1={(frameH * i) / 3} y2={(frameH * i) / 3} x1={0} x2={paperW} />
              </g>
            ))}
          </svg>

          {guide && (
            <svg width={paperW} height={frameH} aria-hidden style={{ position: "absolute", inset: 0, pointerEvents: "none" }}>
              <ellipse cx={guide.cx} cy={guide.cy} rx={guide.rx} ry={guide.ry} fill="none" stroke="rgba(0,0,0,0.35)" strokeWidth={3} />
              <ellipse
                cx={guide.cx} cy={guide.cy} rx={guide.rx} ry={guide.ry} fill="none"
                stroke="rgba(255,255,255,0.9)" strokeWidth={1.25} strokeDasharray="5 5"
                style={{ opacity: dragging ? 1 : 0.7, transition: "opacity 0.25s" }}
              />
            </svg>
          )}
        </div>
        {footer && footH > 0.5 && footer(paperW, footH)}
      </div>
    </div>
  );
}
