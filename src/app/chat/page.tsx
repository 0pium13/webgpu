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
import Markdown from "@/components/chat/Markdown";
import { ChatIcon, SparkleIcon } from "@/components/Icons";
import { keepModelsCached } from "@/lib/storage";

/**
 * Unfiltered mode: huihui-ai's abliterated Qwen3.5-4B (refusal behaviour
 * removed), q4f16_1 MLC weights. The weights repo is data only (76 tensor
 * shards + JSON, verified); the executable model library is WebLLM's
 * official Qwen3.5-4B build from mlc-ai — same architecture + quantization.
 * Only selectable after explicit 18+ / responsibility consent.
 */
const UNFILTERED_ID = "Huihui-Qwen3.5-4B-abliterated-q4f16_1-MLC";
const UNFILTERED_RECORD = {
  model: "https://huggingface.co/kamekichi1231/Huihui-Qwen3.5-4B-abliterated-q4f16_1-MLC",
  model_id: UNFILTERED_ID,
  model_lib:
    "https://raw.githubusercontent.com/mlc-ai/binary-mlc-llm-libs/main/web-llm-models/v0_2_84/base/Qwen3.5-4B-q4f16_1_cs1k-webgpu.wasm",
  vram_required_MB: 3867.82,
  low_resource_required: false,
  overrides: { context_window_size: 4096 },
};
const CONSENT_KEY = "webgpu.in:unfiltered-consent-v1";
const BACKEND_KEY = "webgpu.in:webllm-cache-backend";

function hasConsent(): boolean {
  try { return !!localStorage.getItem(CONSENT_KEY); } catch { return false; }
}
function saveConsent() {
  try { localStorage.setItem(CONSENT_KEY, new Date().toISOString()); } catch { /* private mode: asked again next visit */ }
}

