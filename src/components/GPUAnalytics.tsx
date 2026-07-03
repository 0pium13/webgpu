"use client";

import { useEffect, useRef, useState } from "react";
import {
  generateReport,
  funComparisons,
  TIER_LABEL,
  TIER_COLOR,
  type DeviceReport,
  type Phase,
} from "@/lib/deviceReport";
import { HourglassIcon, UsersIcon, ChatIcon, MediaIcon, GamepadIcon } from "@/components/Icons";

const PHASE_TEXT: Record<Phase, string> = {
  detect: "Detecting hardware",
  benchmark: "Running compute benchmark",
  analyze: "Analyzing results",
  done: "Complete",
};

export default function GPUAnalytics() {
  const [report, setReport] = useState<DeviceReport | null>(null);
  const [phase, setPhase] = useState<Phase>("detect");
  const [score, setScore] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const started = useRef(false);

  // run the real benchmark once
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    generateReport((p) => setPhase(p)).then((r) => {
      setReport(r);
      // count-up the score with ease-out
      const target = r.score;
      if (target <= 0) { setScore(0); return; }
      const dur = 1400;
      const t0 = performance.now();
      const tick = (now: number) => {
        const t = Math.min(1, (now - t0) / dur);
        const eased = 1 - Math.pow(1 - t, 3);
        setScore(Math.round(target * eased));
        if (t < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, []);

  const done = !!report;

  return (
    <div style={{ width: "100%", maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ===== Main report card ===== */}
      <div
        className="ring-lux"
        style={{
          position: "relative",
          background: "linear-gradient(180deg, rgba(255,255,255,0.02), transparent 40%), var(--surface)",
          borderRadius: 18,
          padding: 32,
          overflow: "hidden",
          minHeight: 220,
          boxShadow: "0 30px 80px -40px rgba(99,102,241,0.28)",
        }}
      >
        {!done ? (
          /* ---- benchmarking state ---- */
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 20, padding: "28px 0" }}>
            <div className="scan-line" />
            {/* CSS-only loading bars — no React re-renders, so the benchmark
                timing stays accurate */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 44 }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 6,
                    height: "100%",
                    borderRadius: 3,
                    background: "var(--accent)",
                    transformOrigin: "bottom",
                    animation: `eq 1s ease-in-out ${i * 0.12}s infinite`,
                  }}
                />
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--accent)", animation: "pulse 1s ease-in-out infinite" }} />
              <span style={{ fontSize: 14, color: "var(--text-secondary)" }}>{PHASE_TEXT[phase]}…</span>
            </div>
            <PhaseSteps phase={phase} />
          </div>
        ) : (
          /* ---- result state ---- */
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 28 }}>
              <div>
                <p style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 8 }}>
                  Your GPU
                </p>
                <p className="mono" style={{ fontSize: 22, fontWeight: 500, letterSpacing: "-0.01em" }}>
                  {report.gpu}
                </p>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                  {report.architecture} · {report.os} · {report.browser}
                </p>
              </div>
              <span className="pill" style={{
                background: report.supported ? "rgba(34,197,94,0.1)" : "rgba(245,158,11,0.1)",
                color: report.supported ? "var(--green)" : "var(--amber)",
                flexShrink: 0,
              }}>
                {report.supported ? "● WebGPU live" : "○ no WebGPU"}
              </span>
            </div>

            {/* hero score */}
            <div style={{ display: "flex", alignItems: "flex-end", gap: 24, flexWrap: "wrap" }}>
              <div>
                <span className="mono" style={{ fontSize: 72, fontWeight: 500, lineHeight: 1, letterSpacing: "-0.03em", color: TIER_COLOR[report.tier], fontVariantNumeric: "tabular-nums" }}>
                  {score.toLocaleString()}
                </span>
                <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  GPU score · measured GFLOPS
                </p>
              </div>
              <div style={{ display: "flex", gap: 10, marginBottom: 6 }}>
                <Chip label="Tier" value={TIER_LABEL[report.tier]} color={TIER_COLOR[report.tier]} />
                <Chip label="Rank" value={`top ${report.percentile}%`} color="var(--accent)" />
              </div>
            </div>
          </>
        )}
      </div>

      {/* ===== everything else is optional reading, collapsed by default ===== */}
      {done && (
        <>
          <button
            onClick={() => setShowDetails((v) => !v)}
            aria-expanded={showDetails}
            className="group mx-auto flex cursor-pointer items-center gap-2 rounded-full border border-line bg-transparent px-4.5 py-2 text-[13px] text-muted-fg transition-colors duration-200 hover:border-line-strong hover:text-fg"
          >
            Device details
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              className="transition-transform duration-500 ease-[var(--ease-lux)]"
              style={{ transform: showDetails ? "rotate(180deg)" : "rotate(0deg)" }}
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          <div className={`reveal-rows ${showDetails ? "open" : ""}`}>
            <div>
              <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingTop: 2, paddingBottom: 2 }}>
                <DeviceGrid report={report} />
                <PercentileBar report={report} />
                <Capabilities report={report} />
                <Comparisons report={report} />
                <ShareCard report={report} />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function PhaseSteps({ phase }: { phase: Phase }) {
  const order: Phase[] = ["detect", "benchmark", "analyze"];
  const idx = order.indexOf(phase);
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
      {order.map((p, i) => (
        <span key={p} style={{
          width: 28, height: 3, borderRadius: 2,
          background: i <= idx ? "var(--accent)" : "var(--surface-2)",
          transition: "background 0.4s",
        }} />
      ))}
    </div>
  );
}

