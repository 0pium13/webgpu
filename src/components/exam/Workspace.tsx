"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Dropzone from "@/components/Dropzone";
import CropFrame from "./CropFrame";
import ResultCard, { type ExamResult } from "./ResultCard";
import { Toggle, Divider, Progress, card, ghostBtn, input } from "./ui";
import { ExamPhotoIcon, SignatureIcon, ThumbprintIcon, PdfIcon } from "@/components/Icons";
import { kbWindow, maxScale, type ExamMode, type ExamPreset } from "@/lib/examPresets";
import {
  backgroundCheck, clampCrop, cleanInk, cropLimits, drawCrop, drawStrip, encodeInRange,
  frameDefault, frameFace, frameInk, inkLevels, loadImage, makeCanvas, padJpeg, readJpegDpi,
  stripHeight, todayDMY, whiten, type Box, type Crop,
} from "@/lib/examImage";
import { detectFace, type FaceBox } from "@/lib/examFace";
import { computeMask } from "@/lib/rmbgClient";

type FaceState = "idle" | "detecting" | "found" | "none" | "error";
type BgPhase = "idle" | "loading" | "processing" | "done" | "error";

/** How much of the frame's tighter side the ink should fill. */
const INK_FILL: Record<ExamMode, number> = { photo: 1, signature: 0.84, declaration: 0.9, thumb: 0.72 };
/** Documents are cleaned at this size; the editor works in the same pixels. */
const DOC_MAX = 1600;

const DROP: Record<ExamMode, { title: string; subtitle: string; cta: string }> = {
  photo: {
    title: "Add your photo",
    subtitle: "A clear phone photo against a plain wall works — we find your face and frame it.",
    cta: "Choose photo",
  },
  signature: {
    title: "Add a photo of your signature",
    subtitle: "Sign on plain white paper with a black pen, then snap it. Shadows and grey paper get cleaned.",
    cta: "Choose image",
  },
  thumb: {
    title: "Add your thumb impression",
    subtitle: "Press your left thumb on an ink pad, then on white paper. Snap it straight from above.",
    cta: "Choose image",
  },
  declaration: {
    title: "Add your handwritten declaration",
    subtitle: "Write it on white paper in black ink (not capitals), then photograph the page flat.",
    cta: "Choose image",
  },
};

function ModeIcon({ mode, size }: { mode: ExamMode; size: number }) {
  if (mode === "photo") return <ExamPhotoIcon size={size} />;
  if (mode === "signature") return <SignatureIcon size={size} />;
  if (mode === "thumb") return <ThumbprintIcon size={size} />;
  return <PdfIcon size={size} />;
}

function shrink(c: HTMLCanvasElement, max: number) {
  const s = max / Math.max(c.width, c.height);
  if (s >= 1) return c;
  const out = makeCanvas(c.width * s, c.height * s);
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(c, 0, 0, out.width, out.height);
  return out;
}

