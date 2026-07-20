"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/upscale", label: "Upscale" },
  { href: "/rotoscope", label: "Roto" },
  { href: "/bg-remove", label: "BG" },
  { href: "/image-to-3d", label: "3D" },
  { href: "/subtitles", label: "Subs" },
  { href: "/erase", label: "Erase" },
  { href: "/convert", label: "Convert" },
  { href: "/pdf", label: "PDF" },
  { href: "/voice", label: "Voice" },
  { href: "/webcam", label: "Cam" },
  { href: "/chat", label: "Chat" },
  { href: "/code", label: "Code" },
];

/** Full names + tints (mirrors ToolsGrid) for the mobile menu. */
const MENU = [
  { href: "/upscale", name: "Upscaler", tint: "#818cf8" },
  { href: "/rotoscope", name: "Rotoscope", tint: "#a78bfa" },
  { href: "/bg-remove", name: "Background Remover", tint: "#34d399" },
  { href: "/image-to-3d", name: "Image to 3D", tint: "#fbbf24" },
  { href: "/subtitles", name: "Auto Subtitles", tint: "#22d3ee" },
  { href: "/erase", name: "Magic Eraser", tint: "#fb7185" },
  { href: "/convert", name: "Converter", tint: "#a3e635" },
  { href: "/pdf", name: "PDF Studio", tint: "#f87171" },
  { href: "/voice", name: "Voice Studio", tint: "#e879f9" },
  { href: "/webcam", name: "Webcam Studio", tint: "#2dd4bf" },
  { href: "/chat", name: "Local AI Chat", tint: "#38bdf8" },
  { href: "/code", name: "Vibe Coder", tint: "#facc15" },
];

export default function Nav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // Lock page scroll while the menu is up; Escape closes it.
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <>
      <nav className="fixed inset-x-0 top-0 z-100 flex h-14 items-center justify-between border-b border-line bg-canvas/70 px-5 backdrop-blur-xl sm:px-8">
        <a href="/" className="group flex items-center gap-2.5 no-underline">
          <svg
            width="20" height="20" viewBox="0 0 24 24" fill="none"
            stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
            className="transition-transform duration-500 ease-[var(--ease-spring)] group-hover:rotate-90"
          >
            <rect x="4" y="4" width="16" height="16" rx="2" />
            <rect x="9" y="9" width="6" height="6" />
            <path d="M15 2v2M9 2v2M15 20v2M9 20v2M2 15h2M2 9h2M20 15h2M20 9h2" />
          </svg>
          <span className="mono text-[15px] font-medium tracking-tight text-fg">webgpu.in</span>
        </a>

        {/* Desktop: the full link row. */}
        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => {
            const active = pathname === l.href;
            return (
              <a
                key={l.href}
                href={l.href}
                data-active={active}
                className={`nav-link whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium no-underline transition-colors duration-200 ${
                  active
                    ? "bg-white/[0.06] text-fg"
                    : "text-muted-fg hover:bg-white/[0.04] hover:text-fg"
                }`}
              >
                {l.label}
              </a>
            );
          })}
        </div>

        {/* Mobile: hamburger → morphs into an X. */}
        <button
          aria-label={open ? "Close tools menu" : "Open tools menu"}
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="relative flex h-10 w-10 items-center justify-center rounded-lg transition-colors duration-200 hover:bg-white/[0.05] md:hidden"
        >
          <span
            className="absolute h-px w-[18px] bg-fg transition-all duration-300 ease-[var(--ease-lux)]"
            style={{ transform: open ? "rotate(45deg)" : "translateY(-5px)" }}
          />
          <span
            className="absolute h-px w-[18px] bg-fg transition-all duration-300 ease-[var(--ease-lux)]"
            style={{ opacity: open ? 0 : 1 }}
          />
          <span
            className="absolute h-px w-[18px] bg-fg transition-all duration-300 ease-[var(--ease-lux)]"
            style={{ transform: open ? "rotate(-45deg)" : "translateY(5px)" }}
          />
        </button>
      </nav>

      {/* Mobile menu overlay. Stays mounted so open/close both animate. */}
      <div
        aria-hidden={!open}
        className={`fixed inset-x-0 bottom-0 top-14 z-90 overflow-y-auto bg-canvas/95 backdrop-blur-2xl transition-opacity duration-300 ease-[var(--ease-lux)] md:hidden ${
          open ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <div className="grid grid-cols-2 gap-2.5 p-5 pt-6">
          {MENU.map((t, i) => {
            const active = pathname === t.href;
            return (
              <a
                key={t.href}
                href={t.href}
                onClick={() => setOpen(false)}
                tabIndex={open ? 0 : -1}
                className={`rounded-xl border p-4 no-underline transition-all duration-300 ease-[var(--ease-lux)] ${
                  active
                    ? "border-white/20 bg-white/[0.07]"
                    : "border-line bg-surface"
                }`}
                style={{
                  opacity: open ? 1 : 0,
                  transform: open ? "translateY(0)" : "translateY(10px)",
                  transitionDelay: open ? `${40 + i * 22}ms` : "0ms",
                }}
              >
                <span
                  className="mb-2.5 block h-1.5 w-1.5 rounded-full"
                  style={{ background: t.tint }}
                />
                <span className="block text-[13.5px] font-medium leading-snug text-fg">
                  {t.name}
                </span>
              </a>
            );
          })}
        </div>
        <p className="mono px-5 pb-8 pt-1 text-[10.5px] uppercase tracking-[0.14em] text-dim-fg">
          Free · No upload · No watermark
        </p>
      </div>
    </>
  );
}
