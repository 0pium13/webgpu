"use client";

export type Tier = 0 | 1 | 2 | 3;
export const TIER_LABEL = ["Entry", "Solid", "Strong", "Beast"] as const;
export const TIER_COLOR = [
  "var(--text-muted)",
  "var(--amber)",
  "var(--accent)",
  "var(--green)",
];

export interface DeviceReport {
  supported: boolean;
  gpu: string;
  architecture: string;
  gflops: number;
  score: number;
  tier: Tier;
  percentile: number;
  cpuCores: number;
  ramGb: number | null;
  os: string;
  browser: string;
  screen: string;
  refreshHz: number;
  features: string[];
  limits: { label: string; value: string }[];
}

export type Phase = "detect" | "benchmark" | "analyze" | "done";

function parseGpuName(raw: string | null): string {
  if (!raw) return "GPU detected";
  const m = raw.match(/ANGLE \(([^,]+), (.+?)(?:,[^,]*)?\)/);
  if (m) {
    let r = m[2]
      .replace(/ANGLE Metal Renderer:\s*/i, "")
      .replace(/\s*Direct3D.*$/i, "")
      .replace(/\s*vs_[\d_]+.*$/i, "")
      .replace(/\s*\(0x[0-9A-Fa-f]+\)/, "")
      .trim();
    return r || m[1];
  }
  return raw.replace(/\s+/g, " ").trim();
}

function detectBrowser(): string {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return "Edge";
  if (/OPR\//.test(ua)) return "Opera";
  if (/Chrome\//.test(ua)) return "Chrome";
  if (/Firefox\//.test(ua)) return "Firefox";
  if (/Safari\//.test(ua)) return "Safari";
  return "Browser";
}

function detectOS(): string {
  const p = (navigator as any).userAgentData?.platform || navigator.platform || "";
  const ua = navigator.userAgent;
  if (/Mac/i.test(p) || /Mac OS/i.test(ua)) return "macOS";
  if (/Win/i.test(p) || /Windows/i.test(ua)) return "Windows";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iOS/i.test(ua)) return "iOS";
  if (/Linux/i.test(p)) return "Linux";
  return p || "Unknown";
}

function getGpuName(): string {
  try {
    const gl = (document.createElement("canvas").getContext("webgl") ||
      document.createElement("canvas").getContext("experimental-webgl")) as WebGLRenderingContext;
    const ext = gl.getExtension("WEBGL_debug_renderer_info");
    if (ext) return parseGpuName(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL));
  } catch {}
  return "GPU detected";
}

function measureRefresh(): Promise<number> {
  return new Promise((res) => {
    let n = 0;
    const t0 = performance.now();
    function frame() {
      n++;
      const dt = performance.now() - t0;
      if (dt < 350) requestAnimationFrame(frame);
      else res(Math.round(n / (dt / 1000)));
    }
    requestAnimationFrame(frame);
  });
}

async function runBenchmark(
  device: GPUDevice
): Promise<number> {
  const N = 1 << 20;
  const wg = 256;
  const data = device.createBuffer({ size: N * 4, usage: GPUBufferUsage.STORAGE });
  const uni = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const module = device.createShaderModule({
    code: `
      struct U { iters: u32 };
      @group(0) @binding(0) var<storage, read_write> data: array<f32>;
      @group(0) @binding(1) var<uniform> u: U;
      @compute @workgroup_size(${wg})
      fn main(@builtin(global_invocation_id) g: vec3<u32>) {
        let i = g.x;
        var x = f32(i) * 0.00001 + 1.0;
        var y = x * 0.5 + 0.2;
        for (var k = 0u; k < u.iters; k = k + 1u) {
          x = fma(x, y, 0.001);
          y = fma(y, x, 0.001);
        }
        data[i] = x + y;
      }`,
  });
  const pipe = device.createComputePipeline({ layout: "auto", compute: { module, entryPoint: "main" } });
  const bg = device.createBindGroup({
    layout: pipe.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: data } },
      { binding: 1, resource: { buffer: uni } },
    ],
  });

  async function run(iters: number): Promise<number> {
    device.queue.writeBuffer(uni, 0, new Uint32Array([iters]));
    const enc = device.createCommandEncoder();
    const p = enc.beginComputePass();
    p.setPipeline(pipe);
    p.setBindGroup(0, bg);
    p.dispatchWorkgroups(N / wg);
    p.end();
    device.queue.submit([enc.finish()]);
    const t0 = performance.now();
    await device.queue.onSubmittedWorkDone();
    return performance.now() - t0;
  }

  await run(64); // warmup
  let iters = 512;
  let t = await run(iters);
  while (t < 60 && iters < 80000) {
    iters *= 3;
    t = await run(iters);
  }
  const times = [await run(iters), await run(iters), await run(iters)].sort((a, b) => a - b);
  const med = times[1];
  const flops = N * iters * 4; // 2 fma × 2 flops
  return flops / (med / 1000) / 1e9;
}

