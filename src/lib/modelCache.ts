/**
 * Model weights in Cache Storage, split so no single entry exceeds PART_BYTES.
 *
 * Chromium's in-memory CacheStorage backend (Incognito / private windows,
 * in-memory partitions) caps one entry at INT_MAX/8 = 256MiB − 1 byte; a
 * bigger put() rejects with "UnknownError: Unexpected internal error", so
 * 300MB+ models (GFPGAN, Chatterbox LM, whisper large) re-downloaded on every
 * load. Smaller parts also keep the transient copy made while caching small.
 *
 * Layout: a file that fits in one part stays a single entry under its plain
 * URL (what earlier visits wrote — still served). Bigger files become
 * `url?wgpu-chunk=0..n-1` plus a JSON manifest at `url?wgpu-chunk=manifest`,
 * written last, so a half-written file is never visible. A query param, not
 * `#part=i`: Cache matching ignores URL fragments, so those keys collide.
 */

const PART_BYTES = 64 * 1024 * 1024;
const TAG = "wgpu-chunk";

type Manifest = { v: 1; size: number; parts: number[]; headers: [string, string][] };
type Progress = (p: { progress: number; loaded: number; total: number }) => void;

export type ModelCache = {
  match(req: RequestInfo | URL): Promise<Response | undefined>;
  put(req: RequestInfo | URL, resp: Response, onProgress?: Progress): Promise<void>;
  putBytes(req: RequestInfo | URL, bytes: Uint8Array): Promise<void>;
  delete(req: RequestInfo | URL): Promise<boolean>;
  has(req: RequestInfo | URL): Promise<boolean>;
};

function norm(req: RequestInfo | URL): string {
  const raw = typeof req === "string" ? req : req instanceof URL ? req.href : req.url;
  try {
    const u = new URL(raw, globalThis.location?.href);
    u.hash = "";
    return u.href;
  } catch {
    return raw;
  }
}

const keyFor = (url: string, part: number | "manifest" | "") =>
  `${url}${url.includes("?") ? "&" : "?"}${TAG}=${part}`;

async function open(name: string): Promise<Cache | null> {
  try { return await caches.open(name); } catch { return null; } // no Cache API / private mode
}

/** The manifest plus every part it lists; "broken" if a piece is unreadable or was evicted. */
async function lookup(c: Cache, url: string): Promise<{ m: Manifest; parts: Response[] } | "broken" | null> {
  const r = await c.match(keyFor(url, "manifest"));
  if (!r) return null;
  let m: Manifest;
  try { m = await r.json(); } catch { return "broken"; }
  if (m?.v !== 1 || !Array.isArray(m.parts) || !m.parts.length || m.parts.reduce((a, b) => a + b, 0) !== m.size) return "broken";
  const parts = await Promise.all(m.parts.map((_, i) => c.match(keyFor(url, i))));
  return parts.every(Boolean) ? { m, parts: parts as Response[] } : "broken";
}

/** Remove the manifest (first, so readers stop seeing the file) and all parts. */
async function dropParts(c: Cache, url: string): Promise<void> {
  await c.delete(keyFor(url, "manifest"));
  const prefix = keyFor(url, "");
  const keys = await c.keys();
  await Promise.all(keys.filter((k) => k.url.startsWith(prefix)).map((k) => c.delete(k)));
}

async function write(
  c: Cache,
  url: string,
  read: () => Promise<Uint8Array | null>,
  total: number,
  headers: Headers,
  onProgress?: Progress
): Promise<void> {
  let pending: Uint8Array | null = null;
  let loaded = 0;
  // Blob parts: universally accepted by cache.put, and the copy leaves the JS heap.
  const nextPart = async (): Promise<Blob | null> => {
    const views: Uint8Array[] = [];
    let size = 0;
    while (size < PART_BYTES) {
      pending ??= await read();
      if (!pending) break;
      const n = Math.min(pending.byteLength, PART_BYTES - size);
      views.push(pending.subarray(0, n));
      pending = n < pending.byteLength ? pending.subarray(n) : null;
      size += n;
    }
    if (!size) return null;
    loaded += size;
    onProgress?.({ progress: total ? (loaded / total) * 100 : 0, loaded, total });
    return new Blob(views as BlobPart[]);
  };

  // Never keep a short body. A longer one is fine: for a content-encoded
  // response (jsdelivr's wasm) content-length is the compressed wire size.
  const assertComplete = () => {
    if (loaded < total) throw new Error(`model body was ${loaded} bytes, expected ${total}`);
  };
  // stored bodies are decoded bytes, so the wire's length/encoding no longer apply
  const kept = [...headers].filter(([k]) => k !== "content-length" && k !== "content-encoding");
  const first = await nextPart();
  if (!first) return;
  pending ??= await read();
  if (!pending) {
    assertComplete();
    const h = new Headers(kept);
    h.set("content-length", String(loaded));
    await c.put(url, new Response(first, { headers: h }));
    return;
  }

  await dropParts(c, url); // leftovers of an older or interrupted write
  try {
    const sizes: number[] = [];
    for (let part: Blob | null = first; part; part = await nextPart()) {
      await c.put(keyFor(url, sizes.length), new Response(part));
      sizes.push(part.size);
    }
    assertComplete();
    const m: Manifest = { v: 1, size: loaded, parts: sizes, headers: kept };
    await c.put(keyFor(url, "manifest"), new Response(JSON.stringify(m), { headers: { "content-type": "application/json" } }));
    await c.delete(url); // a whole copy would shadow the parts
  } catch (e) {
    await dropParts(c, url).catch(() => {});
    throw e;
  }
}

