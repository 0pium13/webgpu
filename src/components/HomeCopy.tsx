"use client";

import { useEffect, useState } from "react";
import Hero from "@/components/Hero";
import ToolsGrid from "@/components/ToolsGrid";
import Reveal from "@/components/Reveal";
import { DEFAULT_CONTENT, type SiteContent } from "@/lib/site-content";

/**
 * Homepage copy. The page is a static export, so it ships the defaults; any
 * /admin edits come from the /api/content function and replace them after
 * load, so a save is live without a rebuild.
 */
export default function HomeCopy() {
  const [content, setContent] = useState<SiteContent>(DEFAULT_CONTENT);

  useEffect(() => {
    let live = true;
    fetch("/api/content")
      .then((r) => (r.ok ? (r.json() as Promise<SiteContent>) : null))
      .then((c) => {
        if (live && c && JSON.stringify(c) !== JSON.stringify(DEFAULT_CONTENT)) setContent(c);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      <Hero hero={content.hero} />
      <Reveal><ToolsGrid tools={content.tools} /></Reveal>
    </>
  );
}
