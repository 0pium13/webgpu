"use client";

/**
 * Route-level error boundary. Catches any render/runtime crash inside a tool
 * page so the user sees a calm recovery card — with a retry that re-mounts the
 * subtree — instead of a blank screen or a raw stack trace.
 */

import { useEffect } from "react";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ maxWidth: 460, textAlign: "center" }}>
        <div style={{ width: 46, height: 46, margin: "0 auto 20px", borderRadius: 12, background: "var(--surface)", border: "0.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
          <span style={{ fontSize: 22 }}>⚠️</span>
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 500, letterSpacing: "-0.02em", marginBottom: 10 }}>
          Something broke on this page
        </h1>
        <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 24 }}>
          Everything runs in your browser, so nothing was lost or uploaded. Try again — if it keeps happening, reloading the page usually clears it.
        </p>
        <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
          <button onClick={reset} style={{ background: "var(--accent)", color: "var(--on-accent)", border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
            Try again
          </button>
          <a href="/" style={{ background: "transparent", color: "var(--text-muted)", border: "0.5px solid var(--border)", borderRadius: 10, padding: "10px 20px", fontSize: 14, textDecoration: "none", display: "inline-flex", alignItems: "center" }}>
            Back home
          </a>
        </div>
      </div>
    </div>
  );
}
