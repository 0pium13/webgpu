"use client";

/**
 * Small markdown renderer for chat replies — React elements only.
 *
 * Model output is untrusted (one of the chat models is unfiltered), so this
 * never emits raw HTML: every node is a React element, `<tags>` stay text and
 * links are limited to http(s). It re-renders on every streamed token, so each
 * block is memoized on its source text and only the block still being written
 * re-parses its inline markup.
 */

import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";

type Align = "left" | "center" | "right" | undefined;

type Block =
  | { t: "p"; src: string; text: string }
  | { t: "h"; src: string; level: number; text: string }
  | { t: "hr"; src: string }
  | { t: "code"; src: string; lang: string; code: string }
  | { t: "quote"; src: string; children: Block[] }
  | { t: "list"; src: string; ordered: boolean; start: number; tight: boolean; items: Item[] }
  | { t: "table"; src: string; align: Align[]; head: string[]; rows: string[][] };

interface Item { src: string; children: Block[] }

/* ── blocks ─────────────────────────────────────────────────────────────── */

const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$/;
const FENCE_END = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
const HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const LIST = /^( *)([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/;
const TABLE_DELIM = /^ *\|? *:?-+:? *(?:\| *:?-+:? *)*\|? *$/;
const PARTIAL_DELIM = /^ *\|[ :|-]*$/;
// While streaming, a last line that is only a marker is ambiguous ("-" may
// become a bullet or a rule, "``" a fence, "1" a list) — hide it for a token.
const UNSTABLE_TAIL = /^ *(?:[-*+_#>~`|]{1,3}|\d{1,9}[.)]?) *$/;

interface Fence { indent: number; ch: string; len: number; lang: string }

function fenceOpen(line: string): Fence | null {
  const m = FENCE.exec(line);
  if (!m || (m[2][0] === "`" && m[3].includes("`"))) return null;
  return { indent: m[1].length, ch: m[2][0], len: m[2].length, lang: m[3].trim().split(/\s+/)[0].slice(0, 24) };
}

function fenceCloses(line: string, f: Fence): boolean {
  const m = FENCE_END.exec(line);
  return !!m && m[1][0] === f.ch && m[1].length >= f.len;
}

const isBlank = (l: string | undefined) => !l || l.trim() === "";
function indentOf(l: string): number {
  let k = 0;
  while (l.charCodeAt(k) === 32) k++;
  return k;
}
const dedent = (l: string, max: number) => l.slice(Math.min(indentOf(l), max));
const isList = (l: string) => LIST.test(l) && !HR.test(l);
const isTableStart = (lines: string[], i: number) =>
  i + 1 < lines.length && lines[i].includes("|") && lines[i + 1].includes("|") && TABLE_DELIM.test(lines[i + 1]);
// streaming only: a pipe row whose delimiter row hasn't fully arrived yet
const isPendingTable = (lines: string[], i: number, tail: boolean) =>
  tail && /^ *\|/.test(lines[i]) &&
  (i === lines.length - 1 || (i === lines.length - 2 && PARTIAL_DELIM.test(lines[i + 1])));

/** Can line i end a paragraph without a blank line before it? */
function interrupts(lines: string[], i: number, tail: boolean): boolean {
  const l = lines[i];
  if (fenceOpen(l) || HEADING.test(l) || HR.test(l) || QUOTE.test(l)) return true;
  if (isTableStart(lines, i) || isPendingTable(lines, i, tail)) return true;
  // like CommonMark: only a non-empty item, and an ordered list only from 1
  // ("…grew in\n2024. Then…" stays prose)
  const m = LIST.exec(l);
  return !!m && !isBlank(m[4]) && (!/\d/.test(m[2]) || parseInt(m[2], 10) === 1);
}

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let k = 0; k < s.length; k++) {
    if (s[k] === "\\" && s[k + 1] === "|") { cur += "|"; k++; }
    else if (s[k] === "|") { cells.push(cur.trim()); cur = ""; }
    else cur += s[k];
  }
  cells.push(cur.trim());
  return cells;
}

function alignOf(cell: string): Align {
  const l = cell.startsWith(":"), r = cell.endsWith(":");
  return l && r ? "center" : r ? "right" : l ? "left" : undefined;
}

const fit = (cells: string[], n: number) =>
  cells.length >= n ? cells.slice(0, n) : cells.concat(Array<string>(n - cells.length).fill(""));

function parseBlocks(lines: string[], tail: boolean, depth = 0): Block[] {
  const n = lines.length;
  // "- - - - … x" or "> > > …" nests one level per marker; past this, plain text
  if (depth > 12) { const src = lines.join("\n"); return src.trim() ? [{ t: "p", src, text: src.trim() }] : []; }
  const out: Block[] = [];
  let i = 0;
  while (i < n) {
    const line = lines[i];
    if (isBlank(line)) { i++; continue; }
    const src = (end: number) => lines.slice(i, end).join("\n");

    const f = fenceOpen(line);
    if (f) {
      let j = i + 1;
      const code: string[] = [];
      while (j < n && !fenceCloses(lines[j], f)) code.push(dedent(lines[j++], f.indent));
      // an unclosed fence (still streaming, or cut off) runs to the end
      const end = Math.min(j + 1, n);
      out.push({ t: "code", src: src(end), lang: f.lang, code: code.join("\n") });
      i = end;
      continue;
    }

    const h = HEADING.exec(line);
    if (h) {
      out.push({ t: "h", src: line, level: h[1].length, text: (h[2] ?? "").replace(/(?:^|[ \t]+)#+$/, "") });
      i++;
      continue;
    }

    if (HR.test(line)) {
      out.push({ t: "hr", src: line });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const inner: string[] = [];
      let j = i;
      for (; j < n; j++) {
        const l = lines[j];
        if (QUOTE.test(l)) inner.push(l.replace(QUOTE, ""));
        else if (!isBlank(l) && !isBlank(inner[inner.length - 1]) && !interrupts(lines, j, tail)) inner.push(l);
        else break;
      }
      out.push({ t: "quote", src: src(j), children: parseBlocks(inner, tail && j >= n, depth + 1) });
      i = j;
      continue;
    }

    const full = isTableStart(lines, i);
    if (full || isPendingTable(lines, i, tail)) {
      const head = splitRow(line);
      const rows: string[][] = [];
      let j = n;
      if (full) {
        for (j = i + 2; j < n && !isBlank(lines[j]) && lines[j].includes("|"); j++) rows.push(fit(splitRow(lines[j]), head.length));
      }
      const align = full ? splitRow(lines[i + 1]).map(alignOf) : [];
      out.push({ t: "table", src: src(j), align, head, rows });
      i = j;
      continue;
    }

    if (isList(line)) {
      const [b, j] = parseList(lines, i, tail, depth);
      out.push(b);
      i = j;
      continue;
    }

    let j = i + 1;
    while (j < n && !isBlank(lines[j]) && !interrupts(lines, j, tail)) j++;
    out.push({ t: "p", src: src(j), text: lines.slice(i, j).map((l) => l.trim()).join("\n") });
    i = j;
  }
  return out;
}

/**
 * Lenient about indentation on purpose: models nest with 2, 3 or 4 spaces, so
 * any line indented past an item's marker belongs to that item — except a
 * same-kind item starting left of the content column, which is a sibling
 * (as in CommonMark).
 */
function parseList(lines: string[], i: number, tail: boolean, depth: number): [Block, number] {
  const n = lines.length;
  const first = LIST.exec(lines[i])!;
  const ordered = /\d/.test(first[2]);
  const items: Item[] = [];
  let tight = true;
  let j = i;
  for (;;) {
    const m = LIST.exec(lines[j])!;
    const indent = m[1].length;
    const pad = m[3]?.length ?? 0;
    const col = indent + m[2].length + (pad >= 1 && pad <= 4 ? pad : 1);
    const body = [m[4] ?? ""];
    let fence = fenceOpen(body[0]);
    let lazy = !fence && !isBlank(body[0]);
    const sibling = (l: string) => {
      const x = LIST.exec(l);
      return !!x && !HR.test(l) && /\d/.test(x[2]) === ordered && indentOf(l) < col;
    };
    let k = j + 1;
    while (k < n) {
      const l = lines[k];
      if (fence) {
        const d = dedent(l, col);
        body.push(d);
        if (fenceCloses(d, fence)) fence = null;
        lazy = false;
        k++;
        continue;
      }
      if (isBlank(l)) {
        let q = k + 1;
        while (q < n && isBlank(lines[q])) q++;
        if (q >= n || indentOf(lines[q]) <= indent || sibling(lines[q])) break;
        while (k < q) { body.push(""); k++; }
        tight = false;
        lazy = false;
        continue;
      }
      if (indentOf(l) > indent && !sibling(l)) {
        const d = dedent(l, col);
        body.push(d);
        fence = fenceOpen(d);
        lazy = !fence;
        k++;
        continue;
      }
      const x = isList(l) ? LIST.exec(l) : null;
      if ((x && /\d/.test(x[2]) === ordered) || !lazy || interrupts(lines, k, tail)) break;
      body.push(l.trim()); // lazy continuation of the item's paragraph
      k++;
    }
    items.push({ src: body.join("\n"), children: parseBlocks(body, tail && k >= n, depth + 1) });

    let q = k;
    while (q < n && isBlank(lines[q])) q++;
    const next = q < n && isList(lines[q]) ? LIST.exec(lines[q]) : null;
    if (!next || /\d/.test(next[2]) !== ordered) { j = k; break; }
    if (q > k) tight = false;
    j = q;
  }
  return [{
    t: "list", src: lines.slice(i, j).join("\n"), ordered,
    start: ordered ? parseInt(first[2], 10) : 1, tight, items,
  }, j];
}

/* ── inline ─────────────────────────────────────────────────────────────── */

interface Ctx {
  key: number;
  nest: number;
  /** closer searches that already failed, as [from, to] — keeps a run of unmatched `*` linear */
  miss: Record<string, [number, number]>;
}

const PUNCT = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
const SPECIAL = "\\`*_~[!<h";
const URL_RE = /https?:\/\/[^\s<>"'`]+/y;
const isSpace = (c: string | undefined) => c === undefined || c === " " || c === "\n" || c === "\t";
const isWord = (c: string | undefined) => !!c && (/[A-Za-z0-9]/.test(c) || c.charCodeAt(0) > 127);

function runOf(s: string, i: number, to: number, ch: string): number {
  let k = i;
  while (k < to && s[k] === ch) k++;
  return k - i;
}

function safeHref(raw: string): string | null {
  const h = raw.trim().replace(/\\([^A-Za-z0-9])/g, "$1");
  if (!/^https?:\/\//i.test(h)) return null;
  try {
    const u = new URL(h);
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null;
  } catch {
    return null;
  }
}

function renderInline(text: string, tail: boolean): ReactNode[] {
  let to = text.length;
  // A trailing delimiter is either a closer (auto-closed below) or an opener
  // with nothing after it yet — dropping it renders the same either way.
  if (tail) while (to > 0 && "*_~`".includes(text[to - 1])) to--;
  return inline(text, 0, to, tail, false, { key: 0, nest: 0, miss: {} });
}

/** `open`: this range ends at the streaming cursor, so unclosed markup is auto-closed. */
function inline(s: string, from: number, to: number, open: boolean, inLink: boolean, ctx: Ctx): ReactNode[] {
  const out: ReactNode[] = [];
  let start = from; // start of pending plain text
  const flush = (end: number) => {
    if (end <= start) return;
    s.slice(start, end).split("\n").forEach((part, k) => {
      if (k) out.push(<br key={ctx.key++} />);
      if (part) out.push(part);
    });
  };
  const emit = (at: number, node: ReactNode, end: number) => {
    flush(at);
    out.push(node);
    start = end;
    return end;
  };

  let i = from;
  while (i < to) {
    const c = s[i];
    if (!SPECIAL.includes(c)) { i++; continue; }

    if (c === "\\" && i + 1 < to) {
      const nx = s[i + 1];
      if (nx === "\n") { i = emit(i, <br key={ctx.key++} />, i + 2); continue; }
      if (PUNCT.includes(nx)) { flush(i); start = i + 1; i += 2; continue; }
    } else if (c === "`") {
      const n = runOf(s, i, to, "`");
      const close = findTicks(s, i + n, to, n, ctx);
      if (close >= 0 || open) {
        const body = s.slice(i + n, close >= 0 ? close : to);
        i = emit(i, <code key={ctx.key++} className="mono" style={S.code}>{codeText(body)}</code>, close >= 0 ? close + n : to);
        continue;
      }
      i += n;
      continue;
    } else if (c === "*" || c === "_" || c === "~") {
      const r = emphasis(s, i, to, open, inLink, ctx);
      if (r) { i = emit(i, r.node, r.end); continue; }
      i += runOf(s, i, to, c);
      continue;
    } else if (c === "[" || (c === "!" && s[i + 1] === "[")) {
      const img = c === "!";
      const l = scanLink(s, img ? i + 1 : i, to, open);
      if (l) {
        const label = img ? s.slice(l.from, l.to) || "image" : inline(s, l.from, l.to, false, true, ctx);
        const href = inLink ? null : safeHref(l.href);
        const node = href
          ? <a key={ctx.key++} href={href} target="_blank" rel="noopener noreferrer nofollow" style={S.link}>{label}</a>
          : <span key={ctx.key++} style={l.pending && !inLink ? S.link : undefined}>{label}</span>;
        i = emit(i, node, l.end);
        continue;
      }
    } else if (c === "<") {
      const br = /^<br ?\/?>/i.exec(s.slice(i, Math.min(to, i + 6)));
      if (br) { i = emit(i, <br key={ctx.key++} />, i + br[0].length); continue; }
      const auto = /^<(https?:\/\/[^\s<>]+)>/i.exec(s.slice(i, Math.min(to, i + 2048)));
      const href = auto && !inLink ? safeHref(auto[1]) : null;
      if (auto && href) {
        i = emit(i, <a key={ctx.key++} href={href} target="_blank" rel="noopener noreferrer nofollow" style={S.link}>{auto[1]}</a>, i + auto[0].length);
        continue;
      }
    } else if (c === "h" && !inLink && !isWord(s[i - 1]) && (s.startsWith("https://", i) || s.startsWith("http://", i))) {
      const end = bareUrl(s, i, to);
      const href = end > 0 ? safeHref(s.slice(i, end)) : null;
      if (href) {
        i = emit(i, <a key={ctx.key++} href={href} target="_blank" rel="noopener noreferrer nofollow" style={S.link}>{s.slice(i, end)}</a>, end);
        continue;
      }
    }
    i++;
  }
  flush(to);
  return out;
}

function findTicks(s: string, from: number, to: number, n: number, ctx: Ctx): number {
  const key = "`" + n;
  const miss = ctx.miss[key];
  if (miss && from >= miss[0] && to <= miss[1]) return -1;
  for (let j = s.indexOf("`", from); j >= 0 && j < to; ) {
    const r = runOf(s, j, to, "`");
    if (r === n) return j;
    j = s.indexOf("`", j + r);
  }
  ctx.miss[key] = [from, to];
  return -1;
}

function codeText(raw: string): string {
  const t = raw.replace(/\n/g, " ");
  return t.length > 2 && t[0] === " " && t[t.length - 1] === " " && t.trim() ? t.slice(1, -1) : t;
}

/** Returns [end of inner text, end of closing run]. */
function findCloser(s: string, from: number, to: number, ch: string, len: number, ctx: Ctx): [number, number] | null {
  const key = ch + len;
  const miss = ctx.miss[key];
  if (miss && from >= miss[0] && to <= miss[1]) return null;
  for (let j = from; j < to; ) {
    const c = s[j];
    if (c === "\\") { j += 2; continue; }
    if (c === "`") {
      const r = runOf(s, j, to, "`");
      const e = findTicks(s, j + r, to, r, ctx);
      j = e < 0 ? j + r : e + r;
      continue;
    }
    if (c === ch) {
      const m = runOf(s, j, to, ch);
      if (!isSpace(s[j - 1]) && (m === len || m >= 3) && !(ch === "_" && isWord(s[j + m]))) return [j + m - len, j + m];
      j += m;
      continue;
    }
    j++;
  }
  ctx.miss[key] = [from, to];
  return null;
}

function emphasis(s: string, i: number, to: number, open: boolean, inLink: boolean, ctx: Ctx): { node: ReactNode; end: number } | null {
  const ch = s[i];
  const n = runOf(s, i, to, ch);
  if (i + n >= to || isSpace(s[i + n]) || ctx.nest > 12) return null;
  if (ch === "_" && isWord(s[i - 1])) return null; // snake_case_names
  if (ch === "~" && n !== 2) return null;
  // ***a** b* is em(strong(a) b): try the single-char closer before the double
  const lens = ch === "~" ? [2] : n === 1 ? [1] : n === 2 ? [2, 1] : [3, 1, 2];
  let len = 0, innerEnd = to, end = to;
  for (const l of lens) {
    const c = findCloser(s, i + n, to, ch, l, ctx);
    if (c) { len = l; [innerEnd, end] = c; break; }
  }
  if (!len) {
    if (!open) return null;
    len = ch === "~" ? 2 : Math.min(n, 3);
  }
  ctx.nest++;
  const kids = inline(s, i + len, innerEnd, open && innerEnd === to, inLink, ctx);
  ctx.nest--;
  const key = ctx.key++;
  const node = ch === "~" ? <del key={key} style={S.del}>{kids}</del>
    : len === 3 ? <strong key={key} style={S.strong}><em>{kids}</em></strong>
    : len === 2 ? <strong key={key} style={S.strong}>{kids}</strong>
    : <em key={key}>{kids}</em>;
  return { node, end };
}

interface LinkScan { from: number; to: number; href: string; end: number; pending: boolean }

/** `[label](url "title")` starting at s[i] === "[". */
function scanLink(s: string, i: number, to: number, open: boolean): LinkScan | null {
  let depth = 0, j = i;
  const labelMax = Math.min(to, i + 1000);
  for (; j < labelMax; j++) {
    const c = s[j];
    if (c === "\\") j++;
    else if (c === "[") depth++;
    else if (c === "]" && --depth === 0) break;
  }
  if (j >= labelMax || j + 1 >= to || s[j + 1] !== "(") return null;
  const label = { from: i + 1, to: j };
  // half-written destination at the streaming cursor: show the label as a link-to-be
  const ranOut = (): LinkScan | null => (open ? { ...label, href: "", end: to, pending: true } : null);
  const max = Math.min(to, j + 2050);
  let k = j + 2;
  while (k < max && isSpace(s[k])) k++;
  let href: string;
  if (s[k] === "<") {
    const e = s.indexOf(">", k);
    if (e < 0 || e >= max) return ranOut();
    href = s.slice(k + 1, e);
    k = e + 1;
  } else {
    const st = k;
    for (let p = 0; k < max; k++) {
      const c = s[k];
      if (c === "\\") k++;
      else if (c === "(") p++;
      else if (c === ")" && p-- === 0) break;
      else if (c === " " || c === "\n" || c === "\t") break;
    }
    href = s.slice(st, k);
  }
  while (k < max && isSpace(s[k])) k++;
  const q = s[k];
  if (k < max && (q === "\"" || q === "'" || q === "(")) {
    const e = s.indexOf(q === "(" ? ")" : q, k + 1);
    if (e < 0 || e >= max) return ranOut();
    k = e + 1;
    while (k < max && isSpace(s[k])) k++;
  }
  if (k < max && s[k] === ")") return { ...label, href, end: k + 1, pending: false };
  return k >= to ? ranOut() : null;
}

function bareUrl(s: string, i: number, to: number): number {
  URL_RE.lastIndex = i;
  const m = URL_RE.exec(s);
  if (!m) return -1;
  let end = Math.min(i + m[0].length, to);
  const count = (ch: string) => { let c = 0; for (let k = i; k < end; k++) if (s[k] === ch) c++; return c; };
  // trailing punctuation is prose, not URL — but keep a balanced ")" (wikipedia-style links)
  while (end > i) {
    const c = s[end - 1];
    if (".,;:!?*_~]".includes(c) || (c === ")" && count("(") < count(")"))) end--;
    else break;
  }
  return /^https?:\/\/[^/?#]*[A-Za-z0-9]/.test(s.slice(i, end)) ? end : -1;
}

/* ── rendering ──────────────────────────────────────────────────────────── */

const S = {
  root: { overflowWrap: "break-word", minWidth: 0 },
  strong: { fontWeight: 600 },
  del: { color: "var(--text-muted)" },
  code: {
    fontSize: "0.86em", padding: "0.12em 0.4em", borderRadius: 5,
    background: "var(--canvas)", border: "0.5px solid var(--border)",
    boxDecorationBreak: "clone", WebkitBoxDecorationBreak: "clone",
  },
  link: {
    color: "var(--accent)", textDecoration: "underline", textDecorationColor: "var(--accent-border)",
    textDecorationThickness: 1, textUnderlineOffset: 3,
  },
  codeBlock: { border: "0.5px solid var(--border)", borderRadius: 10, background: "var(--canvas)", overflow: "hidden" },
  codeHead: {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10,
    padding: "5px 6px 5px 12px", background: "var(--surface)", borderBottom: "0.5px solid var(--border)",
  },
  codeLang: { fontSize: 10.5, letterSpacing: "0.06em", color: "var(--text-muted)" },
  copy: {
    background: "transparent", border: "0.5px solid var(--border)", borderRadius: 6,
    fontSize: 10.5, padding: "2px 9px", cursor: "pointer",
  },
  pre: {
    margin: 0, padding: "12px 14px", overflowX: "auto", whiteSpace: "pre", overflowWrap: "normal",
    fontSize: 12.5, lineHeight: 1.65, tabSize: 2, color: "var(--text)", scrollbarWidth: "thin",
  },
  quote: { margin: 0, padding: "1px 0 1px 14px", borderLeft: "2px solid var(--accent-border)", color: "var(--text-secondary)" },
  hr: { border: 0, borderTop: "0.5px solid var(--border-strong)", marginBottom: 0 },
  tableWrap: { overflowX: "auto", border: "0.5px solid var(--border)", borderRadius: 10, scrollbarWidth: "thin" },
  table: { borderCollapse: "collapse", width: "100%", fontSize: 13, lineHeight: 1.5 },
  th: { padding: "8px 12px", fontWeight: 600, background: "var(--surface)", borderBottom: "0.5px solid var(--border-strong)" },
  td: { padding: "8px 12px", borderTop: "0.5px solid var(--border)", verticalAlign: "top" },
} satisfies Record<string, CSSProperties>;

// In-bubble headings sit under the page's own h1/h2, so # renders as h3.
const HEADINGS = [
  { tag: "h3", style: { fontSize: 18, fontWeight: 600, letterSpacing: "-0.02em", lineHeight: 1.35 } },
  { tag: "h4", style: { fontSize: 16, fontWeight: 600, letterSpacing: "-0.015em", lineHeight: 1.4 } },
  { tag: "h5", style: { fontSize: 14.5, fontWeight: 600, letterSpacing: "-0.01em", lineHeight: 1.45 } },
  { tag: "h6", style: { fontSize: 13, fontWeight: 600, letterSpacing: "0.01em", lineHeight: 1.5, color: "var(--text-secondary)" } },
] as const satisfies readonly { tag: string; style: CSSProperties }[];

const BULLETS = ["disc", "circle", "square"];

function spaceFor(prev: Block | undefined, cur: Block, gap: number): number {
  if (!prev) return 0;
  if (cur.t === "h") return gap + 8;
  if (prev.t === "h") return Math.max(4, gap - 4);
  if (cur.t === "hr" || prev.t === "hr") return gap + 4;
  return gap;
}

function Blocks({ blocks, tail, gap, depth }: { blocks: Block[]; tail: boolean; gap: number; depth: number }) {
  return blocks.map((b, i) => (
    <BlockView key={i} b={b} tail={tail && i === blocks.length - 1} space={spaceFor(blocks[i - 1], b, gap)} depth={depth} />
  ));
}

interface BlockProps { b: Block; tail: boolean; space: number; depth: number }

const BlockView = memo(function BlockView({ b, tail, space, depth }: BlockProps) {
  switch (b.t) {
    case "p":
      return <p style={{ margin: 0, marginTop: space }}>{renderInline(b.text, tail)}</p>;
    case "h": {
      const { tag: Tag, style } = HEADINGS[Math.min(b.level, 4) - 1];
      return <Tag style={{ ...style, margin: 0, marginTop: space }}>{renderInline(b.text, tail)}</Tag>;
    }
    case "hr":
      return <hr style={{ ...S.hr, marginTop: space }} />;
    case "code":
      return <CodeBlock lang={b.lang} code={b.code} space={space} />;
    case "quote":
      return (
        <blockquote style={{ ...S.quote, marginTop: space }}>
          <Blocks blocks={b.children} tail={tail} gap={8} depth={depth} />
        </blockquote>
      );
    case "list": {
      const Tag = b.ordered ? "ol" : "ul";
      return (
        <Tag
          start={b.ordered && b.start !== 1 ? b.start : undefined}
          style={{
            margin: 0, marginTop: space, paddingLeft: b.ordered ? 24 : 20,
            listStyleType: b.ordered ? "decimal" : BULLETS[depth % BULLETS.length],
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {b.items.map((it, i) => (
            <ListItem key={i} item={it} tail={tail && i === b.items.length - 1} tight={b.tight} first={i === 0} depth={depth} />
          ))}
        </Tag>
      );
    }
    case "table":
      return (
        <div style={{ ...S.tableWrap, marginTop: space }}>
          <table style={S.table}>
            <thead>
              <tr>
                {b.head.map((c, k) => (
                  <th key={k} style={{ ...S.th, textAlign: b.align[k] ?? "left" }}>{renderInline(c, tail && !b.rows.length)}</th>
                ))}
              </tr>
            </thead>
            {b.rows.length > 0 && (
              <tbody>
                {b.rows.map((r, ri) => (
                  <tr key={ri}>
                    {r.map((c, k) => (
                      <td key={k} style={{ ...S.td, textAlign: b.align[k] ?? "left" }}>{renderInline(c, tail && ri === b.rows.length - 1)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            )}
          </table>
        </div>
      );
  }
}, (a, b) => a.b.src === b.b.src && a.b.t === b.b.t && a.tail === b.tail && a.space === b.space && a.depth === b.depth);

interface ItemProps { item: Item; tail: boolean; tight: boolean; first: boolean; depth: number }

const ListItem = memo(function ListItem({ item, tail, tight, first, depth }: ItemProps) {
  // the li colour tints only the marker; content gets the normal text colour
  return (
    <li style={{ marginTop: first ? 0 : tight ? 4 : 8, paddingLeft: 2, color: "var(--text-muted)" }}>
      <div style={{ color: "var(--text)" }}>
        <Blocks blocks={item.children} tail={tail} gap={tight ? 4 : 8} depth={depth + 1} />
      </div>
    </li>
  );
}, (a, b) => a.item.src === b.item.src && a.tail === b.tail && a.tight === b.tight && a.first === b.first && a.depth === b.depth);

function CodeBlock({ lang, code, space }: { lang: string; code: string; space: number }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function copy() {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1600);
    }, () => { /* clipboard blocked: nothing to undo */ });
  }

  return (
    <div style={{ ...S.codeBlock, marginTop: space }}>
      <div style={S.codeHead}>
        <span className="mono" style={S.codeLang}>{lang || "code"}</span>
        <button type="button" onClick={copy} className="mono" style={{ ...S.copy, color: copied ? "var(--accent)" : "var(--text-muted)" }}>
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="mono" style={S.pre}><code>{code || " "}</code></pre>
    </div>
  );
}

function toLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n")
    .map((l) => (l.includes("\t") ? l.replace(/^[ \t]+/, (ws) => ws.replace(/\t/g, "    ")) : l));
}

function stableTail(text: string): string {
  const t = text.trimEnd();
  const nl = t.lastIndexOf("\n");
  return UNSTABLE_TAIL.test(t.slice(nl + 1)) ? t.slice(0, Math.max(nl, 0)) : t;
}

/**
 * `streaming`: the text is still arriving — unclosed `**bold`, `code` and
 * links render as if closed, and a half-typed marker line is held back.
 */
function Markdown({ text, streaming = false }: { text: string; streaming?: boolean }) {
  const blocks = useMemo(
    () => parseBlocks(toLines(streaming ? stableTail(text) : text), streaming),
    [text, streaming]
  );
  return (
    <div style={S.root}>
      <Blocks blocks={blocks} tail={streaming} gap={10} depth={0} />
    </div>
  );
}

export default memo(Markdown);
