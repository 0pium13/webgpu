"use client";

/**
 * Releases GPU/wasm model memory when the user leaves the tools that use it.
 *
 * Every model lib caches its session in a module-level promise so repeat
 * runs are instant. With client-side navigation those modules survive route
 * changes, so without this a tour of upscale → erase → subtitles would stack
 * every model in VRAM until the tab died. Each lib registers a "taker" that
 * hands over (and forgets) its cached promise, tagged with the routes that
 * use it; on navigation, anything the new route doesn't need is released.
 * Weights stay in the browser's Cache Storage, so coming back reloads from
 * disk, not the network.
 */

type Taker = () => Promise<unknown> | null | undefined;

const entries: { routes: string[]; take: Taker }[] = [];

export function registerModel(routes: string[], take: Taker) {
  entries.push({ routes, take });
}

const RELEASERS = ["release", "dispose", "close", "unload"] as const;

/** Call the first release-ish method found, else recurse one level into
 *  plain containers like { session, processor } or { encoder, decoder }. */
async function releaseDeep(v: unknown, depth = 0): Promise<void> {
  if (!v || typeof v !== "object" || depth > 2) return;
  const obj = v as Record<string, unknown>;
  for (const m of RELEASERS) {
    if (typeof obj[m] === "function") {
      try { await (obj[m] as () => unknown).call(obj); } catch { /* already gone */ }
      return;
    }
  }
  for (const child of Object.values(obj)) await releaseDeep(child, depth + 1);
}

/** Release every model not used by `pathname`. */
export function releaseModelsExcept(pathname: string) {
  for (const e of entries) {
    if (e.routes.includes(pathname)) continue;
    const p = e.take();
    if (p) Promise.resolve(p).then((v) => releaseDeep(v)).catch(() => {});
  }
}
