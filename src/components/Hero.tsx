"use client";

import GPUAnalytics from "./GPUAnalytics";
import { DEFAULT_CONTENT, type SiteContent } from "@/lib/site-content";

export default function Hero({
  hero = DEFAULT_CONTENT.hero,
}: {
  hero?: SiteContent["hero"];
}) {
  return (
    <section className="relative flex flex-col items-center px-6 pt-32 pb-16 sm:pt-36">
      <div className="aurora" />

      <div className="mb-14 text-center">
        <h1 className="text-lux rise rise-2 mx-auto mb-5 max-w-2xl text-[clamp(42px,7vw,76px)] leading-[1.05] font-medium tracking-[-0.035em] text-balance">
          {hero.headingBefore}
          <span className="grad-live">{hero.headingAccent}</span>
        </h1>

        <p className="rise rise-3 mx-auto max-w-md text-[16px] leading-relaxed text-muted-fg">
          {hero.sub}
        </p>
      </div>

      <div className="rise rise-4 w-full">
        <GPUAnalytics />
      </div>
    </section>
  );
}
