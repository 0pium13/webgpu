"use client";

import { useRef, useState, useCallback } from "react";
import { MediaIcon } from "@/components/Icons";

export default function UpscaleDropzone({ onFile }: { onFile: (f: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const accept = (file: File) => {
    if (!file.type.startsWith("video/") && !file.type.startsWith("image/"))
      return alert("Please drop a video or image file.");
    onFile(file);
  };

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) accept(file);
  }, []);

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      style={{
        border: dragging ? "0.5px solid var(--accent)" : "0.5px dashed var(--border-strong)",
        borderRadius: 16,
        background: dragging ? "var(--accent-dim)" : "var(--surface)",
        padding: "64px 32px",
        textAlign: "center",
        cursor: "pointer",
        transition: "all 0.15s",
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*,image/*"
        style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) accept(f); }}
      />

      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 14,
          background: "var(--surface-2)",
          border: "0.5px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          margin: "0 auto 20px",
          color: "var(--accent)",
        }}
      >
        <MediaIcon size={26} />
      </div>

      <p style={{ fontSize: 17, fontWeight: 500, marginBottom: 8 }}>
        Drop your video or image here
      </p>
      <p style={{ fontSize: 14, color: "var(--text-muted)", marginBottom: 20 }}>
        MP4, MOV, WebM · PNG, JPG, WebP — up to 2GB
      </p>

      <button
        style={{
          padding: "9px 22px",
          background: "var(--accent)",
          color: "#fff",
          border: "none",
          borderRadius: 8,
          fontSize: 14,
          fontWeight: 500,
          cursor: "pointer",
          transition: "opacity 0.15s",
        }}
        onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = "0.85")}
        onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = "1")}
      >
        Choose file
      </button>

      <p className="mono" style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 24 }}>
        Processed locally · Nothing uploaded · Free forever
      </p>
    </div>
  );
}