export default function Workspace({ mode, preset }: { mode: ExamMode; preset: ExamPreset }) {
  const isPhoto = mode === "photo";
  const [fileName, setFileName] = useState("");
  const [base, setBase] = useState<HTMLCanvasElement | null>(null);
  const [baseId, setBaseId] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // photo
  const [face, setFace] = useState<FaceBox | null>(null);
  const [faceState, setFaceState] = useState<FaceState>("idle");
  const [whiteOn, setWhiteOn] = useState(false);
  const [white, setWhite] = useState<HTMLCanvasElement | null>(null);
  const [bg, setBg] = useState<{ phase: BgPhase; pct: number; msg: string }>({ phase: "idle", pct: 0, msg: "" });
  // the strip follows the preset's default until the user flips it
  const [stripPick, setStripPick] = useState<{ preset: string; on: boolean } | null>(null);
  const stripOn = stripPick?.preset === preset.id ? stripPick.on : !!preset.nameDate;
  const setStripOn = (on: boolean) => setStripPick({ preset: preset.id, on });
  const [name, setName] = useState("");
  const [date, setDate] = useState(todayDMY);

  // documents
  const [cleanOn, setCleanOn] = useState(true);
  const [strength, setStrength] = useState(0.5);
  const [ink, setInk] = useState<HTMLCanvasElement | null>(null);
  /** undefined until the first clean pass has looked for ink */
  const [inkBox, setInkBox] = useState<Box | null | undefined>(undefined);

  /** the user's crop, valid only for the framing it was made under */
  const [userCrop, setUserCrop] = useState<{ key: string; crop: Crop } | null>(null);
  const [result, setResult] = useState<ExamResult | null>(null);
  const [rendering, setRendering] = useState(false);
  // custom sizes carry the choice in the spec; presets keep it here
  const [growPick, setGrowPick] = useState(false);
  const isCustom = preset.id === "custom";
  const growOn = isCustom ? !preset.pxFixed : growPick;
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => { baseRef.current = base; }, [base]);

  async function handleFiles(files: File[]) {
    const f = files[0];
    if (!f) return;
    if (f.type && !f.type.startsWith("image/")) { setError("Please choose an image (JPG, PNG or WebP)."); return; }
    setError("");
    setLoading(true);
    try {
      let c = await loadImage(f);
      if (!isPhoto) c = shrink(c, DOC_MAX);
      setFace(null); setFaceState(isPhoto ? "detecting" : "idle");
      setWhite(null); setWhiteOn(false); setBg({ phase: "idle", pct: 0, msg: "" });
      setInk(null); setInkBox(undefined);
      setUserCrop(null);
      setFileName(f.name);
      setBase(c);
      setBaseId((n) => n + 1);
    } catch (e) {
      console.error(e);
      setError("Couldn't open that image. iPhone HEIC photos: share → save as JPG first, or take a screenshot.");
    } finally {
      setLoading(false);
    }
  }

  // photo: find the face once per image
  useEffect(() => {
    if (!isPhoto || !base) return;
    let dead = false;
    detectFace(base)
      .then((f) => { if (!dead) { setFace(f); setFaceState(f ? "found" : "none"); } })
      .catch((e) => { console.warn("[exam-photo] face detection failed", e); if (!dead) setFaceState("error"); });
    return () => { dead = true; };
  }, [base, isPhoto]);

  // documents: clean (debounced while the strength slider moves)
  const cleanedOnce = useRef(false);
  useEffect(() => {
    if (isPhoto || !base || !cleanOn) return;
    const id = setTimeout(() => {
      const r = cleanInk(base, strength, mode === "thumb");
      cleanedOnce.current = true;
      setInk(r.canvas);
      setInkBox((b) => (b === undefined ? r.box : b));
    }, cleanedOnce.current ? 140 : 30);
    return () => clearTimeout(id);
  }, [base, cleanOn, strength, isPhoto, mode]);

  const W = preset.width, H = preset.height;
  const sh = isPhoto && stripOn ? stripHeight(W, H) : 0;
  const photoH = H - sh;
  const aspect = W / photoH;
  const limits = base ? cropLimits(base.width, base.height, aspect, W, !isPhoto) : null;
  const display = isPhoto ? (whiteOn && white ? white : base) : (cleanOn && ink ? ink : base);

  function autoCrop(): Crop | null {
    if (!base || !limits) return null;
    let c: Crop;
    if (isPhoto) {
      c = face ? frameFace(face, aspect, base.width, base.height, preset.face ?? 0.72) : frameDefault(base.width, base.height, aspect);
    } else if (inkBox) {
      c = frameInk(inkBox, aspect, INK_FILL[mode]);
    } else {
      const w = Math.max(base.width, base.height * aspect);
      c = { x: (base.width - w) / 2, y: (base.height - w / aspect) / 2, w };
    }
    return clampCrop(c, aspect, base.width, base.height, limits, !isPhoto);
  }

  // re-frame whenever the target shape or the detection changes
  const ready = !!base && (isPhoto ? faceState !== "idle" && faceState !== "detecting" : inkBox !== undefined || !cleanOn);
  const autoKey = ready ? `${baseId}|${preset.id}|${W}x${H}|${aspect.toFixed(5)}|${faceState}|${inkBox ? 1 : 0}` : "";
  // autoKey captures everything autoCrop reads
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const auto = useMemo(() => (autoKey ? autoCrop() : null), [autoKey]);
  const crop = !autoKey ? null : userCrop?.key === autoKey ? userCrop.crop : auto;
  const setCrop = (c: Crop) => setUserCrop({ key: autoKey, crop: c });

  // render + size-target the output whenever anything visible changes
  const seq = useRef(0);
  useEffect(() => {
    if (!display || !crop) return;
    const my = ++seq.current;
    const id = setTimeout(async () => {
      setRendering(true);
      try {
        const draw = (w: number, h: number) => {
          const out = makeCanvas(w, h);
          const ctx = out.getContext("2d", { willReadFrequently: true })!;
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
          const s = sh ? stripHeight(w, h) : 0;
          drawCrop(ctx, display, crop, aspect, 0, 0, w, h - s);
          if (s) drawStrip(ctx, 0, h - s, w, s, name, date);
          if (cleanOn && (mode === "signature" || mode === "declaration")) inkLevels(out);
          return out;
        };
        const win = kbWindow(preset);
        const sMax = growOn ? maxScale(preset) : 1;
        // opt-in: grow the pixels (same shape) while quality 100 still can't
        // reach the minimum; bisect back if a step overshoots the maximum
        let s = 1, lo = 1, hi = Infinity;
        let out = draw(W, H);
        let enc = await encodeInRange(out, win.min, win.max, preset.dpi);
        for (let i = 0; i < 8 && enc.status !== "ok" && sMax > 1; i++) {
          if (enc.status === "too-small") {
            if (s >= sMax) break;
            lo = s;
            s = hi < Infinity ? (s + hi) / 2 : Math.min(sMax, s * Math.min(2, Math.max(1.25, (win.min / enc.maxQualityBytes) ** 0.8)));
          } else {
            if (s === 1) break;
            hi = s;
            s = (lo + s) / 2;
          }
          out = draw(Math.round(W * s), Math.round(H * s));
          enc = await encodeInRange(out, win.min, win.max, preset.dpi);
          if (my !== seq.current) return;
        }
        // default: keep the exact pixels, pad with JPEG comments to the minimum
        let padded = 0;
        if (enc.status === "too-small") {
          const target = Math.min(win.max, win.min + Math.max(256, Math.round(win.min * 0.02)));
          const bytes = padJpeg(enc.bytes, target);
          padded = bytes.length - enc.bytes.length;
          enc = { ...enc, bytes, status: "ok" };
        }
        const bgWarn = isPhoto && !whiteOn && backgroundCheck(out).dark > 0.35;
        if (my !== seq.current) return;
        const url = URL.createObjectURL(new Blob([enc.bytes as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }));
        setResult((prev) => {
          if (prev) URL.revokeObjectURL(prev.url);
          return {
            url, bytes: enc.bytes.length, width: out.width, height: out.height, quality: enc.quality, status: enc.status,
            maxQualityBytes: enc.maxQualityBytes, dpi: readJpegDpi(enc.bytes), bgWarn, padded,
          };
        });
      } catch (e) {
        console.error(e);
        setError("Couldn't build the JPEG in this browser.");
      } finally {
        if (my === seq.current) setRendering(false);
      }
    }, 160);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display, crop, W, H, aspect, sh, name, date, mode, cleanOn, isPhoto, whiteOn, preset.minKB, preset.maxKB, preset.dpi, growOn]);

  useEffect(() => () => { setResult((prev) => { if (prev) URL.revokeObjectURL(prev.url); return null; }); }, []);

  async function toggleWhite(on: boolean) {
    setWhiteOn(on);
    if (!on || white || !base || bg.phase === "loading" || bg.phase === "processing") return;
    const forBase = base;
    setBg({ phase: "loading", pct: -1, msg: "Loading background model (one-time ~44 MB)…" });
    try {
      const blob = await new Promise<Blob>((res, rej) =>
        forBase.toBlob((b) => (b ? res(b) : rej(new Error("Could not read the photo"))), "image/jpeg", 0.95));
      const mask = await computeMask(blob, {
        progress: (p) => {
          if (p.status === "progress" && p.total) {
            const pct = Math.round(((p.loaded ?? 0) / p.total) * 100);
            setBg({ phase: "loading", pct, msg: `Downloading background model… ${pct}%` });
          }
        },
        onFallback: () => setBg((s) => ({ ...s, msg: "WebGPU unavailable — using CPU…" })),
        onProcessing: () => setBg({ phase: "processing", pct: -1, msg: "Painting the background white…" }),
      });
      if (baseRef.current !== forBase) return;
      setWhite(whiten(forBase, mask));
      setBg({ phase: "done", pct: 100, msg: "" });
    } catch (e) {
      console.error(e);
      if (baseRef.current !== forBase) return;
      setBg({ phase: "error", pct: 0, msg: e instanceof Error ? e.message : "Background removal failed" });
      setWhiteOn(false);
    }
  }

  function reset() {
    setBase(null); setFileName(""); setUserCrop(null); setFace(null); setFaceState("idle");
    setWhite(null); setWhiteOn(false); setInk(null); setInkBox(undefined); setError("");
    setResult((prev) => { if (prev) URL.revokeObjectURL(prev.url); return null; });
  }

  if (!base) {
    const d = DROP[mode];
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Dropzone
          onFiles={handleFiles}
          accept="image/*"
          icon={<ModeIcon mode={mode} size={26} />}
          title={loading ? "Opening…" : d.title}
          subtitle={d.subtitle}
          cta={d.cta}
          footnote="Processed on your device · Nothing uploaded · Free"
        />
        {error && <p role="alert" style={{ fontSize: 13, color: "#ef4444" }}>{error}</p>}
      </div>
    );
  }

  const busyBg = bg.phase === "loading" || bg.phase === "processing";
  const zoom = crop && limits ? sliderFromCrop(crop.w, limits.minW, limits.maxW) : 0;
  const nameDateOk = preset.nameDate ? stripOn && !!name.trim() && !!date.trim() : null;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 16, alignItems: "start" }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 14, minWidth: 0 }}>
        <div style={{ ...card, padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
            <p style={{ fontSize: 12.5, color: "var(--text-muted)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {fileName}
            </p>
            <label style={{ ...ghostBtn, flexShrink: 0 }}>
              <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFiles([f]); e.target.value = ""; }} />
              Change {isPhoto ? "photo" : "image"}
            </label>
          </div>

          <div style={{ position: "relative" }}>
            {crop && limits && display ? (
              <CropFrame
                source={display}
                aspect={aspect}
                totalAspect={W / H}
                crop={crop}
                limits={limits}
                contain={!isPhoto}
                onChange={setCrop}
                faceGuide={isPhoto ? preset.face ?? 0.72 : undefined}
                footer={sh ? (fw, fh) => <StripPreview width={fw} height={fh} name={name} date={date} /> : undefined}
              />
            ) : (
              <div style={{ height: 320, borderRadius: 10, background: "linear-gradient(110deg, var(--surface-2) 30%, rgba(255,255,255,0.05) 50%, var(--surface-2) 70%)", backgroundSize: "200% 100%", animation: "exam-shimmer 1.4s linear infinite" }} />
            )}
            <StatusPill isPhoto={isPhoto} faceState={faceState} hasInk={!!inkBox} ready={!!crop} />
            <style>{`@keyframes exam-shimmer { from { background-position: 200% 0; } to { background-position: -200% 0; } }`}</style>
          </div>

          {crop && limits && (
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span aria-hidden className="mono" style={{ fontSize: 15, color: "var(--text-dim)", width: 12, textAlign: "center" }}>−</span>
              <input
                type="range" min={0} max={1000} value={Math.round(zoom * 1000)} aria-label="Zoom"
                onChange={(e) => {
                  const w = cropFromSlider(Number(e.target.value) / 1000, limits.minW, limits.maxW);
                  const cx = crop.x + crop.w / 2, cy = crop.y + crop.w / aspect / 2;
                  setCrop(clampCrop({ x: cx - w / 2, y: cy - w / aspect / 2, w }, aspect, base.width, base.height, limits, !isPhoto));
                }}
                style={{ flex: 1, minWidth: 0, accentColor: "var(--accent)" }}
              />
              <span aria-hidden className="mono" style={{ fontSize: 15, color: "var(--text-dim)", width: 12, textAlign: "center" }}>+</span>
              <button onClick={() => setUserCrop(null)} style={ghostBtn}>
                {isPhoto ? "Auto-frame" : "Auto-fit"}
              </button>
            </div>
          )}
          <p className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)", textAlign: "center", marginTop: -6 }}>
            Drag to move · pinch or scroll to zoom
          </p>
        </div>

        <div style={{ ...card, padding: 16, display: "flex", flexDirection: "column", gap: 16 }}>
          {isPhoto ? (
            <>
              <Toggle
                on={whiteOn}
                onChange={toggleWhite}
                disabled={busyBg}
                title="White background"
                hint="AI replaces the wall behind you with pure white. Downloads a one-time model, then runs on your device."
              >
                {busyBg && <Progress pct={bg.pct} label={bg.msg} />}
                {bg.phase === "error" && <p style={{ fontSize: 12, color: "#ef4444" }}>{bg.msg}</p>}
              </Toggle>
              <Divider />
              <Toggle
                on={stripOn}
                onChange={setStripOn}
                title="Name & date on photo"
                hint={preset.nameDate ? `${preset.exam} asks for your name and the date the photo was taken.` : "Only if your notification asks for it."}
              >
                {stripOn && (
                  <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 3fr) minmax(0, 2fr)", gap: 8 }}>
                    <input aria-label="Name on photo" placeholder="Your full name" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} style={input} autoComplete="name" />
                    <input aria-label="Date the photo was taken" placeholder="DD-MM-YYYY" value={date} maxLength={10} onChange={(e) => setDate(e.target.value)} style={input} inputMode="numeric" className="mono" />
                  </div>
                )}
              </Toggle>
            </>
          ) : (
            <Toggle
              on={cleanOn}
              onChange={setCleanOn}
              title="Auto-clean"
              hint={mode === "thumb"
                ? "Flattens shadows and turns the paper pure white, keeping the ink's colour and ridges."
                : "Removes shadows and grey paper — crisp black ink on pure white."}
            >
              {cleanOn && (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 11.5, color: "var(--text-muted)", width: 34 }}>Light</span>
                  <input
                    type="range" min={0} max={1} step={0.02} value={strength} aria-label="Ink strength"
                    onChange={(e) => setStrength(Number(e.target.value))}
                    style={{ flex: 1, minWidth: 0, accentColor: "var(--accent)" }}
                  />
                  <span style={{ fontSize: 11.5, color: "var(--text-muted)", width: 34, textAlign: "right" }}>Bold</span>
                </div>
              )}
            </Toggle>
          )}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-start" }}>
          <button onClick={reset} style={{ ...ghostBtn, border: "none", padding: "4px 0", color: "var(--text-muted)" }}>← Start over</button>
        </div>
        {error && <p role="alert" style={{ fontSize: 13, color: "#ef4444" }}>{error}</p>}
      </div>

      <div style={{ position: "sticky", top: 76, minWidth: 0 }}>
        <ResultCard
          preset={preset}
          result={result}
          busy={rendering}
          nameDateOk={nameDateOk}
          whiteBg={whiteOn && !!white}
          onGrow={!isCustom && maxScale({ ...preset, pxFixed: false }) > 1 ? setGrowPick : undefined}
          onWhiteBg={isPhoto && !busyBg ? () => toggleWhite(true) : undefined}
        />
      </div>
    </div>
  );
}

