import type { NextConfig } from "next";

/**
 * Security headers. CSP is tuned to exactly what the tools need and nothing
 * else: models come from HuggingFace, runtimes (ort/ffmpeg wasm) from
 * jsDelivr/unpkg, WebLLM model libs from the MLC GitHub raw host. Everything
 * runs client-side, so there are no API routes to protect — the attack
 * surface is script injection, and this pins it shut.
 *
 * 'unsafe-inline'/'unsafe-eval' in script-src: Next.js inline runtime and
 * dev-mode eval need them; 'wasm-unsafe-eval' is what actually lets ORT,
 * ffmpeg and WebLLM compile wasm.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob: https://cdn.jsdelivr.net https://unpkg.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "connect-src 'self' blob: data: https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net https://unpkg.com https://raw.githubusercontent.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  // transformers.js / onnxruntime-web ship server-only fallbacks we don't bundle
  serverExternalPackages: ["@huggingface/transformers"],
  // outetts has a dead `await import("fs")` branch for Node — stub it out so
  // Turbopack can bundle the browser path
  turbopack: {
    resolveAlias: {
      fs: { browser: "./src/lib/empty.ts" },
    },
  },
  // Note: single-threaded ffmpeg core is used, so no cross-origin isolation
  // (COOP/COEP) is required — and omitting it lets transformers.js load
  // models + wasm from the HuggingFace / jsDelivr CDNs without CORP errors.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ];
  },
};

export default nextConfig;
