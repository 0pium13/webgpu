import type { MetadataRoute } from "next";

const TOOLS = [
  "upscale", "rotoscope", "bg-remove", "image-to-3d", "subtitles",
  "erase", "convert", "pdf", "voice", "webcam", "chat", "code",
];

const LANDING = ["free-ai-video-tools", "hinglish-subtitles", "no-watermark"];

export default function sitemap(): MetadataRoute.Sitemap {
  const base = "https://webgpu.in";
  return [
    { url: base, changeFrequency: "weekly", priority: 1 },
    ...TOOLS.map((slug) => ({
      url: `${base}/${slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
    ...LANDING.map((slug) => ({
      url: `${base}/${slug}`,
      changeFrequency: "monthly" as const,
      priority: 0.7,
    })),
  ];
}
