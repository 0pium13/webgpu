// Post-build step for the Cloudflare Pages static export (out/).
//
// onnxruntime-web references its wasm binaries via `new URL(..., import.meta.url)`,
// so the bundler copies them into out/_next/static/media even though nothing
// loads them from our origin: transformers.js and src/lib/ortRuntime.ts both
// point wasmPaths at jsDelivr. One of them (25.6 MiB) is over Cloudflare Pages'
// 25 MiB per-file limit and would fail the deploy, so drop them all.
import { readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const OUT = "out";
const MAX_BYTES = 25 * 1024 * 1024;

const media = join(OUT, "_next/static/media");
let pruned = 0;
for (const f of readdirSync(media)) {
  if (/^ort-wasm.*\.wasm$/.test(f)) {
    rmSync(join(media, f));
    pruned++;
  }
}

const tooBig = [];
const walk = (dir) => {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    const s = statSync(p);
    if (s.isDirectory()) walk(p);
    else if (s.size > MAX_BYTES) tooBig.push(`${p} (${(s.size / 1048576).toFixed(1)} MiB)`);
  }
};
walk(OUT);

console.log(`prune-export: removed ${pruned} unused ort-wasm binaries`);
if (tooBig.length) {
  console.error(`prune-export: files over Cloudflare Pages' 25 MiB limit:\n  ${tooBig.join("\n  ")}`);
  process.exit(1);
}
