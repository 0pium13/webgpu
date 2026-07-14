"use client";

/**
 * Single image → real 3D mesh, fully in-browser.
 *
 * Engine: TripoSR (Tripo AI + Stability AI, Apache-2.0) — a genuine
 * image-to-3D reconstruction model that PREDICTS hidden geometry, exported
 * for onnxruntime-web WebGPU as three sessions
 * (dcharlot65-aurasense/triposr-onnx-web):
 *
 *   encoder  (1,3,512,512) image        -> tokens      (1,768,1025)
 *   backbone (1,1025,768)  image tokens -> scene_codes (1,3,40,64,64)  [triplane]
 *   decoder  triplane + (N,3) points    -> density (N,1), color (N,3)
 *
 * Pipeline: RMBG cutout → composite on 0.5 gray, 512² → encoder → backbone
 * → sample density on a 3D grid over (−0.87, +0.87)³ → Surface Nets at
 * iso 25 → query decoder again at vertex positions for colors.
 */

const REPO = "https://huggingface.co/dcharlot65-aurasense/triposr-onnx-web/resolve/main";
const BOUND = 0.87;
const ISO = 25;

import { loadOrt, createSession } from "@/lib/ortRuntime";
import { ortDevice } from "@/lib/gpuBackend";

export type To3DPhase =
  | { step: "download"; pct: number }
  | { step: "cutout" }
  | { step: "understand" }   // encoder
  | { step: "imagine" }      // backbone (predicting unseen sides)
  | { step: "carve"; pct: number }   // density grid + surface nets
  | { step: "paint" };       // vertex colors

export interface Mesh3D {
  positions: Float32Array; // xyz per vertex
  colors: Float32Array;    // rgb 0..1 per vertex
  indices: Uint32Array;
  cutoutUrl: string;       // the isolated subject, for the UI
}

let sessionsPromise: Promise<{ ort: any; encoder: any; backbone: any; decoder: any }> | null = null;

function loadSessions(onProgress?: (pct: number) => void) {
  if (sessionsPromise) return sessionsPromise;
  sessionsPromise = (async () => {
    const ort = await loadOrt();
    // sizes (bytes) for a single combined progress number
    const sizes = { encoder: 173e6, backbone: 666e6, decoder: 0.2e6 };
    const totalAll = sizes.encoder + sizes.backbone + sizes.decoder;
    const got = { encoder: 0, backbone: 0, decoder: 0 };
    const report = () => {
      const loaded = got.encoder + got.backbone + got.decoder;
      onProgress?.(Math.min(99, Math.round((loaded / totalAll) * 100)));
    };
    const mk = (name: keyof typeof got, file: string, eps?: string[]) =>
      createSession(ort, `${REPO}/${file}`, (l) => { got[name] = l; report(); }, eps);

    // sequential keeps peak memory sane (backbone alone is ~666MB).
    // decoder runs on wasm: it's a tiny MLP + GridSample, and GridSample on
    // some WebGPU backends silently corrupts the command buffer — wasm is
    // deterministic and fast enough at this size.
    const encoder = await mk("encoder", "encoder_fp16.onnx");
    const backbone = await mk("backbone", "backbone_fp16.onnx");
    const decoder = await mk("decoder", "decoder_fp16.onnx", ["wasm"]);
    onProgress?.(100);
    return { ort, encoder, backbone, decoder };
  })();
  sessionsPromise.catch(() => { sessionsPromise = null; }); // allow retry
  return sessionsPromise;
}

// ── background removal (RMBG-1.4, same engine the BG-remover tool uses) ────

