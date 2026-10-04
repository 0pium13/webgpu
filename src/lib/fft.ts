/**
 * Mixed-radix real FFT for sizes that aren't powers of two (DeepFilterNet's
 * 960-point frame = 2⁶·3·5). A real FFT of length 2M runs as one complex
 * FFT of length M (even/odd samples packed into re/im) plus an O(M) untangle.
 * The complex core is KissFFT's decimation-in-time butterflies (radix 2/3/4/5),
 * flattened into a precomputed digit-reversal permutation + iterative stages.
 *
 * Unnormalized in both directions: inverse(forward(x)) = 2M · x.
 */

type Stage = { p: number; m: number; fstride: number };

class ComplexFFT {
  readonly n: number;
  private readonly twRe: Float64Array;
  private readonly twIm: Float64Array;
  private readonly perm: Int32Array;
  private readonly stages: Stage[];
  private readonly tmpRe: Float64Array;
  private readonly tmpIm: Float64Array;

  constructor(n: number) {
    this.n = n;
    this.twRe = new Float64Array(n);
    this.twIm = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = (-2 * Math.PI * i) / n;
      this.twRe[i] = Math.cos(a);
      this.twIm[i] = Math.sin(a);
    }
    const factors: number[] = [];
    let rest = n;
    for (const p of [4, 2, 3, 5]) {
      while (rest % p === 0) { factors.push(p); rest /= p; }
    }
    if (rest !== 1) throw new Error(`fft: size ${n} has prime factors other than 2, 3, 5`);

    this.perm = new Int32Array(n);
    const build = (outOff: number, inIdx: number, fstride: number, fi: number) => {
      const p = factors[fi];
      const m = factors.slice(fi + 1).reduce((a, b) => a * b, 1);
      for (let j = 0; j < p; j++) {
        if (m === 1) this.perm[outOff + j] = inIdx + j * fstride;
        else build(outOff + j * m, inIdx + j * fstride, fstride * p, fi + 1);
      }
    };
    build(0, 0, 1, 0);

