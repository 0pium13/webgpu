"use client";

/**
 * Bespoke line-icon set — replaces emojis across the UI.
 *
 * One visual language: 24×24 grid, 1.5px stroke, round caps, currentColor.
 * Each icon is drawn to tell the tool's story rather than borrow a generic
 * glyph: the upscaler *expands out of its frame*, the rotoscope is a
 * *marquee selection around a subject*, the background remover shows the
 * *background dissolving into particles*.
 */

import type { CSSProperties } from "react";

interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
  strokeWidth?: number;
}

function Svg({ size = 20, className, style, strokeWidth = 1.5, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden
    >
      {children}
    </svg>
  );
}

/** Upscaler — corner brackets bursting open, detail arrow escaping ↗ */
export function UpscaleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4 8.5V6a2 2 0 0 1 2-2h2.5" />
      <path d="M15.5 4H18a2 2 0 0 1 2 2v2.5" />
      <path d="M20 15.5V18a2 2 0 0 1-2 2h-2.5" />
      <path d="M8.5 20H6a2 2 0 0 1-2-2v-2.5" />
      <path d="M9.5 14.5 15 9" />
      <path d="M11.25 9H15v3.75" />
    </Svg>
  );
}

/** Rotoscope — dashed marquee selection locked around a subject */
export function RotoscopeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="4" y="4" width="16" height="16" rx="3.5" strokeDasharray="3.4 3.4" />
      <circle cx="12" cy="12" r="3.5" />
      <circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Background remover — the subject stays, the background dissolves into particles */
export function BgRemoveIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9.5" cy="14" r="4.5" />
      <circle cx="16.2" cy="4.8" r="1" fill="currentColor" stroke="none" />
      <circle cx="20" cy="6" r="0.85" fill="currentColor" stroke="none" opacity="0.75" />
      <circle cx="17.6" cy="8.8" r="0.9" fill="currentColor" stroke="none" opacity="0.85" />
      <circle cx="20.8" cy="10.2" r="0.7" fill="currentColor" stroke="none" opacity="0.5" />
      <circle cx="15.6" cy="12" r="0.8" fill="currentColor" stroke="none" opacity="0.6" />
      <circle cx="19.4" cy="14.4" r="0.6" fill="currentColor" stroke="none" opacity="0.35" />
      <circle cx="16.8" cy="17.6" r="0.5" fill="currentColor" stroke="none" opacity="0.25" />
    </Svg>
  );
}

/** Privacy — lock with a solid keyhole dot */
export function LockIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="5.5" y="10.5" width="13" height="9" rx="2.5" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
      <circle cx="12" cy="15" r="1" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** GPU power — lightning bolt */
export function BoltIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M13 2.5 4.75 13.5h6.25l-1 8L18.25 10.5H12l1-8Z" />
    </Svg>
  );
}

/** Free forever — infinity loop */
export function InfinityIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M8.4 15.6a3.6 3.6 0 1 1 0-7.2c3.6 0 3.6 7.2 7.2 7.2a3.6 3.6 0 1 0 0-7.2c-3.6 0-3.6 7.2-7.2 7.2Z" />
    </Svg>
  );
}

/** Video + images — a frame holding a landscape */
export function MediaIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="5" width="17" height="14" rx="2.5" />
      <path d="m3.5 15.5 5-4.5 4 4 3-2.5 5 3.8" />
      <circle cx="15.75" cy="9.25" r="1.25" />
    </Svg>
  );
}

/** AI action — a four-point star with a small companion sparkle */
export function SparkleIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M11 4.5c.55 3.3 2.35 5.1 5.65 5.65-3.3.55-5.1 2.35-5.65 5.65-.55-3.3-2.35-5.1-5.65-5.65 3.3-.55 5.1-2.35 5.65-5.65Z" />
      <path d="M17.75 14.5c.3 1.8 1.28 2.78 3.08 3.08-1.8.3-2.78 1.28-3.08 3.08-.3-1.8-1.28-2.78-3.08-3.08 1.8-.3 2.78-1.28 3.08-3.08Z" />
    </Svg>
  );
}

/** Auto-select — magic wand with a sparkle at the tip */
export function WandIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M4.5 19.5 13.5 10.5" />
      <path d="M17.25 3.75c.35 2.05 1.45 3.15 3.5 3.5-2.05.35-3.15 1.45-3.5 3.5-.35-2.05-1.45-3.15-3.5-3.5 2.05-.35 3.15-1.45 3.5-3.5Z" />
    </Svg>
  );
}

/** Deep time — hourglass */
export function HourglassIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6.5 3.5h11M6.5 20.5h11" />
      <path d="M8 3.5v2.7c0 2.6 4 3.5 4 5.8 0-2.3 4-3.2 4-5.8V3.5" />
      <path d="M8 20.5v-2.7c0-2.6 4-3.5 4-5.8 0 2.3 4 3.2 4 5.8v2.7" />
    </Svg>
  );
}