async function cutoutSubject(img: HTMLImageElement): Promise<HTMLCanvasElement> {
  const tj: any = await import("@huggingface/transformers");
  const { AutoModel, AutoProcessor, RawImage, env } = tj;
  env.allowLocalModels = false;
  let model: any, processor: any;
  const want = await ortDevice(); // Safari/WebKit → wasm (ORT webgpu broken there)
  try {
    model = await AutoModel.from_pretrained("briaai/RMBG-1.4", { device: want, dtype: "fp32" });
  } catch {
    model = await AutoModel.from_pretrained("briaai/RMBG-1.4", { dtype: "fp32" });
  }
  processor = await AutoProcessor.from_pretrained("briaai/RMBG-1.4");

  const raw = await RawImage.fromURL(img.src);
  const { pixel_values } = await processor(raw);
  const { output } = await model({ input: pixel_values });
  const mask = await RawImage.fromTensor(output[0].mul(255).to("uint8")).resize(raw.width, raw.height);

  const c = document.createElement("canvas");
  c.width = raw.width; c.height = raw.height;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(img, 0, 0, raw.width, raw.height);
  const id = ctx.getImageData(0, 0, raw.width, raw.height);
  for (let i = 0; i < mask.data.length; i++) id.data[i * 4 + 3] = mask.data[i];
  ctx.putImageData(id, 0, 0);
  return c;
}

/** RGBA cutout → fp32 CHW (1,3,512,512), composited over 0.5 gray. */
function preprocess(cutout: HTMLCanvasElement): Float32Array {
  const S = 512;
  const c = document.createElement("canvas");
  c.width = S; c.height = S;
  const ctx = c.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // fit with padding, centered — TripoSR expects the object framed with margin
  const scale = (S * 0.85) / Math.max(cutout.width, cutout.height);
  const w = cutout.width * scale, h = cutout.height * scale;
  ctx.drawImage(cutout, (S - w) / 2, (S - h) / 2, w, h);
  const id = ctx.getImageData(0, 0, S, S).data;

  const out = new Float32Array(3 * S * S);
  for (let i = 0; i < S * S; i++) {
    const a = id[i * 4 + 3] / 255;
    for (let ch = 0; ch < 3; ch++) {
      const v = (id[i * 4 + ch] / 255) * a + 0.5 * (1 - a); // over gray
      out[ch * S * S + i] = v;
    }
  }
  return out;
}

/** (1,768,1025) → (1,1025,768) */
function transposeTokens(t: Float32Array): Float32Array {
  const C = 768, N = 1025;
  const out = new Float32Array(C * N);
  for (let c = 0; c < C; c++)
    for (let n = 0; n < N; n++)
      out[n * C + c] = t[c * N + n];
  return out;
}

// ── Surface Nets: density grid → smooth mesh (compact, no 256-entry tables) ─

function surfaceNets(
  field: Float32Array, R: number, iso: number, bound: number
): { positions: Float32Array; indices: Uint32Array } {
  const cellIdx = new Int32Array((R - 1) * (R - 1) * (R - 1)).fill(-1);
  const verts: number[] = [];
  const at = (x: number, y: number, z: number) => field[(x * R + y) * R + z];
  const world = (g: number) => (g / (R - 1)) * 2 * bound - bound;

  // one vertex per sign-changing cell, at the mean of edge crossings
  for (let x = 0; x < R - 1; x++) for (let y = 0; y < R - 1; y++) for (let z = 0; z < R - 1; z++) {
    let cx = 0, cy = 0, cz = 0, n = 0;
    for (let e = 0; e < 12; e++) {
      const [a, b] = EDGES[e];
      const va = at(x + a[0], y + a[1], z + a[2]) - iso;
      const vb = at(x + b[0], y + b[1], z + b[2]) - iso;
      if ((va < 0) === (vb < 0)) continue;
      const t = va / (va - vb);
      cx += x + a[0] + t * (b[0] - a[0]);
      cy += y + a[1] + t * (b[1] - a[1]);
      cz += z + a[2] + t * (b[2] - a[2]);
      n++;
    }
    if (!n) continue;
    cellIdx[(x * (R - 1) + y) * (R - 1) + z] = verts.length / 3;
    verts.push(world(cx / n), world(cy / n), world(cz / n));
  }

  // quads across the three axis-aligned edge directions
  const cid = (x: number, y: number, z: number) => cellIdx[(x * (R - 1) + y) * (R - 1) + z];
  const idx: number[] = [];
  for (let x = 0; x < R - 1; x++) for (let y = 0; y < R - 1; y++) for (let z = 0; z < R - 1; z++) {
    // X-edge between (x,y,z)-(x+1,y,z): quad of cells around it in yz
    if (y > 0 && z > 0) {
      const a = at(x, y, z) - iso, b = at(x + 1, y, z) - iso;
      if ((a < 0) !== (b < 0)) {
        const q = [cid(x, y - 1, z - 1), cid(x, y, z - 1), cid(x, y, z), cid(x, y - 1, z)];
        if (q.every((v) => v >= 0)) pushQuad(idx, q, a < 0);
      }
    }
    // Y-edge
    if (x > 0 && z > 0) {
      const a = at(x, y, z) - iso, b = at(x, y + 1, z) - iso;
      if ((a < 0) !== (b < 0)) {
        const q = [cid(x - 1, y, z - 1), cid(x - 1, y, z), cid(x, y, z), cid(x, y, z - 1)];
        if (q.every((v) => v >= 0)) pushQuad(idx, q, a < 0);
      }
    }
    // Z-edge
    if (x > 0 && y > 0) {
      const a = at(x, y, z) - iso, b = at(x, y, z + 1) - iso;
      if ((a < 0) !== (b < 0)) {
        const q = [cid(x - 1, y - 1, z), cid(x, y - 1, z), cid(x, y, z), cid(x - 1, y, z)];
        if (q.every((v) => v >= 0)) pushQuad(idx, q, a < 0);
      }
    }
  }

  return { positions: new Float32Array(verts), indices: new Uint32Array(idx) };
}

