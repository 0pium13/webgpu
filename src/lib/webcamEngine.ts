"use client";

/**
 * Real-time webcam pipeline on WebGL2. Everything runs on the GPU, per frame,
 * at camera framerate — no model for the image effects (shaders), MediaPipe
 * only supplies the face polygons/box which we pass in.
 *
 * Passes:
 *   1. mask  — fill landmark polygons into an offscreen mask (skin/eyes/lips)
 *   2. blurH/blurV — separable gaussian of the frame (low-freq for beautify)
 *   3. composite — denoise + low-light lift + white balance + adaptive sharpen
 *      + clarity, then (optional) frequency-separation skin smoothing, even
 *      lighting, eye brighten; auto-frame crop is applied as a UV remap.
 *
 * Orientation: video uploaded with UNPACK_FLIP_Y so uv.y=1 is the top of the
 * frame; landmark polygons map to the same convention.
 */

import type { FaceRegions } from "./faceTrack";

export interface EnhanceSettings {
  enhanceOn: boolean;
  exposure: number;   // multiplier around 1.0
  shadow: number;     // 0..1 shadow lift
  warmth: number;     // -1..1 (cool..warm)
  autoWB: boolean;    // gray-world white balance
  denoise: number;    // 0..1
  sharpen: number;    // 0..1.5
  clarity: number;    // 0..1 local contrast
  beautifyOn: boolean;
  smooth: number;     // 0..1 skin smoothing
  even: number;       // 0..1 even out face lighting
  eye: number;        // 0..1 eye brighten
  autoFrame: boolean;
  mirror: boolean;
  // crop window in normalized coords (auto-frame result), full-frame if 0,0,1,1
  crop: { x: number; y: number; w: number; h: number };
  // gray-world gain, computed on CPU when autoWB is on
  wb: [number, number, number];
}

const VERT = `#version 300 es
in vec2 a_pos;
out vec2 v_uv;
void main(){ v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;

// polygon fill for the mask — a_ch selects which channel to write
const MASK_VERT = `#version 300 es
in vec2 a_pos;              // already in clip space
void main(){ gl_Position = vec4(a_pos, 0.0, 1.0); }`;
const MASK_FRAG = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 o;
void main(){ o = u_color; }`;

