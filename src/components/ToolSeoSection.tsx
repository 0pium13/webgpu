import { TOOL_META, type ToolFaq } from "@/lib/toolMeta";

/**
 * Crawlable FAQ block rendered below a tool from its route layout.
 * Server component on purpose: the text is guaranteed into the static
 * HTML with zero client JS. <details> gives free interactivity.
 */
export default function ToolSeoSection({ slug }: { slug: string }) {
  const t = TOOL_META[slug];
  if (!t?.faqs?.length) return null;
  return <FaqSection faqs={t.faqs} />;
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