const MODELS: { id: string; label: string; size: string; vram: string; hint: string; unfiltered?: boolean }[] = [
  {
    id: "Qwen3.5-0.8B-q4f16_1-MLC",
    label: "Qwen3.5 0.8B", size: "~450MB", vram: "1.6GB VRAM",
    hint: "Fastest — instant answers, light GPUs",
  },
  {
    id: "Qwen3.5-2B-q4f16_1-MLC",
    label: "Qwen3.5 2B", size: "~1.1GB", vram: "2.2GB VRAM",
    hint: "Balanced — strong multilingual, good Hindi",
  },
  {
    id: "Qwen3.5-4B-q4f16_1-MLC",
    label: "Qwen3.5 4B", size: "~2.4GB", vram: "3.9GB VRAM",
    hint: "Smartest — needs a real GPU",
  },
  {
    id: UNFILTERED_ID,
    label: "Unfiltered 4B", size: "~2.3GB", vram: "3.9GB VRAM",
    hint: "No refusals · 18+ · opt-in",
    unfiltered: true,
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
  const [consentOpen, setConsentOpen] = useState(false);
  const engineRef = useRef<any>(null);
  // Leaving the page (client-side nav keeps modules alive): unload the
  // 1–4GB WebLLM model so the next tool starts with free VRAM.
  useEffect(() => () => {
    const engine = engineRef.current;
    engineRef.current = null;
    engine?.unload?.().catch?.(() => {});
  }, []);
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
      void keepModelsCached();
      // fail fast with a clear message instead of a cryptic Cache.add error
      // halfway through a multi-GB download
      // Compare against total capacity, not free space: a resumed download's
      // already-saved shards count as "used", and a genuinely full disk is
      // still caught by the storage-error handling below.
      const need = parseFloat(model.size.replace(/[^\d.]/g, "")) * (/GB/.test(model.size) ? 1e9 : 1e6);
      const quota = await navigator.storage?.estimate?.().then((e) => e.quota ?? 0).catch(() => 0);
      if (quota && quota < need * 1.1) {
        throw new Error(
          `This browser can store at most ${Math.round(quota / 1048576)}MB, and ${model.label} needs ${model.size}. ` +
            `Free up disk space (browsers size their storage from free disk), or pick a smaller model.`
        );
      }
      const create = (cacheBackend: "cache" | "indexeddb") =>
        webllm.CreateMLCEngine(modelId, {
          appConfig: {
            ...webllm.prebuiltAppConfig,
            cacheBackend,
            model_list: [...webllm.prebuiltAppConfig.model_list, UNFILTERED_RECORD as any],
          },
          initProgressCallback: (p: { text: string; progress?: number }) => {
            setLoadMsg(p.text);
            setLoadPct(typeof p.progress === "number" && p.progress > 0 ? Math.round(p.progress * 100) : -1);
          },
        });
      let preferIdb = false;
      try { preferIdb = localStorage.getItem(BACKEND_KEY) === "indexeddb"; } catch { /* no storage access */ }
      if (preferIdb) {
        engineRef.current = await create("indexeddb");
      } else {
        try {
          engineRef.current = await create("cache");
        } catch (e: any) {
          // Some Chromium builds throw "Unexpected internal error" from Cache
          // Storage on large shards even with quota to spare — IndexedDB copes.
          // Remember it, so retries resume the shards already in IndexedDB.
          if (!/on 'Cache'/.test(String(e?.message))) throw e;
          console.warn("[chat] Cache Storage failed, retrying with IndexedDB", e);
          try { localStorage.setItem(BACKEND_KEY, "indexeddb"); } catch { /* ignore */ }
          // drop the half-written Cache Storage copy so it doesn't eat the
          // quota the IndexedDB copy now needs
          try { await caches.delete("webllm/model"); } catch { /* ignore */ }
          setLoadMsg("Retrying with a different browser storage…");
          engineRef.current = await create("indexeddb");
        }
      }
      setPhase("ready");
    } catch (e: any) {
      console.error(e);
      const msg = String(e?.message ?? "Failed to load the model");
      setErrMsg(
        /on 'Cache'|QuotaExceeded|quota/i.test(msg)
          ? `Your browser ran out of storage while saving ${model.label}. Free up disk space (or clear this site's data) and try again, or pick a smaller model.`
          : msg
      );
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
        // Qwen3.5 reasons in a <think> block by default — for chat we want
        // the answer immediately, not seconds of hidden monologue.
        extra_body: { enable_thinking: false },
      });
      for await (const chunk of stream) {
        if (stopRef.current) break;
        const delta = chunk.choices?.[0]?.delta?.content ?? "";
        if (!delta) continue;
        out += delta;
        nTok++;
        setTokSec(Math.round(nTok / ((performance.now() - t0) / 1000)));
        // safety net: never show a reasoning block if one slips through
        const shown = out.replace(/<think>[\s\S]*?(<\/think>|$)/g, "").trimStart();
        setMsgs([...history, { role: "assistant", content: shown }]);
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
                  <button key={m.id} onClick={() => (m.unfiltered && !hasConsent() ? setConsentOpen(true) : setModelId(m.id))} style={{
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
            {model.unfiltered && (
              <p style={{ margin: 0, padding: "9px 16px", fontSize: 12, lineHeight: 1.5, color: "var(--amber)", background: "var(--amber-dim)", borderBottom: "0.5px solid var(--border)" }}>
                Unfiltered model · 18+ · outputs are unmoderated and may be false, offensive or harmful.
                You are solely responsible for how you use them. <a href="/terms" style={{ color: "inherit" }}>Terms</a>
              </p>
            )}
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
                  maxWidth: m.role === "user" ? "82%" : "min(100%, 640px)",
                  background: m.role === "user" ? "var(--accent-dim)" : "var(--surface-2)",
                  border: "0.5px solid var(--border)",
                  borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
                  padding: "10px 14px", fontSize: 14, lineHeight: 1.6, whiteSpace: m.role === "user" ? "pre-wrap" : "normal",
                }}>
                  {!m.content ? <span style={{ color: "var(--text-dim)" }}>thinking…</span>
                    : m.role === "assistant" ? <Markdown text={m.content} streaming={phase === "generating" && i === msgs.length - 1} />
                    : m.content}
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

        {consentOpen && (
          <UnfilteredConsent
            onCancel={() => setConsentOpen(false)}
            onAccept={() => { saveConsent(); setConsentOpen(false); setModelId(UNFILTERED_ID); }}
          />
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

/**
 * 18+ / responsibility gate for the unfiltered model. Both boxes must be
 * ticked; acceptance is remembered per device (localStorage).
 */
function UnfilteredConsent({ onAccept, onCancel }: { onAccept: () => void; onCancel: () => void }) {
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);
  const ok = adult && terms;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="unfiltered-title"
      style={{ position: "fixed", inset: 0, zIndex: 200, background: "rgba(0,0,0,0.72)", backdropFilter: "blur(6px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div style={{ width: "100%", maxWidth: 520, maxHeight: "90vh", overflowY: "auto", background: "var(--surface)", border: "0.5px solid var(--border-strong)", borderRadius: 16, padding: "26px 24px" }}>
        <span className="mono" style={{ fontSize: 11, letterSpacing: "0.15em", color: "var(--amber)", textTransform: "uppercase" }}>18+ only</span>
        <h2 id="unfiltered-title" style={{ fontSize: 22, fontWeight: 600, margin: "8px 0 12px" }}>Unfiltered mode</h2>
        <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 8, fontSize: 13.5, lineHeight: 1.6, color: "var(--text-secondary)" }}>
          <li>This model has had its safety refusals removed. It may produce content that is explicit, offensive, dangerous, illegal where you live, or simply false.</li>
          <li>It runs entirely on your device. webgpu.in does not see, store, log or moderate anything you type or it generates.</li>
          <li>Outputs are not advice (medical, legal, financial or otherwise) and are not endorsed by webgpu.in.</li>
          <li>You are solely responsible for what you generate and how you use it, including complying with the laws that apply to you. Do not use it to harm anyone.</li>
          <li>Provided &ldquo;as is&rdquo;, without warranty. To the fullest extent permitted by law, webgpu.in is not liable for any outputs or their use.</li>
        </ul>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 18, fontSize: 13.5, cursor: "pointer" }}>
          <input type="checkbox" checked={adult} onChange={(e) => setAdult(e.target.checked)} style={{ marginTop: 3 }} />
          <span>I am 18 years or older (or the age of majority where I live).</span>
        </label>
        <label style={{ display: "flex", gap: 10, alignItems: "flex-start", marginTop: 10, fontSize: 13.5, cursor: "pointer" }}>
          <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} style={{ marginTop: 3 }} />
          <span>I accept full responsibility for what I generate and agree to the <a href="/terms" target="_blank" style={{ color: "var(--accent)" }}>Terms of Use</a>.</span>
        </label>
        <div style={{ display: "flex", gap: 10, marginTop: 22, flexWrap: "wrap" }}>
          <button onClick={onAccept} disabled={!ok} style={{ ...btn, opacity: ok ? 1 : 0.4, cursor: ok ? "pointer" : "not-allowed" }}>
            I understand — enable
          </button>
          <button onClick={onCancel} style={{ ...btn, background: "var(--surface-2)", color: "var(--text)" }}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

const btn: React.CSSProperties = {
  background: "var(--accent)", color: "var(--on-accent)", border: "none", borderRadius: 10,
  padding: "11px 20px", fontSize: 14, fontWeight: 500, cursor: "pointer",
};
