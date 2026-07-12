"use client";

/**
 * OpenRouter BYOK client — the user's own key, called straight from their
 * browser (OpenRouter supports CORS for exactly this). We never see, store
 * or proxy the key server-side; it lives in localStorage on their machine.
 *
 * The `:free` model list rotates, so we fetch it live instead of hardcoding.
 */

export interface ORModel {
  id: string;
  name: string;
  ctx: number;
}

/** Live list of $0 models (ids ending in `:free`). No auth needed. */
export async function fetchFreeModels(): Promise<ORModel[]> {
  const res = await fetch("https://openrouter.ai/api/v1/models");
  if (!res.ok) throw new Error(`Couldn't load the OpenRouter model list (${res.status})`);
  const json = await res.json();
  return (json.data ?? [])
    .filter((m: any) => typeof m.id === "string" && m.id.endsWith(":free"))
    .map((m: any) => ({
      id: m.id,
      name: String(m.name ?? m.id).replace(/\s*\(free\)\s*$/i, ""),
      ctx: m.context_length ?? 0,
    }))
    .sort((a: ORModel, b: ORModel) => a.name.localeCompare(b.name));
}

export interface ChatMsg {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Streaming chat completion (SSE). Returns the full text; deltas via callback. */
export async function streamChat(opts: {
  apiKey: string;
  model: string;
  messages: ChatMsg[];
  onDelta: (text: string) => void;
  signal?: AbortSignal;
  temperature?: number;
}): Promise<string> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://webgpu.in",
      "X-Title": "webgpu.in Vibe Coder",
    },
    body: JSON.stringify({
      model: opts.model,
      messages: opts.messages,
      stream: true,
      temperature: opts.temperature ?? 0.4,
    }),
    signal: opts.signal,
  });
  if (!res.ok || !res.body) {
    let detail = "";
    try { detail = (await res.json())?.error?.message ?? ""; } catch { /* not json */ }
    if (res.status === 401) detail = detail || "Invalid API key";
    if (res.status === 429) detail = detail || "Rate limited — free models have per-day caps; try another model or wait";
    throw new Error(detail || `OpenRouter request failed (${res.status})`);
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      const s = line.trim();
      // OpenRouter interleaves ": OPENROUTER PROCESSING" keep-alive comments
      if (!s.startsWith("data:")) continue;
      const payload = s.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        const delta = j?.choices?.[0]?.delta?.content ?? "";
        if (delta) { out += delta; opts.onDelta(delta); }
        const err = j?.error?.message;
        if (err) throw new Error(err);
      } catch (e) {
        if (e instanceof Error && !(e instanceof SyntaxError)) throw e;
        // partial JSON split across chunks — next read completes it
      }
    }
  }
  return out;
}

/** Pull the runnable HTML out of a model reply (fences, chatter, etc.). */
export function extractHtml(raw: string): string {
  const fence = raw.match(/```(?:html)?\s*\n?([\s\S]*?)```/i);
  let code = fence ? fence[1] : raw;
  const start = code.search(/<!DOCTYPE|<html/i);
  if (start > 0) code = code.slice(start);
  return code.trim();
}
