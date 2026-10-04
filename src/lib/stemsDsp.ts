/**
 * HTDemucs pre/post-processing: the model's spectrogram input and the
 * iSTFT of its frequency-branch output, for one 343,980-sample segment.
 *
 * Ported from demucs-web 1.0.2 (MIT, © timcsy) — prepareModelInput,
 * standaloneMask, standaloneIspec — which in turn mirror HTDemucs' _spec /
 * _ispec (MIT, Meta AI Research). Same math, reorganised for speed: both
 * stereo channels share one complex FFT per frame (two real signals packed
 * as re + i·im), twiddle/bit-reverse tables are precomputed, and the model
 * layout is written directly instead of through intermediate copies.
 */

export const SAMPLE_RATE = 44100;
export const SEGMENT = 343980;
export const N_FFT = 4096;
export const HOP = 1024;
export const BINS = 2048; // HTDemucs drops the Nyquist bin
export const FRAMES = 336;

const PAD = (HOP / 2) * 3; // 1536 — HTDemucs' own reflect pad
const LE = Math.ceil(SEGMENT / HOP); // 336
const PAD_RIGHT = PAD + LE * HOP - SEGMENT; // 1620
const CENTER = N_FFT / 2; // torch.stft(center=True)
const PADDED = CENTER + PAD + SEGMENT + PAD_RIGHT + CENTER; // 351232
const ALL_FRAMES = FRAMES + 4; // 2 discarded frames each side
const FRAME_OFFSET = 2;
const PLANE = BINS * FRAMES;

// ---- FFT tables (N fixed at 4096) ----------------------------------------

const LOG2N = 12;
const bitrev = new Uint16Array(N_FFT);
for (let i = 0; i < N_FFT; i++) {
  let r = 0;
  for (let b = 0, x = i; b < LOG2N; b++, x >>= 1) r = (r << 1) | (x & 1);
  bitrev[i] = r;
}
const cosT = new Float64Array(N_FFT / 2);
const sinT = new Float64Array(N_FFT / 2);
for (let k = 0; k < N_FFT / 2; k++) {
  cosT[k] = Math.cos((2 * Math.PI * k) / N_FFT);
  sinT[k] = Math.sin((2 * Math.PI * k) / N_FFT);
}
// periodic Hann (torch.hann_window default)
const hann = new Float64Array(N_FFT);
for (let i = 0; i < N_FFT; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / N_FFT));

/** In-place radix-2 complex FFT on (re, im), already in bit-reversed order. sign −1 forward, +1 inverse (unscaled). */
function fftCore(re: Float64Array, im: Float64Array, sign: 1 | -1) {
  for (let size = 2; size <= N_FFT; size <<= 1) {
    const half = size >> 1;
    const step = N_FFT / size;
    for (let i = 0; i < N_FFT; i += size) {
      for (let j = 0, k = 0; j < half; j++, k += step) {
        const wr = cosT[k];
        const wi = sign * sinT[k];
        const a = i + j;
        const b = a + half;
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
      }
    }
  }
}

const fRe = new Float64Array(N_FFT);
const fIm = new Float64Array(N_FFT);

// ---- input: reflect pads + STFT -------------------------------------------

function reflectPad(src: Float32Array, left: number, right: number): Float32Array {
  const n = src.length;
  const out = new Float32Array(left + n + right);
  for (let i = 0; i < left; i++) out[i] = src[Math.min(left - i, n - 1)];
  out.set(src, left);
  for (let i = 0; i < right; i++) out[left + n + i] = src[Math.max(0, n - 2 - i)];
  return out;
}

/**
 * Model inputs for one segment (left/right exactly SEGMENT long, zero-padded
 * by the caller): `mix` [1,2,SEGMENT] and `mag` [1,4,BINS,FRAMES] laid out
 * as L.re, L.im, R.re, R.im planes of [bin][frame].
 */
