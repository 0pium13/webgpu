"use client";

/**
 * WebSR — real-time AI super-resolution (Anime4K CNN) on WebGPU.
 * Engine by Sam Bhattacharyya (@websr/websr, MIT). We wrap it with our own
 * video capture pipeline + UI. Weights are served from /public/weights.
 */

export type NetSize = "s" | "m";
export type Content = "rl" | "an"; // real-life / anime

let WebSRClass: any = null;

async function getWebSR() {
  if (!WebSRClass) {
    const mod: any = await import("@websr/websr");
    WebSRClass = mod.default || mod.WebSR || mod;
  }
  return WebSRClass;
}

export async function webgpuAvailable(): Promise<boolean> {
  try {
    const W = await getWebSR();
    return !!(await W.initWebGPU());
  } catch {
    return false;
  }
}

/** Create a WebSR upscaler bound to an output canvas. 2x Anime4K. */
export async function createUpscaler(
  canvas: HTMLCanvasElement,
  size: NetSize,
  content: Content
): Promise<any> {
  const W = await getWebSR();
  const gpu = await W.initWebGPU();
  if (!gpu) throw new Error("WebGPU is not available in this browser");
  const network_name = `anime4k/cnn-2x-${size}`;
  const weights = await (await fetch(`/weights/anime4k/cnn-2x-${size}-${content}.json`)).json();
  return new W({ network_name, weights, gpu, canvas });
}
