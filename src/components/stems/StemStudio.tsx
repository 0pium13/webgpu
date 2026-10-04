"use client";

import { useEffect, useRef, useState } from "react";
import ModelLoader from "@/components/ModelLoader";
import { SparkleIcon } from "@/components/Icons";
import { titleProgress, titleDone } from "@/lib/bgYield";
import { MODE_TRACKS, MODEL_SIZE, SAMPLE_RATE, type StemMode, type StemDevice } from "@/lib/stems";
import { separateStems, type StemJob } from "@/lib/stemsClient";
import { probeDuration, decodeToStereo, accumulateLevels, encodeWavStereo, zipFiles, saveBlob } from "@/lib/stemsAudio";
import StemMixer, { STEM_UI, fmtTime, type StemTrack } from "./StemMixer";
import Waveform from "./Waveform";

const LEVEL_BINS = 1200;
const WARN_SEC = 10 * 60;
const MAX_SEC = 20 * 60;

type Phase = "reading" | "ready" | "loading" | "separating" | "done" | "error";

const MODES: { id: StemMode; title: string; sub: string }[] = [
  { id: "karaoke", title: "Remove vocals", sub: "Karaoke instrumental + clean vocals" },
  { id: "four", title: "4 stems", sub: "Vocals · drums · bass · other" },
];

const LOADER_FACTS = [
  "HTDemucs by Meta AI Research — the model the pros benchmark against",
  "Downloads once, cached forever. Next song: instant",
  "Your song never leaves this tab — no upload, no server",
  "Hybrid model: it listens to the waveform and the spectrogram at once",
];