    // butterflies run deepest level first; each level's blocks are contiguous
    this.stages = [];
    for (let s = factors.length - 1; s >= 0; s--) {
      const m = factors.slice(s + 1).reduce((a, b) => a * b, 1);
      const fstride = factors.slice(0, s).reduce((a, b) => a * b, 1);
      this.stages.push({ p: factors[s], m, fstride });
    }
    this.tmpRe = new Float64Array(n);
    this.tmpIm = new Float64Array(n);
  }

  /** In-place forward complex FFT (e^{-2πikn/N}). */
  forward(re: Float64Array, im: Float64Array) {
    const { n, perm, tmpRe, tmpIm } = this;
    for (let i = 0; i < n; i++) { tmpRe[i] = re[perm[i]]; tmpIm[i] = im[perm[i]]; }
    re.set(tmpRe); im.set(tmpIm);
    for (const st of this.stages) {
      const blocks = st.fstride;
      const span = st.p * st.m;
      for (let b = 0; b < blocks; b++) {
        const o = b * span;
        if (st.p === 4) this.bfly4(re, im, o, st.fstride, st.m);
        else if (st.p === 2) this.bfly2(re, im, o, st.fstride, st.m);
        else if (st.p === 3) this.bfly3(re, im, o, st.fstride, st.m);
        else this.bfly5(re, im, o, st.fstride, st.m);
      }
    }
  }

  private bfly2(re: Float64Array, im: Float64Array, o: number, fs: number, m: number) {
    const { twRe, twIm } = this;
    for (let k = 0; k < m; k++) {
      const a = o + k, b = a + m, t = k * fs;
      const tr = re[b] * twRe[t] - im[b] * twIm[t];
      const ti = re[b] * twIm[t] + im[b] * twRe[t];
      re[b] = re[a] - tr; im[b] = im[a] - ti;
      re[a] += tr; im[a] += ti;
    }
  }

  private bfly3(re: Float64Array, im: Float64Array, o: number, fs: number, m: number) {
    const { twRe, twIm } = this;
    const epi = twIm[fs * m]; // sin(-2π/3)
    for (let k = 0; k < m; k++) {
      const i0 = o + k, i1 = i0 + m, i2 = i1 + m;
      const t1 = k * fs, t2 = 2 * k * fs;
      const s1r = re[i1] * twRe[t1] - im[i1] * twIm[t1];
      const s1i = re[i1] * twIm[t1] + im[i1] * twRe[t1];
      const s2r = re[i2] * twRe[t2] - im[i2] * twIm[t2];
      const s2i = re[i2] * twIm[t2] + im[i2] * twRe[t2];
      const s3r = s1r + s2r, s3i = s1i + s2i;
      const s0r = (s1r - s2r) * epi, s0i = (s1i - s2i) * epi;
      const mr = re[i0] - s3r * 0.5, mi = im[i0] - s3i * 0.5;
      re[i0] += s3r; im[i0] += s3i;
      re[i2] = mr + s0i; im[i2] = mi - s0r;
      re[i1] = mr - s0i; im[i1] = mi + s0r;
    }
  }

  private bfly4(re: Float64Array, im: Float64Array, o: number, fs: number, m: number) {
    const { twRe, twIm } = this;
    for (let k = 0; k < m; k++) {
      const i0 = o + k, i1 = i0 + m, i2 = i1 + m, i3 = i2 + m;
      const t1 = k * fs, t2 = 2 * k * fs, t3 = 3 * k * fs;
      const s0r = re[i1] * twRe[t1] - im[i1] * twIm[t1];
      const s0i = re[i1] * twIm[t1] + im[i1] * twRe[t1];
      const s1r = re[i2] * twRe[t2] - im[i2] * twIm[t2];
      const s1i = re[i2] * twIm[t2] + im[i2] * twRe[t2];
      const s2r = re[i3] * twRe[t3] - im[i3] * twIm[t3];
      const s2i = re[i3] * twIm[t3] + im[i3] * twRe[t3];
      const s5r = re[i0] - s1r, s5i = im[i0] - s1i;
      const ar = re[i0] + s1r, ai = im[i0] + s1i;
      const s3r = s0r + s2r, s3i = s0i + s2i;
      const s4r = s0r - s2r, s4i = s0i - s2i;
      re[i2] = ar - s3r; im[i2] = ai - s3i;
      re[i0] = ar + s3r; im[i0] = ai + s3i;
      re[i1] = s5r + s4i; im[i1] = s5i - s4r;
      re[i3] = s5r - s4i; im[i3] = s5i + s4r;
    }
  }

  private bfly5(re: Float64Array, im: Float64Array, o: number, fs: number, m: number) {
    const { twRe, twIm } = this;
    const yar = twRe[fs * m], yai = twIm[fs * m];
    const ybr = twRe[2 * fs * m], ybi = twIm[2 * fs * m];
    for (let u = 0; u < m; u++) {
      const i0 = o + u, i1 = i0 + m, i2 = i1 + m, i3 = i2 + m, i4 = i3 + m;
      const t1 = u * fs, t2 = 2 * u * fs, t3 = 3 * u * fs, t4 = 4 * u * fs;
      const s0r = re[i0], s0i = im[i0];
      const s1r = re[i1] * twRe[t1] - im[i1] * twIm[t1];
      const s1i = re[i1] * twIm[t1] + im[i1] * twRe[t1];
      const s2r = re[i2] * twRe[t2] - im[i2] * twIm[t2];
      const s2i = re[i2] * twIm[t2] + im[i2] * twRe[t2];
      const s3r = re[i3] * twRe[t3] - im[i3] * twIm[t3];
      const s3i = re[i3] * twIm[t3] + im[i3] * twRe[t3];
      const s4r = re[i4] * twRe[t4] - im[i4] * twIm[t4];
      const s4i = re[i4] * twIm[t4] + im[i4] * twRe[t4];
      const s7r = s1r + s4r, s7i = s1i + s4i;
      const s10r = s1r - s4r, s10i = s1i - s4i;
      const s8r = s2r + s3r, s8i = s2i + s3i;
      const s9r = s2r - s3r, s9i = s2i - s3i;
      re[i0] = s0r + s7r + s8r; im[i0] = s0i + s7i + s8i;
      const s5r = s0r + s7r * yar + s8r * ybr, s5i = s0i + s7i * yar + s8i * ybr;
      const s6r = s10i * yai + s9i * ybi, s6i = -s10r * yai - s9r * ybi;
      re[i1] = s5r - s6r; im[i1] = s5i - s6i;
      re[i4] = s5r + s6r; im[i4] = s5i + s6i;
      const s11r = s0r + s7r * ybr + s8r * yar, s11i = s0i + s7i * ybr + s8i * yar;
      const s12r = -s10i * ybi + s9i * yai, s12i = s10r * ybi - s9r * yai;
      re[i2] = s11r + s12r; im[i2] = s11i + s12i;
      re[i3] = s11r - s12r; im[i3] = s11i - s12i;
    }
  }
}

