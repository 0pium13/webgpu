"use client";

/**
 * Vibe Coder — describe a mini-app, watch the code stream in, run it
 * instantly in a sandboxed preview. Two engines:
 *
 *  1. Your GPU (default) — Qwen2.5-Coder via WebLLM, fully local, $0 forever.
 *  2. Your OpenRouter key (BYOK) — the live `:free` model list, or any paid
 *     model id (e.g. moonshotai/kimi-k2) billed to the user's own key. The
 *     key goes browser→OpenRouter directly; webgpu.in never sees it.
 *
 * Preview runs in <iframe sandbox="allow-scripts" srcDoc> — generated code
 * can't touch this page, cookies, or storage.
 */

import { useEffect, useRef, useState } from "react";
import Nav from "@/components/Nav";
import ModelLoader from "@/components/ModelLoader";
import { CodeIcon } from "@/components/Icons";
import { fetchFreeModels, streamChat, extractHtml, type ORModel, type ChatMsg } from "@/lib/openrouter";

const LOCAL_MODELS = [
  {
    id: "Qwen2.5-Coder-0.5B-Instruct-q4f16_1-MLC",
    label: "Coder 0.5B", size: "~500MB", vram: "1GB VRAM",
    hint: "Fastest — simple pages, light GPUs",
  },
  {
    id: "Qwen2.5-Coder-1.5B-Instruct-q4f16_1-MLC",
    label: "Coder 1.5B", size: "~1.6GB", vram: "2GB VRAM",
    hint: "Sweet spot — solid small apps",
  },
  {
    id: "Qwen2.5-Coder-3B-Instruct-q4f16_1-MLC",
    label: "Coder 3B", size: "~2.5GB", vram: "3GB VRAM",
    hint: "Best local — needs a real GPU",
  },
];

const SYSTEM_PROMPT = [
  "You are an expert front-end engineer.",
  "Reply with ONE complete, self-contained HTML file and nothing else — no explanations, no markdown fences.",
  "Start with <!DOCTYPE html>. Inline all CSS in <style> and all JS in <script>.",
  "If a library is genuinely needed, load it only from https://cdn.jsdelivr.net or https://unpkg.com.",
  "Make it look premium: dark background, modern typography, generous spacing, subtle motion.",
  "The app must actually work when opened.",
].join(" ");

const IDEAS = [
  "a pomodoro timer with a circular progress ring",
  "a kanban board with drag and drop",
  "a typing-speed test with live WPM",
  "an expense splitter for a trip with friends",
  "a breathing exercise app with a pulsing circle",
  "a markdown editor with live preview",
];

type Engine = "local" | "api";
type Phase = "idle" | "loading" | "generating";

