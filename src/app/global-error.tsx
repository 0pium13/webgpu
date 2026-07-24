"use client";

/**
 * Root error boundary — the last resort if the root layout itself throws.
 * Must render its own <html>/<body> because it replaces the whole tree.
 */

import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0a0a0b", color: "#ededed", fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ maxWidth: 440, textAlign: "center" }}>
            <h1 style={{ fontSize: 22, fontWeight: 500, marginBottom: 10 }}>Something went wrong</h1>
            <p style={{ fontSize: 14, color: "#9a9a9a", lineHeight: 1.6, marginBottom: 24 }}>
              The page hit an unexpected error. Nothing was uploaded — everything runs locally in your browser.
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
              <button onClick={reset} style={{ background: "#e4c078", color: "#16130c", border: "none", borderRadius: 10, padding: "10px 20px", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
                Try again
              </button>
              <a href="/" style={{ color: "#9a9a9a", border: "0.5px solid #2a2a2e", borderRadius: 10, padding: "10px 20px", fontSize: 14, textDecoration: "none" }}>
                Back home
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
