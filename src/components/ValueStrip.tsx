"use client";

/**
 * The "how is this free?" answer, laid out as three quiet steps.
 * People genuinely don't believe it — this is where we say it plainly.
 */

import { MediaIcon, BoltIcon, LockIcon, InfinityIcon } from "./Icons";

const STEPS = [
  { n: "01", title: "Pick a tool", body: "No account, no signup, no card. Click and you're in." },
  { n: "02", title: "The model comes to you", body: "Real AI weights download into your browser cache — once, ever." },
  { n: "03", title: "Your GPU does the work", body: "That's the whole trick. No servers to pay for, so nothing to charge you for." },
];

const BADGES = [
  { Icon: LockIcon, label: "Nothing uploads" },
  { Icon: BoltIcon, label: "Runs on your GPU" },
  { Icon: InfinityIcon, label: "No limits, no watermarks" },
  { Icon: MediaIcon, label: "Full-quality exports" },
];

export default function ValueStrip() {
  return (
    <section className="mx-auto max-w-3xl px-6 pb-20">
      <div className="ring-lux rounded-2xl border border-line bg-surface/60 p-8 backdrop-blur-sm sm:p-10">
        <p className="mono mb-8 text-[11px] uppercase tracking-[0.18em] text-accent">
          How is this free?
        </p>
        <div className="grid gap-8 sm:grid-cols-3">
          {STEPS.map((s) => (
            <div key={s.n}>
              <p className="mono mb-2 text-[12px] text-dim-fg">{s.n}</p>
              <p className="mb-1.5 text-[14.5px] font-medium text-fg">{s.title}</p>
              <p className="text-[13px] leading-relaxed text-muted-fg">{s.body}</p>
            </div>
          ))}
        </div>
        <div className="mt-9 flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-line pt-6">
          {BADGES.map((b) => (
            <span key={b.label} className="flex items-center gap-2 text-[12.5px] text-fg-secondary">
              <b.Icon size={15} />
              {b.label}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}
