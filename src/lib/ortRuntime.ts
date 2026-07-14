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
  ort.env.logLevel = "fatal"; // session-assignment warnings otherwise flood the console
}

const MODEL_CACHE = "webgpu-models-v1";

/**
 * Fetch a model's bytes, caching them in the Cache API keyed by the stable
 * HuggingFace URL. Without this every visit re-downloads the model (hundreds
 * of MB for GFPGAN/3D): the HF URL 302-redirects to a *signed* CDN URL that
 * changes each time, so the browser HTTP cache never hits. A cache hit here
 * makes the second load instant. All failures are non-fatal — we just fetch.
 */
/** Drop a possibly-corrupt cached model so the next load refetches it fresh. */
async function evictModel(url: string): Promise<void> {
  try { const c = await caches.open(MODEL_CACHE); await c.delete(url); } catch { /* nothing to evict */ }
}

async function fetchModelBytes(
  url: string,
  onProgress: ((loadedBytes: number, totalBytes: number) => void) | undefined,
  skipCache: boolean
): Promise<{ buf: Uint8Array; fromCache: boolean }> {
  let cache: Cache | null = null;
  try { cache = await caches.open(MODEL_CACHE); } catch { cache = null; }

  if (cache && !skipCache) {
    try {
      const hit = await cache.match(url);
      if (hit) {
        const buf = new Uint8Array(await hit.arrayBuffer());
        // guard against a truncated entry: content-length must match the body
        const expected = Number(hit.headers.get("content-length") ?? 0);
        if (buf.byteLength > 0 && (!expected || expected === buf.byteLength)) {
          onProgress?.(buf.byteLength, buf.byteLength);
          return { buf, fromCache: true };
        }
        await cache.delete(url); // corrupt/partial — drop and refetch
      }
    } catch { /* fall through to network */ }
  }

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
  chunks.length = 0; // release the duplicate ~model-size of chunk memory before session compile

  // Only cache a byte-complete download — never a short read that would poison
  // future loads (the bug that can break a tool until the user clears storage).
  if (cache && loaded > 0 && (!total || total === loaded)) {
    cache.put(url, new Response(buf.slice(), {
      headers: { "content-length": String(buf.byteLength), "content-type": "application/octet-stream" },
    })).catch(() => { /* over quota / private mode — model still works */ });
  }
  return { buf, fromCache: false };
}

/**
 * Fetch a model file (cached) with byte-level progress, then create a session.
 * WebGPU first, WASM fallback. Self-healing: if the session can't be created
 * from CACHED bytes (corruption), the entry is evicted and refetched once —
 * so a bad cache entry can never permanently break a tool.
 */
export async function createSession(
  ort: any,
  url: string,
  onProgress?: (loadedBytes: number, totalBytes: number) => void,
  executionProviders: string[] = ["webgpu"]
): Promise<any> {
  const build = async (buf: Uint8Array) => {
    try {
      return await ort.InferenceSession.create(buf, { executionProviders, graphOptimizationLevel: "all" });
    } catch (e) {
      console.warn("[ort] webgpu session failed, wasm fallback", e);
      return await ort.InferenceSession.create(buf, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    }
  };

  const { buf, fromCache } = await fetchModelBytes(url, onProgress, false);
  try {
    return await build(buf);
  } catch (e) {
    if (!fromCache) throw e;
    // the cached bytes wouldn't load — assume corruption, refetch fresh, retry once
    console.warn("[ort] session failed on cached model; evicting + refetching fresh", e);
    await evictModel(url);
    const fresh = await fetchModelBytes(url, onProgress, true);
    return await build(fresh.buf);
  }
}
