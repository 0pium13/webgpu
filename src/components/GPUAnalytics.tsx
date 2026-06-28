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
  const [scramble, setScramble] = useState(0);
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

  // scrambling number while benchmarking (anticipation)
  useEffect(() => {
    if (report) return;
    const iv = setInterval(() => setScramble(Math.floor(Math.random() * 9000) + 500), 70);
    return () => clearInterval(iv);
  }, [report]);

  const done = !!report;

  return (
    <div style={{ width: "100%", maxWidth: 720, margin: "0 auto", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* ===== Main report card ===== */}
      <div
        style={{
          position: "relative",
          background: "var(--surface)",
          border: "0.5px solid var(--border)",
          borderRadius: 18,
          padding: 32,
          overflow: "hidden",
          minHeight: 220,
        }}
      >
        {!done ? (
          /* ---- benchmarking state ---- */
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 18, padding: "24px 0" }}>
            <div className="scan-line" />
            <span className="mono" style={{ fontSize: 48, fontWeight: 500, color: "var(--text-muted)", letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
              {scramble.toLocaleString()}
            </span>
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

      {/* ===== detail cards (cascade in once done) ===== */}
      {done && (
        <>
          <DeviceGrid report={report} />
          <PercentileBar report={report} />
          <Capabilities report={report} />
          <Comparisons report={report} />
          <ShareCard report={report} />
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
  return (
    <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "20px 24px" }}>
      <p style={{ fontSize: 13, color: "var(--text-muted)", marginBottom: 16 }}>
        Where your GPU lands against common devices
      </p>
      <div style={{ position: "relative", height: 6, background: "var(--surface-2)", borderRadius: 4, marginBottom: 12 }}>
        <div style={{ position: "absolute", inset: 0, width: `${beat}%`, background: TIER_COLOR[report.tier], borderRadius: 4, transition: "width 1.2s cubic-bezier(0.22,1,0.36,1)" }} />
        <div style={{ position: "absolute", left: `${beat}%`, top: "50%", transform: "translate(-50%,-50%)", width: 14, height: 14, borderRadius: "50%", background: TIER_COLOR[report.tier], border: "2px solid var(--canvas)" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Entry</span>
        <span style={{ fontSize: 13, fontWeight: 500, color: TIER_COLOR[report.tier] }}>Faster than {beat}% of devices</span>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Flagship</span>
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

function Comparisons({ report }: { report: DeviceReport }) {
  if (report.gflops <= 0) return null;
  const items = funComparisons(report.gflops, report.tier);
  return (
    <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 12, padding: "20px 24px" }}>
      <p style={{ fontSize: 11, color: "var(--text-muted)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 16 }}>
        What that actually means
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((c, i) => (
          <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            <span style={{ fontSize: 17, flexShrink: 0 }}>{c.icon}</span>
            <p style={{ fontSize: 14, color: "var(--text-secondary)", lineHeight: 1.5 }}>{c.text}</p>
          </div>
        ))}
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
