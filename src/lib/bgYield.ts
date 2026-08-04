"use client";

/**
 * Keep long jobs running at full speed in background tabs.
 *
 * Browsers throttle setTimeout in hidden tabs (1s clamp, then 1/min under
 * "intensive throttling") — so a tile loop that yields with setTimeout(0)
 * between chunks slows ~1000x the moment the user switches tabs. That was
 * exactly the "continuity breaks" report. MessageChannel messages are NOT
 * timer-throttled, so this yield keeps the event loop breathing for UI
 * responsiveness while letting hidden-tab work continue at full speed.
 */
export function uiYield(): Promise<void> {
  return new Promise((resolve) => {
    const ch = new MessageChannel();
    ch.port1.onmessage = () => {
      ch.port1.close();
      resolve();
    };
    ch.port2.postMessage(0);
  });
}

/**
 * Progress in the tab title — the user can watch a job tick from another
 * tab, and a finished job announces itself. Call with null to restore.
 */
let baseTitle: string | null = null;
export function titleProgress(label: string | null, pct?: number) {
  if (typeof document === "undefined") return;
  if (baseTitle === null) baseTitle = document.title;
  if (label === null) {
    document.title = baseTitle;
    baseTitle = null;
    return;
  }
  document.title =
    pct != null ? `${Math.round(pct)}% · ${label} — webgpu.in` : `${label} — webgpu.in`;
}

/** "✓ Done" flash in the title so a background tab shows completion. */
export function titleDone(label: string) {
  if (typeof document === "undefined") return;
  if (baseTitle === null) baseTitle = document.title;
  document.title = `✓ ${label} — webgpu.in`;
  // restore once the user comes back and has had a moment to see it
  const restore = () => {
    setTimeout(() => titleProgress(null), 1500);
    document.removeEventListener("visibilitychange", restore);
  };
  if (document.hidden) document.addEventListener("visibilitychange", restore);
  else setTimeout(() => titleProgress(null), 4000);
}
