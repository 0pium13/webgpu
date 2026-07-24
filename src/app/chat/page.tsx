"use client";

/**
 * Local AI chat — WebLLM (MLC) running the model on the user's GPU.
 *
 * No API key, no account, no server: the weights download once into browser
 * cache and every token is generated on-device. WebGPU is required (WebLLM
 * has no wasm path), so we gate on that up front.
 */

import { useEffect, useRef, useState } from "react";
import Nav from "@/components/Nav";
import ModelLoader from "@/components/ModelLoader";
import { ChatIcon, SparkleIcon } from "@/components/Icons";

const MODELS = [
  {
    id: "Llama-3.2-1B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 1B", size: "~700MB", vram: "1GB VRAM",
    hint: "Fastest — instant answers, light GPUs",
  },
  {
    id: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
    label: "Qwen 2.5 1.5B", size: "~950MB", vram: "1.6GB VRAM",
    hint: "Best multilingual — good Hindi",
  },
  {
    id: "Llama-3.2-3B-Instruct-q4f16_1-MLC",
    label: "Llama 3.2 3B", size: "~1.7GB", vram: "2.3GB VRAM",
    hint: "Smartest — needs a real GPU",
  },
];

const SYSTEM_PROMPT =
  "You are a helpful, direct assistant running entirely on the user's own GPU in their browser. Nothing the user types ever leaves their machine.";

interface Msg { role: "user" | "assistant"; content: string }

type Phase = "pick" | "loading" | "ready" | "generating" | "unsupported" | "error";