const EDGES: [number[], number[]][] = [
  [[0,0,0],[1,0,0]],[[0,1,0],[1,1,0]],[[0,0,1],[1,0,1]],[[0,1,1],[1,1,1]],
  [[0,0,0],[0,1,0]],[[1,0,0],[1,1,0]],[[0,0,1],[0,1,1]],[[1,0,1],[1,1,1]],
  [[0,0,0],[0,0,1]],[[1,0,0],[1,0,1]],[[0,1,0],[0,1,1]],[[1,1,0],[1,1,1]],
];

function pushQuad(idx: number[], q: number[], flip: boolean) {
  const [a, b, c, d] = flip ? [q[0], q[3], q[2], q[1]] : q;
  idx.push(a, b, c, a, c, d);
}

// ── main pipeline ────────────────────────────────────────────────────────────

export async function imageTo3D(
  img: HTMLImageElement,
  resolution: number,
  onPhase: (p: To3DPhase) => void
): Promise<Mesh3D> {
  const { ort, encoder, backbone, decoder } = await loadSessions((pct) => onPhase({ step: "download", pct }));

  onPhase({ step: "cutout" });
  const cutout = await cutoutSubject(img);
  const cutoutUrl = cutout.toDataURL("image/png");

  onPhase({ step: "understand" });
  const image = new ort.Tensor("float32", preprocess(cutout), [1, 3, 512, 512]);
  const encOut = await encoder.run({ [encoder.inputNames[0]]: image });
  const tokens = encOut[encoder.outputNames[0]];

  onPhase({ step: "imagine" });
  const image_tokens = new ort.Tensor("float32", transposeTokens(tokens.data as Float32Array), [1, 1025, 768]);
  const bbOut = await backbone.run({ [backbone.inputNames[0]]: image_tokens });
  const sceneCodes = bbOut[backbone.outputNames[0]]; // (1,3,40,64,64)
  const triplane = new ort.Tensor("float32", sceneCodes.data as Float32Array, [3, 40, 64, 64]);
  const triName = decoder.inputNames.find((n: string) => /tri|plane|scene/i.test(n)) ?? decoder.inputNames[0];
  const ptsName = decoder.inputNames.find((n: string) => /point|xyz|pos/i.test(n)) ?? decoder.inputNames[1];
  const densName = decoder.outputNames.find((n: string) => /dens|sigma/i.test(n)) ?? decoder.outputNames[0];
  const colName = decoder.outputNames.find((n: string) => /col|rgb/i.test(n)) ?? decoder.outputNames[1];

  // ── hierarchical density sampling: coarse scan, then fine detail only
  // where the surface actually is. 224³ everywhere would be 11M queries;
  // the band around the surface is typically <10% of the volume.
  const R = resolution;
  const BATCH = 96 * 96 * 8;

  async function queryDensity(coords: Float32Array, count: number): Promise<Float32Array> {
    const pts = new ort.Tensor("float32", coords.subarray(0, count * 3), [count, 3]);
    const out = await decoder.run({ [triName]: triplane, [ptsName]: pts });
    return out[densName].data as Float32Array;
  }

  // pass 1: full coarse grid
  const RC = 64;
  const coarse = new Float32Array(RC * RC * RC);
  {
    const linC = (g: number) => (g / (RC - 1)) * 2 * BOUND - BOUND;
    const coords = new Float32Array(BATCH * 3);
    let pending = 0, base = 0;
    for (let x = 0; x < RC; x++) {
      for (let y = 0; y < RC; y++) for (let z = 0; z < RC; z++) {
        coords[pending * 3] = linC(x); coords[pending * 3 + 1] = linC(y); coords[pending * 3 + 2] = linC(z);
        if (++pending === BATCH) { coarse.set((await queryDensity(coords, pending)).subarray(0, pending), base); base += pending; pending = 0; }
      }
      onPhase({ step: "carve", pct: Math.round(((x + 1) / RC) * 25) });
      await new Promise((r) => setTimeout(r, 0));
    }
    if (pending) coarse.set((await queryDensity(coords, pending)).subarray(0, pending), base);
  }

  // mark coarse cells whose corner range crosses the surface band, dilated by 1
  const CC = RC - 1;
  const active = new Uint8Array(CC * CC * CC);
  const cAt = (x: number, y: number, z: number) => coarse[(x * RC + y) * RC + z];
  for (let x = 0; x < CC; x++) for (let y = 0; y < CC; y++) for (let z = 0; z < CC; z++) {
    let mn = Infinity, mx = -Infinity;
    for (let dx = 0; dx <= 1; dx++) for (let dy = 0; dy <= 1; dy++) for (let dz = 0; dz <= 1; dz++) {
      const v = cAt(x + dx, y + dy, z + dz);
      if (v < mn) mn = v; if (v > mx) mx = v;
    }
    if (mx >= ISO * 0.4 && mn <= ISO * 2.5) active[(x * CC + y) * CC + z] = 1;
  }
  const dilated = new Uint8Array(active);
  for (let x = 0; x < CC; x++) for (let y = 0; y < CC; y++) for (let z = 0; z < CC; z++) {
    if (!active[(x * CC + y) * CC + z]) continue;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (nx >= 0 && ny >= 0 && nz >= 0 && nx < CC && ny < CC && nz < CC) dilated[(nx * CC + ny) * CC + nz] = 1;
    }
  }

  // pass 2: fine samples only inside active coarse cells
  const field = new Float32Array(R * R * R); // default 0 = empty space
  const lin = (g: number) => (g / (R - 1)) * 2 * BOUND - BOUND;
  const toC = (g: number) => Math.min(CC - 1, Math.floor((g / (R - 1)) * CC));
  {
    const coords = new Float32Array(BATCH * 3);
    const offsets = new Uint32Array(BATCH);
    let pending = 0;
    const flush = async () => {
      if (!pending) return;
      const d = await queryDensity(coords, pending);
      for (let i = 0; i < pending; i++) field[offsets[i]] = d[i];
      pending = 0;
    };
    for (let x = 0; x < R; x++) {
      const cx = toC(x);
      for (let y = 0; y < R; y++) {
        const cy = toC(y);
        for (let z = 0; z < R; z++) {
          if (!dilated[(cx * CC + cy) * CC + toC(z)]) continue;
          coords[pending * 3] = lin(x); coords[pending * 3 + 1] = lin(y); coords[pending * 3 + 2] = lin(z);
          offsets[pending] = (x * R + y) * R + z;
          if (++pending === BATCH) await flush();
        }
      }
      onPhase({ step: "carve", pct: 25 + Math.round(((x + 1) / R) * 70) });
      await new Promise((r) => setTimeout(r, 0));
    }
    await flush();
  }

  let fMin = Infinity, fMax = -Infinity;
  for (let i = 0; i < field.length; i++) { const v = field[i]; if (v < fMin) fMin = v; if (v > fMax) fMax = v; }
  console.log(`[to3d] density field min=${fMin.toFixed(2)} max=${fMax.toFixed(2)} iso=${ISO}`);

  const { positions, indices } = surfaceNets(field, R, ISO, BOUND);
  onPhase({ step: "carve", pct: 100 });
  if (!indices.length) throw new Error("No surface found — try a clearer photo of a single object.");

  // Taubin smoothing: kills the voxel-grid staircase without shrinking the
  // model the way plain Laplacian smoothing would (λ grow, μ shrink pairs).
  taubinSmooth(positions, indices, 8);

  // colors at the vertices — averaged from the vertex and a point nudged
  // inside the surface, which is where TripoSR's color field is stable
  onPhase({ step: "paint" });
  const nVerts = positions.length / 3;
  const normals = vertexNormals(positions, indices);
  const colors = new Float32Array(nVerts * 3);
  const CB = 65536;
  const sampleColors = async (pts32: Float32Array, into: Float32Array) => {
    for (let o = 0; o < nVerts; o += CB) {
      const count = Math.min(CB, nVerts - o);
      const pts = new ort.Tensor("float32", pts32.subarray(o * 3, (o + count) * 3), [count, 3]);
      const out = await decoder.run({ [triName]: triplane, [ptsName]: pts });
      into.set(out[colName].data.subarray(0, count * 3), o * 3);
    }
  };
  await sampleColors(positions, colors);
  const inner = new Float32Array(nVerts * 3);
  const nudged = new Float32Array(nVerts * 3);
  const EPS = (2 * BOUND) / R; // one voxel inward
  for (let i = 0; i < nVerts * 3; i++) nudged[i] = positions[i] - normals[i] * EPS;
  await sampleColors(nudged, inner);
  for (let i = 0; i < colors.length; i++) {
    colors[i] = Math.min(1, Math.max(0, (colors[i] + inner[i]) * 0.5));
  }

  return { positions, colors, indices, cutoutUrl };
}

