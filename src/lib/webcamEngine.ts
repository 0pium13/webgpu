"use client";

/**
 * Real-time webcam pipeline on WebGL2. Everything runs on the GPU, per frame.
 * No model for the image effects (shaders); MediaPipe only supplies the face
 * polygons/box, passed in.
 *
 * Passes:
 *   0. temporal — motion-aware blend with the previous frame (kills webcam
 *      noise on still areas) + downscale to the processing resolution
 *   1. mask     — fill landmark polygons (skin/eyes/lips) for beautify
 *   2. blurH/V  — separable gaussian (low-freq for clarity + beautify)
 *   3. composite— denoise + low-light + white balance + adaptive sharpen +
 *      clarity, then optional skin smooth / even lighting / eye brighten;
 *      auto-frame crop as a UV remap; drawn at the chosen OUTPUT resolution
 *      (clean upscale up to 4K).
 *
 * Lifecycle: the GL context is created ONCE and reused across start/stop — we
 * never call loseContext() between runs (that poisons the canvas so the next
 * getContext returns a dead context and createShader returns null).
 */

import type { FaceRegions } from "./faceTrack";

export type OutputRes = "native" | "fhd" | "qhd" | "uhd";

export interface EnhanceSettings {
  enhanceOn: boolean;
  exposure: number;
  shadow: number;
  warmth: number;
  autoWB: boolean;
  denoise: number;    // spatial (edge-aware)
  temporal: number;   // temporal (multi-frame) — the real "no noise" lever
  sharpen: number;
  clarity: number;
  outputRes: OutputRes;
  beautifyOn: boolean;
  smooth: number;
  even: number;
  eye: number;
  autoFrame: boolean;
  mirror: boolean;
  crop: { x: number; y: number; w: number; h: number };
  wb: [number, number, number];
}

const OUTPUT_HEIGHT: Record<OutputRes, number> = { native: 0, fhd: 1080, qhd: 1440, uhd: 2160 };
const PROC_CAP = 1600; // processing resolution cap (detail without melting weak GPUs)

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main(){ v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

const MASK_VERT = `#version 300 es
in vec2 a_pos;
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }`;
const MASK_FRAG = `#version 300 es
precision highp float; uniform vec4 u_color; out vec4 o;
void main(){ o = u_color; }`;

const TEMPORAL_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_cur, u_prev;
uniform float u_amt;
out vec4 o;
float luma(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
void main(){
  vec3 cur = texture(u_cur, v_uv).rgb;
  vec3 prev = texture(u_prev, v_uv).rgb;
  float motion = clamp(abs(luma(cur) - luma(prev)) * 8.0, 0.0, 1.0); // 0 still, 1 moving
  float w = u_amt * (1.0 - motion);       // trust history only where nothing moved
  o = vec4(mix(cur, prev, w), 1.0);
}`;

const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_dir;
out vec4 o;
void main(){
  vec3 c = texture(u_tex, v_uv).rgb * 0.227027;
  c += texture(u_tex, v_uv + u_dir*1.3846).rgb * 0.316216;
  c += texture(u_tex, v_uv - u_dir*1.3846).rgb * 0.316216;
  c += texture(u_tex, v_uv + u_dir*3.2308).rgb * 0.070270;
  c += texture(u_tex, v_uv - u_dir*3.2308).rgb * 0.070270;
  o = vec4(c, 1.0);
}`;

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_frame, u_blur, u_mask;
uniform vec2 u_texel;
uniform bool u_enhance, u_beautify, u_mirror;
uniform float u_exposure, u_shadow, u_denoise, u_sharpen, u_clarity;
uniform float u_smooth, u_even, u_eye;
uniform vec3 u_wb;
uniform vec4 u_crop;
out vec4 o;
float luma(vec3 c){ return dot(c, vec3(0.299,0.587,0.114)); }
void main(){
  vec2 uv = v_uv;
  if (u_mirror) uv.x = 1.0 - uv.x;
  uv = u_crop.xy + uv * u_crop.zw;
  vec3 center = texture(u_frame, uv).rgb;
  vec3 c = center;
  if (u_enhance) {
    vec3 avg = vec3(0.0);
    for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++)
      avg += texture(u_frame, uv + vec2(float(i),float(j)) * u_texel).rgb;
    avg /= 9.0;
    float flatW = 1.0 - clamp(length(center - avg) * 6.0, 0.0, 1.0);
    c = mix(center, avg, u_denoise * flatW);
    c *= u_exposure;
    float l = luma(c);
    float sh = 1.0 - smoothstep(0.0, 0.5, l);
    c = mix(c, sqrt(clamp(c,0.0,1.0)), u_shadow * sh);
    c *= u_wb;
    c += u_sharpen * (c - avg);
    float lb = luma(texture(u_blur, uv).rgb);
    c *= 1.0 + u_clarity * (luma(c) - lb);
  }
  if (u_beautify) {
    vec4 m = texture(u_mask, uv);
    float skin = m.r * (1.0 - max(m.g, m.b));
    float eye = m.g;
    vec3 low = texture(u_blur, uv).rgb;
    float lowL = max(luma(low), 0.05);
    float evenGain = mix(1.0, clamp(0.5 / lowL, 0.65, 1.5), u_even * skin);
    c *= evenGain;
    vec3 hi = c - low;
    float flatW2 = 1.0 - clamp(length(hi) * 4.0, 0.0, 1.0);
    c = low + hi * (1.0 - u_smooth * skin * flatW2);
    vec3 bright = clamp((c - 0.5) * 1.12 + 0.5 + 0.06, 0.0, 1.0);
    c = mix(c, bright, u_eye * eye);
  }
  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type);
  if (!s) throw new Error("WebGL context lost — reload the page.");
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("shader compile: " + gl.getShaderInfoLog(s));
  return s;
}
function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("link: " + gl.getProgramInfoLog(p));
  return p;
}
function makeFBO(gl: WebGL2RenderingContext, w: number, h: number) {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return { tex, fbo };
}

