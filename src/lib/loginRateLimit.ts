/**
 * Brute-force protection for /api/admin/login: 5 failed attempts per IP
 * locks that IP out for 15 minutes.
 *
 * Counters live in Vercel KV when it's configured, because serverless
 * instances are short-lived and don't share memory. Without KV we fall back
 * to an in-memory map: best effort only, since each instance counts on its
 * own. Every failure also costs a fixed delay, which caps guessing speed
 * per connection regardless of where the counters live.
 */

const MAX_FAILS = 5;
const WINDOW_S = 15 * 60;
export const FAIL_DELAY_MS = 800;

const hasKV = !!process.env.KV_REST_API_URL && !!process.env.KV_REST_API_TOKEN;
const memory = new Map<string, { n: number; until: number }>();

const key = (ip: string) => `admin-login-fails:${ip}`;

export function clientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] || req.headers.get("x-real-ip") || "unknown").trim();
}

/** Seconds until this IP may try again, or 0 if it isn't locked out. */
export async function lockedFor(ip: string): Promise<number> {
  try {
    if (hasKV) {
      const { kv } = await import("@vercel/kv");
      const n = (await kv.get<number>(key(ip))) ?? 0;
      if (n < MAX_FAILS) return 0;
      const ttl = await kv.ttl(key(ip));
      return ttl > 0 ? ttl : WINDOW_S;
    }
  } catch {
    /* KV unreachable: fall through to memory */
  }
  const m = memory.get(ip);
  if (!m || Date.now() > m.until) return 0;
  return m.n >= MAX_FAILS ? Math.ceil((m.until - Date.now()) / 1000) : 0;
}

export async function recordFailure(ip: string): Promise<void> {
  try {
    if (hasKV) {
      const { kv } = await import("@vercel/kv");
      const n = await kv.incr(key(ip));
      if (n === 1) await kv.expire(key(ip), WINDOW_S);
      return;
    }
  } catch {
    /* fall through to memory */
  }
  const m = memory.get(ip);
  if (!m || Date.now() > m.until) memory.set(ip, { n: 1, until: Date.now() + WINDOW_S * 1000 });
  else m.n++;
}

export async function clearFailures(ip: string): Promise<void> {
  memory.delete(ip);
  try {
    if (hasKV) {
      const { kv } = await import("@vercel/kv");
      await kv.del(key(ip));
    }
  } catch {
    /* nothing to clear */
  }
}