export default function ChatPage() {
  const [phase, setPhase] = useState<Phase>("pick");
  const [modelId, setModelId] = useState(MODELS[0].id);
  const [loadMsg, setLoadMsg] = useState("");
  const [loadPct, setLoadPct] = useState(-1);
  const [errMsg, setErrMsg] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [tokSec, setTokSec] = useState(0);
  const engineRef = useRef<any>(null);
  const stopRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!("gpu" in navigator)) setPhase("unsupported");
  }, []);

  async function loadModel() {
    try {
      setPhase("loading");
      setLoadMsg("Preparing…");
      const webllm = await import("@mlc-ai/web-llm");
      engineRef.current = await webllm.CreateMLCEngine(modelId, {
        initProgressCallback: (p: { text: string; progress?: number }) => {
          setLoadMsg(p.text);
          setLoadPct(typeof p.progress === "number" && p.progress > 0 ? Math.round(p.progress * 100) : -1);
        },
      });
      setPhase("ready");
    } catch (e: any) {
      console.error(e);
      setErrMsg(e?.message ?? "Failed to load the model");
      setPhase("error");
    }
  }

  async function send() {
    const text = draft.trim();
    if (!text || !engineRef.current || phase === "generating") return;
    setDraft("");
    stopRef.current = false;
    const history = [...msgs, { role: "user" as const, content: text }];
    setMsgs([...history, { role: "assistant", content: "" }]);
    setPhase("generating");
    try {
      const t0 = performance.now();
      let out = "", nTok = 0;
      const stream = await engineRef.current.chat.completions.create({
        messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
        stream: true,
        temperature: 0.7,
      });
      for await (const chunk of stream) {
        if (stopRef.current) break;
        const delta = chunk.choices?.[0]?.delta?.content ?? "";
        if (!delta) continue;
        out += delta;
        nTok++;
        setTokSec(Math.round(nTok / ((performance.now() - t0) / 1000)));
        setMsgs([...history, { role: "assistant", content: out }]);
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      }
      setPhase("ready");
    } catch (e: any) {
      console.error(e);
      setErrMsg(e?.message ?? "Generation failed");
      setPhase("error");
    }
  }

  const model = MODELS.find((m) => m.id === modelId)!;

  async function switchModel() {
    if (phase === "generating") return;
    const engine = engineRef.current;
    engineRef.current = null;
    setMsgs([]);
    setTokSec(0);
    setLoadPct(-1);
    setPhase("pick");
    try { await engine?.unload?.(); } catch (e) { console.warn("[chat] unload failed", e); }
  }

  return (
    <div style={{ minHeight: "100vh" }}>
      <Nav />
      <div style={{ maxWidth: 860, margin: "0 auto", padding: "100px 24px 80px" }}>
        <div style={{ marginBottom: 28 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.15em", color: "var(--accent)", textTransform: "uppercase" }}>
            webgpu.in / chat
          </span>
          <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 500, letterSpacing: "-0.03em", marginTop: 12, marginBottom: 10 }}>
            Local AI Chat
          </h1>
          <p style={{ fontSize: 16, color: "var(--text-muted)", maxWidth: 560, lineHeight: 1.6 }}>
            A real LLM on your own GPU. No account, no API key, no server —
            ask it anything on a plane, in a village with no signal, or with
            secrets you&apos;d never paste into ChatGPT. Nothing leaves this tab.
          </p>
        </div>

        {phase === "unsupported" && (
          <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 16, padding: "48px 32px", textAlign: "center" }}>
            <p style={{ fontSize: 15, marginBottom: 8 }}>This one genuinely needs WebGPU.</p>
            <p style={{ fontSize: 13.5, color: "var(--text-muted)" }}>
              Chrome or Edge on desktop runs it — your current browser doesn&apos;t expose a GPU to the page.
            </p>
          </div>
        )}

        {phase === "pick" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 18, background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 16, padding: "36px 28px", alignItems: "center" }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, width: "100%", maxWidth: 640 }}>
              {MODELS.map((m) => {
                const active = modelId === m.id;
                return (
                  <button key={m.id} onClick={() => setModelId(m.id)} style={{
                    textAlign: "left", background: active ? "var(--accent-dim)" : "var(--surface-2)",
                    border: active ? "0.5px solid var(--accent)" : "0.5px solid var(--border)",
                    borderRadius: 12, padding: "14px 16px", cursor: "pointer",
                  }}>
                    <span style={{ display: "block", fontSize: 14, fontWeight: 500, color: active ? "var(--accent)" : "var(--text)" }}>{m.label}</span>
                    <span className="mono" style={{ display: "block", fontSize: 10.5, color: "var(--text-dim)", margin: "4px 0" }}>{m.size} · {m.vram}</span>
                    <span style={{ display: "block", fontSize: 12, color: "var(--text-muted)", lineHeight: 1.4 }}>{m.hint}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={loadModel} style={{
              background: "var(--accent)", color: "var(--on-accent)", border: "none", borderRadius: 12,
              padding: "14px 32px", fontSize: 16, fontWeight: 500, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 9,
            }}>
              <SparkleIcon size={17} /> Load {model.label}
            </button>
            <p className="mono" style={{ fontSize: 11.5, color: "var(--text-dim)" }}>
              Downloads once, cached forever · runs 100% on your GPU
            </p>
          </div>
        )}

        {phase === "loading" && (
          <div style={{ background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
            <ModelLoader
              pct={loadPct}
              title={`${model.label} is waking up`}
              sub={`${model.size} · downloads once, cached forever`}
            />
            <p className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)", textAlign: "center", padding: "0 24px 16px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{loadMsg}</p>
          </div>
        )}

        {(phase === "ready" || phase === "generating" || (phase === "error" && msgs.length > 0)) && (
          <div style={{ display: "flex", flexDirection: "column", background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 16, overflow: "hidden" }}>
            <div ref={scrollRef} style={{ height: "48vh", overflowY: "auto", padding: "20px 22px", display: "flex", flexDirection: "column", gap: 14 }}>
              {msgs.length === 0 && (
                <div style={{ margin: "auto", textAlign: "center", color: "var(--text-dim)" }}>
                  <ChatIcon size={28} />
                  <p style={{ fontSize: 13, marginTop: 10 }}>Loaded. Ask anything — it never leaves your machine.</p>
                </div>
              )}
              {msgs.map((m, i) => (
                <div key={i} style={{
                  alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "82%",
                  background: m.role === "user" ? "var(--accent-dim)" : "var(--surface-2)",
                  border: "0.5px solid var(--border)",
                  borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                  padding: "10px 14px", fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-wrap",
                }}>
                  {m.content || <span style={{ color: "var(--text-dim)" }}>thinking…</span>}
                </div>
              ))}
            </div>

            <div style={{ borderTop: "0.5px solid var(--border)", padding: "12px 14px", display: "flex", gap: 10, alignItems: "flex-end" }}>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder={phase === "generating" ? "Generating…" : "Message your GPU…"}
                rows={1}
                style={{
                  flex: 1, resize: "none", background: "var(--surface-2)", color: "var(--text)",
                  border: "0.5px solid var(--border)", borderRadius: 10, padding: "11px 14px",
                  fontSize: 14, lineHeight: 1.5, outline: "none", fontFamily: "inherit",
                }}
              />
              {phase === "generating" ? (
                <button onClick={() => { stopRef.current = true; }} style={{ ...btn, background: "var(--surface-2)", color: "var(--text)" }}>Stop</button>
              ) : (
                <button onClick={send} disabled={!draft.trim()} style={{ ...btn, opacity: draft.trim() ? 1 : 0.45 }}>Send</button>
              )}
            </div>

            <p className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)", padding: "0 16px 10px", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
                {model.label} · local
                {phase !== "generating" && (
                  <button onClick={switchModel} style={{
                    background: "transparent", border: "0.5px solid var(--border)", borderRadius: 6,
                    color: "var(--text-muted)", fontSize: 10, padding: "2px 8px", cursor: "pointer",
                    fontFamily: "inherit",
                  }}>
                    switch model
                  </button>
                )}
              </span>
              {tokSec > 0 && <span>{tokSec} tokens/s from your GPU</span>}
            </p>
          </div>
        )}

        {phase === "error" && (
          <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 12 }}>
            <p style={{ color: "#ef4444", fontSize: 13, flex: 1 }}>{errMsg}</p>
            <button onClick={() => (engineRef.current ? setPhase("ready") : setPhase("pick"))} style={{ ...btn }}>Try again</button>
            <button onClick={switchModel} style={{ ...btn, background: "var(--surface-2)", color: "var(--text)" }}>Pick another model</button>
          </div>
        )}
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  background: "var(--accent)", color: "var(--on-accent)", border: "none", borderRadius: 10,
  padding: "11px 20px", fontSize: 14, fontWeight: 500, cursor: "pointer",
};
