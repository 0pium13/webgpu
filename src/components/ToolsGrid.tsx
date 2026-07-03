"use client";

import { useCallback } from "react";
import { UpscaleIcon, RotoscopeIcon, BgRemoveIcon } from "./Icons";

const TOOLS = [
  { href: "/upscale", Icon: UpscaleIcon, name: "Upscaler", desc: "Real AI detail reconstruction. Up to 4K." },
  { href: "/rotoscope", Icon: RotoscopeIcon, name: "Rotoscope", desc: "Cut out and track any object, even in video." },
  { href: "/bg-remove", Icon: BgRemoveIcon, name: "Background Remover", desc: "Instant, clean edges. One click." },
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
      <div className="stagger grid grid-cols-1 gap-3 sm:grid-cols-3">
        {TOOLS.map((t) => (
          <a
            key={t.href}
            href={t.href}
            onMouseMove={track}
            className="spotlight group block rounded-2xl border border-line bg-surface p-6 no-underline transition-[border-color,transform,box-shadow] duration-300 ease-[var(--ease-lux)] hover:-translate-y-0.5 hover:border-line-strong hover:shadow-[0_12px_40px_-16px_rgba(99,102,241,0.25)] active:translate-y-0 active:scale-[0.99]"
          >
            <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-line bg-surface-2 text-fg-secondary shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-[transform,color] duration-300 ease-[var(--ease-spring)] group-hover:scale-110 group-hover:text-accent">
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