const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_dir;        // texel step in one direction
out vec4 o;
void main(){
  vec3 c = texture(u_tex, v_uv).rgb * 0.227027;
  c += texture(u_tex, v_uv + u_dir * 1.3846).rgb * 0.316216;
  c += texture(u_tex, v_uv - u_dir * 1.3846).rgb * 0.316216;
  c += texture(u_tex, v_uv + u_dir * 3.2308).rgb * 0.070270;
  c += texture(u_tex, v_uv - u_dir * 3.2308).rgb * 0.070270;
  o = vec4(c, 1.0);
}`;

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_frame;
uniform sampler2D u_blur;
uniform sampler2D u_mask;
uniform vec2 u_texel;
uniform bool u_enhance, u_beautify, u_mirror;
uniform float u_exposure, u_shadow, u_denoise, u_sharpen, u_clarity;
uniform float u_smooth, u_even, u_eye;
uniform vec3 u_wb;
uniform vec4 u_crop;
out vec4 o;

float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

void main(){
  vec2 uv = v_uv;
  if (u_mirror) uv.x = 1.0 - uv.x;
  uv = u_crop.xy + uv * u_crop.zw;      // auto-frame window

  vec3 center = texture(u_frame, uv).rgb;
  vec3 c = center;

  if (u_enhance) {
    // 3x3 average for denoise + sharpen
    vec3 avg = vec3(0.0);
    for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++)
      avg += texture(u_frame, uv + vec2(float(i), float(j)) * u_texel).rgb;
    avg /= 9.0;
    // edge-aware denoise: smooth flats, keep edges
    float flatW = 1.0 - clamp(length(center - avg) * 6.0, 0.0, 1.0);
    c = mix(center, avg, u_denoise * flatW);
    // low-light: lift shadows (sqrt curve masked to darks) + exposure
    c *= u_exposure;
    float l = luma(c);
    float sh = 1.0 - smoothstep(0.0, 0.5, l);
    c = mix(c, sqrt(clamp(c, 0.0, 1.0)), u_shadow * sh);
    // white balance / warmth
    c *= u_wb;
    // adaptive sharpen (unsharp against the 3x3 avg; flats add little)
    c += u_sharpen * (c - avg);
    // clarity: midtone local contrast against heavy blur
    float lb = luma(texture(u_blur, uv).rgb);
    c *= 1.0 + u_clarity * (luma(c) - lb);
  }

  if (u_beautify) {
    vec4 m = texture(u_mask, uv);
    float skin = m.r * (1.0 - max(m.g, m.b));
    float eye = m.g;
    vec3 low = texture(u_blur, uv).rgb;
    // even lighting: pull face luminance toward mid on skin
    float lowL = max(luma(low), 0.05);
    float evenGain = mix(1.0, clamp(0.5 / lowL, 0.65, 1.5), u_even * skin);
    c *= evenGain;
    // frequency separation: reduce high-freq texture on skin, edge-aware
    vec3 hi = c - low;
    float flatW2 = 1.0 - clamp(length(hi) * 4.0, 0.0, 1.0);
    c = low + hi * (1.0 - u_smooth * skin * flatW2);
    // eye brighten + a touch of contrast
    vec3 bright = clamp((c - 0.5) * 1.12 + 0.5 + 0.06, 0.0, 1.0);
    c = mix(c, bright, u_eye * eye);
  }

  o = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error("shader compile: " + gl.getShaderInfoLog(s));
  }
  return s;
}
function program(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error("link: " + gl.getProgramInfoLog(p));
  }
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
  private quad: WebGLBuffer;
  private maskBuf: WebGLBuffer;
  private frameTex: WebGLTexture;
  private blurH!: { tex: WebGLTexture; fbo: WebGLFramebuffer };
  private blurV!: { tex: WebGLTexture; fbo: WebGLFramebuffer };
  private mask!: { tex: WebGLTexture; fbo: WebGLFramebuffer };
  private w = 0;
  private h = 0;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw new Error("WebGL2 not available in this browser.");
    this.gl = gl;
    this.progComposite = program(gl, VERT, COMPOSITE_FRAG);
    this.progBlur = program(gl, VERT, BLUR_FRAG);
    this.progMask = program(gl, MASK_VERT, MASK_FRAG);
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

  private resize(w: number, h: number) {
    if (this.w === w && this.h === h) return;
    this.w = w; this.h = h;
    (this.gl.canvas as HTMLCanvasElement).width = w;
    (this.gl.canvas as HTMLCanvasElement).height = h;
    this.blurH = makeFBO(this.gl, w, h);
    this.blurV = makeFBO(this.gl, w, h);
    this.mask = makeFBO(this.gl, w, h);
  }

  private drawQuad(prog: WebGLProgram) {
    const gl = this.gl;
    const loc = gl.getAttribLocation(prog, "a_pos");
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  /** Fan-triangulate a region's landmark points (sorted by angle) into clip verts. */
  private fillRegion(prog: WebGLProgram, points: { x: number; y: number }[], idx: number[], color: [number, number, number, number]) {
    const gl = this.gl;
    if (idx.length < 3) return;
    let cx = 0, cy = 0;
    for (const i of idx) { cx += points[i].x; cy += points[i].y; }
    cx /= idx.length; cy /= idx.length;
    const sorted = [...idx].sort((a, b) =>
      Math.atan2(points[a].y - cy, points[a].x - cx) - Math.atan2(points[b].y - cy, points[b].x - cx)
    );
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

  render(
    video: HTMLVideoElement,
    s: EnhanceSettings,
    face: { points: { x: number; y: number }[] | null },
    regions: FaceRegions | null
  ) {
    const gl = this.gl;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) return;
    const scale = Math.min(1, 1280 / Math.max(vw, vh));
    const w = Math.round(vw * scale), h = Math.round(vh * scale);
    this.resize(w, h);

    // upload frame
    gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

    const beautify = s.beautifyOn && !!face.points && !!regions;

    // build mask (only if beautifying)
    if (beautify && face.points && regions) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.mask.fbo);
      gl.viewport(0, 0, w, h);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.disable(gl.BLEND);
      // skin (R), eyes (G), lips (B) — independent channel writes
      gl.colorMask(true, false, false, true);
      this.fillRegion(this.progMask, face.points, regions.oval, [1, 0, 0, 1]);
      gl.colorMask(false, true, false, true);
      this.fillRegion(this.progMask, face.points, regions.leftEye, [0, 1, 0, 1]);
      this.fillRegion(this.progMask, face.points, regions.rightEye, [0, 1, 0, 1]);
      gl.colorMask(false, false, true, true);
      this.fillRegion(this.progMask, face.points, regions.lips, [0, 0, 1, 1]);
      gl.colorMask(true, true, true, true);
      // soften mask edges: blur mask through blurH→blurV would clobber the
      // frame blur, so skip — polygon edges are acceptable for v1
    }

    // blur frame (low-freq) — needed for clarity and beautify
    const needBlur = (s.enhanceOn && s.clarity > 0) || beautify;
    if (needBlur) {
      gl.useProgram(this.progBlur);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurH.fbo);
      gl.viewport(0, 0, w, h);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
      gl.uniform1i(gl.getUniformLocation(this.progBlur, "u_tex"), 0);
      gl.uniform2f(gl.getUniformLocation(this.progBlur, "u_dir"), 2.5 / w, 0);
      this.drawQuad(this.progBlur);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.blurV.fbo);
      gl.bindTexture(gl.TEXTURE_2D, this.blurH.tex);
      gl.uniform2f(gl.getUniformLocation(this.progBlur, "u_dir"), 0, 2.5 / h);
      this.drawQuad(this.progBlur);
    }

    // composite to screen
    const p = this.progComposite;
    gl.useProgram(p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.frameTex);
    gl.uniform1i(gl.getUniformLocation(p, "u_frame"), 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, needBlur ? this.blurV.tex : this.frameTex);
    gl.uniform1i(gl.getUniformLocation(p, "u_blur"), 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.mask.tex);
    gl.uniform1i(gl.getUniformLocation(p, "u_mask"), 2);
    gl.uniform2f(gl.getUniformLocation(p, "u_texel"), 1 / w, 1 / h);
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
    const gl = this.gl;
    const ext = gl.getExtension("WEBGL_lose_context");
    ext?.loseContext();
  }
}
