"use client";

/**
 * ModelLoader — the signature "a mind is waking up" moment, shared by every
 * tool that pulls a model down.
 *
 * A neural constellation renders on canvas: nodes scattered organically,
 * synapses between neighbours. As download progress sweeps left→right the
 * network IGNITES — nodes flare on, light packets travel the active edges,
 * the whole thing breathes. At 100% the lattice is fully alive. The metaphor
 * is literal: you are watching a neural network arrive in your browser.
 *
 * Perf: one rAF loop, DPR-capped canvas, ~50 nodes — trivial next to the
 * download itself. prefers-reduced-motion gets a static lit lattice.
 */

import { useEffect, useRef, useState } from "react";

interface Node { x: number; y: number; r: number; phase: number }
interface Edge { a: number; b: number; len: number }
interface Packet { edge: number; t: number; speed: number; dir: 1 | -1 }

const FACTS = [
  "The model downloads to you — your files never leave this tab",
  "Downloads once, cached forever. Next time: instant",
  "Your GPU is doing what cloud APIs charge monthly for",
  "No account. No upload. No queue. Just your hardware",
  "Bigger model, smarter results — worth the wait",
];

export default function ModelLoader({
  pct,
  title,
  sub,
  facts = FACTS,
}: {
  /** 0–100, or -1 for indeterminate */
  pct: number;
  title: string;
  sub?: string;
  facts?: string[];
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pctRef = useRef(pct);
  pctRef.current = pct;
  const [factIdx, setFactIdx] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setFactIdx((i) => (i + 1) % facts.length), 4200);
    return () => clearInterval(id);
  }, [facts.length]);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let W = 0, H = 0, raf = 0;
    const DPR = Math.min(window.devicePixelRatio || 1, 2);

    const nodes: Node[] = [];
    const edges: Edge[] = [];
    const packets: Packet[] = [];

    function build() {
      const rect = canvas.getBoundingClientRect();
      W = rect.width; H = rect.height;
      canvas.width = W * DPR; canvas.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

      nodes.length = 0; edges.length = 0; packets.length = 0;
      // jittered grid = organic but evenly filled
      const COLS = 11, ROWS = 5;
      for (let cy = 0; cy < ROWS; cy++) {
        for (let cx = 0; cx < COLS; cx++) {
          // deterministic jitter so rebuilds don't "pop"
          const j1 = Math.sin(cx * 12.9898 + cy * 78.233) * 43758.5453;
          const j2 = Math.sin(cx * 39.346 + cy * 11.135) * 24634.6345;
          const jx = (j1 - Math.floor(j1) - 0.5) * 0.75;
          const jy = (j2 - Math.floor(j2) - 0.5) * 0.75;
          nodes.push({
            x: ((cx + 0.5 + jx) / COLS) * W,
            y: ((cy + 0.5 + jy) / ROWS) * H,
            r: 1.3 + (j1 - Math.floor(j1)) * 1.6,
            phase: (j2 - Math.floor(j2)) * Math.PI * 2,
          });
        }
      }
      for (let i = 0; i < nodes.length; i++) {
        for (let k = i + 1; k < nodes.length; k++) {
          const dx = nodes[i].x - nodes[k].x, dy = nodes[i].y - nodes[k].y;
          const d = Math.hypot(dx, dy);
          if (d < W / COLS * 1.65) edges.push({ a: i, b: k, len: d });
        }
      }
    }

    function frame(now: number) {
      const t = now / 1000;
      const p = pctRef.current;
      // indeterminate: a wave sweeps back and forth instead of a fill
      const sweep = p < 0 ? (Math.sin(t * 0.9) * 0.5 + 0.5) : Math.min(p, 100) / 100;
      ctx.clearRect(0, 0, W, H);

      const frontX = sweep * W * 1.15; // ignition front, slightly ahead

      // edges
      for (let e = 0; e < edges.length; e++) {
        const { a, b } = edges[e];
        const na = nodes[a], nb = nodes[b];
        const mid = (na.x + nb.x) / 2;
        const lit = mid < frontX;
        const flicker = 0.5 + 0.5 * Math.sin(t * 1.4 + na.phase);
        ctx.strokeStyle = lit
          ? `rgba(129,140,248,${0.10 + 0.13 * flicker})`
          : "rgba(148,163,184,0.045)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(na.x, na.y); ctx.lineTo(nb.x, nb.y); ctx.stroke();

        // spawn light packets on lit edges occasionally
        if (lit && !reduced && packets.length < 26 && Math.random() < 0.004) {
          packets.push({ edge: e, t: 0, speed: 0.4 + Math.random() * 0.9, dir: Math.random() > 0.5 ? 1 : -1 });
        }
      }

      // travelling packets
      for (let i = packets.length - 1; i >= 0; i--) {
        const pk = packets[i];
        pk.t += pk.speed / 60;
        if (pk.t >= 1) { packets.splice(i, 1); continue; }
        const { a, b } = edges[pk.edge];
        const na = nodes[a], nb = nodes[b];
        const tt = pk.dir === 1 ? pk.t : 1 - pk.t;
        const x = na.x + (nb.x - na.x) * tt;
        const y = na.y + (nb.y - na.y) * tt;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 5);
        g.addColorStop(0, "rgba(199,210,254,0.9)");
        g.addColorStop(1, "rgba(129,140,248,0)");
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
      }

      // nodes
      for (const n of nodes) {
        const lit = n.x < frontX;
        const breathe = reduced ? 0.7 : 0.55 + 0.45 * Math.sin(t * 2 + n.phase);
        if (lit) {
          const glow = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 5);
          glow.addColorStop(0, `rgba(165,180,252,${0.55 * breathe})`);
          glow.addColorStop(1, "rgba(165,180,252,0)");
          ctx.fillStyle = glow;
          ctx.beginPath(); ctx.arc(n.x, n.y, n.r * 5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = `rgba(224,231,255,${0.65 + 0.35 * breathe})`;
        } else {
          ctx.fillStyle = "rgba(148,163,184,0.18)";
        }
        ctx.beginPath(); ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2); ctx.fill();
      }

      // ignition front shimmer
      if (p >= 0 && p < 100 && !reduced) {
        const g = ctx.createLinearGradient(frontX - 34, 0, frontX + 8, 0);
        g.addColorStop(0, "rgba(129,140,248,0)");
        g.addColorStop(1, "rgba(165,180,252,0.10)");
        ctx.fillStyle = g;
        ctx.fillRect(frontX - 34, 0, 42, H);
      }

      raf = requestAnimationFrame(frame);
    }

    build();
    const onResize = () => build();
    window.addEventListener("resize", onResize);
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); };
  }, []);

  return (
    <div style={{ position: "relative", minHeight: 240, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", overflow: "hidden", borderRadius: 14 }}>
      <canvas ref={canvasRef} style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} aria-hidden />
      <div style={{ position: "relative", textAlign: "center", pointerEvents: "none", padding: "28px 20px" }}>
        <p className="mono" style={{ fontSize: 40, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text)", textShadow: "0 0 24px rgba(129,140,248,0.35)", lineHeight: 1 }}>
          {pct < 0 ? "···" : `${Math.min(99, Math.round(pct))}%`}
        </p>
        <p style={{ fontSize: 14, fontWeight: 500, color: "var(--text)", marginTop: 10 }}>{title}</p>
        {sub && <p className="mono" style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{sub}</p>}
        <p key={factIdx} style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 14, animation: "fadein 0.8s ease-out", maxWidth: 380, marginLeft: "auto", marginRight: "auto" }}>
          {facts[factIdx]}
        </p>
      </div>
    </div>
  );
}
