import type { NextConfig } from "next";

/**
 * Static export served by Cloudflare Pages: every route prerenders to /out,
 * and the few dynamic bits (/admin login + save, editable homepage copy) are
 * Pages Functions in /functions.
 *
 * Security headers live in public/_headers — Next's headers() does not run
 * in a static export. The CSP there allows exactly what the tools need:
 * models from HuggingFace, runtimes (ort/ffmpeg wasm) from jsDelivr/unpkg,
 * WebLLM model libs from the MLC GitHub raw host.
 */

const nextConfig: NextConfig = {
  output: "export",
  // transformers.js / onnxruntime-web ship server-only fallbacks we don't bundle
  serverExternalPackages: ["@huggingface/transformers"],
  // Some browser-safe deps keep a dead `await import("fs")` Node branch — stub
  // it out for both bundlers (dev runs Turbopack, production builds webpack).
  turbopack: {
    resolveAlias: {
      fs: { browser: "./src/lib/empty.ts" },
    },
  },
  webpack: (config, { isServer }) => {
    if (!isServer) config.resolve.fallback = { ...config.resolve.fallback, fs: false };
    // transformers.js / kokoro-js also reference their Node backends (native
    // .node binaries); the site only ever runs the browser builds
    config.resolve.alias = { ...config.resolve.alias, "onnxruntime-node$": false, "sharp$": false };
    return config;
  },
  // Note: we deliberately do NOT set COEP (require-corp): the single-threaded
  // ffmpeg core needs no cross-origin isolation, and COEP would block the
  // HuggingFace / jsDelivr CDN loads. COOP alone (public/_headers) is safe — it only
  // governs window.opener relationships, not subresource fetches.
  poweredByHeader: false,
};

export default nextConfig;
