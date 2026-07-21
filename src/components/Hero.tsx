"use client";

import GPUAnalytics from "./GPUAnalytics";

export default function Hero() {
  return (
    <section className="relative flex flex-col items-center px-6 pt-32 pb-16 sm:pt-36">
      <div className="aurora" />

      <div className="mb-14 text-center">
        <h1 className="text-lux rise rise-2 mx-auto mb-5 max-w-2xl text-[clamp(42px,7vw,76px)] leading-[1.05] font-medium tracking-[-0.035em] text-balance">
          See what your GPU can <span className="grad-live">really do</span>
        </h1>

        <p className="rise rise-3 mx-auto max-w-md text-[16px] leading-relaxed text-muted-fg">
          Free AI tools that run entirely on your GPU.
          Nothing uploaded, nothing installed.
        </p>
      </div>

      <div className="rise rise-4 w-full">
        <GPUAnalytics />
      </div>
    </section>
  );
}