const sliderFromCrop = (w: number, minW: number, maxW: number) =>
  maxW <= minW ? 0 : Math.log(maxW / w) / Math.log(maxW / minW);
const cropFromSlider = (v: number, minW: number, maxW: number) =>
  maxW * Math.pow(minW / maxW, v);

function StatusPill({ isPhoto, faceState, hasInk, ready }: { isPhoto: boolean; faceState: FaceState; hasInk: boolean; ready: boolean }) {
  let tone: "accent" | "green" | "amber" = "accent";
  let text = "";
  if (isPhoto) {
    if (faceState === "detecting" || faceState === "idle") text = "Finding your face…";
    else if (faceState === "found") { tone = "green"; text = "Face found · auto-framed"; }
    else { tone = "amber"; text = "No face found — drag to frame it"; }
  } else {
    if (!ready) text = "Cleaning…";
    else if (hasInk) { tone = "green"; text = "Ink found · auto-fitted"; }
    else { tone = "amber"; text = "Couldn't find ink — zoom to fit"; }
  }
  const color = tone === "green" ? "var(--green)" : tone === "amber" ? "var(--amber)" : "var(--accent)";
  return (
    <span
      aria-live="polite"
      style={{
        position: "absolute", top: 10, left: "50%", transform: "translateX(-50%)", zIndex: 2,
        display: "inline-flex", alignItems: "center", gap: 7, whiteSpace: "nowrap",
        padding: "5px 11px", borderRadius: 20, fontSize: 11.5, fontWeight: 500,
        background: "rgba(11,10,8,0.78)", color, backdropFilter: "blur(10px)", WebkitBackdropFilter: "blur(10px)",
        boxShadow: "0 0 0 0.5px rgba(255,255,255,0.12), 0 8px 20px -10px rgba(0,0,0,0.8)",
        pointerEvents: "none",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 3, background: color, animation: tone === "accent" ? "pulse 1.2s ease-in-out infinite" : undefined }} />
      {text}
    </span>
  );
}

function StripPreview({ width, height, name, date }: { width: number; height: number; name: string; date: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    c.width = Math.round(width * dpr);
    c.height = Math.round(height * dpr);
    drawStrip(c.getContext("2d")!, 0, 0, c.width, c.height, name || "YOUR NAME", date);
  }, [width, height, name, date]);
  return <canvas ref={ref} aria-hidden style={{ display: "block", width, height, opacity: name ? 1 : 0.45 }} />;
}
