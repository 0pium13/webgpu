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
  },
  twitter: {
    card: "summary_large_image",
    title: "WebGPU.in",
    description: "Your browser. Your GPU. Your AI.",
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <head>
        {/* models & runtimes come from these hosts — shave the handshake */}
        <link rel="preconnect" href="https://huggingface.co" crossOrigin="anonymous" />
        <link rel="preconnect" href="https://cdn.jsdelivr.net" crossOrigin="anonymous" />
        <link rel="dns-prefetch" href="https://unpkg.com" />
        <link rel="dns-prefetch" href="https://cas-bridge.xethub.hf.co" />
      </head>
      <body>
        <div className="bg-field" aria-hidden />
        {children}
      </body>
    </html>
  );
}
