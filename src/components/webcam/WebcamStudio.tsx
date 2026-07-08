"use client";

/**
 * Webcam Studio — real-time enhance + beautify + auto-frame on the live feed,
 * all on the GPU in this tab. Record it or use it as an OBS browser source;
 * browsers can't register a virtual camera, so it can't feed Zoom directly.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { WebcamEngine, type EnhanceSettings, type OutputRes } from "@/lib/webcamEngine";
import { loadFaceTracker, detectFace, faceRegions, type FaceResult } from "@/lib/faceTrack";
import { VideocamIcon } from "@/components/Icons";

type CamState = "idle" | "starting" | "live" | "denied" | "error";

const DEFAULTS: EnhanceSettings = {
  enhanceOn: true, exposure: 1.06, shadow: 0.35, warmth: 0.1, autoWB: true,
  denoise: 0.4, temporal: 0.45, sharpen: 0.5, clarity: 0.35, outputRes: "native",
  beautifyOn: false, smooth: 0.5, even: 0.4, eye: 0.4,
  autoFrame: false, mirror: true,
  crop: { x: 0, y: 0, w: 1, h: 1 }, wb: [1, 1, 1],
};

const RES_OPTIONS: { id: OutputRes; label: string }[] = [
  { id: "native", label: "Native" },
  { id: "fhd", label: "1080p" },
  { id: "qhd", label: "1440p" },
  { id: "uhd", label: "4K" },
];

export default function WebcamStudio() {
  const [cam, setCam] = useState<CamState>("idle");
  const [errMsg, setErrMsg] = useState("");
  const [fps, setFps] = useState(0);
  const [faceOk, setFaceOk] = useState<boolean | null>(null);
  const [trackerMsg, setTrackerMsg] = useState("");
  const [recording, setRecording] = useState(false);
  const [recUrl, setRecUrl] = useState<string | null>(null);
  const [s, setS] = useState<EnhanceSettings>(DEFAULTS);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<WebcamEngine | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackerRef = useRef<any>(null);
  const rafRef = useRef(0);
  const sRef = useRef(s); sRef.current = s;
  const camRef = useRef(cam); camRef.current = cam;
  const cropRef = useRef({ x: 0, y: 0, f: 1 });     // smoothed auto-frame state
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const wbCanvas = useRef<HTMLCanvasElement | null>(null);
  const wbRef = useRef<[number, number, number]>([1, 1, 1]);
  const frameCount = useRef(0);
  const lastFpsT = useRef(performance.now());
  const fpsBase = useRef(0);
  const faceOkT = useRef(0);

  // ── camera lifecycle ────────────────────────────────────────────────────
  const start = useCallback(async () => {
    try {
      setCam("starting"); setErrMsg("");
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        setErrMsg("Cameras only work on https:// or http://localhost. Open the site at localhost, not a LAN IP address.");
        setCam("error");
        return;
      }
      const videoC = { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: "user" };
      // audio is best-effort: machines with a camera but no mic (or a busy
      // mic) must still get video, so we never let audio fail the whole start
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: videoC, audio: true });
      } catch (audioErr: any) {
        if (audioErr?.name === "NotAllowedError" || audioErr?.name === "SecurityError") throw audioErr;
        stream = await navigator.mediaDevices.getUserMedia({ video: videoC, audio: false });
      }
      streamRef.current = stream;
      const v = videoRef.current!;
      v.srcObject = stream;
      await v.play();
      // create the GL engine ONCE and reuse it — recreating (and disposing) a
      // context on the same canvas poisons it, so createShader returns null
      if (!engineRef.current) engineRef.current = new WebcamEngine(canvasRef.current!);
      setCam("live");
      loop();
    } catch (e: any) {
      console.error(e);
      const name = e?.name ?? "";
      if (name === "NotAllowedError" || name === "SecurityError") setCam("denied");
      else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setErrMsg("No camera found. Check a webcam is connected and not in use by another app.");
        setCam("error");
      } else if (name === "NotReadableError") {
        setErrMsg("The camera is busy — another app (Zoom, Photo Booth, OBS…) is using it. Close it and retry.");
        setCam("error");
      } else { setErrMsg(`${name || "Error"}: ${e?.message ?? "couldn't start the camera"}`); setCam("error"); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // stop = pause: end the stream + rAF but KEEP the GL engine/context alive so
  // the next Start reuses it (disposing it would poison the canvas)
  const stop = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    recRef.current?.state === "recording" && recRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCam("idle"); setFaceOk(null); setFps(0);
  }, []);

  // full teardown only when the component unmounts (navigating away)
  useEffect(() => () => {
    cancelAnimationFrame(rafRef.current);
    recRef.current?.state === "recording" && recRef.current.stop();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    engineRef.current?.dispose();
    engineRef.current = null;
  }, []);

  // proactively detect a sticky "blocked" permission so we can guide the user
  // to unblock it, instead of only failing after they click Start
  useEffect(() => {
    (async () => {
      try {
        const p = await (navigator.permissions as any)?.query({ name: "camera" });
        if (p?.state === "denied") setCam("denied");
        p?.addEventListener?.("change", () => { if (p.state !== "denied" && camRef.current === "denied") setCam("idle"); });
      } catch { /* Firefox/Safari don't support the camera permission query — ignore */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // lazy-load the face tracker the first time beautify/auto-frame turns on
  useEffect(() => {
    if ((s.beautifyOn || s.autoFrame) && !trackerRef.current) {
      loadFaceTracker(setTrackerMsg).then((t) => { trackerRef.current = t; setTrackerMsg(""); })
        .catch((e) => { console.error(e); setTrackerMsg("Face tracker failed to load"); });
    }
  }, [s.beautifyOn, s.autoFrame]);

  function grayWorld(video: HTMLVideoElement): [number, number, number] {
    if (!wbCanvas.current) { wbCanvas.current = document.createElement("canvas"); wbCanvas.current.width = 16; wbCanvas.current.height = 16; }
    const ctx = wbCanvas.current.getContext("2d", { willReadFrequently: true })!;
    ctx.drawImage(video, 0, 0, 16, 16);
    const d = ctx.getImageData(0, 0, 16, 16).data;
    let r = 0, g = 0, b = 0;
    for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; }
    const n = d.length / 4;
    r /= n; g /= n; b /= n;
    const gray = (r + g + b) / 3;
    return [gray / Math.max(r, 1), gray / Math.max(g, 1), gray / Math.max(b, 1)];
  }

  function updateCrop(face: FaceResult) {
    const c = cropRef.current;
    let tx = 0, ty = 0, tf = 1;
    if (face.box) {
      const b = face.box;
      tf = Math.min(1, Math.max(0.35, Math.max(b.h / 0.55, b.w / 0.9)));
      tx = Math.min(1 - tf, Math.max(0, b.cx - tf / 2));
      ty = Math.min(1 - tf, Math.max(0, b.cy - tf / 2));
    }
    // deadzone + smooth follow so it glides instead of jittering
    const near = Math.abs(tx - c.x) < 0.015 && Math.abs(ty - c.y) < 0.015 && Math.abs(tf - c.f) < 0.02;
    const k = near ? 0 : 0.12;
    c.x += (tx - c.x) * k; c.y += (ty - c.y) * k; c.f += (tf - c.f) * k;
  }

  function loop() {
    const engine = engineRef.current, v = videoRef.current;
    if (!engine || !v) return;
    const st = sRef.current;

    let face: FaceResult = { points: null, box: null };
    const wantFace = (st.beautifyOn || st.autoFrame) && trackerRef.current && v.readyState >= 2;
    if (wantFace) {
      try { face = detectFace(trackerRef.current, v, performance.now()); } catch { /* skip frame */ }
    }

    if (st.autoFrame) updateCrop(face);
    else { cropRef.current.x += (0 - cropRef.current.x) * 0.12; cropRef.current.y += (0 - cropRef.current.y) * 0.12; cropRef.current.f += (1 - cropRef.current.f) * 0.12; }

    if (st.autoWB && st.enhanceOn && frameCount.current % 12 === 0) wbRef.current = grayWorld(v);

    const cr = cropRef.current;
    engine.render(v, { ...st, crop: { x: cr.x, y: cr.y, w: cr.f, h: cr.f }, wb: wbRef.current }, face, faceRegions());

    if (st.beautifyOn || st.autoFrame) setFaceOkThrottled(!!face.box);

    frameCount.current++;
    const now = performance.now();
    if (now - lastFpsT.current > 500) {
      setFps(Math.round((frameCount.current - fpsBase.current) / ((now - lastFpsT.current) / 1000)));
      fpsBase.current = frameCount.current; lastFpsT.current = now;
    }
    rafRef.current = requestAnimationFrame(loop);
  }
  function setFaceOkThrottled(ok: boolean) {
    const n = performance.now();
    if (n - faceOkT.current > 400) { faceOkT.current = n; setFaceOk(ok); }
  }

  // ── recording ──────────────────────────────────────────────────────────
  function toggleRecord() {
    if (recording) { recRef.current?.stop(); return; }
    const canvasStream = (canvasRef.current as any).captureStream(30) as MediaStream;
    const audio = streamRef.current?.getAudioTracks() ?? [];
    const mixed = new MediaStream([...canvasStream.getVideoTracks(), ...audio]);
    const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus"
      : MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus") ? "video/webm;codecs=vp8,opus" : "video/webm";
    const rec = new MediaRecorder(mixed, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    chunksRef.current = [];
    rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
    rec.onstop = () => {
      if (recUrl) URL.revokeObjectURL(recUrl);
      const blob = new Blob(chunksRef.current, { type: "video/webm" });
      setRecUrl(URL.createObjectURL(blob));
      setRecording(false);
    };
    recRef.current = rec; rec.start(); setRecording(true);
  }

  function snapshot() {
    canvasRef.current?.toBlob((b) => {
      if (!b) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = "webcam-snapshot.png";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
    }, "image/png");
  }

  const set = (patch: Partial<EnhanceSettings>) => setS((p) => ({ ...p, ...patch }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <video ref={videoRef} playsInline muted style={{ display: "none" }} />

      {/* preview */}
      <div style={{ position: "relative", background: "#000", borderRadius: 16, overflow: "hidden", border: "0.5px solid var(--border)", aspectRatio: "16/9", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <canvas ref={canvasRef} style={{ width: "100%", height: "100%", objectFit: "contain", display: cam === "live" ? "block" : "none" }} />

        {cam !== "live" && (
          <div style={{ textAlign: "center", padding: 32 }}>
            <div style={{ width: 60, height: 60, borderRadius: 15, background: "var(--surface-2)", border: "0.5px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 18px", color: "var(--accent)" }}>
              <VideocamIcon size={28} />
            </div>
            {cam === "denied" ? (
              <div style={{ maxWidth: 420, margin: "0 auto", textAlign: "left" }}>
                <p style={{ fontSize: 15, fontWeight: 500, marginBottom: 10, textAlign: "center" }}>Camera is blocked for this site</p>
                <p style={{ fontSize: 12.5, color: "var(--text-muted)", marginBottom: 12, textAlign: "center", lineHeight: 1.5 }}>
                  Your browser remembered a block for localhost. Two clicks to fix:
                </p>
                <ol style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.7, paddingLeft: 20, margin: "0 0 16px" }}>
                  <li>Click the <b>camera</b> (or <b>⚙/🔒</b>) icon at the left end of the address bar.</li>
                  <li>Set <b>Camera</b> to <b>Allow</b>.</li>
                  <li>Hit reload below.</li>
                </ol>
                <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                  <button onClick={() => location.reload()} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 10, padding: "10px 22px", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>Reload &amp; try again</button>
                </div>
                <p className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 14, textAlign: "center" }}>Chrome: chrome://settings/content/camera → remove localhost from Blocked</p>
              </div>
            ) : cam === "error" ? (
              <>
                <p style={{ color: "#ef4444", fontSize: 13.5, maxWidth: 380, margin: "0 auto 14px" }}>{errMsg}</p>
                <button onClick={start} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 10, padding: "10px 22px", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>Try again</button>
              </>
            ) : (
              <>
                <p style={{ fontSize: 16, fontWeight: 500, marginBottom: 8 }}>Turn on your camera to start</p>
                <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 18 }}>The feed never leaves this tab · nothing uploaded</p>
              </>
            )}
            {(cam === "idle" || cam === "starting") && (
              <button onClick={start} disabled={cam === "starting"} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12, padding: "12px 28px", fontSize: 15, fontWeight: 500, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 9 }}>
                <VideocamIcon size={16} /> {cam === "starting" ? "Starting…" : "Start camera"}
              </button>
            )}
          </div>
        )}

        {cam === "live" && (
          <div style={{ position: "absolute", top: 10, left: 10, display: "flex", gap: 8, alignItems: "center" }}>
            <span className="mono" style={{ fontSize: 11, background: "rgba(10,10,11,0.7)", color: fps >= 24 ? "var(--green)" : "var(--amber)", padding: "3px 9px", borderRadius: 7 }}>{fps} fps</span>
            {(s.beautifyOn || s.autoFrame) && (
              <span className="mono" style={{ fontSize: 11, background: "rgba(10,10,11,0.7)", color: faceOk ? "var(--green)" : "var(--text-dim)", padding: "3px 9px", borderRadius: 7 }}>
                {trackerMsg ? trackerMsg : faceOk ? "face locked" : "no face"}
              </span>
            )}
            {recording && <span className="mono" style={{ fontSize: 11, background: "rgba(239,68,68,0.85)", color: "#fff", padding: "3px 9px", borderRadius: 7, display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff", animation: "pulse 1s infinite" }} />REC</span>}
          </div>
        )}
      </div>

      {cam === "live" && (
        <>
          {/* action row */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={toggleRecord} style={{ background: recording ? "var(--surface-2)" : "var(--accent)", color: recording ? "var(--text)" : "#fff", border: recording ? "0.5px solid var(--border)" : "none", borderRadius: 10, padding: "10px 20px", fontSize: 14, fontWeight: 500, cursor: "pointer" }}>
              {recording ? "■ Stop recording" : "● Record"}
            </button>
            <button onClick={snapshot} style={ghost}>Snapshot PNG</button>
            <button onClick={stop} style={ghost}>Stop camera</button>
            {/* output quality */}
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 4 }}>
              <span className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)", marginRight: 2 }}>OUTPUT</span>
              {RES_OPTIONS.map((r) => {
                const active = s.outputRes === r.id;
                return (
                  <button key={r.id} onClick={() => set({ outputRes: r.id })} style={{
                    background: active ? "var(--accent-dim)" : "var(--surface)",
                    border: active ? "0.5px solid var(--accent)" : "0.5px solid var(--border)",
                    borderRadius: 8, padding: "6px 11px", fontSize: 12, cursor: "pointer",
                    color: active ? "var(--accent)" : "var(--text-muted)", fontWeight: active ? 500 : 400,
                  }}>{r.label}</button>
                );
              })}
            </div>
            <span style={{ flex: 1 }} />
            {recUrl && <a href={recUrl} download="webcam-recording.webm" style={{ background: "var(--surface-2)", color: "var(--text)", border: "0.5px solid var(--accent)", borderRadius: 10, padding: "10px 18px", fontSize: 14, fontWeight: 500, textDecoration: "none" }}>↓ Download recording</a>}
          </div>

          {/* effect modules */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            <Module title="Enhance" hint="low-light · denoise · sharpen" on={s.enhanceOn} onToggle={() => set({ enhanceOn: !s.enhanceOn })}>
              <Slider label="Brightness" min={0.7} max={1.6} step={0.02} value={s.exposure} onChange={(v) => set({ exposure: v })} />
              <Slider label="Lift shadows" min={0} max={1} step={0.02} value={s.shadow} onChange={(v) => set({ shadow: v })} />
              <Slider label="Clean (temporal)" min={0} max={0.9} step={0.02} value={s.temporal} onChange={(v) => set({ temporal: v })} />
              <Slider label="Denoise (spatial)" min={0} max={1} step={0.02} value={s.denoise} onChange={(v) => set({ denoise: v })} />
              <Slider label="Sharpen" min={0} max={1.5} step={0.02} value={s.sharpen} onChange={(v) => set({ sharpen: v })} />
              <Slider label="Clarity" min={0} max={1} step={0.02} value={s.clarity} onChange={(v) => set({ clarity: v })} />
              <Toggle label="Auto white balance" on={s.autoWB} onToggle={() => set({ autoWB: !s.autoWB })} />
              {!s.autoWB && <Slider label="Warmth" min={-1} max={1} step={0.05} value={s.warmth} onChange={(v) => set({ warmth: v })} />}
            </Module>

            <Module title="Beautify" hint="skin · lighting · eyes" on={s.beautifyOn} onToggle={() => set({ beautifyOn: !s.beautifyOn })}>
              <Slider label="Smooth skin" min={0} max={1} step={0.02} value={s.smooth} onChange={(v) => set({ smooth: v })} />
              <Slider label="Even lighting" min={0} max={1} step={0.02} value={s.even} onChange={(v) => set({ even: v })} />
              <Slider label="Brighten eyes" min={0} max={1} step={0.02} value={s.eye} onChange={(v) => set({ eye: v })} />
              <p className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)", marginTop: 2 }}>needs a visible face · masked to skin only</p>
            </Module>

            <Module title="Auto-frame" hint="keeps you centered" on={s.autoFrame} onToggle={() => set({ autoFrame: !s.autoFrame })}>
              <p style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.5 }}>Tracks your face and smoothly pans + zooms to keep you centered — like Center Stage, on any camera.</p>
              <Toggle label="Mirror (selfie view)" on={s.mirror} onToggle={() => set({ mirror: !s.mirror })} />
            </Module>
          </div>

          <p className="mono" style={{ fontSize: 11, color: "var(--text-dim)", lineHeight: 1.7 }}>
            Record the enhanced feed, or pipe it into <span style={{ color: "var(--text-muted)" }}>OBS → Browser Source → Virtual Camera</span> to use it in Zoom/Meet/Teams.
            Browsers can&apos;t register a virtual camera on their own, so this can&apos;t feed a call directly.
          </p>
        </>
      )}
    </div>
  );
}