/** A Cache-like store over `name` that transparently splits big entries. */
export function chunkedCache(name: string): ModelCache {
  return {
    async match(req) {
      const url = norm(req);
      const c = await open(name);
      if (!c) return undefined;
      const whole = await c.match(url);
      if (whole) return whole;
      const hit = await lookup(c, url);
      if (!hit) return undefined;
      if (hit !== "broken") {
        // Joined as Blobs: Chromium hands cached bodies out as blob handles, so
        // this copies nothing, reads at native speed, and sizes are checkable up front.
        const blobs = await Promise.all(hit.parts.map((p) => p.blob())).catch(() => null);
        if (blobs?.every((b, i) => b.size === hit.m.parts[i])) {
          const h = new Headers(hit.m.headers);
          h.set("content-length", String(hit.m.size));
          return new Response(new Blob(blobs), { headers: h });
        }
      }
      await dropParts(c, url).catch(() => {}); // a part was evicted, truncated or unreadable
      return undefined;
    },

    async put(req, resp, onProgress) {
      const url = norm(req);
      const c = await open(name);
      if (!c) throw new Error("Cache Storage unavailable");
      if (!resp.body) return c.put(url, resp);
      const reader = resp.body.getReader();
      const read = async () => { const r = await reader.read(); return r.done ? null : r.value; };
      try {
        await write(c, url, read, Number(resp.headers.get("content-length") ?? 0), resp.headers, onProgress);
      } catch (e) {
        void reader.cancel().catch(() => {});
        throw e;
      }
    },

    async putBytes(req, bytes) {
      const url = norm(req);
      const c = await open(name);
      if (!c) throw new Error("Cache Storage unavailable");
      let given = false;
      const read = async () => (given ? null : ((given = true), bytes));
      await write(c, url, read, bytes.byteLength, new Headers({ "content-type": "application/octet-stream" }));
    },

    async delete(req) {
      const url = norm(req);
      const c = await open(name);
      if (!c) return false;
      const chunked = !!(await c.match(keyFor(url, "manifest")));
      const whole = await c.delete(url);
      await dropParts(c, url);
      return whole || chunked;
    },

    async has(req) {
      const url = norm(req);
      const c = await open(name);
      if (!c) return false;
      if (await c.match(url)) return true;
      const hit = await lookup(c, url);
      return !!hit && hit !== "broken";
    },
  };
}

/** The store behind transformers.js (its default cache name, so old entries still hit). */
export const transformersCache = chunkedCache("transformers-cache");

const RESUME_MIN_BYTES = 8 * 1024 * 1024;
const RESUME_TRIES = 5;

/**
 * fetch() whose body survives a dropped connection: a big binary download that
 * dies mid-stream ("TypeError: network error") continues with an HTTP Range
 * request from the byte it stopped at instead of failing the whole model.
 * Anything else (non-GET, ranged, small, non-binary) is a plain fetch.
 */
export async function resumableFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const resp = await fetch(input, init);
  const req = input instanceof Request ? input : null;
  const method = (init?.method ?? req?.method ?? "GET").toUpperCase();
  const ranged = new Headers(init?.headers ?? req?.headers).has("range");
  const total = Number(resp.headers.get("content-length") ?? 0);
  const binary = /octet-stream/i.test(resp.headers.get("content-type") ?? "");
  if (resp.status !== 200 || !resp.body || method !== "GET" || ranged || !binary || total < RESUME_MIN_BYTES) return resp;

  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const signal = init?.signal ?? req?.signal;
  let reader = resp.body.getReader();
  let loaded = 0;
  let tries = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      for (;;) {
        try {
          const r = await reader.read();
          if (!r.done) {
            loaded += r.value.byteLength;
            return ctrl.enqueue(r.value);
          }
          if (loaded >= total) return ctrl.close();
          throw new TypeError(`connection closed at ${loaded} of ${total} bytes`);
        } catch (e) {
          // loaded > total: the body was content-encoded, byte offsets don't map to ranges
          if (loaded > total || ++tries > RESUME_TRIES || signal?.aborted) return ctrl.error(e);
          console.warn(`[model] download dropped at ${loaded}/${total} bytes, resuming`, e);
          await new Promise((res) => setTimeout(res, 1000 * tries));
          try {
            const r = await fetch(url, { headers: { Range: `bytes=${loaded}-` }, signal });
            const range = r.headers.get("content-range");
            const fits = r.status === 206 && !!r.body
              && Number(r.headers.get("content-length")) === total - loaded
              && (!range || range.startsWith(`bytes ${loaded}-`));
            if (!fits) {
              void r.body?.cancel().catch(() => {});
              return ctrl.error(e); // server can't resume — surface the original error
            }
            reader = r.body!.getReader();
          } catch { /* resume request failed too — the next read rethrows and we retry */ }
        }
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return new Response(body, { status: resp.status, statusText: resp.statusText, headers: resp.headers });
}

/**
 * Point a transformers.js `env` at the chunked cache and resumable fetch.
 * `env` is per realm (page and each worker), so call this wherever a lib
 * sets `env.allowLocalModels`.
 */
export function configureTransformersCache(env: any): void {
  if (typeof caches === "undefined") return;
  env.useCustomCache = true;
  env.customCache = transformersCache;
  env.fetch = resumableFetch;
}
