/**
 * Admin session auth — no dependencies, Edge-runtime safe (Web Crypto only).
 *
 * Login compares the submitted password to ADMIN_PASSWORD in constant time.
 * On success we hand out an HMAC-signed cookie carrying an expiry; every
 * protected request re-verifies the signature and expiry. The password is
 * never stored in the cookie, and a tampered/expired token is rejected.
 *
 * Required env:
 *   ADMIN_PASSWORD        — the login password
 *   ADMIN_SESSION_SECRET  — HMAC signing key (falls back to ADMIN_PASSWORD)
 */

export const SESSION_COOKIE = "wg_admin";
const MAX_AGE_S = 60 * 60 * 24 * 7; // 7 days

const enc = new TextEncoder();

function secret(): string {
  return process.env.ADMIN_SESSION_SECRET || process.env.ADMIN_PASSWORD || "";
}

/** Timing-safe string compare (avoids leaking the password via response time). */
export function safeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  // Fold length into the result rather than early-returning on mismatch.
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const byte of arr) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(payload));
  return b64url(sig);
}

/** Issue a signed session token valid for MAX_AGE_S. */
export async function createSessionToken(): Promise<string> {
  const exp = Date.now() + MAX_AGE_S * 1000;
  const payload = `${exp}`;
  const sig = await hmac(payload);
  return `${payload}.${sig}`;
}

/** Verify a session token's signature and expiry. */
export async function verifySessionToken(token: string | undefined): Promise<boolean> {
  if (!token || !secret()) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmac(payload);
  if (!safeEqual(sig, expected)) return false;
  const exp = Number(payload);
  return Number.isFinite(exp) && exp > Date.now();
}

export const SESSION_MAX_AGE = MAX_AGE_S;
