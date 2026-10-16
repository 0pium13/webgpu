/**
 * Shared helpers for the Cloudflare Pages Functions in /functions.
 * The site itself is a static export; only /api/* runs here.
 *
 * Bindings (wrangler.toml / Pages project settings):
 *   CONTENT               — KV namespace for admin-edited copy + login throttling
 *   ADMIN_PASSWORD        — secret, the admin login password
 *   ADMIN_SESSION_SECRET  — secret, HMAC key for the session cookie
 */

export interface KV {
  get(key: string, type: "json"): Promise<unknown>;
  get(key: string): Promise<string | null>;
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

export interface Env {
  CONTENT?: KV;
  ADMIN_PASSWORD?: string;
  ADMIN_SESSION_SECRET?: string;
}

export type Handler = (ctx: { request: Request; env: Env }) => Promise<Response>;

export const CONTENT_KEY = "site-content:v1";

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

// ── session cookie (HMAC-signed expiry; the password never leaves the server) ──

export const SESSION_COOKIE = "wg_admin";
const MAX_AGE_S = 60 * 60 * 24 * 7;
const enc = new TextEncoder();

const secretOf = (env: Env) => env.ADMIN_SESSION_SECRET || env.ADMIN_PASSWORD || "";

/** Timing-safe compare: length is folded into the result, never early-returned. */
export function safeEqual(a: string, b: string): boolean {
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const len = Math.max(ab.length, bb.length);
  for (let i = 0; i < len; i++) diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0);
  return diff === 0;
}

function b64url(bytes: ArrayBuffer): string {
  let bin = "";
  for (const byte of new Uint8Array(bytes)) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(payload)));
}

export async function sessionCookie(env: Env): Promise<string> {
  const payload = `${Date.now() + MAX_AGE_S * 1000}`;
  const token = `${payload}.${await hmac(secretOf(env), payload)}`;
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${MAX_AGE_S}`;
}

export const clearedCookie = `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

export async function isAuthed(request: Request, env: Env): Promise<boolean> {
  const secret = secretOf(env);
  if (!secret) return false;
  const token = (request.headers.get("cookie") ?? "")
    .split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!token) return false;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return false;
  const payload = token.slice(0, dot);
  if (!safeEqual(token.slice(dot + 1), await hmac(secret, payload))) return false;
  const exp = Number(payload);
  return Number.isFinite(exp) && exp > Date.now();
}

// ── login throttling: 5 failures per IP → 15 min lockout ──
// KV is eventually consistent, so counts are approximate across locations;
// the fixed delay on every failure caps guessing speed regardless.

const MAX_FAILS = 5;
const WINDOW_S = 15 * 60;
export const FAIL_DELAY_MS = 800;
const failKey = (ip: string) => `admin-login-fails:${ip}`;

export const clientIp = (request: Request) => request.headers.get("cf-connecting-ip") ?? "unknown";

export async function isLockedOut(env: Env, ip: string): Promise<boolean> {
  if (!env.CONTENT) return false;
  return Number((await env.CONTENT.get(failKey(ip))) ?? 0) >= MAX_FAILS;
}

export async function recordFailure(env: Env, ip: string): Promise<void> {
  if (!env.CONTENT) return;
  const n = Number((await env.CONTENT.get(failKey(ip))) ?? 0) + 1;
  await env.CONTENT.put(failKey(ip), String(n), { expirationTtl: WINDOW_S });
}

export async function clearFailures(env: Env, ip: string): Promise<void> {
  await env.CONTENT?.delete(failKey(ip));
}

export const LOCKOUT_MINUTES = WINDOW_S / 60;
