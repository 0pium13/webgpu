"use client";

/**
 * onnxruntime-web loaded from CDN as a UMD global — same pattern as our
 * ffmpeg loader. We deliberately do NOT import the npm package here:
 * Turbopack struggles with ort-web's import.meta.url wasm resolution, and
 * transformers.js pins its own internal copy. A script tag with matching
 * wasmPaths sidesteps both problems.
 */

const ORT_VERSION = "1.23.0";
const ORT_BASE = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist`;

let ortPromise: Promise<any> | null = null;

export function loadOrt(): Promise<any> {
  if (ortPromise) return ortPromise;
  ortPromise = new Promise((resolve, reject) => {
    const w = window as any;
    if (w.ort) { configure(w.ort); resolve(w.ort); return; }
    const s = document.createElement("script");
    s.src = `${ORT_BASE}/ort.webgpu.min.js`;
    s.onload = () => {
      if (!w.ort) return reject(new Error("ort global missing after script load"));
      configure(w.ort);
      resolve(w.ort);
    };
    s.onerror = () => reject(new Error("failed to load onnxruntime-web from CDN"));
    document.head.appendChild(s);
  });
  return ortPromise;
}

function configure(ort: any) {
  ort.env.wasm.wasmPaths = `${ORT_BASE}/`;
}

/** Fetch a model file with byte-level progress, then create a session. */
export async function createSession(
  ort: any,
  url: string,
  onProgress?: (loadedBytes: number, totalBytes: number) => void,
  executionProviders: string[] = ["webgpu"]
): Promise<any> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`model fetch failed: ${resp.status} ${url}`);
  const total = Number(resp.headers.get("content-length") ?? 0);
  const reader = resp.body!.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.byteLength;
    onProgress?.(loaded, total);
  }
  const buf = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) { buf.set(c, off); off += c.byteLength; }

  try {
    return await ort.InferenceSession.create(buf, {
      executionProviders,
      graphOptimizationLevel: "all",
    });
  } catch (e) {
    console.warn("[ort] webgpu session failed, wasm fallback", e);
    return await ort.InferenceSession.create(buf, {
      executionProviders: ["wasm"],
      graphOptimizationLevel: "all",
    });
  }
}
