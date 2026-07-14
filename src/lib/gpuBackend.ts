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

/** Convenience: the device string transformers.js should load with. */
export async function ortDevice(): Promise<"webgpu" | "wasm"> {
  return (await ortWebgpuUsable()) ? "webgpu" : "wasm";
}
