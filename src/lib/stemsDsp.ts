/**
 * Spleeter's spectrogram contract: 44.1kHz stereo, periodic Hann, frame 4096,
 * hop 1024, |STFT| of the first NET_BINS bins fed to the U-Nets in splits of
 * T = 512 frames. Each net returns its stem's magnitude estimate; the stems
 * are soft ratio masks (est² / Σ est²) on the ORIGINAL complex STFT, the bins
 * above the net's range get each frame's mean mask ("average" extension, so
 * the stems sum back to the mix exactly), and a weighted overlap-add inverts.
 *
 * Follows sherpa-onnx's Spleeter implementation (Apache-2.0) and the
 * Best-Practice/spleeter-4stems-onnx reference pipeline, including its
 * N_FFT − HOP front pad: with it every output sample sits under exactly four
 * frames, so the window-power sum is the constant 1.5 and streaming chunk by
 * chunk gives the same result as transforming the whole song at once.
 *
 * Both stereo channels share one complex FFT per frame (two real signals
 * packed as re + i·im).
 */

export const SAMPLE_RATE = 44100;
export const N_FFT = 4096;
export const HOP = 1024;
export const BINS = N_FFT / 2 + 1; // 2049
export const T = 512; // frames per net split (~11.9s)
export const PAD = N_FFT - HOP;
/** samples finalised per chunk of T frames */
export const CHUNK = T * HOP;
const WSUM = 1.5; // Σ hann² over 4 frames at 75% overlap
const SIZE = 2 * T * BINS; // one [channel][frame][bin] spectrogram

export function frameCount(samples: number): number {
  return Math.ceil((PAD + samples) / HOP);
}

export function chunkCount(samples: number): number {
  return Math.ceil(frameCount(samples) / T);
}

// ---- FFT (N fixed at 4096) ------------------------------------------------

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
const hann = new Float64Array(N_FFT); // periodic, as tf.signal / torch use
for (let i = 0; i < N_FFT; i++) hann[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / N_FFT));

/** In-place radix-2 FFT on (re, im) already in bit-reversed order. sign −1 forward, +1 inverse (unscaled). */
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

// ---- analysis -------------------------------------------------------------

export interface ChunkSpec {
  /** complex STFT, [channel][frame][bin] with T frames × BINS bins */
  re: Float32Array;
  im: Float32Array;
  /** net input |STFT|, [channel][frame][bin] with T × netBins */
  mag: Float32Array;
  /** frames of this chunk that hold real audio */
  frames: number;
}

/** STFT of chunk `c` (frames c·T … c·T+T−1) of both channels. */
export function analyzeChunk(left: Float32Array, right: Float32Array, c: number, netBins: number): ChunkSpec {
  const total = left.length;
  const frames = Math.max(0, Math.min(T, frameCount(total) - c * T));
  const re = new Float32Array(SIZE);
  const im = new Float32Array(SIZE);
  const mag = new Float32Array(2 * T * netBins);
  for (let f = 0; f < frames; f++) {
    // padded index j ↔ sample j − PAD; zero outside the song
    const s0 = (c * T + f) * HOP - PAD;
    for (let i = 0; i < N_FFT; i++) {
      const j = bitrev[i];
      const s = s0 + j;
      const inside = s >= 0 && s < total;
      fRe[i] = inside ? left[s] * hann[j] : 0;
      fIm[i] = inside ? right[s] * hann[j] : 0;
    }
    fftCore(fRe, fIm, -1);
    // unpack Z = FFT(l + i·r): L[k] = (Z[k] + conj Z[N−k]) / 2, R[k] = (Z[k] − conj Z[N−k]) / 2i
    const oL = f * BINS;
    const oR = (T + f) * BINS;
    const mL = f * netBins;
    const mR = (T + f) * netBins;
    for (let k = 0; k < BINS; k++) {
      const nk = (N_FFT - k) & (N_FFT - 1);
      const a = fRe[k], b = fIm[k], cc = fRe[nk], d = fIm[nk];
      const lr = (a + cc) / 2, li = (b - d) / 2, rr = (b + d) / 2, ri = (cc - a) / 2;
      re[oL + k] = lr; im[oL + k] = li;
      re[oR + k] = rr; im[oR + k] = ri;
      if (k < netBins) {
        mag[mL + k] = Math.sqrt(lr * lr + li * li);
        mag[mR + k] = Math.sqrt(rr * rr + ri * ri);
      }
    }
  }
  return { re, im, mag, frames };
}

