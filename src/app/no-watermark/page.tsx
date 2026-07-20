import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { FaqSection } from "@/components/ToolSeoSection";
import type { ToolFaq } from "@/lib/toolMeta";

const SITE = "https://webgpu.in";
const TITLE = "Free AI Tools With No Watermark — Here's Why There's No Catch";
const DESC =
  "Every tool on webgpu.in exports clean, full-resolution files with no watermark, no trial, no signup. The catch other sites have — server costs — doesn't exist here, because the AI runs on your device.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: "/no-watermark" },
  openGraph: { title: TITLE, description: DESC, url: "/no-watermark", siteName: "WebGPU.in", type: "website" },
  twitter: { card: "summary", title: TITLE, description: DESC },
};

const FAQS: ToolFaq[] = [
  {
    q: "Why do other free tools add watermarks?",
    a: "Because processing your file on their servers costs them real money, and the watermark is the lever that converts you to a paid plan. It is not malice — it is their cost structure. Our cost structure is different: your device does the computing, so there is nothing to recover from you.",
  },
  {
    q: "So how does webgpu.in make money?",
    a: "Right now it doesn't — it is a showcase of what browser GPU computing can do, built by one studio. There is no data collection to monetize either: your files never reach us, so we couldn't sell them if we wanted to.",
  },
  {
    q: "Is the quality actually full-resolution?",
    a: "Yes. You download exactly what the model produced — full resolution, no compression pass, no 'HD is premium' gate. The background remover, upscaler, eraser and converter all export originals.",
  },
  {
    q: "No signup at all? Not even email?",
    a: "None. There are no accounts on the site. Open a tool, use it, close the tab. The models cache in your browser so repeat visits start faster.",
  },
  {
    q: "What's the trade-off, honestly?",
    a: "Speed depends on your hardware. On a laptop with a decent GPU everything is fast; on an old machine or phone, the heavier models run slower or fall back to CPU. That is the entire trade-off — your hardware, your speed, your files.",
  },
];

const TOOLS = [
  ["Background Remover", "/bg-remove", "full-res PNG, clean edges"],
  ["AI Upscaler", "/upscale", "up to 4K, face restore"],
  ["Auto Subtitles", "/subtitles", "SRT/VTT export, 27 languages"],
  ["Magic Eraser", "/erase", "object removal, no smudge"],
  ["Converter", "/convert", "MP4, MP3, GIF, compress"],
  ["PDF Studio", "/pdf", "merge, split, edit text"],
] as const;

const jsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": `${SITE}/no-watermark`,
      name: TITLE,
      description: DESC,
      url: `${SITE}/no-watermark`,
      isPartOf: { "@id": `${SITE}/#website` },
      publisher: { "@id": `${SITE}/#organization` },
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${SITE}/no-watermark#breadcrumbs`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "WebGPU.in", item: SITE },
        {
          "@type": "ListItem",
          position: 2,
          name: "No Watermark",
          item: `${SITE}/no-watermark`,
        },
      ],
    },
    {
      "@type": "FAQPage",
      "@id": `${SITE}/no-watermark#faq`,
      mainEntity: FAQS.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ],
});

export default function NoWatermark() {
  return (
    <div style={{ minHeight: "100vh" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <Nav />
      <main style={{ maxWidth: 860, margin: "0 auto", padding: "110px 24px 40px" }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.15em", color: "var(--accent)", textTransform: "uppercase" }}>
          webgpu.in / no watermark
        </span>
        <h1 style={{ margin: "14px 0 0", fontSize: "clamp(30px, 5.4vw, 46px)", fontWeight: 650, letterSpacing: "-0.025em", lineHeight: 1.08, color: "var(--text)" }}>
          No watermark. No trial. No signup. Here&rsquo;s why that&rsquo;s not a trick.
        </h1>
        <p style={{ margin: "20px 0 0", maxWidth: 620, fontSize: 15.5, lineHeight: 1.65, color: "var(--text-secondary)" }}>
          You&rsquo;ve seen the pattern: a &ldquo;free&rdquo; tool processes
          your file, then shows a preview with a watermark and a pricing page.
          That happens because their servers did the work and servers cost
          money. On webgpu.in the AI models run{" "}
          <strong style={{ color: "var(--text)" }}>in your browser, on your
          own GPU</strong>. We never touch your file, we pay nothing to process
          it — so nothing stands between you and the clean, full-resolution
          export.
        </p>

        <section style={{ marginTop: 48 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text)" }}>
            Every tool, watermark-free
          </h2>
          <div style={{ marginTop: 18, display: "grid", gap: 10 }}>
            {TOOLS.map(([name, href, note]) => (
              <a
                key={href}
                href={href}
                style={{
                  display: "flex", alignItems: "baseline", justifyContent: "space-between",
                  gap: 16, flexWrap: "wrap", padding: "15px 18px",
                  border: "1px solid var(--border)", borderRadius: 10,
                  background: "var(--surface)", textDecoration: "none",
                }}
              >
                <span style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{name}</span>
                <span className="mono" style={{ fontSize: 11.5, color: "var(--text-muted)" }}>{note}</span>
              </a>
            ))}
          </div>
          <p style={{ margin: "18px 0 0", fontSize: 13.5, lineHeight: 1.65, color: "var(--text-muted)" }}>
            The same applies to privacy: no uploads means no server logs, no
            retention policies, no &ldquo;we may use your content to improve
            our services.&rdquo; There is nothing to have a policy about.
          </p>
        </section>
      </main>
      <FaqSection faqs={FAQS} />
      <Footer />
    </div>
  );
}