function Module({ title, hint, on, onToggle, children }: { title: string; hint: string; on: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div style={{ background: "var(--surface)", border: on ? "0.5px solid var(--accent-border)" : "0.5px solid var(--border)", borderRadius: 14, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div>
          <p style={{ fontSize: 14.5, fontWeight: 500, color: on ? "var(--text)" : "var(--text-muted)" }}>{title}</p>
          <p className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)" }}>{hint}</p>
        </div>
        <Switch on={on} onToggle={onToggle} />
      </div>
      {on && <div style={{ display: "flex", flexDirection: "column", gap: 9, paddingTop: 2 }}>{children}</div>}
    </div>
  );
}

function Switch({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button onClick={onToggle} aria-pressed={on} style={{ width: 40, height: 23, borderRadius: 999, border: "none", cursor: "pointer", background: on ? "var(--accent)" : "var(--surface-2)", position: "relative", transition: "background 0.18s", flexShrink: 0 }}>
      <span style={{ position: "absolute", top: 2.5, left: on ? 20 : 2.5, width: 18, height: 18, borderRadius: "50%", background: "#fff", transition: "left 0.18s" }} />
    </button>
  );
}

function Toggle({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <span style={{ fontSize: 12.5, color: "var(--text-muted)" }}>{label}</span>
      <Switch on={on} onToggle={onToggle} />
    </div>
  );
}

function Slider({ label, min, max, step, value, onChange }: { label: string; min: number; max: number; step: number; value: number; onChange: (v: number) => void }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <span style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--text-muted)" }}>
        <span>{label}</span>
        <span className="mono" style={{ color: "var(--text-dim)" }}>{value.toFixed(2)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--accent)" }} />
    </label>
  );
}

const ghost: React.CSSProperties = {
  fontSize: 13.5, color: "var(--text-muted)", background: "transparent",
  border: "0.5px solid var(--border)", borderRadius: 10, padding: "10px 16px", cursor: "pointer",
};
