"use client";

/**
 * Devanagari → Hinglish (natural chat-style Roman script).
 *
 * Why this exists: Whisper is most ACCURATE transcribing Hindi in Devanagari.
 * Forcing it to output Latin directly (language=english on Hindi audio) makes
 * it randomly translate instead of transliterate. So we let Whisper do what
 * it's best at, then deterministically romanize here — accuracy of native
 * ASR, readability of Hinglish.
 *
 * Pipeline: sanscript Devanagari→IAST, then per-word rules tuned to how
 * Indians actually type: schwa deletion (kara→kar, āpakā→aapka), positional
 * long vowels (rahā→raha but bāta→baat, ṭhīka→theek, dūra→door), nuqta
 * letters (ज़िंदगी→zindagi, फ़िल्म→film), anusvara (maiṃ→main, laṃbā→lamba).
 * Dictionary words (chahiye, zyada, wala…) bypass the letter rules entirely.
 *
 * Only Devanagari runs are converted — English words Whisper already wrote
 * in Latin (code-switched Hinglish audio) pass through untouched.
 */

import Sanscript from "@indic-transliteration/sanscript";

const VOWELS = "aāiīuūeo";

/** ultra-frequent words where letter rules can't reach the common spelling —
 *  matched on the raw IAST token, output is final (no further processing) */
const WORD_FIXES: Record<string, string> = {
  "meṃ": "mein", "nahīṃ": "nahin", "nahī~": "nahin", "hūṃ": "hoon",
  "hū~": "hoon", "kyoṃ": "kyun", "kyoṃki": "kyunki", "koī": "koi",
  "hai~": "hain", "haiṃ": "hain", "vīḍiyo": "video", "yaha": "yeh",
  "vaha": "woh", "hama": "hum", "hā~": "haan", "hāṃ": "haan",
  "yahā~": "yahan", "vahā~": "wahan", "kahā~": "kahan", "jahā~": "jahan",
  "yahāṃ": "yahan", "vahāṃ": "wahan", "kahāṃ": "kahan", "jahāṃ": "jahan",
  "matalaba": "matlab", "cāhie": "chahiye", "dījie": "dijiye",
  "kījie": "kijiye", "ja़yādā": "zyada", "vālā": "wala",
  "vāle": "wale", "vālī": "wali",
};

/**
 * Schwa deletion — the rule that makes it read like typed Hinglish instead
 * of textbook romanization: kara→kar, āpakā→aapka, karatā→karta.
 * Vowel-count guards keep short words intact (manā stays mana, not mna).
 */
function dropSchwa(core: string): string {
  const vowels = (core.match(new RegExp(`[${VOWELS}]`, "g")) ?? []).length;
  // medial schwa in the penultimate syllable: kara|nā→karnā, āpa|kā→āpkā,
  // mila|tā→miltā — 3+ vowels only, and only before long-vowel endings
  // (plain-a endings are final-schwa territory: sadaka→sadak, not sadka)
  if (vowels >= 3) {
    core = core.replace(/([^aāiīuūeoṃ~\s])a(?=[nktr][āeī]$)/u, "$1");
  }
  // final schwa: consonant + plain "a" at end, if another vowel exists
  if (/[^aāiīuūeoṃ~]a$/.test(core) && vowels >= 2) core = core.slice(0, -1);
  return core;
}

/** nuqta artifacts: sanscript leaves "़" after "Ca". If a vowel follows, the
 *  matra already supplies it (ja़i → zi); otherwise keep the inherent a. */
const NUQTA: [string, string, string][] = [
  ["jha़", "jh", "jha"], ["pha़", "f", "fa"], ["kha़", "kh", "kha"],
  ["ga़", "g", "ga"], ["ka़", "k", "ka"], ["ḍha़", "dh", "dha"],
  ["ḍa़", "d", "da"], ["ja़", "z", "za"],
];