export default function StemStudio({ file, gpuOk, onReset }: { file: File; gpuOk: boolean; onReset: () => void }) {
  const [phase, setPhase] = useState<Phase>("reading");
  const [readMsg, setReadMsg] = useState("Reading audio…");
  const [errMsg, setErrMsg] = useState("");
  const [original, setOriginal] = useState<AudioBuffer | null>(null);
  const [origLevels, setOrigLevels] = useState<Float32Array | null>(null);
  const [norm, setNorm] = useState(1);
  const [mode, setMode] = useState<StemMode>("karaoke");
  const [tracks, setTracks] = useState<StemTrack[]>([]);
  const [loadPct, setLoadPct] = useState(-1);
  const [seg, setSeg] = useState({ done: 0, total: 0 });
  const [filled, setFilled] = useState(0);
  const [eta, setEta] = useState<number | null>(null);
  const [device, setDevice] = useState<StemDevice | null>(null);
  const [stat, setStat] = useState<{ secs: number; device: StemDevice } | null>(null);
  const [zipPct, setZipPct] = useState<number | null>(null);
  const job = useRef<StemJob | null>(null);
  const baseName = file.name.replace(/\.[^.]+$/, "") || "song";

  // decode once per file
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const dur = await probeDuration(file);
        if (dur && dur > MAX_SEC) throw new Error(`This file is ${fmtTime(dur)} long. Trim it under 20 minutes — longer audio can run your browser out of memory.`);
        const buf = await decodeToStereo(file, () => alive && setReadMsg("Extracting audio with ffmpeg…"));
        if (!alive) return;
        if (buf.duration > MAX_SEC) throw new Error(`This file is ${fmtTime(buf.duration)} long. Trim it under 20 minutes — longer audio can run your browser out of memory.`);
        const levels = new Float32Array(LEVEL_BINS);
        accumulateLevels(levels, buf.length, buf.getChannelData(0), buf.getChannelData(1), 0);
        let max = 0;
        for (const p of levels) if (p > max) max = p;
        setOriginal(buf);
        setOrigLevels(levels);
        setNorm(max || 1);
        setPhase("ready");
      } catch (e) {
        if (!alive) return;
        console.error(e);
        const m = e instanceof Error ? e.message : "";
        setErrMsg(/long|audio track|no audio/i.test(m) ? m : "Couldn't read audio from this file. Try an MP3, WAV, M4A or MP4.");
        setPhase("error");
      }
    })();
    return () => { alive = false; job.current?.cancel(); };
  }, [file]);

  async function start(m: StemMode) {
    if (!original) return;
    setMode(m);
    const total = original.length;
    const ts: StemTrack[] = MODE_TRACKS[m].map((t) => ({
      id: t.id,
      buffer: new AudioBuffer({ numberOfChannels: 2, length: total, sampleRate: SAMPLE_RATE }),
      levels: new Float32Array(LEVEL_BINS),
    }));
    setTracks(ts);
    setFilled(0);
    setSeg({ done: 0, total: 0 });
    setEta(null);
    setStat(null);
    setLoadPct(-1);
    setPhase("loading");

    let readyAt = 0;
    const segTimes: number[] = [];
    const j = separateStems(original.getChannelData(0), original.getChannelData(1), m, {
      onLoad: (loaded, t) => setLoadPct((loaded / t) * 100),
      onReady: (d) => {
        setDevice(d);
        if (!readyAt) {
          readyAt = performance.now();
          segTimes.push(readyAt);
        }
        setPhase("separating");
      },
      onSegment: (done, n) => {
        segTimes.push(performance.now());
        setSeg({ done, total: n });
        // the first segment includes shader compilation — leave it out of the pace once we can
        const laps = segTimes.slice(1).map((t, i) => t - segTimes[i]);
        const pace = laps.length > 1 ? laps.slice(1).reduce((a, b) => a + b, 0) / (laps.length - 1) : laps[0];
        setEta(((n - done) * pace) / 1000);
        titleProgress("Separating", (done / n) * 100);
      },
      onChunk: (offset, channels) => {
        ts.forEach((t, i) => {
          const l = channels[2 * i], r = channels[2 * i + 1];
          t.buffer.copyToChannel(l, 0, offset);
          t.buffer.copyToChannel(r, 1, offset);
          accumulateLevels(t.levels, total, l, r, offset);
        });
        setFilled((offset + channels[0].length) / total);
      },
    });
    job.current = j;
    try {
      const r = await j.promise;
      if (job.current !== j) return;
      job.current = null;
      if (r === "cancelled") {
        setTracks([]);
        setPhase("ready");
        titleProgress(null);
        return;
      }
      setStat({ secs: (performance.now() - readyAt) / 1000, device: r.device });
      setFilled(1);
      setPhase("done");
      titleDone("Stems ready");
    } catch (e) {
      if (job.current !== j) return;
      job.current = null;
      console.error(e);
      setErrMsg(e instanceof Error ? e.message : "Separation failed");
      setPhase("error");
      titleProgress(null);
    }
  }

  function cancel() {
    job.current?.cancel();
  }

  async function downloadAll() {
    if (zipPct !== null) return;
    setZipPct(0);
    try {
      const files = tracks.map((t) => ({ name: `${baseName} - ${STEM_UI[t.id].label}.wav`, blob: encodeWavStereo(t.buffer) }));
      const zip = await zipFiles(files, (p) => setZipPct(p));
      saveBlob(zip, `${baseName} - stems.zip`);
    } finally {
      setZipPct(null);
    }
  }

  const busy = phase === "loading" || phase === "separating";
  const long = !!original && original.duration > WARN_SEC;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)", minWidth: 0, overflowWrap: "anywhere" }}>
          {file.name}
          {original && <span className="mono" style={{ color: "var(--text-dim)" }}> · {fmtTime(Math.round(original.duration))}</span>}
        </p>
        {!busy && <button onClick={onReset} style={ghost}>← New file</button>}
      </div>

      <div style={{ position: "relative", background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 16, padding: "20px clamp(14px, 3vw, 24px)", minHeight: 280 }}>
        {phase === "reading" && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10, minHeight: 240 }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", animation: "pulse 1s ease-in-out infinite" }} />
            <p style={{ fontSize: 13.5, color: "var(--text-muted)" }}>{readMsg}</p>
          </div>
        )}

        {phase === "ready" && original && origLevels && (
          <div style={{ display: "flex", flexDirection: "column", gap: 22, animation: "fadein 0.5s var(--ease-lux)" }}>
            <div>
              <p className="mono" style={label}>Your track</p>
              <Waveform levels={origLevels} norm={norm} color="#a9a294" height={64} />
            </div>

            <div>
              <p className="mono" style={label}>What do you need?</p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
                {MODES.map((o) => {
                  const active = mode === o.id;
                  return (
                    <button key={o.id} onClick={() => setMode(o.id)} aria-pressed={active} style={{
                      background: active ? "var(--accent-dim)" : "var(--surface-2)",
                      border: active ? "0.5px solid var(--accent)" : "0.5px solid var(--border)",
                      borderRadius: 12, padding: "14px 14px 13px", cursor: "pointer", textAlign: "left",
                      transition: "all 0.25s var(--ease-lux)",
                    }}>
                      <span style={{ display: "flex", gap: 5, marginBottom: 10 }}>
                        {MODE_TRACKS[o.id].map((t) => (
                          <span key={t.id} style={{ height: 4, flex: 1, maxWidth: 34, borderRadius: 4, background: STEM_UI[t.id].color, opacity: active ? 1 : 0.45 }} />
                        ))}
                      </span>
                      <span style={{ display: "block", fontSize: 14.5, fontWeight: 500, color: active ? "var(--accent)" : "var(--text)" }}>{o.title}</span>
                      <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)", marginTop: 3, lineHeight: 1.4 }}>{o.sub}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {long && (
              <p style={{ ...note, borderColor: "rgba(245,158,11,0.3)", background: "var(--amber-dim)" }}>
                Long track ({fmtTime(Math.round(original.duration))}). It works, but needs about {Math.round((original.duration * SAMPLE_RATE * 8 * (MODE_TRACKS[mode].length + 1)) / 1e9 * 10) / 10}GB of memory
                {mode === "four" ? " — Remove vocals uses less" : ""}. Under 10 minutes is the sweet spot.
              </p>
            )}
            {!gpuOk && (
              <p style={note}>
                No WebGPU here, so this runs on your CPU — expect roughly twice the song&apos;s length (a 4-minute song ≈ 7 minutes). Chrome or Edge on a laptop is about 10× faster.
              </p>
            )}

            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
              <button onClick={() => start(mode)} style={{
                background: "var(--accent)", color: "var(--on-accent)", border: "none", borderRadius: 12,
                padding: "14px 32px", fontSize: 16, fontWeight: 500, cursor: "pointer",
                display: "inline-flex", alignItems: "center", gap: 9, boxShadow: "0 10px 30px -12px rgba(228,192,120,0.55)",
              }}>
                <SparkleIcon size={17} /> {mode === "karaoke" ? "Remove vocals" : "Split into 4 stems"}
              </button>
              <p className="mono" style={{ fontSize: 11.5, color: "var(--text-muted)", textAlign: "center" }}>
                HTDemucs v4 · {MODEL_SIZE} once, then cached · {gpuOk ? "runs on your GPU" : "runs on your CPU"}
              </p>
            </div>
          </div>
        )}

        {phase === "loading" && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
            <div style={{ alignSelf: "stretch" }}>
              <ModelLoader
                pct={loadPct}
                title="HTDemucs is waking up"
                sub={`${MODEL_SIZE} · downloads once, cached forever`}
                facts={LOADER_FACTS}
              />
            </div>
            <button onClick={cancel} style={ghost}>Cancel</button>
          </div>
        )}

        {(phase === "separating" || phase === "done") && original && (
          <div style={{ animation: "fadein 0.5s var(--ease-lux)" }}>
            {phase === "separating" && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", animation: "pulse 1s ease-in-out infinite", flexShrink: 0 }} />
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <p style={{ fontSize: 13.5, color: "var(--text)" }}>
                    {seg.done === 0 ? `Warming up the ${device === "wasm" ? "CPU" : "GPU"}…` : `Separating · part ${seg.done} of ${seg.total}`}
                    {eta !== null && seg.done < seg.total && <span className="mono" style={{ color: "var(--text-muted)" }}> · ≈ {fmtTime(Math.max(1, eta))} left</span>}
                  </p>
                  <div style={{ height: 3, background: "var(--surface-2)", borderRadius: 3, overflow: "hidden", marginTop: 8 }}>
                    <div style={{ height: "100%", width: `${Math.max(2, filled * 100)}%`, background: "var(--accent)", transition: "width 0.6s var(--ease-lux)" }} />
                  </div>
                </div>
                <button onClick={cancel} style={ghost}>Cancel</button>
              </div>
            )}

            <StemMixer
              tracks={tracks}
              original={original}
              norm={norm}
              filled={filled}
              live={phase === "separating"}
              baseName={baseName}
            />
          </div>
        )}

        {phase === "error" && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, minHeight: 240, textAlign: "center" }}>
            <p style={{ color: "#ef4444", fontSize: 14, maxWidth: 460, lineHeight: 1.55 }}>{errMsg}</p>
            {original ? (
              <button onClick={() => setPhase("ready")} style={primary}>Try again</button>
            ) : (
              <button onClick={onReset} style={primary}>Choose another file</button>
            )}
          </div>
        )}
      </div>

      {phase === "done" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, animation: "fadein 0.5s var(--ease-lux)" }}>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
            <button onClick={downloadAll} style={primary}>
              {zipPct !== null ? `Zipping… ${Math.round(zipPct)}%` : <>↓ Download all <span style={sub}>· {tracks.length} WAVs, .zip</span></>}
            </button>
            {mode === "karaoke" ? (
              <button onClick={() => start("four")} style={secondary}>Split into 4 stems instead</button>
            ) : (
              <button onClick={() => start("karaoke")} style={secondary}>Just vocals + instrumental</button>
            )}
          </div>
          {stat && (
            <p className="mono" style={{ fontSize: 11.5, color: "var(--text-muted)" }}>
              {fmtTime(Math.round(original!.duration))} separated in {stat.secs.toFixed(1)}s · {(original!.duration / stat.secs).toFixed(1)}× real-time · {stat.device === "webgpu" ? "WebGPU" : "CPU (wasm)"}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

const label: React.CSSProperties = {
  fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-dim)", marginBottom: 10,
};
const note: React.CSSProperties = {
  fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.55, padding: "10px 14px",
  border: "0.5px solid var(--border)", borderRadius: 10, background: "var(--surface-2)",
};
const ghost: React.CSSProperties = {
  fontSize: 13, color: "var(--text-muted)", background: "transparent",
  border: "0.5px solid var(--border)", borderRadius: 8, padding: "7px 14px", cursor: "pointer",
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
