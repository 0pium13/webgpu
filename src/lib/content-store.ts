import "server-only";
import {
  DEFAULT_CONTENT,
  mergeContent,
  sanitizeContent,
  type SiteContent,
} from "./site-content";

/**
 * Content persistence. Two backends, chosen at runtime:
 *   - Vercel KV (production) when KV_REST_API_URL/TOKEN are present
 *   - a local JSON file (dev) otherwise
 * Reads always merge over DEFAULT_CONTENT, so a missing, empty or partial
 * store degrades to the shipped copy instead of a blank page.
 *
 * Reads are deliberately uncached: the pages that use them are dynamic, so
 * an admin save is live on the very next request with no cache juggling.
 * A KV round-trip is a few milliseconds.
 */

const KEY = "site-content:v1";
const hasKV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;

function localPath() {
  return `${process.cwd()}/.content.local.json`;
}

async function readStore(): Promise<Partial<SiteContent> | null> {
  try {
    if (hasKV) {
      const { kv } = await import("@vercel/kv");
      return (await kv.get<Partial<SiteContent>>(KEY)) ?? null;
    }
    const { readFile } = await import("node:fs/promises");
    return JSON.parse(await readFile(localPath(), "utf8")) as Partial<SiteContent>;
  } catch {
    // nothing stored yet, or unreadable — fall back to defaults
    return null;
  }
}

async function writeStore(data: SiteContent): Promise<void> {
  if (hasKV) {
    const { kv } = await import("@vercel/kv");
    await kv.set(KEY, data);
    return;
  }
  // Serverless filesystems are read-only, so the dev file fallback can't work
  // in production. Say so plainly instead of surfacing a raw EROFS error.
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "No content store connected. Add a Vercel KV store (and redeploy) to save changes.",
    );
  }
  const { writeFile } = await import("node:fs/promises");
  await writeFile(localPath(), JSON.stringify(data, null, 2), "utf8");
}

/** Current site copy: stored values merged over the shipped defaults. */
export async function getContent(): Promise<SiteContent> {
  return mergeContent(DEFAULT_CONTENT, await readStore());
}

/** Persist admin edits after clamping them to the known shape. */
export async function saveContent(input: unknown): Promise<SiteContent> {
  const clean = sanitizeContent(input);
  await writeStore(clean);
  return clean;
}

/** Whether a persistent cloud store is wired up (surfaced in the admin UI). */
export const storeConfigured = hasKV;
