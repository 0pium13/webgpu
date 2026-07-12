"use client";

import { useCallback } from "react";
import { UpscaleIcon, RotoscopeIcon, BgRemoveIcon, CubeIcon, CaptionsIcon, EraserIcon, ConvertIcon, ChatIcon, PdfIcon, VoiceIcon, VideocamIcon, CodeIcon } from "./Icons";

const TOOLS = [
  { href: "/upscale", Icon: UpscaleIcon, name: "Upscaler", desc: "Real AI detail reconstruction. Up to 4K.", tint: "#818cf8" },
  { href: "/rotoscope", Icon: RotoscopeIcon, name: "Rotoscope", desc: "Cut out and track any object, even in video.", tint: "#a78bfa" },
  { href: "/bg-remove", Icon: BgRemoveIcon, name: "Background Remover", desc: "Instant, clean edges. One click.", tint: "#34d399" },
  { href: "/image-to-3d", Icon: CubeIcon, name: "Image to 3D", desc: "One photo becomes a real 3D model. Export GLB, OBJ, STL.", tint: "#fbbf24" },
  { href: "/subtitles", Icon: CaptionsIcon, name: "Auto Subtitles", desc: "Hinglish captions + 27 languages. Live, on your GPU.", tint: "#22d3ee" },
  { href: "/erase", Icon: EraserIcon, name: "Magic Eraser", desc: "Paint over anything. AI rebuilds what was behind it.", tint: "#fb7185" },
  { href: "/convert", Icon: ConvertIcon, name: "Converter", desc: "MP4, MP3, GIF, compress. No upload sites, no ads.", tint: "#a3e635" },
  { href: "/pdf", Icon: PdfIcon, name: "PDF Studio", desc: "Merge, split, compress, convert. Your contract stays here.", tint: "#f87171" },
  { href: "/voice", Icon: VoiceIcon, name: "Voice Studio", desc: "Studio TTS in English, Hindi + more. No credits, ever.", tint: "#e879f9" },
  { href: "/webcam", Icon: VideocamIcon, name: "Webcam Studio", desc: "Enhance + retouch + auto-frame your live cam. Real time.", tint: "#2dd4bf" },
  { href: "/chat", Icon: ChatIcon, name: "Local AI Chat", desc: "A real LLM on your GPU. Works offline, keeps secrets.", tint: "#38bdf8" },
  { href: "/code", Icon: CodeIcon, name: "Vibe Coder", desc: "Describe an app, watch it build and run. Local or your key.", tint: "#facc15" },
];

export default function ToolsGrid() {
  // feed the cursor position to the CSS spotlight (cheap: two custom props)
  const track = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, []);

  return (
    <section className="mx-auto max-w-3xl px-6 pb-24">
      <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TOOLS.map((t) => (
          <a
            key={t.href}
            href={t.href}
            onMouseMove={track}
            style={{ "--tint": t.tint } as React.CSSProperties}
            className="spotlight tool-card group block rounded-2xl border border-line bg-surface p-6 no-underline transition-[border-color,transform,box-shadow] duration-300 ease-[var(--ease-lux)] hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.99]"
          >
            <span className="tool-icon mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-[transform,color] duration-300 ease-[var(--ease-spring)] group-hover:scale-110">
              <t.Icon size={22} />
            </span>

            <p className="mb-1.5 flex items-center gap-1 text-[15px] font-medium text-fg">
              {t.name}
              <span
                aria-hidden
                className="translate-x-0 opacity-0 transition-all duration-300 ease-[var(--ease-lux)] group-hover:translate-x-1 group-hover:opacity-100"
              >
                →
              </span>
            </p>
            <p className="text-[13px] leading-relaxed text-muted-fg">{t.desc}</p>
          </a>
        ))}
      </div>
    </section>
  );
}
