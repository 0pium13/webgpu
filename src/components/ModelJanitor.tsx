"use client";

import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { releaseModelsExcept } from "@/lib/modelRegistry";

/**
 * Mounted once in the root layout. On every client-side route change it
 * releases models the new route doesn't use (see modelRegistry.ts), so
 * instant tool-to-tool navigation never stacks models in VRAM.
 */
export default function ModelJanitor() {
  const pathname = usePathname();
  const prev = useRef(pathname);
  useEffect(() => {
    if (prev.current === pathname) return;
    prev.current = pathname;
    releaseModelsExcept(pathname);
  }, [pathname]);
  return null;
}
