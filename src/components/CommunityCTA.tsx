"use client";

import { useState } from "react";

export default function CommunityCTA() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (email) setDone(true);
  }

  return (
    <section
      id="community"
      style={{
        padding: "100px 24px",
        maxWidth: 680,
        margin: "0 auto",
        textAlign: "center",
      }}
    >
      <div
        style={{
          position: "relative",
          background: "var(--surface)",
          border: "0.5px solid var(--border)",
          borderRadius: 20,
          padding: "56px 40px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            backgroundImage:
              "linear-gradient(rgba(99,102,241,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.03) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
            pointerEvents: "none",
          }}
        />

        <span
          className="mono"
          style={{ fontSize: 11, letterSpacing: "0.15em", color: "var(--accent)", textTransform: "uppercase", position: "relative" }}
        >
          community
        </span>

        <h2
          style={{
            fontSize: "clamp(24px,4vw,36px)",
            fontWeight: 500,
            letterSpacing: "-0.02em",
            margin: "16px 0 12px",
            lineHeight: 1.2,
            position: "relative",
          }}
        >
          You&apos;re early. Join the community building the local-AI web.
        </h2>

        <p style={{ fontSize: 15, color: "var(--text-muted)", marginBottom: 36, position: "relative" }}>
          One email per week. What shipped, what runs in-browser now, what&apos;s worth your time.
          No spam. Just signal.
        </p>

        {done ? (
          <p style={{ color: "var(--green)", fontSize: 15, position: "relative" }}>
            You&apos;re in. Watch your inbox.
          </p>
        ) : (
          <form
            onSubmit={submit}
            style={{
              display: "flex",
              gap: 8,
              maxWidth: 440,
              margin: "0 auto 20px",
              position: "relative",
            }}
          >
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              style={{
                flex: 1,
                background: "var(--surface-2)",
                border: "0.5px solid var(--border-strong)",
                borderRadius: 8,
                padding: "10px 14px",
                fontSize: 14,
                color: "var(--text)",
                outline: "none",
              }}
            />
            <button
              type="submit"
              style={{
                background: "var(--accent)",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "10px 20px",
                fontSize: 14,
                fontWeight: 500,
                cursor: "pointer",
                whiteSpace: "nowrap",
                transition: "opacity 0.15s",
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.opacity = "0.85")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.opacity = "1")}
            >
              Get the roundup
            </button>
          </form>
        )}

        <a
          href="#"
          style={{
            fontSize: 13,
            color: "var(--text-muted)",
            textDecoration: "none",
            borderBottom: "0.5px solid var(--border-strong)",
            paddingBottom: 1,
            position: "relative",
            transition: "color 0.15s",
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text-muted)")}
        >
          Join the Discord →
        </a>
      </div>
    </section>
  );
}
