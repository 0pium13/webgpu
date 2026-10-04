/** Noise remover — a clean voice waveform on a flat floor, the noise dissolving off it.
 *  Same grammar as components/Icons.tsx (24×24, 1.5px stroke, round caps). */
export default function DenoiseIcon({ size = 20, strokeWidth = 1.5 }: { size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 12h2.5M19 12h2.5" />
      <path d="M7.5 10.5v3M10 8v8M12.5 5.5v13M15 8.5v7M17.5 10.75v2.5" />
      <circle cx="4.2" cy="7.6" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="2.9" cy="4.9" r="0.6" fill="currentColor" stroke="none" opacity="0.6" />
      <circle cx="6.1" cy="4.1" r="0.5" fill="currentColor" stroke="none" opacity="0.4" />
    </svg>
  );
}
