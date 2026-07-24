"use client";

import { useRef, useCallback } from "react";

/**
 * Before/after compare slider.
 *
 * Smoothness notes (the previous version stuttered and "let go" mid-drag):
 * - Pointer Events + setPointerCapture: the drag can never be stolen by the
 *   browser, even when the cursor leaves the element or the window.
 * - draggable/native gestures killed via touch-action:none + preventDefault,
 *   which were hijacking the hold-and-drag entirely.
 * - No React state per move — clip and handle update directly on the DOM in
 *   one rAF per frame, so even a 100MP comparison pans at 60fps.
 */
export default function CompareSlider({
  beforeUrl,
  afterUrl,
}: {
  beforeUrl: string;
  afterUrl: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const clipRef = useRef<HTMLDivElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const raf = useRef(0);
  const pending = useRef(50);

  const apply = useCallback(() => {
    raf.current = 0;
    const p = pending.current;
    if (clipRef.current) clipRef.current.style.clipPath = `inset(0 ${100 - p}% 0 0)`;
    if (lineRef.current) lineRef.current.style.left = `${p}%`;
  }, []);

  const moveTo = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    pending.current = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    if (!raf.current) raf.current = requestAnimationFrame(apply);
  }, [apply]);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch {}
    moveTo(e.clientX);
  }, [moveTo]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    // capture is the happy path; primary-button state is the fallback that
    // keeps the drag alive even if capture failed (synthetic/edge pointers)
    if ((e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId) || e.buttons & 1) moveTo(e.clientX);
  }, [moveTo]);

  return (
    <div
      ref={containerRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      style={{
        position: "relative", width: "100%", height: "100%",
        userSelect: "none", cursor: "col-resize", touchAction: "none",
      }}
    >
      <video
        src={afterUrl}
        autoPlay loop muted playsInline
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", pointerEvents: "none" }}
      />

      <div ref={clipRef} style={{ position: "absolute", inset: 0, overflow: "hidden", clipPath: "inset(0 50% 0 0)", pointerEvents: "none" }}>
        <video
          src={beforeUrl}
          autoPlay loop muted playsInline
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      </div>

      <div
        ref={lineRef}
        style={{
          position: "absolute", top: 0, bottom: 0, left: "50%", width: 2,
          background: "#fff", transform: "translateX(-50%)", pointerEvents: "none",
          boxShadow: "0 0 12px rgba(0,0,0,0.5)",
        }}
      >
        <div style={{
          position: "absolute", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          width: 36, height: 36, borderRadius: "50%", background: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 14, boxShadow: "0 2px 12px rgba(0,0,0,0.4)", color: "#000",
        }}>
          ↔
        </div>
      </div>

      <span style={badge("left")}>Original</span>
      <span style={badge("right")}>Upscaled</span>
    </div>
  );
}

function badge(side: "left" | "right"): React.CSSProperties {
  return {
    position: "absolute", top: 12, [side]: 12,
    fontSize: 11, fontWeight: 500,
    background: side === "left" ? "rgba(0,0,0,0.6)" : "rgba(228,192,120,0.9)",
    color: "#fff", padding: "4px 10px", borderRadius: 20,
    letterSpacing: "0.06em", textTransform: "uppercase",
    pointerEvents: "none",
  } as React.CSSProperties;
}
