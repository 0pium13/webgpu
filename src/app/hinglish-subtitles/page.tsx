import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";
import { FaqSection } from "@/components/ToolSeoSection";
import type { ToolFaq } from "@/lib/toolMeta";

const SITE = "https://webgpu.in";
const TITLE = "Hinglish Subtitles Generator — Free, Auto, No Upload";
const DESC =
  "Generate Hinglish subtitles automatically — Hindi speech written in Roman script, the caption style Indian Reels and Shorts actually use. Free, no watermark, and your video never gets uploaded.";

export const metadata: Metadata = {
  title: TITLE,
  description: DESC,
  alternates: { canonical: "/hinglish-subtitles" },
  openGraph: { title: TITLE, description: DESC, url: "/hinglish-subtitles", siteName: "WebGPU.in", type: "website" },
  twitter: { card: "summary", title: TITLE, description: DESC },
};

const FAQS: ToolFaq[] = [
  {
    q: "What exactly are Hinglish subtitles?",
    a: "Hindi (or mixed Hindi-English) speech written in Roman letters — 'aaj main aapko dikhata hoon' instead of 'आज मैं आपको दिखाता हूँ'. It reads instantly for the Instagram and YouTube generation, which is why nearly every big Indian creator captions this way.",
  },
  {
    q: "Why do Hinglish captions perform better for Indian audiences?",
    a: "Most viewers watch with sound off and read faster in Roman script than Devanagari, while pure English translation loses the speaker's voice. Hinglish keeps the exact words spoken in the script people scroll fastest — retention and completion rates follow.",
  },
  {
    q: "How is this different from YouTube's auto-captions?",
    a: "YouTube gives you Devanagari Hindi or an English translation — not Hinglish. Dedicated caption apps charge monthly for it. This tool does true Hinglish transliteration free, and works for Reels, Shorts and any video file, not just YouTube uploads.",
  },
  {
    q: "Does it handle mixed Hindi-English speech?",
    a: "Yes — code-switched speech ('market mein new launch hai') is exactly what it is built for. English words stay English, Hindi words come out in clean Roman script.",
  },
  {
    q: "What formats can I export for editing apps?",
    a: "SRT for CapCut, Premiere Pro, DaVinci Resolve and Final Cut; VTT for web players; plain text for scripts. Timing is word-accurate, and you can edit lines before export.",
  },
  {
    q: "Is my video uploaded to a server?",
    a: "No. The speech model runs inside your browser on your own GPU or CPU. Unpublished client videos and personal footage never leave your device.",
  },
];

const jsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebPage",
      "@id": `${SITE}/hinglish-subtitles`,
      name: TITLE,
      description: DESC,
      url: `${SITE}/hinglish-subtitles`,
    },
    {
      "@type": "HowTo",
      "@id": `${SITE}/hinglish-subtitles#howto`,
      name: "How to generate Hinglish subtitles for free",
      step: [
        { "@type": "HowToStep", position: 1, name: "Open the subtitle tool", text: "Go to webgpu.in/subtitles in Chrome, Edge or Brave." },
        { "@type": "HowToStep", position: 2, name: "Drop your video", text: "Drag in any video or audio file — it stays on your device." },
        { "@type": "HowToStep", position: 3, name: "Choose Hinglish output", text: "Pick the Hinglish style; lines appear live as they are heard." },
        { "@type": "HowToStep", position: 4, name: "Export SRT", text: "Download SRT/VTT and drop it into CapCut, Premiere or YouTube." },
      ],
    },
    {
      "@type": "FAQPage",
      "@id": `${SITE}/hinglish-subtitles#faq`,
      mainEntity: FAQS.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    },
  ],
});

export default function HinglishSubtitles() {
  return (
    <div style={{ minHeight: "100vh" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />
      <Nav />
      <main style={{ maxWidth: 860, margin: "0 auto", padding: "110px 24px 40px" }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.15em", color: "var(--accent)", textTransform: "uppercase" }}>
          webgpu.in / hinglish subtitles
        </span>
        <h1 style={{ margin: "14px 0 0", fontSize: "clamp(30px, 5.4vw, 46px)", fontWeight: 650, letterSpacing: "-0.025em", lineHeight: 1.08, color: "var(--text)" }}>
          Hinglish subtitles, generated automatically. Free.
        </h1>
        <p style={{ margin: "20px 0 0", maxWidth: 620, fontSize: 15.5, lineHeight: 1.65, color: "var(--text-secondary)" }}>
          <em>&ldquo;kya kar rahe ho&rdquo;</em> — not{" "}
          <em>&ldquo;क्या कर रहे हो&rdquo;</em>, not{" "}
          <em>&ldquo;what are you doing&rdquo;</em>. Hinglish is how India
          captions its Reels, and almost no tool makes it well. This one
          transcribes your Hindi or mixed speech on your own GPU and writes it
          straight into Roman script, live, with word-accurate timing.
        </p>

        <div style={{ marginTop: 32, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <a
            href="/subtitles"
            style={{
              display: "inline-block", padding: "13px 26px", borderRadius: 10,
              background: "var(--accent)", color: "#fff", fontSize: 14, fontWeight: 600,
              textDecoration: "none",
            }}
          >
            Generate Hinglish subtitles →
          </a>
          <a
            href="/free-ai-video-tools"
            style={{
              display: "inline-block", padding: "13px 26px", borderRadius: 10,
              border: "1px solid var(--border-strong)", color: "var(--text)",
              fontSize: 14, fontWeight: 500, textDecoration: "none",
            }}
          >
            All video tools
          </a>
        </div>

        <section style={{ marginTop: 56 }}>
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text)" }}>
            How it works
          </h2>
          <ol style={{ margin: "16px 0 0", padding: 0, listStyle: "none", display: "grid", gap: 12 }}>
            {[
              ["01", "Drop any video or audio file — it never uploads anywhere."],
              ["02", "Whisper (OpenAI's speech model) transcribes it live on your GPU."],
              ["03", "Pick Hinglish output — or native Devanagari, or English translation."],
              ["04", "Edit any line, then export SRT/VTT for CapCut, Premiere or YouTube."],
            ].map(([n, step]) => (
              <li key={n} style={{ display: "flex", gap: 16, padding: "14px 18px", border: "1px solid var(--border)", borderRadius: 10, background: "var(--surface)" }}>
                <span className="mono" style={{ color: "var(--accent)", fontSize: 12 }}>{n}</span>
                <span style={{ fontSize: 14, lineHeight: 1.55, color: "var(--text-secondary)" }}>{step}</span>
              </li>
            ))}
          </ol>
          <p style={{ margin: "18px 0 0", fontSize: 13.5, lineHeight: 1.65, color: "var(--text-muted)" }}>
            Also speaks 27 languages — Hindi, Urdu, Bengali, Tamil, Telugu,
            Kannada, Malayalam, Marathi, Gujarati, Punjabi and more, with
            optional English translation.
          </p>
        </section>
      </main>
      <FaqSection faqs={FAQS} />
      <Footer />
    </div>
  );
}