function romanizeToken(token: string): string {
  const m = token.match(/^(.+?)([.,!?;:"']*)$/);
  if (!m) return token;
  let s = m[1];
  const punct = m[2];

  const fixed = WORD_FIXES[s];
  if (fixed) return fixed + punct;

  for (const [seq, bare, withA] of NUQTA) {
    s = s.replace(new RegExp(seq + `(?=[${VOWELS}])`, "g"), bare);
    s = s.split(seq).join(withA);
  }
  s = s.replace(/़/g, "");

  // consonant mapping BEFORE schwa deletion, so छ ("cha") becomes "chha" and
  // schwa then trims it to the final "chh" — the single-pass c/ch swap can't
  // double-apply the way chained replaces would
  s = s.replace(/jñ/g, "gy");
  s = s.replace(/ch|c/g, (x) => (x === "ch" ? "chh" : "ch"));
  s = s.replace(/ṭh/g, "th").replace(/ḍh/g, "dh").replace(/ṭ/g, "t").replace(/ḍ/g, "d");
  s = s.replace(/ś/g, "sh").replace(/ṣ/g, "sh");
  s = s.replace(/ṇ/g, "n").replace(/ñ/g, "n").replace(/ṅ/g, "n").replace(/ḷ/g, "l");
  s = s.replace(/ṛ/g, "ri").replace(/ṝ/g, "ri").replace(/ḥ/g, "h");

  s = dropSchwa(s);
  s = s.replace(/chchh/g, "chh"); // acchā → achha, not achchha

  // anusvara / candrabindu: m before labials, n otherwise. (candrabindu
  // U+0310 is a combining mark — never put it inside a character class,
  // where it decomposes and matches every plain "m")
  s = s.replace(/eṃ$/, "ein"); // bāteṃ→baatein, kareṃ→karein
  s = s.replace(/ṃ([pbm])/g, "m$1").replace(/ṃ/g, "n").replace(/~/g, "n").replace(/̐/g, "n");
  s = s.replace(/ie$/, "iye"); // polite -ie forms → -iye

  // long vowels, positional: final ā→a (rahā→raha), medial ā→aa (bāta→baat)
  s = s.replace(/āī/g, "ai"); // bhāī→bhai, mithāī→mithai
  s = s.replace(/ā(?=[\p{L}])/gu, "aa").replace(/ā/g, "a");
  s = s.replace(/ī(?=[\p{L}])/gu, "ee").replace(/ī/g, "i");
  s = s.replace(/ū(?=[\p{L}])/gu, "oo").replace(/ū/g, "u");

  // any stray combining marks
  s = s.normalize("NFD").replace(/[̀-ͯ]/g, "").normalize("NFC");
  return s + punct;
}

function iastToHinglish(iast: string): string {
  const s = iast.replace(/[।॥]/g, ".");
  return s.split(/(\s+)/).map((t) => (/^\s*$/.test(t) ? t : romanizeToken(t))).join("");
}

// ── Urdu script fallback ─────────────────────────────────────────────────────
// whisper-base often writes Hindi in Urdu script even with language=hindi
// (the bigger tiers write Devanagari). Urdu is an abjad — short vowels are
// unwritten — so this is a best-effort letter map + a dictionary of the words
// that carry most spoken Hindi, + an epenthetic "a" inside consonant
// clusters (kr→kar, rhe→rahe). sanscript's urdu scheme is broken in the JS
// port, hence hand-rolled.

const URDU_WORDS: Record<string, string> = {
  "میں": "mein", "ہیں": "hain", "نہیں": "nahin", "ہے": "hai", "ہو": "ho",
  "ہوں": "hoon", "کیا": "kya", "اور": "aur", "بھائی": "bhai",
  "چاہیے": "chahiye", "چاہی": "chahiye", "تھوڑا": "thoda", "تھورا": "thoda",
  "بہت": "bahut", "آج": "aaj", "یہ": "yeh", "وہ": "woh", "کر": "kar",
  "رہے": "rahe", "رہا": "raha", "رہی": "rahi", "ہی": "hi", "بھی": "bhi",
  "تو": "to", "سے": "se", "کے": "ke", "کی": "ki", "کا": "ka", "پر": "par",
  "مجھے": "mujhe", "تجھے": "tujhe", "ٹھیک": "theek", "اچھا": "achha",
  "آچھا": "achha", "موسم": "mausam", "پانی": "paani", "لوگ": "log",
  "ایک": "ek", "ہم": "hum", "تم": "tum", "آپ": "aap", "کو": "ko",
  "نے": "ne", "جی": "ji", "ابھی": "abhi", "کہاں": "kahan", "یہاں": "yahan",
  "وہاں": "wahan", "کچھ": "kuchh", "سب": "sab", "پھر": "phir",
};

const URDU_LETTERS: Record<string, string> = {
  "آ": "aa", "ا": "a", "ب": "b", "پ": "p", "ت": "t", "ٹ": "t", "ث": "s",
  "ج": "j", "چ": "ch", "ح": "h", "خ": "kh", "د": "d", "ڈ": "d", "ذ": "z",
  "ر": "r", "ڑ": "d", "ز": "z", "ژ": "zh", "س": "s", "ش": "sh", "ص": "s",
  "ض": "z", "ط": "t", "ظ": "z", "ع": "", "غ": "gh", "ف": "f", "ق": "q",
  "ک": "k", "گ": "g", "ل": "l", "م": "m", "ن": "n", "ں": "n", "ہ": "h",
  "ھ": "h", "ء": "", "ئ": "", "ی": "i", "ے": "e", "و": "o",
  "۔": ".", "؟": "?", "،": ",",
};
const URDU_VOWELISH = new Set(["a", "aa", "e", "i", "o", "u", ""]);

function urduWordToRoman(word: string): string {
  const bare = word.replace(/[.,!?;:۔؟،]+$/u, "");
  const punct = word.slice(bare.length).replace(/۔/g, ".").replace(/؟/g, "?").replace(/،/g, ",");
  const hit = URDU_WORDS[bare];
  if (hit) return hit + punct;

  // char → unit list, folding ھ aspiration into the previous consonant
  const units: string[] = [];
  for (const ch of bare) {
    // strip harakat if present
    if (/[ً-ٰٟ]/u.test(ch)) continue;
    const mapped = URDU_LETTERS[ch];
    if (mapped === undefined) { units.push(ch); continue; }
    if (ch === "ھ" && units.length) units[units.length - 1] += "h";
    else if (mapped !== "") units.push(mapped);
  }
  // ی before a vowel acts as y (kya), word-initial و as w (wala)
  for (let i = 0; i < units.length; i++) {
    if (units[i] === "i" && i + 1 < units.length && URDU_VOWELISH.has(units[i + 1])) units[i] = "y";
    if (units[i] === "o" && i === 0 && units.length > 1 && !URDU_VOWELISH.has(units[1])) units[i] = "w";
  }
  // word-initial ا + i/o → i/o (اِس→is), not "ai"/"ao"
  if (units[0] === "a" && units.length > 1 && (units[1] === "i" || units[1] === "o")) units.shift();

  // epenthetic a inside consonant clusters, one per pair: kr→kar, rhe→rahe
  const out: string[] = [];
  for (let i = 0; i < units.length; i++) {
    out.push(units[i]);
    if (i + 1 < units.length && !URDU_VOWELISH.has(units[i]) && !URDU_VOWELISH.has(units[i + 1])) {
      out.push("a");
      out.push(units[i + 1]);
      i++;
    }
  }
  let s = out.join("");
  // final cluster ending got no vowel: krte→karte handled; trailing "h" ok
  return s + punct;
}

function urduToHinglish(run: string): string {
  return run.split(/(\s+)/).map((t) => (/^\s*$/.test(t) ? t : urduWordToRoman(t))).join("");
}

/** Romanize Devanagari AND Urdu-script runs in a line; Latin is untouched. */
export function toHinglish(text: string): string {
  return text
    .replace(/[ऀ-ॿ][ऀ-ॿ\s.,!?;:"'-]*[ऀ-ॿ]|[ऀ-ॿ]/g, (run) =>
      iastToHinglish(Sanscript.t(run, "devanagari", "iast"))
    )
    .replace(/[؀-ۿ][؀-ۿ\s.,!?;:"'-]*[؀-ۿ]|[؀-ۿ]/g,
      (run) => urduToHinglish(run)
    );
}
