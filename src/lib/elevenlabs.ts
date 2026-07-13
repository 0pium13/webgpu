"use client";

/**
 * ElevenLabs BYOK client — studio-grade voice cloning through the user's own
 * key, called straight from the browser (ElevenLabs sends CORS `*`, so no
 * proxy needed). We never see or store the key; it lives in localStorage.
 *
 * This is the "no compromise" tier: a large server model the browser can't
 * run locally. The reference clip + text ARE sent to ElevenLabs — that's the
 * trade for near-perfect human quality, and we say so plainly in the UI.
 *
 * Flow: /voices/add (Instant Voice Clone, needs a paid plan) → voice_id →
 * /text-to-speech/{voice_id}. We create the voice once per reference and reuse.
 */

const BASE = "https://api.elevenlabs.io/v1";

export interface ElModel {
  id: string;
  label: string;
  hint: string;
}

/** The three that matter, most-capable first. */
export const EL_MODELS: ElModel[] = [
  { id: "eleven_multilingual_v2", label: "Multilingual v2", hint: "Highest quality & most stable · 29 languages" },
  { id: "eleven_v3", label: "v3 · expressive", hint: "Most emotion & natural delivery · newest" },
  { id: "eleven_turbo_v2_5", label: "Turbo v2.5", hint: "Fast & ~half the credits · great for drafts" },
];

async function detail(res: Response): Promise<string> {
  try {
    const j = await res.json();
    const d = j?.detail;
    if (typeof d === "string") return d;
    if (d?.message) return d.message;
    return JSON.stringify(j).slice(0, 200);
  } catch { return ""; }
}

function friendly(status: number, msg: string): Error {
  const low = msg.toLowerCase();
  if (status === 401) return new Error("That ElevenLabs API key isn't valid. Copy it from elevenlabs.io → Profile → API key.");
  if (low.includes("instant_voice_cloning") || low.includes("can_not_use") || status === 403)
    return new Error("Your key is valid, but voice cloning needs a paid ElevenLabs plan (from ~$5/mo). Preset-voice TTS works on any plan; custom cloning does not.");
  if (status === 429 || low.includes("quota")) return new Error("This ElevenLabs key is out of credits for now — check your usage or try later.");
  if (status === 422) return new Error(msg || "ElevenLabs rejected the audio — use 10–30s of one clear speaker.");
  return new Error(msg || `ElevenLabs error (${status}).`);
}

/** Create an Instant-Voice-Clone voice from a reference clip. Returns voice_id. */
export async function createClonedVoice(apiKey: string, name: string, file: File): Promise<string> {
  const fd = new FormData();
  fd.append("name", name.slice(0, 40) || "webgpu.in clone");
  fd.append("files", file, file.name || "reference.wav");
  fd.append("remove_background_noise", "true");
  const res = await fetch(`${BASE}/voices/add`, {
    method: "POST",
    headers: { "xi-api-key": apiKey },
    body: fd,
  });
  if (!res.ok) throw friendly(res.status, await detail(res));
  const j = await res.json();
  if (!j.voice_id) throw new Error("ElevenLabs didn't return a voice id.");
  return j.voice_id as string;
}

/** Speak `text` with a cloned voice. Returns an MP3 blob. */
export async function speak(apiKey: string, voiceId: string, text: string, modelId: string): Promise<Blob> {
  const res = await fetch(`${BASE}/text-to-speech/${voiceId}`, {
    method: "POST",
    headers: { "xi-api-key": apiKey, "Content-Type": "application/json", "Accept": "audio/mpeg" },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.0, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw friendly(res.status, await detail(res));
  return res.blob();
}

/** Best-effort cleanup so we don't clutter the user's ElevenLabs voice list. */
export async function deleteVoice(apiKey: string, voiceId: string): Promise<void> {
  try {
    await fetch(`${BASE}/voices/${voiceId}`, { method: "DELETE", headers: { "xi-api-key": apiKey } });
  } catch { /* non-fatal */ }
}
