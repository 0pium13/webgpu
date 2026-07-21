"use client";

import { useState } from "react";

export default function AdminLogin({ configured }: { configured: boolean }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.reload();
        return;
      }
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Login failed.");
    } catch {
      setError("Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24 }}>
      <form
        onSubmit={submit}
        style={{
          width: "100%", maxWidth: 380, padding: 30,
          border: "1px solid var(--border)", borderRadius: 14,
          background: "var(--surface)",
        }}
      >
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.15em", color: "var(--accent)", textTransform: "uppercase" }}>
          webgpu.in
        </span>
        <h1 style={{ margin: "10px 0 6px", fontSize: 22, fontWeight: 600, color: "var(--text)" }}>
          Admin
        </h1>
        <p style={{ margin: "0 0 22px", fontSize: 13.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>
          {configured
            ? "Enter your admin password to edit the site."
            : "Admin isn't configured yet — set the ADMIN_PASSWORD environment variable in Vercel, then redeploy."}
        </p>

        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Password"
          autoFocus
          disabled={!configured || busy}
          style={{
            width: "100%", padding: "12px 14px", borderRadius: 10,
            border: "1px solid var(--border-strong)", background: "var(--canvas)",
            color: "var(--text)", fontSize: 14, outline: "none",
          }}
        />

        {error && (
          <p style={{ margin: "12px 0 0", fontSize: 13, color: "#f87171" }}>{error}</p>
        )}

        <button
          type="submit"
          disabled={!configured || busy || !password}
          style={{
            marginTop: 16, width: "100%", padding: "12px 14px", borderRadius: 10,
            border: "none", background: "var(--accent)", color: "#fff",
            fontSize: 14, fontWeight: 600,
            cursor: !configured || busy || !password ? "not-allowed" : "pointer",
            opacity: !configured || busy || !password ? 0.5 : 1,
          }}
        >
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