export class WebcamEngine {
  private gl: WebGL2RenderingContext;
  private progComposite: WebGLProgram;
  private progBlur: WebGLProgram;
  private progMask: WebGLProgram;
  private progTemporal: WebGLProgram;
  private quad: WebGLBuffer;
  private maskBuf: WebGLBuffer;
  private frameTex: WebGLTexture;
  private blurH!: { tex: WebGLTexture; fbo: WebGLFramebuffer };
  private blurV!: { tex: WebGLTexture; fbo: WebGLFramebuffer };
  private mask!: { tex: WebGLTexture; fbo: WebGLFramebuffer };
  private histA!: { tex: WebGLTexture; fbo: WebGLFramebuffer };
  private histB!: { tex: WebGLTexture; fbo: WebGLFramebuffer };
  private histSwap = false;
  private pw = 0; private ph = 0;   // processing resolution
  private ow = 0; private oh = 0;   // output (canvas) resolution

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("Your browser doesn't support WebGL2 — try Chrome or Edge.");
    this.gl = gl;
    this.progComposite = program(gl, VERT, COMPOSITE_FRAG);
    this.progBlur = program(gl, VERT, BLUR_FRAG);
    this.progMask = program(gl, MASK_VERT, MASK_FRAG);
    this.progTemporal = program(gl, VERT, TEMPORAL_FRAG);
    this.quad = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    this.maskBuf = gl.createBuffer()!;
    this.frameTex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  }

  private resize(pw: number, ph: number, ow: number, oh: number) {
    if (this.pw !== pw || this.ph !== ph) {
      this.pw = pw; this.ph = ph;
      this.blurH = makeFBO(this.gl, pw, ph);
      this.blurV = makeFBO(this.gl, pw, ph);
      this.mask = makeFBO(this.gl, pw, ph);
      this.histA = makeFBO(this.gl, pw, ph);
      this.histB = makeFBO(this.gl, pw, ph);
    }
    if (this.ow !== ow || this.oh !== oh) {
      this.ow = ow; this.oh = oh;
      const c = this.gl.canvas as HTMLCanvasElement;
      c.width = ow; c.height = oh;
    }
  }

  private drawQuad(prog: WebGLProgram) {
    const gl = this.gl;
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  private fillRegion(prog: WebGLProgram, points: { x: number; y: number }[], idx: number[], color: [number, number, number, number]) {
    const gl = this.gl;
    if (idx.length < 3) return;
    let cx = 0, cy = 0;
    for (const i of idx) { cx += points[i].x; cy += points[i].y; }
    cx /= idx.length; cy /= idx.length;
    const sorted = [...idx].sort((a, b) =>
      Math.atan2(points[a].y - cy, points[a].x - cx) - Math.atan2(points[b].y - cy, points[b].x - cx));
    const verts: number[] = [];
    const toClip = (x: number, y: number) => [x * 2 - 1, 1 - y * 2];
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i], b = sorted[(i + 1) % sorted.length];
      verts.push(...toClip(cx, cy), ...toClip(points[a].x, points[a].y), ...toClip(points[b].x, points[b].y));
    }
    gl.useProgram(prog);
    gl.uniform4fv(gl.getUniformLocation(prog, "u_color"), color);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.maskBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, verts.length / 2);
  }

  render(video: HTMLVideoElement, s: EnhanceSettings, face: { points: { x: number; y: number }[] | null }, regions: FaceRegions | null) {
    const gl = this.gl;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;

    // processing resolution (capped) and output resolution (up to 4K)
    const pscale = Math.min(1, PROC_CAP / Math.max(vw, vh));
    const pw = Math.round(vw * pscale), ph = Math.round(vh * pscale);
    const outH = OUTPUT_HEIGHT[s.outputRes];
    let ow = pw, oh = ph;
    if (outH) { oh = outH; ow = Math.round(outH * (vw / vh)); ow += ow % 2; oh += oh % 2; }
    this.resize(pw, ph, ow, oh);

    // upload current frame
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

    // temporal denoise + downscale → clean frame at processing res (always run,
    // so the cleaned frame is consistently proc-sized; amount 0 = passthrough)
    const prev = this.histSwap ? this.histA : this.histB;
    const cur = this.histSwap ? this.histB : this.histA;
    gl.useProgram(this.progTemporal);
    gl.bindFramebuffer(gl.FRAMEBUFFER, cur.fbo);
    gl.viewport(0, 0, pw, ph);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.uniform1i(gl.getUniformLocation(this.progTemporal, "u_cur"), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, prev.tex);
    gl.uniform1i(gl.getUniformLocation(this.progTemporal, "u_prev"), 1);
    gl.uniform1f(gl.getUniformLocation(this.progTemporal, "u_amt"), s.enhanceOn ? s.temporal : 0);
    this.drawQuad(this.progTemporal);
    const cleanTex = cur.tex;
    this.histSwap = !this.histSwap;

    const beautify = s.beautifyOn && !!face.points && !!regions;
    if (beautify && face.points && regions) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.mask.fbo);
      gl.viewport(0, 0, pw, ph);
      gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);
      gl.colorMask(true, false, false, true);
      this.fillRegion(this.progMask, face.points, regions.oval, [1, 0, 0, 1]);
      gl.colorMask(false, true, false, true);
      this.fillRegion(this.progMask, face.points, regions.leftEye, [0, 1, 0, 1]);
      this.fillRegion(this.progMask, face.points, regions.rightEye, [0, 1, 0, 1]);
      gl.colorMask(false, false, true, true);
      this.fillRegion(this.progMask, face.points, regions.lips, [0, 0, 1, 1]);
      gl.colorMask(true, true, true, true);
    }

    const needBlur = (s.enhanceOn && s.clarity > 0) || beautify;
    if (needBlur) {
      gl.useProgram(this.progBlur);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurH.fbo);
      gl.viewport(0, 0, pw, ph);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, cleanTex);
      gl.uniform1i(gl.getUniformLocation(this.progBlur, "u_tex"), 0);
      gl.uniform2f(gl.getUniformLocation(this.progBlur, "u_dir"), 2.5 / pw, 0);
      this.drawQuad(this.progBlur);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurV.fbo);
      gl.bindTexture(gl.TEXTURE_2D, this.blurH.tex);
      gl.uniform2f(gl.getUniformLocation(this.progBlur, "u_dir"), 0, 2.5 / ph);
      this.drawQuad(this.progBlur);
    }

    const p = this.progComposite;
    gl.useProgram(p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, ow, oh);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, cleanTex);
    gl.uniform1i(gl.getUniformLocation(p, "u_frame"), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, needBlur ? this.blurV.tex : cleanTex);
    gl.uniform1i(gl.getUniformLocation(p, "u_blur"), 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.mask.tex);
    gl.uniform1i(gl.getUniformLocation(p, "u_mask"), 2);
    gl.uniform2f(gl.getUniformLocation(p, "u_texel"), 1 / pw, 1 / ph);
    gl.uniform1i(gl.getUniformLocation(p, "u_enhance"), s.enhanceOn ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(p, "u_beautify"), beautify ? 1 : 0);
    gl.uniform1i(gl.getUniformLocation(p, "u_mirror"), s.mirror ? 1 : 0);
    gl.uniform1f(gl.getUniformLocation(p, "u_exposure"), s.exposure);
    gl.uniform1f(gl.getUniformLocation(p, "u_shadow"), s.shadow);
    gl.uniform1f(gl.getUniformLocation(p, "u_denoise"), s.denoise);
    gl.uniform1f(gl.getUniformLocation(p, "u_sharpen"), s.sharpen);
    gl.uniform1f(gl.getUniformLocation(p, "u_clarity"), s.clarity);
    gl.uniform1f(gl.getUniformLocation(p, "u_smooth"), s.smooth);
    gl.uniform1f(gl.getUniformLocation(p, "u_even"), s.even);
    gl.uniform1f(gl.getUniformLocation(p, "u_eye"), s.eye);
    gl.uniform3fv(gl.getUniformLocation(p, "u_wb"), s.autoWB ? s.wb : [1 + s.warmth * 0.15, 1, 1 - s.warmth * 0.15]);
    gl.uniform4f(gl.getUniformLocation(p, "u_crop"), s.crop.x, s.crop.y, s.crop.w, s.crop.h);
    this.drawQuad(p);
  }

  dispose() {
    this.gl.getExtension("WEBGL_lose_context")?.loseContext();
  }
}
