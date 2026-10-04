"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import ModelLoader from "@/components/ModelLoader";
import { titleProgress, titleDone } from "@/lib/bgYield";
import {
  Meter, STRENGTHS, mixFor, mixChannel, encodeWav, SAMPLE_RATE, DENOISE_MODEL_SIZE, type StrengthId,
} from "@/lib/denoise";
import { decodeMedia, runDenoise, remuxVideo, videoOutExt, CancelledError, type DecodedMedia, type DenoiseJob } from "@/lib/denoiseClient";
import { ABPlayer, type ABMode } from "./abPlayer";
import Waveform from "./Waveform";

type Phase = "decoding" | "download" | "processing" | "done" | "error";
type Remux =
  | { state: "idle" }
  | { state: "engine" }
  | { state: "mux"; pct: number }
  | { state: "done"; url: string; name: string; size: number }
  | { state: "error"; msg: string };

function fmtT(t: number) {
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtSize(b: number) {
  if (b > 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b > 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(b / 1e3))} KB`;
}

/** `url` is an object URL for `file`, owned (and revoked) by the page. */
export default function NoiseStudio({ file, url, onReset }: { file: File; url: string; onReset: () => void }) {
  const isVideo = file.type.startsWith("video/");
  const base = file.name.replace(/\.[^.]+$/, "");
  const [phase, setPhase] = useState<Phase>("decoding");
  const [errMsg, setErrMsg] = useState("");
  const [dlPct, setDlPct] = useState(0);
  const [pct, setPct] = useState(0);
  const [media, setMedia] = useState<DecodedMedia | null>(null);
  const [meter, setMeter] = useState<Meter | null>(null);
  const [version, setVersion] = useState(0);
  const [player, setPlayer] = useState<ABPlayer | null>(null);
  const [playing, setPlaying] = useState(false);
  const [mode, setMode] = useState<ABMode>("after");
  const [strength, setStrength] = useState<StrengthId>("strong");
  const [took, setTook] = useState(0);
  const [remux, setRemux] = useState<Remux>({ state: "idle" });
  const clean = useRef<Float32Array[]>([]);
  const job = useRef<DenoiseJob | null>(null);
  const run = useRef(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);

  const lim = mixFor(STRENGTHS.find((s) => s.id === strength)!.db);
  const busy = phase === "decoding" || phase === "download" || phase === "processing";

  // no state is set before the first await: start() also runs from the mount effect
  async function start() {
    const id = ++run.current;
    const live = () => run.current === id;
    try {
      const m = await decodeMedia(file);
      if (!live()) return;
      const mt = new Meter(m.channels);
      clean.current = m.channels.map((c) => new Float32Array(c.length));
      setMedia(m); setMeter(mt); setVersion(0);
      setPhase("processing");
      let t0 = 0;
      const j = runDenoise(
        m.channels,
        (p) => {
          if (!live()) return;
          if (p.stage === "download") {
            if (p.loaded < p.total) setPhase("download");
            setDlPct(p.total ? (p.loaded / p.total) * 100 : -1);
          } else {
            if (!t0) t0 = performance.now();
            setPhase("processing");
            const v = p.total ? (p.done / p.total) * 100 : 0;
            setPct(v);
            titleProgress("Removing noise", v);
          }
        },
        (ch, offset, samples) => {
          if (!live()) return;
          clean.current[ch].set(samples, offset);
          mt.add(ch, offset, samples);
          setVersion((v) => v + 1);
        },
      );
      job.current = j;
      await j.promise;
      if (!live()) return;
      setTook((performance.now() - t0) / 1000);
      const p = new ABPlayer(m.channels, clean.current, SAMPLE_RATE);
      p.onState = setPlaying;
      setPlayer(p);
      setPct(100);
      setPhase("done");
      titleDone("Noise removed");
    } catch (e) {
      if (!live() || e instanceof CancelledError) return;
      console.error(e);
      setErrMsg(e instanceof Error ? e.message : "Something went wrong");
      setPhase("error");
      titleProgress(null);
    } finally {
      if (live()) job.current = null;
    }
  }

  function retry() {
    setPhase("decoding"); setErrMsg(""); setPct(0); setDlPct(0);
    void start();
  }

  function stop() {
    run.current++;
    job.current?.cancel();
    job.current = null;
    titleProgress(null);
  }

  // auto-start on mount; StrictMode's mount→unmount→mount is absorbed by run ids
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start() only sets state after its first await
    void start();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  useEffect(() => () => { player?.dispose(); }, [player]);
  const remuxUrl = remux.state === "done" ? remux.url : null;
  useEffect(() => () => { if (remuxUrl) URL.revokeObjectURL(remuxUrl); }, [remuxUrl]);

  useEffect(() => { player?.setMix(mode, lim); }, [player, mode, lim]);
  useEffect(() => { player?.attachVideo(videoRef.current); }, [player]);
  useEffect(() => {
    if (!player) return;
    return player.subscribe((t) => {
      if (timeRef.current) timeRef.current.textContent = fmtT(t);
    });
  }, [player]);

  // Space = play/pause, unless a control has focus
  useEffect(() => {
    if (!player) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.code !== "Space" || el.closest("button, input, select, textarea, a")) return;
      e.preventDefault();
      player.toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [player]);

  function cancel() {
    stop();
    onReset();
  }

  function mixed(): Float32Array[] {
    if (!media) return [];
    return lim === 0 ? clean.current : clean.current.map((c, i) => mixChannel(media.channels[i], c, lim));
  }

  function downloadWav() {
    const blob = encodeWav(mixed(), SAMPLE_RATE);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${base}-clean.wav`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  }

  async function buildVideo() {
    if (remux.state === "engine" || remux.state === "mux") return;
    if (remux.state === "done") URL.revokeObjectURL(remux.url);
    setRemux({ state: "engine" });
    try {
      const { blob, ext } = await remuxVideo(file, mixed(), (p) =>
        setRemux(p.step === "engine" ? { state: "engine" } : { state: "mux", pct: p.pct }));
      setRemux({ state: "done", url: URL.createObjectURL(blob), name: `${base}-clean.${ext}`, size: blob.size });
    } catch (e) {
      console.error(e);
      setRemux({ state: "error", msg: e instanceof Error ? e.message : "Couldn't build the video" });
    }
  }

  const floor = useMemo(
    () => (meter && phase === "done" ? meter.noiseFloor(lim) : null),
    [meter, phase, lim],
  );
  const duration = media?.duration ?? 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: "1 1 200px" }}>
          {file.name}
          {media && <span className="mono" style={{ color: "var(--text-dim)" }}> · {fmtT(duration)} · {media.layout === "stereo" ? "stereo" : "mono"}</span>}
        </p>
        {!busy && <button onClick={onReset} style={ghost}>← New file</button>}
      </div>

      <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
        {isVideo && (
          <video
            ref={videoRef}
            src={`${url}#t=0.001`}
            muted
            playsInline
            preload="auto"
            onClick={() => player?.toggle()}
            style={{ display: "block", width: "100%", maxHeight: 380, background: "#000", objectFit: "contain", cursor: player ? "pointer" : "default" }}
          />
        )}

        {phase === "download" ? (
          <ModelLoader pct={dlPct} title="The noise remover is waking up" sub={`DeepFilterNet3 · ${DENOISE_MODEL_SIZE} · downloads once, cached forever`} />
        ) : phase === "error" ? (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, minHeight: 200, padding: 24, textAlign: "center" }}>
            <p style={{ color: "#ef4444", fontSize: 14, maxWidth: 460, lineHeight: 1.5 }}>{errMsg}</p>
            <div style={{ display: "flex", gap: 10 }}>
              <button onClick={retry} style={primary}>Try again</button>
              <button onClick={onReset} style={secondary}>Choose another file</button>
            </div>
          </div>
        ) : (
          <div style={{ padding: "18px 18px 14px" }}>
            {meter && media ? (
              <Waveform
                meter={meter}
                version={version}
                lim={lim}
                mode={mode}
                processing={phase !== "done"}
                totalSamples={media.channels[0].length}
                player={player}
              />
            ) : (
              <div style={{ height: 128, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <span className="mono" style={{ fontSize: 12, color: "var(--text-muted)" }}>Reading audio…</span>
              </div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 14, minHeight: 44, flexWrap: "wrap" }}>
              {phase === "done" && player ? (
                <>
                  <button onClick={() => player.toggle()} aria-label={playing ? "Pause" : "Play"} style={playBtn}>
                    {playing ? (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden><rect x="3" y="2" width="3.6" height="12" rx="1" /><rect x="9.4" y="2" width="3.6" height="12" rx="1" /></svg>
                    ) : (
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden><path d="M4.5 2.6v10.8a.8.8 0 0 0 1.2.7l8.6-5.4a.8.8 0 0 0 0-1.4L5.7 1.9a.8.8 0 0 0-1.2.7Z" /></svg>
                    )}
                  </button>
                  <span className="mono" style={{ fontSize: 12.5, color: "var(--text-muted)", whiteSpace: "nowrap" }}>
                    <span ref={timeRef} style={{ color: "var(--text)" }}>0:00</span> / {fmtT(duration)}
                  </span>
                  <div role="group" aria-label="Compare" className="nr-ab" style={{ display: "flex", background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 999, padding: 3 }}>
                    {(["before", "after"] as const).map((m) => (
                      <button key={m} onClick={() => setMode(m)} aria-pressed={mode === m} style={{
                        border: "none", borderRadius: 999, padding: "8px 16px", fontSize: 13, fontWeight: 500, cursor: "pointer",
                        background: mode === m ? (m === "after" ? "var(--accent)" : "var(--text)") : "transparent",
                        color: mode === m ? "var(--on-accent)" : "var(--text-muted)",
                        transition: "background 0.2s var(--ease-lux), color 0.2s var(--ease-lux)",
                      }}>
                        {m === "before" ? "Original" : "Cleaned"}
                      </button>
                    ))}
                  </div>
                  {/* phones: the A/B switch drops to its own full-width row instead of floating alone */}
                  <style>{`.nr-ab{margin-left:auto}@media (max-width:480px){.nr-ab{flex:1 1 100%;margin-left:0}.nr-ab>button{flex:1}}`}</style>
                </>
              ) : (
                <>
                  <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", animation: "pulse 1s ease-in-out infinite", flexShrink: 0 }} />
                  <span style={{ fontSize: 13.5, color: "var(--text)", flex: 1, minWidth: 0 }}>
                    {phase === "decoding" ? "Reading audio…" : (
                      <>Removing noise <span className="mono" style={{ color: "var(--accent)" }}>{Math.round(pct)}%</span>
                        {duration > 0 && <span className="mono" style={{ color: "var(--text-muted)" }}> · {fmtT((pct / 100) * duration)} / {fmtT(duration)}</span>}
                      </>
                    )}
                  </span>
                  <button onClick={cancel} style={ghost}>Cancel</button>
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {phase === "done" && (
        <>
          <div>
            <p className="mono" style={label}>Strength</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8 }}>
              {STRENGTHS.map((s) => {
                const active = strength === s.id;
                return (
                  <button key={s.id} onClick={() => { setStrength(s.id); setMode("after"); }} aria-pressed={active} style={{
                    background: active ? "var(--accent-dim)" : "var(--surface)",
                    border: active ? "0.5px solid var(--accent)" : "0.5px solid var(--border)",
                    borderRadius: 12, padding: "11px 10px", cursor: "pointer", textAlign: "left", minWidth: 0,
                    display: "flex", flexDirection: "column", justifyContent: "flex-start",
                    transition: "border-color 0.2s var(--ease-lux), background 0.2s var(--ease-lux)",
                  }}>
                    <span style={{ display: "block", fontSize: 13.5, fontWeight: 500, color: active ? "var(--accent)" : "var(--text)" }}>{s.label}</span>
                    <span style={{ display: "block", fontSize: 11, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.35 }}>{s.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {floor && (
              <span style={chip}>
                Noise floor <span style={{ color: "var(--text-muted)" }}>{Math.round(floor.before)} dB</span> → <span style={{ color: "var(--green)" }}>{Math.round(floor.after)} dB</span>
              </span>
            )}
            {took > 0 && (
              <span style={chip}>
                {fmtT(duration)} cleaned in {took < 10 ? took.toFixed(1) : Math.round(took)}s
                <span style={{ color: "var(--text-muted)" }}> · {Math.max(1, Math.round(duration / took))}× real-time</span>
              </span>
            )}
            <span style={chip}>On your device · nothing uploaded</span>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={downloadWav} style={primary}>↓ Clean audio <span style={sub}>· WAV</span></button>
            {isVideo && remux.state !== "done" && (
              <button onClick={() => void buildVideo()} disabled={remux.state === "engine" || remux.state === "mux"} style={{ ...secondary, opacity: remux.state === "engine" || remux.state === "mux" ? 0.7 : 1 }}>
                {remux.state === "engine" ? "Loading video engine…" : remux.state === "mux" ? `Building video… ${remux.pct}%` : <>Video with clean audio <span style={sub}>· {videoOutExt(file).toUpperCase()}</span></>}
              </button>
            )}
            {remux.state === "done" && (
              <a href={remux.url} download={remux.name} style={{ ...primary, textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 6 }}>
                ↓ Save video <span style={sub}>· {fmtSize(remux.size)}</span>
              </a>
            )}
          </div>
          {remux.state === "engine" && (
            <p className="mono" style={{ fontSize: 11.5, color: "var(--text-muted)", marginTop: -4 }}>First time only: ~31MB video engine, cached after. Your video stream is copied, not re-encoded.</p>
          )}
          {remux.state === "error" && <p style={{ fontSize: 13, color: "#ef4444", marginTop: -4 }}>{remux.msg}</p>}
          {strength !== "max" && remux.state === "done" && (
            <p style={{ fontSize: 12, color: "var(--text-dim)", marginTop: -4 }}>Changed the strength? Build the video again to use it.</p>
          )}
        </>
      )}

      <p style={{ fontSize: 12.5, color: "var(--text-muted)", lineHeight: 1.6 }}>
        Removes steady background sound: fans, AC, traffic, hiss, mains hum, background music.
        It can&apos;t pull one voice out of a crowd. Other people talking stays in.
      </p>
    </div>
  );
}

const label: React.CSSProperties = {
  fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 8,
};
const ghost: React.CSSProperties = {
  fontSize: 13, color: "var(--text-muted)", background: "transparent",
  border: "0.5px solid var(--border)", borderRadius: 8, padding: "7px 14px", cursor: "pointer", flexShrink: 0,
};
const primary: React.CSSProperties = {
  background: "var(--accent)", color: "var(--on-accent)", border: "none", borderRadius: 10,
  padding: "11px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer",
};
const secondary: React.CSSProperties = {
  background: "var(--surface-2)", color: "var(--text)", border: "0.5px solid var(--border)",
  borderRadius: 10, padding: "11px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer",
};
const sub: React.CSSProperties = { fontSize: 11, opacity: 0.6, fontWeight: 400 };
const chip: React.CSSProperties = {
  fontSize: 12, color: "var(--text)", background: "var(--surface)", border: "0.5px solid var(--border)",
  borderRadius: 999, padding: "6px 12px", whiteSpace: "nowrap",
};
const playBtn: React.CSSProperties = {
  width: 44, height: 44, borderRadius: "50%", border: "none", background: "var(--accent)", color: "var(--on-accent)",
  display: "inline-flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
};
