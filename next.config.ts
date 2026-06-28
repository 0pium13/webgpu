import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // transformers.js / onnxruntime-web ship server-only fallbacks we don't bundle
  serverExternalPackages: ["@huggingface/transformers"],
  // Note: single-threaded ffmpeg core is used, so no cross-origin isolation
  // (COOP/COEP) is required — and omitting it lets transformers.js load
  // models + wasm from the HuggingFace / jsDelivr CDNs without CORP errors.
};

export default nextConfig;
