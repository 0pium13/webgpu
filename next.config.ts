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
  // https: in img-src: Vibe Coder preview iframes (srcdoc inherits this CSP)
  // may reference external images; images can't execute, so this stays safe.
  "img-src 'self' blob: data: https:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  // openrouter.ai: Vibe Coder BYOK calls — the user's own key, straight from
  // their browser to OpenRouter; we never see or proxy it.
  "connect-src 'self' blob: data: https://huggingface.co https://*.huggingface.co https://*.hf.co https://cdn.jsdelivr.net https://unpkg.com https://raw.githubusercontent.com https://openrouter.ai",
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
  // Note: we deliberately do NOT set COEP (require-corp): the single-threaded
  // ffmpeg core needs no cross-origin isolation, and COEP would block the
  // HuggingFace / jsDelivr CDN loads. COOP alone (below) is safe — it only
  // governs window.opener relationships, not subresource fetches.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: CSP },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          // isolate our browsing-context group from any window we open or that
          // opens us — mitigates cross-window / XS-Leak attacks. Safe: the site
          // has no OAuth popups or cross-origin window messaging.
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // camera + mic self-allowed for the Webcam Studio (still processed
          // entirely in-tab; nothing uploaded). geolocation/payment stay off.
          { key: "Permissions-Policy", value: "camera=(self), microphone=(self), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
        ],
      },
    ];
  },
};

export default nextConfig;
