"use client";

/**
 * Which device should transformers.js / onnxruntime-web actually use.
 *
 * `navigator.gpu` existing is NOT enough. Safari/WebKit expose WebGPU (and it
 * even passes a raw adapter+compute benchmark), but onnxruntime-web's JSEP
 * WebGPU build is broken there — it throws `webgpuInit is not a function` at
 * INFERENCE time (after the model has "loaded"), so a load-time try/catch never
 * catches it and the user gets "no available backend found". The only safe move
 * is to not pick webgpu there in the first place and route to wasm (CPU) — slower,
 * but it actually works.
 */

/** WebKit (desktop Safari + every iOS browser) — where ORT's JSEP webgpu fails. */
export function isWebKit(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  const iOS = /\b(iPad|iPhone|iPod)\b/.test(ua) || (navigator.platform === "MacIntel" && (navigator as any).maxTouchPoints > 1);
  const safari = /Safari\//.test(ua) && !/Chrome|Chromium|CriOS|Edg|OPR|Android/.test(ua);
  return iOS || safari;
}

let cached: boolean | null = null;

/**
 * True only when onnxruntime-web WebGPU is expected to actually run: Chromium
 * with a real adapter. Cached after the first probe. Everything else → wasm.
 */
export async function ortWebgpuUsable(): Promise<boolean> {
  if (cached !== null) return cached;
  try {
    const gpu = (navigator as any)?.gpu;
    if (!gpu || isWebKit()) { cached = false; return false; }
    const adapter = await gpu.requestAdapter();
    cached = !!adapter;
  } catch {
    cached = false;
  }
  return cached;
}

/**
 * Safari's major version from `Version/N` — present in desktop Safari and iOS
 * Safari UAs. Third-party iOS browsers (CriOS, FxiOS…) omit it, so they get
 * null and stay on wasm: we can't tell which WebKit they're running.
 */
function safariMajor(): number | null {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  if (/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua)) return null;
  const m = ua.match(/Version\/(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

let tjsCached: boolean | null = null;

/**
 * transformers.js ≥4.3 ships its own native WebGPU runtime (ORT 1.31) that
 * works on Safari 26+, unlike the CDN ORT 1.23 JSEP build behind
 * ortWebgpuUsable(). So transformers.js tools get WebGPU on Chromium AND on
 * Safari ≥26; older or unidentifiable WebKit stays on wasm.
 */
export async function tjsWebgpuUsable(): Promise<boolean> {
  if (tjsCached !== null) return tjsCached;
  try {
    const gpu = (navigator as any)?.gpu;
    if (!gpu) { tjsCached = false; return false; }
    if (isWebKit()) {
      const v = safariMajor();
      if (v === null || v < 26) { tjsCached = false; return false; }
    }
    const adapter = await gpu.requestAdapter();
    tjsCached = !!adapter;
  } catch {
    tjsCached = false;
  }
  return tjsCached;
}

/** The device string transformers.js should load with. */
export async function tjsDevice(): Promise<"webgpu" | "wasm"> {
  return (await tjsWebgpuUsable()) ? "webgpu" : "wasm";
}
