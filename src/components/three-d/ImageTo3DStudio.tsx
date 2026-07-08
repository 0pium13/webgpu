"use client";

import { useEffect, useRef, useState } from "react";
import { imageTo3D, type Mesh3D, type To3DPhase } from "@/lib/imageTo3d";
import { SparkleIcon } from "@/components/Icons";

type Phase = "idle" | "working" | "done" | "error";
export type Img3DFile = { file: File; url: string };

const STEPS: { key: To3DPhase["step"]; label: string }[] = [
  { key: "download", label: "Downloading the 3D model (~840MB, once — cached after)" },
  { key: "cutout", label: "Isolating the subject" },
  { key: "understand", label: "Understanding the image" },
  { key: "imagine", label: "Imagining the hidden sides" },
  { key: "carve", label: "Carving the mesh" },
  { key: "paint", label: "Painting the surface" },
];

export default function ImageTo3DStudio({ input, onReset }: { input: Img3DFile; onReset: () => void }) {
  const viewerRef = useRef<HTMLDivElement>(null);
  const meshRef = useRef<Mesh3D | null>(null);
  const threeRef = useRef<{ dispose: () => void; scene: any; THREE: any } | null>(null);

  const [phase, setPhase] = useState<Phase>("idle");
  const [step, setStep] = useState<To3DPhase | null>(null);
  const [quality, setQuality] = useState<96 | 160 | 224>(160);
  const [stats, setStats] = useState<{ verts: number; tris: number } | null>(null);
  const [errMsg, setErrMsg] = useState("");
  const [cutoutUrl, setCutoutUrl] = useState<string | null>(null);

  async function start() {
    // this tool needs WebGPU (the 840MB model is unusable on CPU) — most
    // phones and Safari don't have it, so say so clearly instead of letting
    // the ONNX runtime throw a cryptic "no available backend found"
    if (typeof navigator !== "undefined" && !("gpu" in navigator)) {
      setErrMsg("Image → 3D needs WebGPU, which this device doesn't have. Open it on a desktop in Chrome or Edge — phones and Safari can't run it yet.");
      setPhase("error");
      return;
    }
    try {
      setPhase("working");
      const img = new Image();
      img.src = input.url;
      await new Promise((r) => (img.onload = r));
      const mesh = await imageTo3D(img, quality, (p) => {
        setStep(p);
        if (p.step === "cutout") setCutoutUrl(null);
      });
      meshRef.current = mesh;
      setCutoutUrl(mesh.cutoutUrl);
      setStats({ verts: mesh.positions.length / 3, tris: mesh.indices.length / 3 });
      setPhase("done");
      mountViewer(mesh);
    } catch (e: any) {
      console.error(e);
      const raw = String(e?.message ?? "");
      setErrMsg(
        /backend|webgpu|device lost|out of memory|oom/i.test(raw)
          ? "Couldn't start the 3D engine on this device — it needs a desktop GPU with WebGPU (Chrome or Edge). On phones/Safari it won't run."
          : raw || "Something went wrong"
      );
      setPhase("error");
    }
  }

  async function mountViewer(mesh: Mesh3D) {
    const THREE = await import("three");
    const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
    const el = viewerRef.current!;
    el.innerHTML = "";

    const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
    // The container is display:none until React re-renders with phase="done".
    // When the three.js modules come from cache, we get here BEFORE that
    // paint — clientWidth is 0 and the mesh renders into a 0x0 canvas
    // ("I see nothing"). Wait for real layout, with a bounded poll.
    for (let i = 0; i < 40 && el.clientWidth === 0; i++) {
      await new Promise((r) => requestAnimationFrame(r));
    }
    const W = el.clientWidth || 800, H = el.clientHeight || 500;
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    el.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, W / H, 0.01, 100);
    camera.position.set(1.6, 1.1, 1.6);

    // image-based lighting sells the surface far better than point lights
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    const dir = new THREE.DirectionalLight(0xffffff, 0.9);
    dir.position.set(2, 3, 2);
    scene.add(dir);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(mesh.colors, 3));
    geo.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
    geo.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0.0, envMapIntensity: 1.1, side: THREE.DoubleSide });
    const obj = new THREE.Mesh(geo, mat);
    obj.rotation.x = -Math.PI / 2; // TripoSR is z-up; three.js is y-up
    const group = new THREE.Group();
    group.add(obj);
    scene.add(group);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.6;

    let raf = 0;
    const tick = () => { controls.update(); renderer.render(scene, camera); raf = requestAnimationFrame(tick); };
    tick();

    const onResize = () => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    window.addEventListener("resize", onResize);

    threeRef.current = {
      THREE, scene,
      dispose: () => { cancelAnimationFrame(raf); window.removeEventListener("resize", onResize); controls.dispose(); renderer.dispose(); el.innerHTML = ""; },
    };
  }

  useEffect(() => () => threeRef.current?.dispose(), []);

  async function exportAs(fmt: "glb" | "obj" | "stl") {
    const three = threeRef.current;
    if (!three) return;
    const name = input.file.name.replace(/\.[^.]+$/, "");
    const save = (data: BlobPart, ext: string, mime: string) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([data], { type: mime }));
      a.download = `${name}_3d.${ext}`;
      a.click();
    };
    if (fmt === "glb") {
      const { GLTFExporter } = await import("three/examples/jsm/exporters/GLTFExporter.js");
      new GLTFExporter().parse(three.scene, (out: any) => save(out as ArrayBuffer, "glb", "model/gltf-binary"),
        (e: any) => console.error(e), { binary: true });
    } else if (fmt === "obj") {
      const { OBJExporter } = await import("three/examples/jsm/exporters/OBJExporter.js");
      save(new OBJExporter().parse(three.scene), "obj", "text/plain");
    } else {
      const { STLExporter } = await import("three/examples/jsm/exporters/STLExporter.js");
      save(new STLExporter().parse(three.scene, { binary: true }) as unknown as ArrayBuffer, "stl", "model/stl");
    }
  }

  const activeIdx = step ? STEPS.findIndex((s) => s.key === step.step) : -1;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* header row */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
          {input.file.name}
          {stats && <span style={{ color: "var(--accent)" }}> · {stats.tris.toLocaleString()} triangles · {stats.verts.toLocaleString()} vertices</span>}
        </p>
        {phase !== "working" && (
          <button onClick={onReset} style={ghost}>← New image</button>
        )}
      </div>

      {/* stage */}
      <div style={{
        position: "relative", borderRadius: 16, overflow: "hidden",
        border: "0.5px solid var(--border)", background: "radial-gradient(600px 300px at 50% 0%, rgba(99,102,241,0.08), transparent), var(--surface)",
        aspectRatio: "16/10", display: "flex", alignItems: "center", justifyContent: "center",
      }}>
        {phase !== "done" && (
          <img src={cutoutUrl ?? input.url} alt="" style={{ maxWidth: "70%", maxHeight: "80%", objectFit: "contain", opacity: phase === "working" ? 0.3 : 1 }} />
        )}
        <div ref={viewerRef} style={{ position: "absolute", inset: 0, display: phase === "done" ? "block" : "none" }} />

        {phase === "idle" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, background: "rgba(10,10,11,0.45)" }}>
            <div style={{ display: "flex", gap: 8 }}>
              {([96, 160, 224] as const).map((q) => (
                <button key={q} onClick={() => setQuality(q)} style={{
                  padding: "7px 16px", borderRadius: 8, fontSize: 13, fontWeight: 500, cursor: "pointer",
                  border: quality === q ? "0.5px solid var(--accent)" : "0.5px solid var(--border)",
                  background: quality === q ? "var(--accent-dim)" : "rgba(10,10,11,0.6)",
                  color: quality === q ? "var(--accent)" : "var(--text-muted)",
                }}>
                  {q === 96 ? "Draft · ~1 min" : q === 160 ? "High · a few min" : "Ultra · slow, finest"}
                </button>
              ))}
            </div>
            <button onClick={start} style={{
              background: "var(--accent)", color: "#fff", border: "none", borderRadius: 12,
              padding: "14px 32px", fontSize: 16, fontWeight: 500, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 9,
            }}>
              <SparkleIcon size={17} /> Generate 3D model
            </button>
            <p className="mono" style={{ fontSize: 12, color: "rgba(255,255,255,0.6)" }}>
              TripoSR · predicts the sides you can&apos;t see · runs on your GPU
            </p>
          </div>
        )}

        {phase === "working" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,10,11,0.55)", backdropFilter: "blur(3px)" }}>
            <div style={{ width: 320, maxWidth: "85%" }}>
              {STEPS.map((s, i) => {
                const isActive = i === activeIdx;
                const isDone = i < activeIdx;
                const pct = step && "pct" in step && step.step === s.key ? ` ${step.pct}%` : "";
                return (
                  <div key={s.key} style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", opacity: isDone ? 0.45 : isActive ? 1 : 0.25, transition: "opacity 0.3s" }}>
                    <span style={{
                      width: 7, height: 7, borderRadius: "50%", flexShrink: 0,
                      background: isDone ? "var(--green)" : isActive ? "var(--accent)" : "var(--border-strong)",
                      animation: isActive ? "pulse 1s ease-in-out infinite" : "none",
                    }} />
                    <span style={{ fontSize: 13, color: isActive ? "var(--text)" : "var(--text-secondary)" }}>
                      {s.label}{isActive ? pct : ""}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {phase === "error" && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(10,10,11,0.85)" }}>
            <div style={{ textAlign: "center", padding: 24 }}>
              <p style={{ color: "#ef4444", fontSize: 14, marginBottom: 12 }}>{errMsg}</p>
              <button onClick={start} style={{ background: "var(--accent)", color: "#fff", border: "none", borderRadius: 8, padding: "8px 18px", fontSize: 13, cursor: "pointer" }}>Try again</button>
            </div>
          </div>
        )}
      </div>

      {/* export row */}
      {phase === "done" && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button onClick={() => exportAs("glb")} style={primary}>↓ GLB <span style={sub}>· game engines, web</span></button>
          <button onClick={() => exportAs("obj")} style={secondary}>↓ OBJ <span style={sub}>· DCC tools</span></button>
          <button onClick={() => exportAs("stl")} style={secondary}>↓ STL <span style={sub}>· 3D printing</span></button>
          <p style={{ fontSize: 12, color: "var(--text-muted)", marginLeft: "auto" }}>
            Drag to orbit · scroll to zoom · colors baked per-vertex
          </p>
        </div>
      )}
    </div>
  );
}

const ghost: React.CSSProperties = {
  fontSize: 13, color: "var(--text-muted)", background: "transparent",
  border: "0.5px solid var(--border)", borderRadius: 8, padding: "7px 14px", cursor: "pointer",
};
const primary: React.CSSProperties = {
  background: "var(--accent)", color: "#fff", border: "none", borderRadius: 10,
  padding: "11px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer",
};
const secondary: React.CSSProperties = {
  background: "var(--surface-2)", color: "var(--text)", border: "0.5px solid var(--border)",
  borderRadius: 10, padding: "11px 18px", fontSize: 14, fontWeight: 500, cursor: "pointer",
};
const sub: React.CSSProperties = { fontSize: 11, color: "rgba(255,255,255,0.55)", fontWeight: 400 };
