/** Image to text — a viewfinder reading a Devanagari word (headline + stems) above a Latin line. */
export default function OcrIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 8.5V6a2 2 0 0 1 2-2h2.5" />
      <path d="M15.5 4H18a2 2 0 0 1 2 2v2.5" />
      <path d="M20 15.5V18a2 2 0 0 1-2 2h-2.5" />
      <path d="M8.5 20H6a2 2 0 0 1-2-2v-2.5" />
      <path d="M7.5 9h9" />
      <path d="M10.25 9v3.75" />
      <path d="M13.75 9v2.5" />
      <path d="M7.5 15.75h6" />
    </svg>
  );
}