function Chip({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ background: "var(--surface-2)", border: "0.5px solid var(--border)", borderRadius: 10, padding: "8px 14px", animation: "fadein 0.5s ease-out 0.3s both" }}>
      <p style={{ fontSize: 10, color: "var(--text-muted)", letterSpacing: "0.06em", textTransform: "uppercase", marginBottom: 3 }}>{label}</p>
      <p style={{ fontSize: 15, fontWeight: 500, color }}>{value}</p>
    </div>
  );
}

function DeviceGrid({ report }: { report: DeviceReport }) {
  const items = [
    { icon: "ti-cpu", label: "GPU", value: report.gpu },
    { icon: "ti-stack-2", label: "Architecture", value: report.architecture },
    { icon: "ti-cpu-2", label: "CPU cores", value: `${report.cpuCores || "—"}` },
    { icon: "ti-database", label: "Memory", value: report.ramGb ? `${report.ramGb} GB` : "—" },
    { icon: "ti-device-desktop", label: "Display", value: report.screen },
    { icon: "ti-refresh", label: "Refresh", value: `${report.refreshHz} Hz` },
  ];
  return (
    <div className="stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 10 }}>
      {items.map((it) => (
        <div key={it.label} style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "16px 18px" }}>
          <p style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.05em", textTransform: "uppercase", marginBottom: 8 }}>{it.label}</p>
          <p className="mono" style={{ fontSize: 14, fontWeight: 500, lineHeight: 1.3, wordBreak: "break-word" }}>{it.value}</p>
        </div>
      ))}
    </div>
  );
}

function PercentileBar({ report }: { report: DeviceReport }) {
  const beat = 100 - report.percentile;
  const color = TIER_COLOR[report.tier];
  // rAF-driven fill so the % label counts up in perfect sync with the bar
  const [p, setP] = useState(0);
  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    const dur = 1700;
    const ease = (t: number) => 1 - Math.pow(1 - t, 4);
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / dur);
      setP(beat * ease(k));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [beat]);

  const ticks = [25, 50, 75];
  // ember fountain: each spark rises off the marker with its own drift/tempo
  const sparks = [
    { dx: -10, delay: 0.0, dur: 1.3, size: 3, c: "#f472b6" },
    { dx: 7,   delay: 0.35, dur: 1.1, size: 2.5, c: "#c084fc" },
    { dx: -4,  delay: 0.6, dur: 1.5, size: 2, c: "#ffffff" },
    { dx: 12,  delay: 0.85, dur: 1.2, size: 3, c: "#818cf8" },
    { dx: 2,   delay: 1.1, dur: 1.4, size: 2, c: "#f472b6" },
    { dx: -13, delay: 1.4, dur: 1.15, size: 2.5, c: "#34d399" },
    { dx: 5,   delay: 1.65, dur: 1.3, size: 2, c: "#ffffff" },
  ];

  return (
    <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "22px 24px 20px" }}>
      <p style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 22 }}>
        Where your GPU lands
      </p>

      <div style={{ position: "relative", height: 9, borderRadius: 6, marginBottom: 16 }}>
        {/* ghost of the full spectrum — the road ahead */}
        <div className="grad-spectrum" style={{ position: "absolute", inset: 0, borderRadius: 6, opacity: 0.14 }} />

        {/* vivid spectrum fill, revealed by clip as the score sweeps up */}
        <div style={{ position: "absolute", inset: 0, width: `${p}%`, borderRadius: 6, overflow: "hidden" }}>
          <div className="grad-spectrum" style={{
            position: "absolute", top: 0, bottom: 0, left: 0,
            width: p > 0 ? `${100 / (p / 100)}%` : "100%",
            boxShadow: "0 0 18px rgba(129,140,248,0.35)",
          }} />
          <span style={{
            position: "absolute", top: 0, bottom: 0, width: 60,
            background: "linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)",
            animation: "sheen 2.4s cubic-bezier(0.4,0,0.2,1) infinite",
          }} />
        </div>

        {/* milestone ticks that ignite as the fill passes them */}
        {ticks.map((t) => (
          <span key={t} style={{
            position: "absolute", left: `${t}%`, top: "50%",
            width: 4, height: 4, borderRadius: "50%",
            transform: "translate(-50%,-50%)",
            background: p >= t ? "#fff" : "var(--border-strong)",
            boxShadow: p >= t ? "0 0 10px rgba(192,132,252,0.9)" : "none",
            transition: "background 0.3s, box-shadow 0.3s",
          }} />
        ))}

        {/* marker: white-hot orb, breathing glow, radar ripple, ember fountain */}
        <div style={{ position: "absolute", left: `${p}%`, top: "50%", transform: "translate(-50%,-50%)" }}>
          {sparks.map((s, i) => (
            <span key={i} style={{
              position: "absolute", left: "50%", top: -3,
              width: s.size, height: s.size, borderRadius: "50%",
              background: s.c, boxShadow: `0 0 6px ${s.c}`,
              animation: `spark ${s.dur}s ease-out ${s.delay}s infinite`,
              ["--dx" as string]: `${s.dx}px`,
            }} />
          ))}
          <span style={{
            position: "absolute", left: "50%", top: "50%",
            width: 15, height: 15, borderRadius: "50%",
            border: "1.5px solid #c084fc",
            animation: "ripple 2.2s ease-out infinite",
          }} />
          <span style={{
            position: "relative", display: "block",
            width: 16, height: 16, borderRadius: "50%",
            background: "radial-gradient(circle at 40% 35%, #fff, #c7d2fe 55%, #818cf8)",
            border: "2.5px solid var(--canvas)",
            animation: "breathe 2.2s ease-in-out infinite",
            ["--glow" as string]: "rgba(165,180,252,0.75)",
          }} />
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)", letterSpacing: "0.14em", textTransform: "uppercase" }}>Entry</span>
        <span className="text-spectrum" style={{
          fontSize: 17, fontWeight: 650, letterSpacing: "-0.02em",
          fontVariantNumeric: "tabular-nums", textAlign: "center",
        }}>
          Faster than {Math.round(p)}% of devices
        </span>
        <span className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)", letterSpacing: "0.14em", textTransform: "uppercase" }}>Flagship</span>
      </div>
    </div>
  );
}

