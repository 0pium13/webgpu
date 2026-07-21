import { TOOL_META, type ToolFaq } from "@/lib/toolMeta";

/**
 * Crawlable FAQ block rendered below a tool from its route layout.
 * Server component on purpose: the text is guaranteed into the static
 * HTML with zero client JS. <details> gives free interactivity.
 */
export default function ToolSeoSection({ slug }: { slug: string }) {
  const t = TOOL_META[slug];
  if (!t?.faqs?.length && !t?.related?.length) return null;
  return (
    <>
      {!!t.faqs?.length && <FaqSection faqs={t.faqs} />}
      {!!t.related?.length && (
        <nav
          aria-label="Related tools"
          style={{ maxWidth: 860, margin: "0 auto", padding: "0 24px 90px" }}
        >
          <span
            className="mono"
            style={{
              fontSize: 11,
              letterSpacing: "0.15em",
              color: "var(--text-muted)",
              textTransform: "uppercase",
            }}
          >
            More free tools
          </span>
          <div style={{ marginTop: 14, display: "flex", flexWrap: "wrap", gap: 10 }}>
            {t.related.map((slug2) => {
              const r = TOOL_META[slug2];
              if (!r) return null;
              return (
                <a
                  key={slug2}
                  href={`/${slug2}`}
                  style={{
                    padding: "10px 16px",
                    border: "1px solid var(--border)",
                    borderRadius: 10,
                    background: "var(--surface)",
                    fontSize: 13,
                    color: "var(--text-secondary)",
                    textDecoration: "none",
                  }}
                >
                  {r.appName}
                </a>
              );
            })}
          </div>
        </nav>
      )}
    </>
  );
}

/** Standalone FAQ renderer, shared with the landing pages. */
export function FaqSection({ faqs }: { faqs: ToolFaq[] }) {
  return (
    <section
      aria-label="Frequently asked questions"
      style={{ maxWidth: 860, margin: "0 auto", padding: "24px 24px 90px" }}
    >
      <span
        className="mono"
        style={{
          fontSize: 11,
          letterSpacing: "0.15em",
          color: "var(--accent)",
          textTransform: "uppercase",
        }}
      >
        Questions
      </span>
      <h2
        style={{
          margin: "10px 0 6px",
          fontSize: 22,
          fontWeight: 600,
          letterSpacing: "-0.01em",
          color: "var(--text)",
        }}
      >
        Good to know
      </h2>
      <div style={{ marginTop: 18 }}>
        {faqs.map((f) => (
          <details
            key={f.q}
            className="tool-faq"
            style={{ borderBottom: "1px solid var(--border)" }}
          >
            <summary
              style={{
                cursor: "pointer",
                listStyle: "none",
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                gap: 20,
                padding: "16px 0",
                fontSize: 14.5,
                fontWeight: 500,
                color: "var(--text)",
              }}
            >
              {f.q}
              <span
                aria-hidden
                className="tool-faq-mark mono"
                style={{ color: "var(--accent)", flexShrink: 0 }}
              >
                +
              </span>
            </summary>
            <p
              style={{
                margin: 0,
                padding: "0 32px 18px 0",
                fontSize: 13.5,
                lineHeight: 1.65,
                color: "var(--text-secondary)",
              }}
            >
              {f.a}
            </p>
          </details>
        ))}
      </div>
    </section>
  );
}
