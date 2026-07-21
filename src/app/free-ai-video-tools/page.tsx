import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { FaqSection } from "@/components/ToolSeoSection";
import type { ToolFaq } from "@/lib/toolMeta";

const SITE = "https://webgpu.in";
const TITLE = "Free AI Video Tools — No Upload, No Watermark, No Limits";
const DESC =
  "Every AI video tool a creator needs, free in your browser: auto subtitles (Hinglish included), upscaling, background removal, rotoscope, conversion. Nothing gets uploaded — your GPU does the work.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: "/free-ai-video-tools" },
  openGraph: { title: TITLE, description: DESC, url: "/free-ai-video-tools", siteName: "WebGPU.in", type: "website", images: [{ url: "/og/free-ai-video-tools", width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", title: TITLE, description: DESC, images: ["/og/free-ai-video-tools"] },
};

const VIDEO_TOOLS = [
  {
    href: "/subtitles",
    name: "Auto Subtitles",
    forWho: "Reels, Shorts, YouTube",
    desc: "Transcribe any video live on your GPU — Hinglish captions built in, plus Hindi, Tamil, Telugu and 27 languages. Export SRT for CapCut, Premiere or YouTube.",
  },
  {
    href: "/upscale",
    name: "AI Upscaler",
    forWho: "Low-res footage & thumbnails",
    desc: "Real detail reconstruction up to 4K with face restoration — sharpen old clips, screenshots and thumbnails without a watermark.",
  },
  {
    href: "/rotoscope",
    name: "Rotoscope",
    forWho: "Cutouts & VFX",
    desc: "Click an object once and AI tracks and cuts it out across frames. Green-screen results without a green screen.",
  },
  {
    href: "/convert",
    name: "Converter",
    forWho: "Delivery & compression",
    desc: "MP4, MP3, GIF, WebM and compression with real FFmpeg — a 2GB file starts converting instantly because it never uploads.",
  },
  {
    href: "/bg-remove",
    name: "Background Remover",
    forWho: "Thumbnails & product shots",
    desc: "One-click clean edges at full resolution. The tool every thumbnail passes through.",
  },
  {
    href: "/voice",
    name: "Voice Studio",
    forWho: "Voiceovers",
    desc: "Studio TTS in English, Hindi and more — no credits, no character limits.",
  },
];

const FAQS: ToolFaq[] = [
  {
    q: "Why are these tools completely free?",
    a: "Because your device does the computing. Every other 'free' tool runs your file on their servers, which costs them money — so they cap you, watermark you, or sell your data. Here the AI models run in your browser on your own GPU, so there is no server bill and therefore no catch.",
  },
  {
    q: "Do I need to install anything?",
    a: "No. Open the tool, drop a file, done. The AI models download once into your browser's cache and run locally from then on.",
  },
  {
    q: "Are these tools good enough for client work?",
    a: "Yes — agencies and freelancers use them daily. Full-resolution exports, no watermarks, and your client's footage never touches a third-party server, which is often a contractual requirement.",
  },
  {
    q: "What do I need to run them?",
    a: "Any modern browser. Chrome, Edge or Brave on a machine with a GPU gives the fastest results; most tools also run on CPU when no GPU is available.",
  },
  {
    q: "Is there a daily limit?",
    a: "No limits of any kind — no daily caps, no queue, no signup. Run a hundred files back to back if you like.",
  },
];

const jsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "CollectionPage",
      "@id": `${SITE}/free-ai-video-tools`,
      name: TITLE,
      description: DESC,
      url: `${SITE}/free-ai-video-tools`,
      isPartOf: { "@id": `${SITE}/#website` },
      publisher: { "@id": `${SITE}/#organization` },
    },
    {
      // Names every tool this hub owns. The explicit hub → child
      // relationship is the structure Google reads when deciding a site
      // has a real hierarchy worth surfacing.
      "@type": "ItemList",
      "@id": `${SITE}/free-ai-video-tools#tools`,
      itemListElement: VIDEO_TOOLS.map((t, i) => ({
        "@type": "ListItem",
        position: i + 1,
        name: t.name,
        url: `${SITE}${t.href}`,
      })),
    },
    {
      "@type": "BreadcrumbList",
      "@id": `${SITE}/free-ai-video-tools#breadcrumbs`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "WebGPU.in", item: SITE },
        {
          "@type": "ListItem",
          position: 2,
          name: "Free AI Video Tools",
          item: `${SITE}/free-ai-video-tools`,
        },
      ],
    },
    {
      "@type": "FAQPage",
      "@id": `${SITE}/free-ai-video-tools#faq`,
      mainEntity: FAQS.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ],
});

export default function FreeAiVideoTools() {
  return (
    <div style={{ minHeight: "100vh" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <Nav />
      <main style={{ maxWidth: 860, margin: "0 auto", padding: "110px 24px 40px" }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.15em", color: "var(--accent)", textTransform: "uppercase" }}>
          webgpu.in / video tools
        </span>
        <h1 style={{ margin: "14px 0 0", fontSize: "clamp(30px, 5.4vw, 46px)", fontWeight: 650, letterSpacing: "-0.025em", lineHeight: 1.08, color: "var(--text)" }}>
          Free AI video tools that don&rsquo;t want your email, your money, or your footage.
        </h1>
        <p style={{ margin: "20px 0 0", maxWidth: 620, fontSize: 15.5, lineHeight: 1.65, color: "var(--text-secondary)" }}>
          Whether you cut Reels for a living, run creative for a D2C brand, or
          ship client work at an agency — the tools below cover the boring 80%
          of video work: subtitles, cleanup, cutouts, conversion. They run
          entirely in your browser on your own GPU, which is why they can be
          genuinely free: <strong style={{ color: "var(--text)" }}>no
          watermark, no upload, no daily limits, no signup</strong>.
        </p>

        <div style={{ marginTop: 44, display: "grid", gap: 14 }}>
          {VIDEO_TOOLS.map((t) => (
            <a
              key={t.href}
              href={t.href}
              style={{
                display: "block",
                padding: "20px 22px",
                border: "1px solid var(--border)",
                borderRadius: 12,
                background: "var(--surface)",
                textDecoration: "none",
                transition: "border-color 0.25s var(--ease-lux)",
              }}
            >
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 600, color: "var(--text)" }}>{t.name}</h2>
                <span className="mono" style={{ fontSize: 11, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {t.forWho}
                </span>
              </div>
              <p style={{ margin: "8px 0 0", fontSize: 13.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>{t.desc}</p>
              <span className="mono" style={{ display: "inline-block", marginTop: 12, fontSize: 12, color: "var(--accent)" }}>
                Open tool →
              </span>
            </a>
          ))}
        </div>

        <section style={{ marginTop: 56 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text)" }}>
            Built for the people who make the videos
          </h2>
          <p style={{ margin: "14px 0 0", fontSize: 14.5, lineHeight: 1.7, color: "var(--text-secondary)" }}>
            <strong style={{ color: "var(--text)" }}>Creators</strong> caption
            Shorts and Reels with the subtitle tool&rsquo;s Hinglish mode — the
            style most Indian audiences actually read.{" "}
            <strong style={{ color: "var(--text)" }}>D2C teams</strong> clean
            product shots with the background remover and upscale UGC footage
            before it hits ads.{" "}
            <strong style={{ color: "var(--text)" }}>Agencies</strong> convert,
            compress and deliver in client-required formats without footage
            ever leaving the building — a privacy guarantee no upload-based
            tool can make.
          </p>
        </section>
      </main>
      <FaqSection faqs={FAQS} />
      <Footer />
    </div>
  );
}