/** Humanity — a crowd of heads */
export function UsersIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <circle cx="9" cy="8.5" r="3.25" />
      <path d="M3.5 19.5c.6-3.3 2.7-5 5.5-5s4.9 1.7 5.5 5" />
      <path d="M15.5 5.6a3.25 3.25 0 0 1 0 5.8" />
      <path d="M17.5 14.9c1.7.7 2.7 2.2 3 4.6" />
    </Svg>
  );
}

/** Local AI chat — speech bubble with a sparkle */
export function ChatIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M20 11.5a7.5 7.5 0 0 1-11 6.6L4.5 19.5l1.4-4.5A7.5 7.5 0 1 1 20 11.5Z" />
      <path d="M12.5 8.2c.3 1.9 1.35 2.9 3.3 3.3-1.95.4-3 1.4-3.3 3.3-.3-1.9-1.35-2.9-3.3-3.3 1.95-.4 3-1.4 3.3-3.3Z" />
    </Svg>
  );
}

/** Console league — gamepad */
export function GamepadIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7 8h10a4.5 4.5 0 0 1 4.4 5.4l-.7 3.2a2.6 2.6 0 0 1-4.6 1L14.6 16H9.4l-1.5 1.6a2.6 2.6 0 0 1-4.6-1l-.7-3.2A4.5 4.5 0 0 1 7 8Z" />
      <path d="M8.5 11v3M7 12.5h3" />
      <circle cx="15.5" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="17.5" cy="13.5" r="0.5" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Image -> 3D — an isometric cube materializing from a sparkle */
export function CubeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M12 3 20 7.5v9L12 21l-8-4.5v-9L12 3Z" />
      <path d="M12 12 20 7.5M12 12v9M12 12 4 7.5" />
    </Svg>
  );
}

/** PDF studio — a document with a folded corner and page-surgery marks */
export function PdfIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M6 3.5h8.5L19 8v10.5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2Z" />
      <path d="M14.5 3.5V8H19" />
      <path d="M7.5 12.5h8M7.5 15.5h5" />
      <circle cx="16.5" cy="15.5" r="0.7" fill="currentColor" stroke="none" />
    </Svg>
  );
}

/** Vibe coder — angle brackets with a spark of generation between them */
export function CodeIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m8 7.5-4.5 4.5L8 16.5" />
      <path d="m16 7.5 4.5 4.5L16 16.5" />
      <path d="M12 8.6c.24 1.4 1 2.16 2.4 2.4-1.4.24-2.16 1-2.4 2.4-.24-1.4-1-2.16-2.4-2.4 1.4-.24 2.16-1 2.4-2.4Z" />
    </Svg>
  );
}

/** Voice studio — a waveform finding its shape */
export function VoiceIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M3.5 10.5v3M6.5 8v8M9.5 5.5v13M12.5 9v6M15.5 6.5v11M18.5 9.5v5M21 11v2" />
    </Svg>
  );
}

/** Webcam studio — a camera lens with a live-enhance spark */
export function VideocamIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3" y="6.5" width="12.5" height="11" rx="2.5" />
      <path d="m15.5 10 5-2.5v9l-5-2.5" />
      <path d="M8.75 9.4c.28 1.6 1.15 2.47 2.75 2.75-1.6.28-2.47 1.15-2.75 2.75-.28-1.6-1.15-2.47-2.75-2.75 1.6-.28 2.47-1.15 2.75-2.75Z" />
    </Svg>
  );
}

/** Magic eraser — tilted eraser wiping, the removed bits dissolving away */
export function EraserIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="m4.5 15.5 8-8a2.2 2.2 0 0 1 3.1 0l2.4 2.4a2.2 2.2 0 0 1 0 3.1l-6.5 6.5H8l-3.5-3.5Z" />
      <path d="m10.5 9.5 5.5 5.5" />
      <path d="M13 19.5h6.5" />
      <circle cx="18.6" cy="5.4" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="21" cy="8" r="0.6" fill="currentColor" stroke="none" opacity="0.6" />
      <circle cx="20.6" cy="3.2" r="0.5" fill="currentColor" stroke="none" opacity="0.4" />
    </Svg>
  );
}

/** Converter — two file shapes trading places in a cycle */
export function ConvertIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <path d="M7.5 9.5v-3a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-2" />
      <rect x="3.5" y="9.5" width="13" height="10" rx="2" />
      <path d="M8 14.5h4.5M10.75 12.25l2.25 2.25-2.25 2.25" />
    </Svg>
  );
}

/** Auto subtitles — a caption box with text lines */
export function CaptionsIcon(props: IconProps) {
  return (
    <Svg {...props}>
      <rect x="3.5" y="6" width="17" height="12.5" rx="2.5" />
      <path d="M7 12h4.5M14 12h3M7 15h2M11.5 15h5.5" />
    </Svg>
  );
}
