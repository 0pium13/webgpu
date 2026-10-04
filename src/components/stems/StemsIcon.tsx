/** Stem splitter — one waveform forking into separate stems (Icons.tsx language: 24px grid, 1.5 stroke). */
export default function StemsIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2.5 11v2M5 8.5v7M7.5 10v4" />
      <path d="M10 12c2.6 0 3.2-5.5 6.2-5.5h5.3" />
      <path d="M10 12h11.5" />
      <path d="M10 12c2.6 0 3.2 5.5 6.2 5.5h5.3" />
    </svg>
  );
}
