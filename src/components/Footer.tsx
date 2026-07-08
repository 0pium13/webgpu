"use client";

const LINKS = [
  { name: "Upscaler", href: "/upscale" },
  { name: "Rotoscope", href: "/rotoscope" },
  { name: "BG Remover", href: "/bg-remove" },
  { name: "Image to 3D", href: "/image-to-3d" },
  { name: "Subtitles", href: "/subtitles" },
  { name: "Eraser", href: "/erase" },
  { name: "Converter", href: "/convert" },
  { name: "PDF", href: "/pdf" },
  { name: "Voice", href: "/voice" },
  { name: "Webcam", href: "/webcam" },
  { name: "AI Chat", href: "/chat" },
  { name: "GitHub", href: "https://github.com/0pium13/webgpu" },
];

export default function Footer() {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-4 border-t border-line px-6 py-7 sm:px-8">
      <div className="flex items-center gap-2">
        <svg
          width="15" height="15" viewBox="0 0 24 24" fill="none"
          stroke="var(--accent)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"
        >
          <rect x="4" y="4" width="16" height="16" rx="2" />
          <rect x="9" y="9" width="6" height="6" />
          <path d="M15 2v2M9 2v2M15 20v2M9 20v2M2 15h2M2 9h2M20 15h2M20 9h2" />
        </svg>
        <span className="mono text-[13px] font-medium text-fg">webgpu.in</span>
      </div>

      <div className="flex items-center gap-5">
        {LINKS.map((l) => (
          <a
            key={l.name}
            href={l.href}
            className="text-[12.5px] text-muted-fg no-underline transition-colors duration-200 hover:text-fg"
          >
            {l.name}
          </a>
        ))}
      </div>

      <p className="mono text-[11px] text-dim-fg">Nothing uploaded, ever.</p>
    </footer>
  );
}