function Capabilities({ report }: { report: DeviceReport }) {
  if (!report.features.length && !report.limits.length) return null;
  return (
    <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "20px 24px" }}>
      <p style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 14 }}>
        WebGPU capabilities
      </p>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: report.limits.length ? 16 : 0 }}>
        {report.features.map((f) => (
          <span key={f} className="mono" style={{ fontSize: 11, padding: "4px 9px", borderRadius: 6, background: "var(--surface-2)", border: "0.5px solid var(--border)", color: "var(--text-secondary)" }}>
            {f}
          </span>
        ))}
      </div>
      {!!report.limits.length && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px,1fr))", gap: 10, borderTop: "0.5px solid var(--border)", paddingTop: 16 }}>
          {report.limits.map((l) => (
            <div key={l.label}>
              <p style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4 }}>{l.label}</p>
              <p className="mono" style={{ fontSize: 14, fontWeight: 500 }}>{l.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const COMPARE_ICONS = {
  time: HourglassIcon,
  humanity: UsersIcon,
  chat: ChatIcon,
  image: MediaIcon,
  game: GamepadIcon,
} as const;

function Comparisons({ report }: { report: DeviceReport }) {
  if (report.gflops <= 0) return null;
  const items = funComparisons(report.gflops, report.tier);
  return (
    <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "20px 24px" }}>
      <p style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 16 }}>
        What that actually means
      </p>
      <div className="stagger" style={{ display: "flex", flexDirection: "column", gap: 13 }}>
        {items.map((c, i) => {
          const Ic = COMPARE_ICONS[c.icon];
          return (
            <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
              <span style={{
                flexShrink: 0, width: 30, height: 30, borderRadius: 9,
                display: "flex", alignItems: "center", justifyContent: "center",
                background: "var(--surface-2)", border: "0.5px solid var(--border)",
                color: "var(--accent)",
              }}>
                <Ic size={15} />
              </span>
              <p style={{ fontSize: 14, lineHeight: 1.55, paddingTop: 4 }}>
                <span style={{ color: "var(--text)", fontWeight: 550 }}>{c.punch}</span>
                <span style={{ color: "var(--text-muted)" }}>{c.rest}</span>
              </p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ShareCard({ report }: { report: DeviceReport }) {
  const [copied, setCopied] = useState(false);
  const text = `My ${report.gpu} scored ${report.score.toLocaleString()} on webgpu.in — ${TIER_LABEL[report.tier]} tier, top ${report.percentile}% of devices. Test yours:`;
  return (
    <div style={{ background: "var(--surface)", border: "0.5px solid var(--accent-border)", borderRadius: 12, padding: "18px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
      <div>
        <p style={{ fontSize: 14, fontWeight: 500 }}>Share your score</p>
        <p style={{ fontSize: 13, color: "var(--text-muted)", marginTop: 3 }}>
          {report.score.toLocaleString()} · {TIER_LABEL[report.tier]} · top {report.percentile}%
        </p>
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={() => window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=https://webgpu.in`, "_blank")}
          style={{ padding: "8px 16px", background: "#000", color: "#fff", border: "0.5px solid var(--border-strong)", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
          Post on 𝕏
        </button>
        <button onClick={() => { navigator.clipboard.writeText(text + " https://webgpu.in"); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
          style={{ padding: "8px 16px", background: copied ? "var(--accent)" : "var(--accent-dim)", color: copied ? "#fff" : "var(--accent)", border: "0.5px solid var(--accent-border)", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer" }}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}