function tierFromGflops(g: number): Tier {
  if (g < 350) return 0;
  if (g < 900) return 1;
  if (g < 2500) return 2;
  return 3;
}

function percentileFromGflops(g: number): number {
  // "faster than X% of devices" → returns the top-N% the device sits in
  const pts: [number, number][] = [
    [100, 82], [250, 65], [500, 48], [900, 33], [1400, 24],
    [2200, 16], [3500, 10], [6000, 5], [10000, 2], [18000, 1],
  ];
  if (g <= pts[0][0]) return pts[0][1];
  for (let i = 1; i < pts.length; i++) {
    if (g <= pts[i][0]) {
      const [g0, p0] = pts[i - 1];
      const [g1, p1] = pts[i];
      return Math.round(p0 + ((p1 - p0) * (g - g0)) / (g1 - g0));
    }
  }
  return 1;
}

let cached: DeviceReport | null = null;

export async function generateReport(
  onPhase?: (phase: Phase) => void
): Promise<DeviceReport> {
  if (cached) {
    onPhase?.("done");
    return cached;
  }

  const gpu = getGpuName();
  const cpuCores = navigator.hardwareConcurrency || 0;
  const ramGb = (navigator as any).deviceMemory ?? null;
  const os = detectOS();
  const browser = detectBrowser();
  const screenStr = `${Math.round(screen.width * devicePixelRatio)}×${Math.round(
    screen.height * devicePixelRatio
  )}`;

  onPhase?.("detect");
  const refreshHz = await measureRefresh();

  if (typeof navigator === "undefined" || !navigator.gpu) {
    const fail: DeviceReport = {
      supported: false, gpu, architecture: "—", gflops: 0, score: 0, tier: 0,
      percentile: 90, cpuCores, ramGb, os, browser, screen: screenStr,
      refreshHz, features: [], limits: [],
    };
    cached = fail;
    onPhase?.("done");
    return fail;
  }

  try {
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: "high-performance" });
    if (!adapter) throw new Error("no adapter");
    const device = await adapter.requestDevice();
    const info = (adapter as any).info ?? {};

    onPhase?.("benchmark");
    const gflops = Math.round(await runBenchmark(device));

    onPhase?.("analyze");
    const tier = tierFromGflops(gflops);
    const percentile = percentileFromGflops(gflops);
    const features = [...adapter.features].slice(0, 10);
    const limits = [
      { label: "Max texture", value: `${adapter.limits.maxTextureDimension2D}px` },
      { label: "Max buffer", value: `${Math.round(adapter.limits.maxBufferSize / 1048576)} MB` },
      { label: "Workgroup", value: `${adapter.limits.maxComputeWorkgroupSizeX}` },
      { label: "Invocations", value: `${adapter.limits.maxComputeInvocationsPerWorkgroup}` },
    ];

    const report: DeviceReport = {
      supported: true,
      gpu,
      architecture: info.architecture || info.vendor || "—",
      gflops,
      score: gflops,
      tier,
      percentile,
      cpuCores,
      ramGb,
      os,
      browser,
      screen: screenStr,
      refreshHz,
      features,
      limits,
    };
    cached = report;
    device.destroy();
    onPhase?.("done");
    return report;
  } catch {
    const fallback: DeviceReport = {
      supported: false, gpu, architecture: "—", gflops: 0, score: 0, tier: 0,
      percentile: 80, cpuCores, ramGb, os, browser, screen: screenStr,
      refreshHz, features: [], limits: [],
    };
    cached = fallback;
    onPhase?.("done");
    return fallback;
  }
}

export function funComparisons(g: number, tier: Tier): { icon: string; text: string }[] {
  const tf = (g / 250).toFixed(1); // rough peak TFLOPS estimate
  const tok = Math.max(2, Math.round(g / 130)); // local LLM tokens/sec
  const sd = Math.max(1, Math.round(4000 / g * 8)); // SD image seconds
  const list = [
    { icon: "🧮", text: `Measured ~${g.toLocaleString()} GFLOPS of real compute (~${tf} TFLOPS peak)` },
    { icon: "🤖", text: `Can run a local 7B LLM at roughly ${tok} tokens/second` },
    { icon: "🎨", text: `Generates a Stable Diffusion image in about ${sd}s` },
  ];
  if (tier >= 3) list.push({ icon: "🏎️", text: "Faster than a PlayStation 5's GPU" });
  else if (tier === 2) list.push({ icon: "🎮", text: "Roughly half the raw power of a PlayStation 5" });
  else if (tier === 1) list.push({ icon: "📱", text: "Comparable to a flagship phone or game console" });
  else list.push({ icon: "🐢", text: "Light-duty — great for images, slow for video" });
  return list;
}
