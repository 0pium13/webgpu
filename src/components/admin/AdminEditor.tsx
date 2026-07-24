"use client";

import { useState } from "react";
import { TOOL_ORDER, type SiteContent } from "@/lib/site-content";

/** Shared field styling — kept local so the admin never leaks into site CSS. */
const inputStyle: React.CSSProperties = {
  width: "100%", padding: "10px 12px", borderRadius: 8,
  border: "1px solid var(--border-strong)", background: "var(--canvas)",
  color: "var(--text)", fontSize: 14, outline: "none",
};
const labelStyle: React.CSSProperties = {
  display: "block", marginBottom: 6, fontSize: 11.5,
  letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-muted)",
};

function Field({
  label, value, onChange, textarea,
}: {
  label: string; value: string; onChange: (v: string) => void; textarea?: boolean;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label className="mono" style={labelStyle}>{label}</label>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          style={{ ...inputStyle, resize: "vertical", lineHeight: 1.5 }}
        />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
      )}
    </div>
  );
}

export default function AdminEditor({
  initial, persistent,
}: {
  initial: SiteContent; persistent: boolean;
}) {
  const [content, setContent] = useState<SiteContent>(initial);
  const [status, setStatus] = useState<null | { ok: boolean; msg: string }>(null);
  const [busy, setBusy] = useState(false);

  const dirty = JSON.stringify(content) !== JSON.stringify(initial);

  const setHero = (k: keyof SiteContent["hero"], v: string) =>
    setContent((c) => ({ ...c, hero: { ...c.hero, [k]: v } }));

  const setTool = (href: string, k: "name" | "desc", v: string) =>
    setContent((c) => ({
      ...c,
      tools: { ...c.tools, [href]: { ...c.tools[href], [k]: v } },
    }));

  async function save() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch("/api/admin/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(content),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setStatus({ ok: true, msg: "Saved — live on the site now." });
      } else {
        setStatus({ ok: false, msg: data.error ?? "Save failed." });
      }
    } catch {
      setStatus({ ok: false, msg: "Network error." });
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.reload();
  }

  return (
    <div style={{ minHeight: "100vh", maxWidth: 780, margin: "0 auto", padding: "40px 24px 120px" }}>
      <header style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.15em", color: "var(--accent)", textTransform: "uppercase" }}>
            webgpu.in / admin
          </span>
          <h1 style={{ margin: "8px 0 0", fontSize: 26, fontWeight: 650, letterSpacing: "-0.02em", color: "var(--text)" }}>
            Edit site content
          </h1>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <a href="/" style={{ fontSize: 13, color: "var(--text-secondary)", textDecoration: "none" }}>
            View site ↗
          </a>
          <button onClick={logout} style={{ background: "none", border: "none", color: "var(--text-muted)", fontSize: 13, cursor: "pointer" }}>
            Sign out
          </button>
        </div>
      </header>

      {!persistent && (
        <p style={{
          margin: "22px 0 0", padding: "12px 14px", borderRadius: 10,
          border: "1px solid rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.08)",
          fontSize: 13, lineHeight: 1.6, color: "var(--amber)",
        }}>
          No cloud store connected — edits save locally only and won&rsquo;t persist
          on the live site. Add a Vercel KV store to enable saving in production.
        </p>
      )}

      <section style={{ marginTop: 34 }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 17, fontWeight: 600, color: "var(--text)" }}>
          Homepage hero
        </h2>
        <Field label="Heading" value={content.hero.headingBefore} onChange={(v) => setHero("headingBefore", v)} />
        <Field label="Heading accent (gradient text)" value={content.hero.headingAccent} onChange={(v) => setHero("headingAccent", v)} />
        <Field label="Subheading" value={content.hero.sub} onChange={(v) => setHero("sub", v)} textarea />
        <p style={{ margin: 0, fontSize: 12.5, color: "var(--text-muted)" }}>
          Preview: {content.hero.headingBefore}
          <span style={{ color: "var(--accent)" }}>{content.hero.headingAccent}</span>
        </p>
      </section>

      <section style={{ marginTop: 40 }}>
        <h2 style={{ margin: "0 0 6px", fontSize: 17, fontWeight: 600, color: "var(--text)" }}>
          Tool cards
        </h2>
        <p style={{ margin: "0 0 20px", fontSize: 13, color: "var(--text-muted)" }}>
          Name and description shown on the homepage grid.
        </p>
        {TOOL_ORDER.map((href) => (
          <div
            key={href}
            style={{
              marginBottom: 14, padding: "16px 18px", borderRadius: 12,
              border: "1px solid var(--border)", background: "var(--surface)",
            }}
          >
            <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)" }}>{href}</span>
            <div style={{ marginTop: 12 }}>
              <Field label="Name" value={content.tools[href].name} onChange={(v) => setTool(href, "name", v)} />
              <div style={{ marginBottom: 0 }}>
                <Field label="Description" value={content.tools[href].desc} onChange={(v) => setTool(href, "desc", v)} textarea />
              </div>
            </div>
          </div>
        ))}
      </section>

      {/* Sticky save bar */}
      <div style={{
        position: "fixed", insetInline: 0, bottom: 0, zIndex: 50,
        borderTop: "1px solid var(--border)", background: "rgba(10,10,11,0.92)",
        backdropFilter: "blur(12px)",
      }}>
        <div style={{
          maxWidth: 780, margin: "0 auto", padding: "14px 24px",
          display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16,
        }}>
          <span style={{ fontSize: 13, color: status ? (status.ok ? "var(--green)" : "#f87171") : "var(--text-muted)" }}>
            {status ? status.msg : dirty ? "Unsaved changes" : "All changes saved"}
          </span>
          <button
            onClick={save}
            disabled={busy || !dirty}
            style={{
              padding: "11px 24px", borderRadius: 10, border: "none",
              background: "var(--accent)", color: "var(--on-accent)", fontSize: 14, fontWeight: 600,
              cursor: busy || !dirty ? "not-allowed" : "pointer",
              opacity: busy || !dirty ? 0.45 : 1,
            }}
          >
            {busy ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