// ---- masks ----------------------------------------------------------------

/**
 * Soft ratio masks over T × netBins from every stem's magnitude estimate
 * (all are needed: the denominator sums them), each track summing the masks
 * of its `sources`. Returned as [track][channel][frame][bin] over netBins.
 */
export function ratioMasks(estimates: Float32Array[], tracks: number[][], netBins: number): Float32Array[] {
  const n = 2 * T * netBins;
  const S = estimates.length;
  const out = tracks.map(() => new Float32Array(n));
  for (let i = 0; i < n; i++) {
    let denom = 1e-10;
    for (let s = 0; s < S; s++) denom += estimates[s][i] * estimates[s][i];
    for (let t = 0; t < tracks.length; t++) {
      let num = 0;
      for (const s of tracks[t]) num += estimates[s][i] * estimates[s][i] + 1e-10 / S;
      out[t][i] = num / denom;
    }
  }
  return out;
}

// ---- synthesis ------------------------------------------------------------

/**
 * Overlap-add state for one track: masks chunk after chunk, emitting audio
 * once no later frame can touch it.
 */
export class TrackSynth {
  private accL = new Float32Array(CHUNK + PAD);
  private accR = new Float32Array(CHUNK + PAD);

  /** Apply `mask` (over netBins, 'average'-extended above) to `spec` and add chunk `c`'s frames. */
  add(spec: ChunkSpec, mask: Float32Array, netBins: number) {
    const { re, im, frames } = spec;
    const scale = 1 / (N_FFT * WSUM);
    for (let f = 0; f < frames; f++) {
      const oL = f * BINS, oR = (T + f) * BINS;
      const mL = f * netBins, mR = (T + f) * netBins;
      let avgL = 0, avgR = 0;
      for (let k = 0; k < netBins; k++) { avgL += mask[mL + k]; avgR += mask[mR + k]; }
      avgL /= netBins;
      avgR /= netBins;
      // pack Z = L + i·R over the Hermitian spectrum; DC/Nyquist imag dropped as irfft does
      for (let k = 0; k < BINS; k++) {
        const gl = k < netBins ? mask[mL + k] : avgL;
        const gr = k < netBins ? mask[mR + k] : avgR;
        const edge = k === 0 || k === BINS - 1;
        const lr = re[oL + k] * gl, li = edge ? 0 : im[oL + k] * gl;
        const rr = re[oR + k] * gr, ri = edge ? 0 : im[oR + k] * gr;
        let j = bitrev[k];
        fRe[j] = lr - ri;
        fIm[j] = li + rr;
        if (!edge) {
          j = bitrev[N_FFT - k];
          fRe[j] = lr + ri;
          fIm[j] = rr - li;
        }
      }
      fftCore(fRe, fIm, 1);
      const at = f * HOP;
      for (let i = 0; i < N_FFT; i++) {
        const w = hann[i] * scale;
        this.accL[at + i] += fRe[i] * w;
        this.accR[at + i] += fIm[i] * w;
      }
    }
  }

  /**
   * Finish chunk `c`: returns its final samples [from, to) of the song and
   * carries the overlap into the next chunk.
   */
  take(c: number, total: number): { from: number; l: Float32Array<ArrayBuffer>; r: Float32Array<ArrayBuffer> } {
    const base = c * CHUNK; // padded index of acc[0]
    const from = Math.max(0, base - PAD);
    const to = Math.min(total, base + CHUNK - PAD);
    const o = from + PAD - base;
    const n = Math.max(0, to - from);
    const l = this.accL.slice(o, o + n);
    const r = this.accR.slice(o, o + n);
    this.accL.copyWithin(0, CHUNK);
    this.accL.fill(0, PAD);
    this.accR.copyWithin(0, CHUNK);
    this.accR.fill(0, PAD);
    return { from, l, r };
  }
}