export function prepareSegment(left: Float32Array, right: Float32Array): { mix: Float32Array; mag: Float32Array } {
  const mix = new Float32Array(2 * SEGMENT);
  mix.set(left, 0);
  mix.set(right, SEGMENT);

  const pl = reflectPad(reflectPad(left, PAD, PAD_RIGHT), CENTER, CENTER);
  const pr = reflectPad(reflectPad(right, PAD, PAD_RIGHT), CENTER, CENTER);
  const mag = new Float32Array(4 * PLANE);
  const scale = 0.5 / Math.sqrt(N_FFT); // ½ from unpacking, 1/√N from normalized=True

  for (let f = 0; f < FRAMES; f++) {
    const start = (f + FRAME_OFFSET) * HOP;
    for (let i = 0; i < N_FFT; i++) {
      const j = bitrev[i];
      fRe[i] = pl[start + j] * hann[j];
      fIm[i] = pr[start + j] * hann[j];
    }
    fftCore(fRe, fIm, -1);
    // unpack Z = FFT(l + i·r): L[k] = (Z[k] + conj Z[N−k]) / 2, R[k] = (Z[k] − conj Z[N−k]) / 2i
    for (let k = 0; k < BINS; k++) {
      const nk = (N_FFT - k) & (N_FFT - 1);
      const a = fRe[k], b = fIm[k], c = fRe[nk], d = fIm[nk];
      const o = k * FRAMES + f;
      mag[o] = (a + c) * scale;
      mag[PLANE + o] = (b - d) * scale;
      mag[2 * PLANE + o] = (b + d) * scale;
      mag[3 * PLANE + o] = (c - a) * scale;
    }
  }
  return { mix, mag };
}

// ---- output: iSTFT of the frequency branch --------------------------------

/** 1 / Σ window² over the kept region (constant for the fixed frame count). */
let invEnv: Float32Array | null = null;
const invEnvelope = () => invEnv ??= (() => {
  const env = new Float64Array(PADDED);
  for (let f = 0; f < ALL_FRAMES; f++) {
    const s = f * HOP;
    for (let i = 0; i < N_FFT; i++) env[s + i] += hann[i] * hann[i];
  }
  const out = new Float32Array(SEGMENT);
  for (let i = 0; i < SEGMENT; i++) {
    const e = env[CENTER + PAD + i];
    out[i] = e > 1e-8 ? 1 / e : 0;
  }
  return out;
})();

let sumBuf: Float32Array | null = null;
let segL: Float32Array | null = null;
let segR: Float32Array | null = null;

/**
 * Add the iSTFT of one source's spectrogram into (outL, outR), each SEGMENT
 * long. `spec` is the model's `x` output; `sources` lists which of its 4
 * sources to sum first (iSTFT is linear, so the instrumental costs one pass,
 * not three).
 */
export function addIspec(spec: Float32Array, sources: number[], outL: Float32Array, outR: Float32Array) {
  let src = spec;
  let base = sources[0] * 4 * PLANE;
  if (sources.length > 1) {
    src = sumBuf ??= new Float32Array(4 * PLANE);
    src.fill(0);
    for (const s of sources) {
      const o = s * 4 * PLANE;
      for (let i = 0; i < 4 * PLANE; i++) src[i] += spec[o + i];
    }
    base = 0;
  }
  const P0 = base, P1 = base + PLANE, P2 = base + 2 * PLANE, P3 = base + 3 * PLANE;

  // only the kept window [CENTER+PAD, +SEGMENT) of the padded output matters
  const lo = CENTER + PAD;
  const hi = lo + SEGMENT;
  const scale = Math.sqrt(N_FFT) / N_FFT; // ×√N (normalized=True), 1/N inverse FFT
  const accL = (segL ??= new Float32Array(SEGMENT)).fill(0);
  const accR = (segR ??= new Float32Array(SEGMENT)).fill(0);

  for (let f = 0; f < FRAMES; f++) {
    // pack Z = L + i·R over the full Hermitian spectrum; DC imag dropped as irfft does
    let o = f;
    fRe[0] = src[P0 + o];
    fIm[0] = src[P2 + o];
    for (let k = 1; k < BINS; k++) {
      o += FRAMES;
      const lr = src[P0 + o], li = src[P1 + o], rr = src[P2 + o], ri = src[P3 + o];
      let j = bitrev[k];
      fRe[j] = lr - ri;
      fIm[j] = li + rr;
      j = bitrev[N_FFT - k];
      fRe[j] = lr + ri;
      fIm[j] = rr - li;
    }
    const ny = bitrev[BINS];
    fRe[ny] = 0;
    fIm[ny] = 0;
    fftCore(fRe, fIm, 1);
    const start = (f + FRAME_OFFSET) * HOP;
    const i0 = Math.max(0, lo - start);
    const i1 = Math.min(N_FFT, hi - start);
    for (let i = i0; i < i1; i++) {
      const w = hann[i] * scale;
      const t = start + i - lo;
      accL[t] += fRe[i] * w;
      accR[t] += fIm[i] * w;
    }
  }
  const inv = invEnvelope();
  for (let t = 0; t < SEGMENT; t++) {
    outL[t] += accL[t] * inv[t];
    outR[t] += accR[t] * inv[t];
  }
}
