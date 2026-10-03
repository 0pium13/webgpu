import type { Metadata } from "next";
import Nav from "@/components/Nav";
import Footer from "@/components/Footer";

export const metadata: Metadata = {
  title: "Terms of Use",
  description: "Terms of use for webgpu.in's free, in-browser AI tools.",
  alternates: { canonical: "/terms" },
};

const UPDATED = "3 October 2026";

function H({ children }: { children: React.ReactNode }) {
  return <h2 style={{ fontSize: 18, fontWeight: 600, margin: "32px 0 8px", color: "var(--text)" }}>{children}</h2>;
}
function P({ children }: { children: React.ReactNode }) {
  return <p style={{ fontSize: 14.5, lineHeight: 1.7, color: "var(--text-secondary)", margin: "0 0 10px" }}>{children}</p>;
}

export default function Terms() {
  return (
    <div style={{ minHeight: "100vh" }}>
      <Nav />
      <main style={{ maxWidth: 760, margin: "0 auto", padding: "110px 24px 60px" }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.15em", color: "var(--accent)", textTransform: "uppercase" }}>
          webgpu.in / terms
        </span>
        <h1 style={{ fontSize: "clamp(30px, 5vw, 44px)", fontWeight: 600, letterSpacing: "-0.02em", margin: "12px 0 6px" }}>Terms of Use</h1>
        <p className="mono" style={{ fontSize: 12, color: "var(--text-dim)" }}>Last updated {UPDATED}</p>

        <H>1. What webgpu.in is</H>
        <P>webgpu.in provides free tools that run AI models and media processing entirely inside your web browser, on your own device. By using the site you agree to these terms. If you don&apos;t agree, please don&apos;t use it.</P>

        <H>2. Your files and data stay on your device</H>
        <P>Files you open and text you type are processed locally in your browser and are not uploaded to our servers. Model files are downloaded from third-party hosts (such as Hugging Face) and cached by your browser. Optional features that use your own API key (for example ElevenLabs or OpenRouter) send data directly from your browser to that provider under their terms.</P>

        <H>3. AI output</H>
        <P>AI models can produce output that is inaccurate, incomplete, biased, offensive or otherwise inappropriate. Output is not professional advice of any kind and is not endorsed by webgpu.in. You are responsible for reviewing output before relying on or sharing it.</P>

        <H>4. Unfiltered chat mode (18+)</H>
        <P>The optional &ldquo;Unfiltered&rdquo; model in Local AI Chat is an open-source model whose safety refusals have been removed by its third-party authors. It is available only to users who confirm they are 18 or older (or the age of majority where they live) and who accept these terms. It may generate explicit, harmful, dangerous or unlawful content. webgpu.in does not see, store, filter or moderate its output. You are solely responsible for what you generate with it and for how you use it.</P>

        <H>5. Acceptable use</H>
        <P>You agree not to use webgpu.in to break any law that applies to you, to infringe others&apos; rights, or to harm, harass, defraud or endanger anyone. You are responsible for having the rights to any content you process.</P>

        <H>6. Third-party models and software</H>
        <P>The tools rely on open-source models and libraries published by third parties under their own licenses. webgpu.in does not control and is not responsible for those models&apos; behaviour.</P>

        <H>7. No warranty</H>
        <P>The site and all tools are provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;, without warranties of any kind, express or implied, including fitness for a particular purpose, accuracy and non-infringement.</P>

        <H>8. Limitation of liability</H>
        <P>To the fullest extent permitted by law, webgpu.in and its operators are not liable for any direct, indirect, incidental or consequential loss or damage arising from your use of the site, its tools or any output they produce. Nothing in these terms excludes liability that cannot be excluded by law.</P>

        <H>9. Changes</H>
        <P>We may update these terms; the date above shows the latest version. Continuing to use the site after a change means you accept the updated terms.</P>
      </main>
      <Footer />
    </div>
  );
}