export default function CodePage() {
  const [engine, setEngine] = useState<Engine>("local");
  const [localModel, setLocalModel] = useState(LOCAL_MODELS[1].id);
  const [localReady, setLocalReady] = useState("");   // id of the loaded model
  const [loadMsg, setLoadMsg] = useState("");
  const [loadPct, setLoadPct] = useState(-1);
  const [gpuOk, setGpuOk] = useState(true);

  const [apiKey, setApiKey] = useState("");
  const [freeModels, setFreeModels] = useState<ORModel[]>([]);
  const [apiModel, setApiModel] = useState("");
  const [customModel, setCustomModel] = useState("");

  const [prompt, setPrompt] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [code, setCode] = useState("");
  const [streamed, setStreamed] = useState(0);        // chars streamed so far
  const [previewDoc, setPreviewDoc] = useState("");   // committed to iframe on finish/run
  const [tab, setTab] = useState<"preview" | "code">("preview");
  const [errMsg, setErrMsg] = useState("");
  const [hasResult, setHasResult] = useState(false);

  const engineRef = useRef<any>(null);
  const historyRef = useRef<ChatMsg[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const stopRef = useRef(false);

  useEffect(() => {
    if (!("gpu" in navigator)) { setGpuOk(false); setEngine("api"); }
    setApiKey(localStorage.getItem("or_key") ?? "");
    fetchFreeModels()
      .then((m) => { setFreeModels(m); if (m.length && !apiModel) setApiModel(m[0].id); })
      .catch((e) => console.warn("[code] model list failed", e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function saveKey(k: string) {
    setApiKey(k);
    localStorage.setItem("or_key", k);
  }

  async function ensureLocalEngine(): Promise<any> {
    if (engineRef.current && localReady === localModel) return engineRef.current;
    setPhase("loading");
    setLoadPct(-1);
    setLoadMsg("Preparing…");
    try { await engineRef.current?.unload?.(); } catch { /* old engine */ }
    engineRef.current = null;
    const webllm = await import("@mlc-ai/web-llm");
    engineRef.current = await webllm.CreateMLCEngine(localModel, {
      initProgressCallback: (p: { text: string; progress?: number }) => {
        setLoadMsg(p.text);
        setLoadPct(typeof p.progress === "number" && p.progress > 0 ? Math.round(p.progress * 100) : -1);
      },
    });
    setLocalReady(localModel);
    return engineRef.current;
  }

  async function generate(instruction: string, fresh: boolean) {
    const text = instruction.trim();
    if (!text || phase === "generating") return;
    setErrMsg("");
    stopRef.current = false;

    const chosenApiModel = customModel.trim() || apiModel;
    if (engine === "api") {
      if (!apiKey.trim()) { setErrMsg("Paste your OpenRouter API key first (free at openrouter.ai/keys)."); return; }
      if (!chosenApiModel) { setErrMsg("Pick a model."); return; }
    }

    if (fresh) historyRef.current = [];
    const userMsg = fresh
      ? `Build this as a single HTML file: ${text}`
      : `Update the app: ${text}. Reply with the FULL updated HTML file, nothing else.`;
    // keep context small for local models: system + last exchange + new ask
    const history = historyRef.current.slice(-2);
    const messages: ChatMsg[] = [
      { role: "system", content: SYSTEM_PROMPT },
      ...history,
      { role: "user", content: userMsg },
    ];

    try {
      let raw = "";
      const onDelta = (d: string) => {
        raw += d;
        setCode(extractHtml(raw));
        setStreamed(raw.length);
      };

      if (engine === "local") {
        const eng = await ensureLocalEngine();
        setPhase("generating");
        setTab("code");
        const stream = await eng.chat.completions.create({
          messages, stream: true, temperature: 0.3, max_tokens: 4096,
        });
        for await (const chunk of stream) {
          if (stopRef.current) break;
          const delta = chunk.choices?.[0]?.delta?.content ?? "";
          if (delta) onDelta(delta);
        }
      } else {
        setPhase("generating");
        setTab("code");
        abortRef.current = new AbortController();
        await streamChat({
          apiKey: apiKey.trim(), model: chosenApiModel, messages,
          onDelta, signal: abortRef.current.signal,
        });
      }

      const html = extractHtml(raw);
      if (!html.toLowerCase().includes("<html") && !html.toLowerCase().includes("<!doctype")) {
        throw new Error("The model didn't return an HTML file — try again or use a bigger model.");
      }
      historyRef.current = ([...history, { role: "user", content: userMsg }, { role: "assistant", content: html }] as ChatMsg[]).slice(-2);
      setCode(html);
      setPreviewDoc(html);
      setHasResult(true);
      setTab("preview");
      setPhase("idle");
    } catch (e: any) {
      if (e?.name === "AbortError") { setPhase("idle"); return; }
      console.error(e);
      setErrMsg(e?.message ?? "Generation failed");
      setPhase("idle");
    }
  }

  function stop() {
    stopRef.current = true;
    abortRef.current?.abort();
  }

  function runEdited() {
    setPreviewDoc(code);
    setTab("preview");
  }

  function download() {
    const blob = new Blob([previewDoc || code], { type: "text/html" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "app.html";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 30_000);
  }

  const localInfo = LOCAL_MODELS.find((m) => m.id === localModel)!;

  return (
    <div style={{ minHeight: "100vh" }}>
      <Nav />
      <div style={{ maxWidth: 1060, margin: "0 auto", padding: "100px 24px 80px" }}>
        <div style={{ marginBottom: 30 }}>
          <span className="mono" style={{ fontSize: 11, letterSpacing: "0.15em", color: "var(--accent)", textTransform: "uppercase" }}>
            webgpu.in / code
          </span>
          <h1 style={{ fontSize: "clamp(32px, 5vw, 56px)", fontWeight: 500, letterSpacing: "-0.03em", marginTop: 12, marginBottom: 10 }}>
            Vibe Coder
          </h1>
          <p style={{ fontSize: 16, color: "var(--text-muted)", maxWidth: 620, lineHeight: 1.6 }}>
            Describe a mini-app. The code streams in and runs instantly in a
            sandbox — on your GPU for free, or through your own OpenRouter key
            for bigger models like Kimi.
          </p>
        </div>

        {/* engine picker */}
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
          <button
            onClick={() => gpuOk && setEngine("local")}
            style={{ ...card, borderColor: engine === "local" ? "var(--accent)" : "var(--border)", opacity: gpuOk ? 1 : 0.4, cursor: gpuOk ? "pointer" : "not-allowed" }}
          >
            <span style={{ fontSize: 13.5, fontWeight: 550 }}>Your GPU</span>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)" }}>
              {gpuOk ? "local · private · $0 forever" : "needs WebGPU (Chrome/Edge)"}
            </span>
          </button>
          <button
            onClick={() => setEngine("api")}
            style={{ ...card, borderColor: engine === "api" ? "var(--accent)" : "var(--border)" }}
          >
            <span style={{ fontSize: 13.5, fontWeight: 550 }}>Your OpenRouter key</span>
            <span className="mono" style={{ fontSize: 10.5, color: "var(--text-dim)" }}>
              {freeModels.length ? `${freeModels.length} free models live` : "free + paid models"} · key stays in your browser
            </span>
          </button>
        </div>

        {/* engine config */}
        {engine === "local" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
            {LOCAL_MODELS.map((m) => (
              <button
                key={m.id}
                onClick={() => phase !== "generating" && setLocalModel(m.id)}
                title={m.hint}
                style={{
                  ...chip,
                  borderColor: localModel === m.id ? "var(--accent)" : "var(--border)",
                  color: localModel === m.id ? "var(--text)" : "var(--text-muted)",
                }}
              >
                {m.label} <span style={{ color: "var(--text-dim)" }}>· {m.size}</span>
                {localReady === m.id && <span style={{ color: "var(--accent)" }}> · loaded</span>}
              </button>
            ))}
          </div>
        )}
        {engine === "api" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, alignItems: "center" }}>
            <input
              type="password"
              placeholder="sk-or-v1-…  (openrouter.ai/keys)"
              value={apiKey}
              onChange={(e) => saveKey(e.target.value)}
              style={{ ...field, width: 260 }}
            />
            <select
              value={apiModel}
              onChange={(e) => setApiModel(e.target.value)}
              disabled={!!customModel.trim()}
              style={{ ...field, maxWidth: 300, opacity: customModel.trim() ? 0.45 : 1 }}
            >
              {freeModels.length === 0 && <option value="">loading free models…</option>}
              {freeModels.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
            <input
              placeholder="or any model id, e.g. moonshotai/kimi-k2 (paid, your credits)"
              value={customModel}
              onChange={(e) => setCustomModel(e.target.value)}
              style={{ ...field, width: 330 }}
            />
          </div>
        )}

        {/* prompt */}
        <div style={{ display: "flex", gap: 10, alignItems: "stretch", marginBottom: 10 }}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) generate(prompt, !hasResult ? true : false); }}
            placeholder={`Try: ${IDEAS[Math.floor(Date.now() / 60000) % IDEAS.length]}`}
            rows={2}
            style={{ ...field, flex: 1, resize: "vertical", lineHeight: 1.5, fontFamily: "inherit" }}
          />
          {phase === "generating" ? (
            <button onClick={stop} style={{ ...primaryBtn, background: "var(--surface-2)", color: "var(--text)", border: "0.5px solid var(--border)" }}>
              ■ Stop
            </button>
          ) : (
            <button onClick={() => generate(prompt, true)} disabled={phase !== "idle" || !prompt.trim()} style={{ ...primaryBtn, opacity: prompt.trim() ? 1 : 0.45 }}>
              <CodeIcon size={15} /> Build it
            </button>
          )}
        </div>
        {hasResult && phase === "idle" && (
          <p className="mono" style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 10 }}>
            &quot;Build it&quot; starts fresh · to refine what&apos;s below, describe the change and press Refine ↓
          </p>
        )}

        {phase === "loading" && (
          <ModelLoader pct={loadPct} title={`Loading ${localInfo.label} onto your GPU`} sub={loadMsg} />
        )}

        {/* workspace */}
        {(hasResult || phase === "generating") && (
          <div style={{ border: "0.5px solid var(--border)", borderRadius: 14, overflow: "hidden", background: "var(--surface)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 4, padding: "8px 10px", borderBottom: "0.5px solid var(--border)" }}>
              <button onClick={() => setTab("preview")} style={{ ...tabBtn, background: tab === "preview" ? "var(--surface-2)" : "transparent", color: tab === "preview" ? "var(--text)" : "var(--text-muted)" }}>Preview</button>
              <button onClick={() => setTab("code")} style={{ ...tabBtn, background: tab === "code" ? "var(--surface-2)" : "transparent", color: tab === "code" ? "var(--text)" : "var(--text-muted)" }}>Code</button>
              {phase === "generating" && (
                <span className="mono" style={{ fontSize: 11, color: "var(--accent)", marginLeft: 8 }}>
                  <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "var(--accent)", marginRight: 6, animation: "pulse 1s ease-in-out infinite" }} />
                  writing… {(streamed / 1000).toFixed(1)}k chars
                </span>
              )}
              <span style={{ flex: 1 }} />
              {tab === "code" && hasResult && phase === "idle" && (
                <button onClick={runEdited} style={miniBtn}>▶ Run edits</button>
              )}
              {hasResult && <button onClick={download} style={miniBtn}>↓ app.html</button>}
            </div>

            {tab === "preview" ? (
              previewDoc ? (
                <iframe
                  key={previewDoc.length + previewDoc.slice(0, 80)}
                  sandbox="allow-scripts"
                  srcDoc={previewDoc}
                  title="app preview"
                  style={{ width: "100%", height: 560, border: "none", background: "#0b0b0d", display: "block" }}
                />
              ) : (
                <div style={{ height: 560, display: "grid", placeItems: "center", color: "var(--text-dim)", fontSize: 13 }}>
                  preview appears when the code finishes
                </div>
              )
            ) : (
              <textarea
                value={code}
                onChange={(e) => setCode(e.target.value)}
                spellCheck={false}
                className="mono"
                style={{
                  width: "100%", height: 560, border: "none", outline: "none", resize: "none",
                  background: "#0b0b0d", color: "#d8d8e0", padding: 16, fontSize: 12.5, lineHeight: 1.55,
                  display: "block", boxSizing: "border-box",
                }}
              />
            )}
          </div>
        )}

        {/* refine bar */}
        {hasResult && phase === "idle" && (
          <RefineBar onRefine={(t) => generate(t, false)} />
        )}

        {errMsg && <p style={{ color: "#ef4444", fontSize: 13, marginTop: 12 }}>{errMsg}</p>}

        <p className="mono" style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 22, lineHeight: 1.7 }}>
          Sandboxed preview — generated code can&apos;t touch this site or your data ·
          BYOK calls go browser → OpenRouter directly, your key never touches our servers ·
          Free OpenRouter models have daily caps set by OpenRouter
        </p>
      </div>
    </div>
  );
}

