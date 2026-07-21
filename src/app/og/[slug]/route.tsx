import { ImageResponse } from "next/og";
import { TOOL_META } from "@/lib/toolMeta";

/**
 * Branded 1200x630 share cards for every page, drawn on the fly and
 * cached hard. One route instead of sixteen opengraph-image files —
 * /og/subtitles, /og/home, /og/hinglish-subtitles, etc.
 */

/** Slugs that aren't tools. Title splits into [line1, accent line2]. */
const EXTRA: Record<string, { top: string; accent: string; tag: string }> = {
  home: {
    top: "See what your GPU",
    accent: "can really do",
    tag: "Free AI tools that run entirely in your browser",
  },
  "free-ai-video-tools": {
    top: "Free AI",
    accent: "video tools",
    tag: "Subtitles · Upscale · Cutouts · Convert — all in your browser",
  },
  "hinglish-subtitles": {
    top: "Hinglish subtitles,",
    accent: "generated automatically",
    tag: "kya kar rahe ho — the caption style India actually reads",
  },
  "no-watermark": {
    top: "No watermark.",
    accent: "No catch.",
    tag: "Your GPU does the work, so nothing stands between you and the file",
  },
};

function cardCopy(slug: string) {
  const extra = EXTRA[slug];
  if (extra) return extra;
  const t = TOOL_META[slug];
  if (!t) return null;
  // "Free Auto Subtitle Generator — Hinglish + 27 Languages"
  const [top, accent] = t.title.split("—").map((s) => s.trim());
  return { top, accent: accent ?? "", tag: t.description.split(".")[0] + "." };
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const copy = cardCopy(slug);
  if (!copy) return new Response("Not found", { status: 404 });

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background:
            "radial-gradient(90% 90% at 80% 0%, #1b1b3a 0%, #0a0a0b 55%)",
          color: "#f4f4f5",
          fontFamily: "sans-serif",
        }}
      >
        {/* wordmark */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div
            style={{
              display: "flex",
              width: 44,
              height: 44,
              borderRadius: 10,
              border: "2.5px solid #6366f1",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: 16,
                height: 16,
                border: "2.5px solid #6366f1",
                borderRadius: 3,
              }}
            />
          </div>
          <div style={{ fontSize: 34, fontWeight: 600, letterSpacing: -0.5 }}>
            webgpu.in
          </div>
        </div>

        {/* title */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div
            style={{
              fontSize: 76,
              fontWeight: 700,
              letterSpacing: -2.5,
              lineHeight: 1.05,
            }}
          >
            {copy.top}
          </div>
          {copy.accent && (
            <div
              style={{
                fontSize: 76,
                fontWeight: 700,
                letterSpacing: -2.5,
                lineHeight: 1.05,
                background: "linear-gradient(90deg, #818cf8 0%, #d946ef 100%)",
                backgroundClip: "text",
                color: "transparent",
              }}
            >
              {copy.accent}
            </div>
          )}
          <div
            style={{
              marginTop: 18,
              fontSize: 30,
              color: "#a1a1aa",
              lineHeight: 1.35,
              maxWidth: 980,
            }}
          >
            {copy.tag}
          </div>
        </div>

        {/* bottom strip */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
            fontSize: 24,
            letterSpacing: 4,
            color: "#818cf8",
          }}
        >
          <div>FREE</div>
          <div style={{ color: "#3f3f46" }}>·</div>
          <div>NO UPLOAD</div>
          <div style={{ color: "#3f3f46" }}>·</div>
          <div>NO WATERMARK</div>
        </div>
      </div>
    ),
    {
      width: 1200,
      height: 630,
      headers: {
        "cache-control": "public, max-age=86400, s-maxage=604800",
      },
    },
  );
}
