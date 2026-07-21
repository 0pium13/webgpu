/**
 * Editable site content. This is the single source of truth for the text
 * an admin can change from /admin. Structural bits (tool routes, icons,
 * tints) stay in code — only the copy lives here and in the store.
 *
 * DEFAULT_CONTENT holds the current live wording; it's both the seed for a
 * fresh store and the fallback whenever the store is empty or unreachable,
 * so the site never renders blank if KV isn't provisioned yet.
 */

export type ToolContent = { name: string; desc: string };

export type SiteContent = {
  hero: {
    /** Heading text before the gradient accent word(s). */
    headingBefore: string;
    /** The gradient-highlighted tail of the heading. */
    headingAccent: string;
    sub: string;
  };
  /** Homepage tool-card copy, keyed by route (matches ToolsGrid hrefs). */
  tools: Record<string, ToolContent>;
};

export const TOOL_ORDER = [
  "/upscale", "/rotoscope", "/bg-remove", "/image-to-3d", "/subtitles",
  "/erase", "/convert", "/pdf", "/voice", "/webcam", "/chat", "/code",
] as const;

export const DEFAULT_CONTENT: SiteContent = {
  hero: {
    headingBefore: "See what your GPU can ",
    headingAccent: "really do",
    sub: "Free AI tools that run entirely on your GPU. Nothing uploaded, nothing installed.",
  },
  tools: {
    "/upscale": { name: "Upscaler", desc: "Real AI detail reconstruction. Up to 4K." },
    "/rotoscope": { name: "Rotoscope", desc: "Cut out and track any object, even in video." },
    "/bg-remove": { name: "Background Remover", desc: "Instant, clean edges. One click." },
    "/image-to-3d": { name: "Image to 3D", desc: "One photo becomes a real 3D model. Export GLB, OBJ, STL." },
    "/subtitles": { name: "Auto Subtitles", desc: "Hinglish captions + 27 languages. Live, on your GPU." },
    "/erase": { name: "Magic Eraser", desc: "Paint over anything. AI rebuilds what was behind it." },
    "/convert": { name: "Converter", desc: "MP4, MP3, GIF, compress. No upload sites, no ads." },
    "/pdf": { name: "PDF Studio", desc: "Merge, split, compress, convert. Your contract stays here." },
    "/voice": { name: "Voice Studio", desc: "Studio TTS in English, Hindi + more. No credits, ever." },
    "/webcam": { name: "Webcam Studio", desc: "Enhance + retouch + auto-frame your live cam. Real time." },
    "/chat": { name: "Local AI Chat", desc: "A real LLM on your GPU. Works offline, keeps secrets." },
    "/code": { name: "Vibe Coder", desc: "Describe an app, watch it build and run. Local or your key." },
  },
};

/**
 * Merge a stored (possibly partial / stale-shaped) content object over the
 * defaults. Unknown keys are ignored and missing keys fall back, so an old
 * stored blob can never break a newer content shape.
 */
export function mergeContent(
  base: SiteContent,
  stored: Partial<SiteContent> | null | undefined,
): SiteContent {
  if (!stored) return base;
  const s = (v: unknown, fallback: string) =>
    typeof v === "string" && v.length > 0 ? v : fallback;

  const tools: Record<string, ToolContent> = {};
  for (const href of TOOL_ORDER) {
    const st = stored.tools?.[href];
    tools[href] = {
      name: s(st?.name, base.tools[href].name),
      desc: s(st?.desc, base.tools[href].desc),
    };
  }

  return {
    hero: {
      headingBefore: s(stored.hero?.headingBefore, base.hero.headingBefore),
      headingAccent: s(stored.hero?.headingAccent, base.hero.headingAccent),
      sub: s(stored.hero?.sub, base.hero.sub),
    },
    tools,
  };
}

/** Clamp incoming admin input to the known shape and sane lengths. */
export function sanitizeContent(input: unknown): SiteContent {
  const obj = (input ?? {}) as Partial<SiteContent>;
  const cut = (v: unknown, max: number) =>
    typeof v === "string" ? v.slice(0, max) : "";

  const tools: Record<string, ToolContent> = {};
  for (const href of TOOL_ORDER) {
    const t = obj.tools?.[href];
    tools[href] = {
      name: cut(t?.name, 60) || DEFAULT_CONTENT.tools[href].name,
      desc: cut(t?.desc, 160) || DEFAULT_CONTENT.tools[href].desc,
    };
  }
  return {
    hero: {
      headingBefore: cut(obj.hero?.headingBefore, 80) || DEFAULT_CONTENT.hero.headingBefore,
      headingAccent: cut(obj.hero?.headingAccent, 40) || DEFAULT_CONTENT.hero.headingAccent,
      sub: cut(obj.hero?.sub, 200) || DEFAULT_CONTENT.hero.sub,
    },
    tools,
  };
}