function RefineBar({ onRefine }: { onRefine: (text: string) => void }) {
  const [text, setText] = useState("");
  function go() {
    if (!text.trim()) return;
    onRefine(text);
    setText("");
  }
  return (
    <div style={{ display: "flex", gap: 10, marginTop: 12 }}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") go(); }}
        placeholder="Refine it — “make the buttons bigger”, “add a dark red theme”, “save to localStorage”…"
        style={{ ...field, flex: 1 }}
      />
      <button onClick={go} disabled={!text.trim()} style={{ ...primaryBtn, opacity: text.trim() ? 1 : 0.45 }}>Refine</button>
    </div>
  );
}

const card: React.CSSProperties = {
  display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4,
  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 12,
  padding: "12px 18px", cursor: "pointer", textAlign: "left",
};
const chip: React.CSSProperties = {
  background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 999,
  padding: "7px 14px", fontSize: 12.5, cursor: "pointer",
};
const field: React.CSSProperties = {
  background: "var(--surface)", border: "0.5px solid var(--border)", borderRadius: 10,
  padding: "10px 14px", fontSize: 13.5, color: "var(--text)", outline: "none",
};
const primaryBtn: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 7,
  background: "var(--accent)", color: "#fff", border: "none", borderRadius: 10,
  padding: "11px 20px", fontSize: 14, fontWeight: 500, cursor: "pointer", whiteSpace: "nowrap",
};
const tabBtn: React.CSSProperties = {
  border: "none", borderRadius: 8, padding: "6px 14px", fontSize: 13, cursor: "pointer",
};
const miniBtn: React.CSSProperties = {
  background: "transparent", color: "var(--text-muted)", border: "0.5px solid var(--border)",
  borderRadius: 8, padding: "5px 12px", fontSize: 12, cursor: "pointer",
};
