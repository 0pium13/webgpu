"use client";

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
];

export default function Nav() {
  const pathname = usePathname();

  return (
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

      <div className="flex items-center gap-1">
        {LINKS.map((l) => {
          const active = pathname === l.href;
          return (
            <a
              key={l.href}
              href={l.href}
              className={`whitespace-nowrap rounded-lg px-3 py-1.5 text-[13px] font-medium no-underline transition-colors duration-200 ${
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
    </nav>
  );
}
