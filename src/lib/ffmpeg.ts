"use client";

/**
 * ffmpeg.wasm via a hand-rolled client.
 *
 * Why not just use @ffmpeg/ffmpeg's FFmpeg class?
 *  - Turbopack can't bundle its worker ("expression is too dynamic").
 *  - Its class forces a `{type:"module"}` worker, and the CDN UMD worker's
 *    module-import fallback is a dead stub ("Cannot find module").
 *
 * So we run our own self-hosted CLASSIC worker (public/ffmpeg/worker.js),
 * which loads the UMD core via importScripts — the proven, version-stable
 * path — and we talk to it with a tiny id-based message protocol.
 */

const UMD_CORE = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd";

let logCb: ((m: string) => void) | null = null;
let progCb: ((p: number) => void) | null = null;

export function setFFmpegCallbacks(
  log: ((m: string) => void) | null,
  prog: ((p: number) => void) | null
) {
  logCb = log;
  progCb = prog;
}

async function toBlobURL(url: string, mime: string): Promise<string> {
  const buf = await (await fetch(url)).arrayBuffer();
  return URL.createObjectURL(new Blob([buf], { type: mime }));
}

type Pending = { res: (v: any) => void; rej: (e: Error) => void };

class FFmpegClient {
  private worker!: Worker;
  private idc = 0;
  private cbs = new Map<number, Pending>();

  async load() {
    const [coreURL, wasmURL] = await Promise.all([
      toBlobURL(`${UMD_CORE}/ffmpeg-core.js`, "text/javascript"),
      toBlobURL(`${UMD_CORE}/ffmpeg-core.wasm`, "application/wasm"),
    ]);

    this.worker = new Worker("/ffmpeg/worker.js"); // classic worker

    this.worker.onmessage = (e: MessageEvent) => {
      const { id, type, data } = e.data || {};
      if (type === "LOG") return logCb?.(data?.message ?? "");
      if (type === "PROGRESS") return progCb?.(data?.progress ?? 0);
      const cb = this.cbs.get(id);
      if (!cb) return;
      this.cbs.delete(id);
      if (type === "ERROR") cb.rej(new Error(data));
      else cb.res(data);
    };
    this.worker.onerror = (e) => {
      const err = new Error(e.message || "ffmpeg worker crashed");
      this.cbs.forEach((cb) => cb.rej(err));
      this.cbs.clear();
    };

    await this.send("LOAD", { coreURL, wasmURL });
  }

  private send(type: string, data: any, transfer?: Transferable[]): Promise<any> {
    return new Promise((res, rej) => {
      const id = this.idc++;
      this.cbs.set(id, { res, rej });
      this.worker.postMessage({ id, type, data }, transfer || []);
    });
  }

  writeFile(path: string, data: Uint8Array) {
    return this.send("WRITE_FILE", { path, data });
  }
  exec(args: string[]) {
    return this.send("EXEC", { args, timeout: -1 });
  }
  readFile(path: string): Promise<Uint8Array> {
    return this.send("READ_FILE", { path, encoding: "binary" });
  }
  listDir(path: string) {
    return this.send("LIST_DIR", { path });
  }
}

let instance: FFmpegClient | null = null;
let loadingPromise: Promise<FFmpegClient> | null = null;

export async function getFFmpeg(): Promise<FFmpegClient> {
  if (instance) return instance;
  if (loadingPromise) return loadingPromise;
  loadingPromise = (async () => {
    const client = new FFmpegClient();
    await client.load();
    instance = client;
    return client;
  })();
  return loadingPromise;
}

export async function fileToUint8(file: File): Promise<Uint8Array> {
  return new Uint8Array(await file.arrayBuffer());
}
