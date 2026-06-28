"use client";

import { useRef, useState, useEffect, useCallback } from "react";

export default function CompareSlider({
  beforeUrl,
  afterUrl,
}: {
  beforeUrl: string;
  afterUrl: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(50);
  const dragging = useRef(false);

  const updatePos = useCallback((clientX: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = Math.max(0, Math.min(100, ((clientX - rect.left) / rect.width) * 100));
    setPos(pct);
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent | TouchEvent) {
      if (!dragging.current) return;
      const x = "touches" in e ? e.touches[0].clientX : e.clientX;
      updatePos(x);
    }
    function onUp() { dragging.current = false; }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("touchmove", onMove);
    window.addEventListener("touchend", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onUp);
    };
  }, [updatePos]);

  return (
    <div
      ref={containerRef}
      style={{ position: "relative", width: "100%", height: "100%", userSelect: "none", cursor: "col-resize" }}
      onMouseDown={(e) => { dragging.current = true; updatePos(e.clientX); }}
      onTouchStart={(e) => { dragging.current = true; updatePos(e.touches[0].clientX); }}
    >
      <video
        src={afterUrl}
        autoPlay
        loop
        muted
        playsInline
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }}
      />

      <div
        style={{
          position: "absolute",
          inset: 0,
          overflow: "hidden",
          clipPath: `inset(0 ${100 - pos}% 0 0)`,
        }}
      >
        <video
          src={beforeUrl}
          autoPlay
          loop
          muted
          playsInline
          style={{ width: "100%", height: "100%", objectFit: "contain" }}
        />
      </div>

      <div
        style={{
          position: "absolute",
          top: 0,
          bottom: 0,
          left: `${pos}%`,
          width: 2,
          background: "#fff",
          transform: "translateX(-50%)",
          pointerEvents: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            transform: "translate(-50%, -50%)",
            width: 36,
            height: 36,
            borderRadius: "50%",
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 14,
            boxShadow: "0 2px 12px rgba(0,0,0,0.4)",
            color: "#000",
          }}
        >
          ↔
        </div>
      </div>

      <span
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          fontSize: 11,
          fontWeight: 500,
          background: "rgba(0,0,0,0.6)",
          color: "#fff",
          padding: "4px 10px",
          borderRadius: 20,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        Original
      </span>
      <span
        style={{
          position: "absolute",
          top: 12,
          right: 12,
          fontSize: 11,
          fontWeight: 500,
          background: "rgba(99,102,241,0.7)",
          color: "#fff",
          padding: "4px 10px",
          borderRadius: 20,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        Upscaled
      </span>
    </div>
  );
}
