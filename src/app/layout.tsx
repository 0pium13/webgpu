import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  // apex webgpu.in is the one canonical host — www redirects here. This anchors
  // every relative metadata URL and emits <link rel="canonical"> so Google
  // attaches the site (and its favicon) to a single hostname, not two.
  metadataBase: new URL("https://webgpu.in"),
  alternates: { canonical: "https://webgpu.in" },
  title: {
    default: "WebGPU.in — See what your GPU can really do",
    template: "%s | WebGPU.in",
  },
  description:
    "The community hub for browser-based GPU AI. Benchmark your GPU, explore what runs in your browser, discover tools — no install, no upload, just your hardware.",
  keywords: ["webgpu", "browser ai", "local ai", "gpu benchmark", "webgpu tools", "run llm in browser"],
  openGraph: {
    title: "WebGPU.in — See what your GPU can really do",
    description: "Benchmark your GPU. See what runs in your browser. Join the community building local-AI tools.",
    url: "https://webgpu.in",
    siteName: "WebGPU.in",
    type: "website",
    images: [{ url: "/og/home", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "WebGPU.in",
    description: "Your browser. Your GPU. Your AI.",
    images: ["/og/home"],
  },
};

/**
 * Sitewide entity graph. Every page's own JSON-LD points its publisher at
 * this one Organization @id, so Google sees a single brand that owns 16
 * pages instead of 16 unrelated documents. That entity confidence is the
 * prerequisite for brand-level treatment in results (name, logo, and the
 * sitelinks Google may choose to grant on its own — those can't be asked for).
 */
const siteJsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://webgpu.in/#organization",
      name: "WebGPU.in",
      alternateName: "WebGPU India",
      url: "https://webgpu.in",
      logo: {
        "@type": "ImageObject",
        "@id": "https://webgpu.in/#logo",
        url: "https://webgpu.in/icon.png",
        contentUrl: "https://webgpu.in/icon.png",
        width: 512,
        height: 512,
        caption: "WebGPU.in",
      },
      image: { "@id": "https://webgpu.in/#logo" },
      description:
        "Free AI tools that run entirely in your browser on your own GPU. No upload, no watermark, no signup.",
      sameAs: ["https://github.com/0pium13/webgpu"],
      knowsAbout: [
        "WebGPU", "browser AI", "local AI", "GPU benchmarking",
        "subtitle generation", "background removal", "image upscaling",
      ],
    },
    {
      "@type": "WebSite",
      "@id": "https://webgpu.in/#website",
      name: "WebGPU.in",
      url: "https://webgpu.in",
      publisher: { "@id": "https://webgpu.in/#organization" },
      inLanguage: "en",
    },
  ],
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <head>
        {/* models & runtimes come from these hosts — shave the handshake */}
        <link rel="preconnect" href="https://huggingface.co" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://unpkg.com" />
        <link rel="dns-prefetch" href="https://cas-bridge.xethub.hf.co" />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: siteJsonLd }}
        />
      </head>
      <body>
        <div className="bg-field" aria-hidden />
        {children}
      </body>
    </html>
  );
}