export class RealFFT {
  /** Real frame length (2M). */
  readonly size: number;
  /** Spectrum bins (M + 1). */
  readonly bins: number;
  private readonly half: number;
  private readonly cfft: ComplexFFT;
  private readonly zRe: Float64Array;
  private readonly zIm: Float64Array;
  /** e^{-iπk/M}, k = 0..M */
  private readonly wRe: Float64Array;
  private readonly wIm: Float64Array;

  constructor(size: number) {
    if (size % 2) throw new Error("RealFFT: size must be even");
    this.size = size;
    this.half = size / 2;
    this.bins = this.half + 1;
    this.cfft = new ComplexFFT(this.half);
    this.zRe = new Float64Array(this.half);
    this.zIm = new Float64Array(this.half);
    this.wRe = new Float64Array(this.bins);
    this.wIm = new Float64Array(this.bins);
    for (let k = 0; k <= this.half; k++) {
      this.wRe[k] = Math.cos((-Math.PI * k) / this.half);
      this.wIm[k] = Math.sin((-Math.PI * k) / this.half);
    }
  }

  /** x (length size) → outRe/outIm (length bins), each multiplied by `scale`. */
  forward(x: ArrayLike<number>, outRe: Float32Array | Float64Array, outIm: Float32Array | Float64Array, scale = 1) {
    const M = this.half, { zRe, zIm, wRe, wIm } = this;
    for (let n = 0; n < M; n++) { zRe[n] = x[2 * n]; zIm[n] = x[2 * n + 1]; }
    this.cfft.forward(zRe, zIm);
    for (let k = 0; k <= M; k++) {
      const a = k % M, b = (M - k) % M;
      const ar = zRe[a], ai = zIm[a], br = zRe[b], bi = -zIm[b]; // Z[k], conj(Z[M-k])
      const er = (ar + br) * 0.5, ei = (ai + bi) * 0.5;
      // (Z[k] - conj Z[M-k]) / 2i
      const dr = (ai - bi) * 0.5, di = -(ar - br) * 0.5;
      outRe[k] = (er + dr * wRe[k] - di * wIm[k]) * scale;
      outIm[k] = (ei + dr * wIm[k] + di * wRe[k]) * scale;
    }
  }

  /** inRe/inIm (length bins, Hermitian half) → out (length size), unnormalized. */
  inverse(inRe: ArrayLike<number>, inIm: ArrayLike<number>, out: Float32Array | Float64Array) {
    const M = this.half, { zRe, zIm, wRe, wIm } = this;
    for (let k = 0; k < M; k++) {
      const xr = inRe[k], xi = inIm[k];
      const cr = inRe[M - k], ci = -inIm[M - k]; // conj X[M-k]
      const er = xr + cr, ei = xi + ci;
      const dr = xr - cr, di = xi - ci;
      // O = D · e^{+iπk/M}
      const or = dr * wRe[k] + di * wIm[k];
      const oi = di * wRe[k] - dr * wIm[k];
      // Z = E + iO, conjugated so the forward kernel computes the inverse
      zRe[k] = er - oi;
      zIm[k] = -(ei + or);
    }
    this.cfft.forward(zRe, zIm);
    for (let n = 0; n < M; n++) { out[2 * n] = zRe[n]; out[2 * n + 1] = -zIm[n]; }
  }
}
