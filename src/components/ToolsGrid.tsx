"use client";

import { useCallback } from "react";
import { UpscaleIcon, RotoscopeIcon, BgRemoveIcon, CubeIcon, CaptionsIcon, EraserIcon, ConvertIcon, ChatIcon, PdfIcon, VoiceIcon, VideocamIcon, CodeIcon } from "./Icons";
import { DEFAULT_CONTENT, type SiteContent } from "@/lib/site-content";

// Structural only — routes, icons and tints stay in code. The name/desc
// copy comes from editable content (admin), with defaults as the fallback.
const TOOLS = [
  { href: "/upscale", Icon: UpscaleIcon, tint: "#818cf8" },
  { href: "/rotoscope", Icon: RotoscopeIcon, tint: "#a78bfa" },
  { href: "/bg-remove", Icon: BgRemoveIcon, tint: "#34d399" },
  { href: "/image-to-3d", Icon: CubeIcon, tint: "#fbbf24" },
  { href: "/subtitles", Icon: CaptionsIcon, tint: "#22d3ee" },
  { href: "/erase", Icon: EraserIcon, tint: "#fb7185" },
  { href: "/convert", Icon: ConvertIcon, tint: "#a3e635" },
  { href: "/pdf", Icon: PdfIcon, tint: "#f87171" },
  { href: "/voice", Icon: VoiceIcon, tint: "#e879f9" },
  { href: "/webcam", Icon: VideocamIcon, tint: "#2dd4bf" },
  { href: "/chat", Icon: ChatIcon, tint: "#38bdf8" },
  { href: "/code", Icon: CodeIcon, tint: "#facc15" },
];

export default function ToolsGrid({
  tools = DEFAULT_CONTENT.tools,
}: {
  tools?: SiteContent["tools"];
}) {
  // feed the cursor position to the CSS spotlight (cheap: two custom props)
  const track = useCallback((e: React.MouseEvent<HTMLAnchorElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--mx", `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty("--my", `${e.clientY - r.top}px`);
  }, []);

  return (
    <section className="mx-auto max-w-3xl px-6 pb-24">
      <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {TOOLS.map((t) => {
          const c = tools[t.href] ?? DEFAULT_CONTENT.tools[t.href];
          return (
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
              {c.name}
              <span
                aria-hidden
                className="translate-x-0 opacity-0 transition-all duration-300 ease-[var(--ease-lux)] group-hover:translate-x-1 group-hover:opacity-100"
              >
                →
              </span>
            </p>
            <p className="text-[13px] leading-relaxed text-muted-fg">{c.desc}</p>
          </a>
          );
        })}
      </div>
    </section>
  );
}
