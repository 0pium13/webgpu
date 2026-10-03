"use client";

/**
 * Model weights live in Cache Storage. Without persistence the browser may
 * evict them under storage pressure — and a returning user silently
 * re-downloads 100MB–1.6GB. persist() is requested only when a model download
 * actually starts (Firefox shows a prompt for it, so never on page load).
 */
let asked = false;
export async function keepModelsCached(): Promise<void> {
  if (asked || typeof navigator === "undefined") return;
  asked = true;
  try {
    const s = navigator.storage;
    if (s?.persisted && !(await s.persisted())) await s.persist();
  } catch { /* not supported — caching still works, just evictable */ }
}

/** Free space check before a big download. Unknown quota → assume OK. */
export async function roomFor(bytes: number): Promise<{ ok: boolean; freeMB: number }> {
  try {
    const { quota = 0, usage = 0 } = await navigator.storage.estimate();
    if (!quota) return { ok: true, freeMB: -1 };
    const free = quota - usage;
    return { ok: free > bytes * 1.1, freeMB: Math.round(free / 1048576) };
  } catch {
    return { ok: true, freeMB: -1 };
  }
}