// ── mesh post-processing helpers ────────────────────────────────────────────

/** Area-weighted vertex normals. */
function vertexNormals(positions: Float32Array, indices: Uint32Array): Float32Array {
  const n = new Float32Array(positions.length);
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3, b = indices[t + 1] * 3, c = indices[t + 2] * 3;
    const ux = positions[b] - positions[a], uy = positions[b + 1] - positions[a + 1], uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a], vy = positions[c + 1] - positions[a + 1], vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { n[i] += nx; n[i + 1] += ny; n[i + 2] += nz; }
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]) || 1;
    n[i] /= l; n[i + 1] /= l; n[i + 2] /= l;
  }
  return n;
}

/** Taubin λ|μ smoothing in place (volume-preserving, unlike pure Laplacian). */
function taubinSmooth(positions: Float32Array, indices: Uint32Array, iterations: number) {
  const nV = positions.length / 3;
  // adjacency
  const nbr: number[][] = Array.from({ length: nV }, () => []);
  const seen = new Set<number>();
  const addEdge = (a: number, b: number) => {
    const key = a < b ? a * nV + b : b * nV + a;
    if (seen.has(key)) return;
    seen.add(key);
    nbr[a].push(b); nbr[b].push(a);
  };
  for (let t = 0; t < indices.length; t += 3) {
    addEdge(indices[t], indices[t + 1]);
    addEdge(indices[t + 1], indices[t + 2]);
    addEdge(indices[t + 2], indices[t]);
  }
  const tmp = new Float32Array(positions.length);
  const pass = (factor: number) => {
    for (let v = 0; v < nV; v++) {
      const ns = nbr[v];
      if (!ns.length) { tmp[v*3]=positions[v*3]; tmp[v*3+1]=positions[v*3+1]; tmp[v*3+2]=positions[v*3+2]; continue; }
      let ax = 0, ay = 0, az = 0;
      for (const u of ns) { ax += positions[u*3]; ay += positions[u*3+1]; az += positions[u*3+2]; }
      ax /= ns.length; ay /= ns.length; az /= ns.length;
      tmp[v*3]   = positions[v*3]   + factor * (ax - positions[v*3]);
      tmp[v*3+1] = positions[v*3+1] + factor * (ay - positions[v*3+1]);
      tmp[v*3+2] = positions[v*3+2] + factor * (az - positions[v*3+2]);
    }
    positions.set(tmp);
  };
  for (let i = 0; i < iterations; i++) { pass(0.5); pass(-0.53); }
}
