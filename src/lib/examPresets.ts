/**
 * Exam photo / signature upload specs, researched against 2025–26 notices.
 *
 * `verified: true` means the numbers were read from the official notice
 * itself (URL in `source`). `verified: false` means the official PDF could
 * not be opened, so the values come from coaching / news sites quoting it;
 * where those disagreed, the KB window is the intersection of the quoted
 * ranges so the output passes whichever one is right.
 *
 * Several notices give only a KB range (NTA, UPSC) or a size in cm (SSC,
 * RRB). For those the pixel size is our choice inside the stated limits and
 * `pxChosen` says so in the UI.
 */

export type ExamMode = "photo" | "signature" | "thumb" | "declaration";

export interface ExamPreset {
  id: string;
  /** Exam family id — keeps the same exam selected across modes. */
  examId: string;
  /** Short exam name used in UI copy and the download filename. */
  exam: string;
  /** Picker label. */
  label: string;
  group: string;
  mode: ExamMode;
  width: number;
  height: number;
  minKB: number;
  maxKB: number;
  /** Written into the JPEG's JFIF density when set. */
  dpi?: number;
  /** Physical size the notice asks for, shown alongside the pixels. */
  physical?: string;
  /** Pixel size picked by us inside the notice's limits. */
  pxChosen?: boolean;
  /**
   * Exact pixels are mandatory. Otherwise (the notice says "preferred", gives
   * a range, or only cm) the output may grow, same shape, when a clean image
   * can't reach the minimum KB even at quality 100.
   */
  pxFixed?: boolean;
  /** Upper pixel bound when the notice gives a range. */
  pxMax?: [number, number];
  /** Head (crown to chin) as a fraction of the photo height. */
  face?: number;
  /** Name + date printed on the photo. */
  nameDate?: boolean;
  notes: string[];
  source: { label: string; url: string };
  verified: boolean;
  /** Extra search terms for the picker. */
  aliases?: string;
  ext?: "jpg" | "jpeg";
}

export const MODE_LABEL: Record<ExamMode, string> = {
  photo: "Photo",
  signature: "Signature",
  thumb: "Thumb",
  declaration: "Declaration",
};

export const GROUP_ORDER = ["UPSC", "SSC", "Banking", "Railways", "NTA", "GATE", "State PSC"];

const IBPS_SRC = {
  label: "IBPS CRP PO/MT-XVI notification (Jun 2026)",
  url: "https://www.ibps.in/wp-content/uploads/Detailed-Notification_CRP-PO-XVI_Final_V1_30.06.2026.pdf",
};
const SBI_SRC = {
  label: "SBI Junior Associates 2025 detailed advertisement",
  url: "https://sbi.co.in/documents/77530/52947104/JA+2025+-Detailed+Advt.pdf",
};
const NEET_SRC = {
  label: "NTA NEET (UG) 2026 Information Bulletin",
  url: "https://cdnbbsr.s3waas.gov.in/s37bc1ec1d9c3426357e69acd5bf320061/uploads/2026/02/202602231394640855.pdf",
};
const JEE_SRC = {
  label: "NTA JEE (Main) 2026 Information Bulletin",
  url: "https://cdnbbsr.s3waas.gov.in/s3f8e59f4b2fe7c5705bf878bbd494ccdf/uploads/2025/11/202511021649722475.pdf",
};
const CUET_SRC = {
  label: "NTA CUET (UG) 2026 Information Bulletin",
  url: "https://cdnbbsr.s3waas.gov.in/s3d1a21da7bca4abff8b0b61b87597de73/uploads/2026/01/202601031633478370.pdf",
};
const GATE_SRC = {
  label: "GATE 2027 (IIT Madras) photo & signature rules",
  url: "https://gate2027.iitm.ac.in/photograph_and_signature",
};

const BANK_PHOTO_NOTES = [
  "Recent passport-style colour photo, light (preferably white) background",
  "No cap or dark glasses; religious headwear must not cover the face",
  "You also capture a live photo in the form — keep the same look",
];
const BANK_SIGN_NOTES = [
  "Black ink on white paper, running hand — NOT in capital letters",
];
const BANK_THUMB_NOTES = [
  "Left thumb, black or blue ink on white paper",
  "No left thumb? Use the right thumb and say so in the image (see notice)",
];
const BANK_DECL_NOTES = [
  "Your own handwriting, English, black ink, NOT in capital letters",
  "Text: “I, (Name of the candidate), hereby declare that all the information submitted by me in the application form is correct, true and valid. I will present the supporting documents as and when required.”",
];

export const PRESETS: ExamPreset[] = [
  // ── UPSC ────────────────────────────────────────────────────────────────
  {
    id: "upsc-photo", examId: "upsc", exam: "UPSC", label: "UPSC — CSE / OTR / CAF", group: "UPSC",
    mode: "photo", width: 350, height: 450, minKB: 20, maxKB: 200, pxChosen: true, pxMax: [1000, 1000],
    face: 0.78, nameDate: true,
    notes: [
      "Name and the date the photo was taken must be printed on it",
      "Photo not older than 10 days from the start of the application",
      "Face ~3/4 of the photo, both ears visible, plain white background",
      "A live photo is also captured and matched against this one",
    ],
    source: { label: "UPSC CSE 2026 notice (as summarised by Drishti IAS)", url: "https://www.drishtiias.com/blog/upsc-2026-notification-exam-dates" },
    verified: false, aliases: "civil services ias ips ifs cds nda capf otr",
  },
  {
    id: "upsc-signature", examId: "upsc", exam: "UPSC", label: "UPSC — three signatures", group: "UPSC",
    mode: "signature", width: 350, height: 500, minKB: 20, maxKB: 100, pxChosen: true, pxMax: [500, 1000],
    notes: [
      "Sign THREE times, one below the other, in one image",
      "Black ink on plain white paper",
    ],
    source: { label: "UPSC 2026 signature rules (VisionIAS)", url: "https://www.visionias.in/blog/english/upsc-new-photo-signature-rules-2026-dos-and-donts" },
    verified: false, aliases: "civil services ias otr",
  },

  // ── SSC ─────────────────────────────────────────────────────────────────
  {
    id: "ssc-photo", examId: "ssc", exam: "SSC", label: "SSC — CGL / CHSL / MTS / GD", group: "SSC",
    mode: "photo", width: 275, height: 354, minKB: 20, maxKB: 50, dpi: 200, physical: "3.5 × 4.5 cm",
    face: 0.72,
    notes: [
      "SSC now captures your photo LIVE in the form — use this only where an uploaded photo is asked for",
      "Plain light background, no cap, mask or spectacles",
    ],
    source: { label: "SSC CGL 2026 photo & signature guide (PW)", url: "https://www.pw.live/ssc/exams/ssc-cgl-photo-and-signature-size-2026" },
    verified: false, aliases: "cgl chsl mts gd cpo selection post steno",
  },
  {
    id: "ssc-signature", examId: "ssc", exam: "SSC", label: "SSC — CGL / CHSL / MTS / GD", group: "SSC",
    mode: "signature", width: 472, height: 157, minKB: 10, maxKB: 20, dpi: 200, physical: "6.0 × 2.0 cm",
    notes: ["Notice text: JPEG, 10–20 KB, about 6.0 cm (width) × 2.0 cm (height)"],
    source: { label: "SSC signature upload rules (PW)", url: "https://www.pw.live/ssc/exams/ssc-cgl-signature-upload-rules" },
    verified: false, aliases: "cgl chsl mts gd cpo",
  },

  // ── Banking ─────────────────────────────────────────────────────────────
  {
    id: "ibps-photo", examId: "ibps", exam: "IBPS", label: "IBPS — PO / Clerk / SO / RRB", group: "Banking",
    mode: "photo", width: 200, height: 230, minKB: 20, maxKB: 50, physical: "4.5 × 3.5 cm",
    face: 0.7, notes: BANK_PHOTO_NOTES, source: IBPS_SRC, verified: true,
    aliases: "bank po clerk so rrb crp",
  },
  {
    id: "ibps-signature", examId: "ibps", exam: "IBPS", label: "IBPS — PO / Clerk / SO / RRB", group: "Banking",
    mode: "signature", width: 140, height: 60, minKB: 10, maxKB: 20,
    notes: BANK_SIGN_NOTES, source: IBPS_SRC, verified: true, aliases: "bank po clerk so rrb crp",
  },
  {
    id: "ibps-thumb", examId: "ibps", exam: "IBPS", label: "IBPS — left thumb impression", group: "Banking",
    mode: "thumb", width: 240, height: 240, minKB: 20, maxKB: 50, dpi: 200, physical: "3 × 3 cm",
    notes: BANK_THUMB_NOTES, source: IBPS_SRC, verified: true, aliases: "bank po clerk thumb impression lti",
  },
  {
    id: "ibps-declaration", examId: "ibps", exam: "IBPS", label: "IBPS — handwritten declaration", group: "Banking",
    mode: "declaration", width: 800, height: 400, minKB: 50, maxKB: 100, dpi: 200, physical: "10 × 5 cm",
    notes: BANK_DECL_NOTES, source: IBPS_SRC, verified: true, aliases: "bank po clerk hand written declaration",
  },
  {
    id: "sbi-photo", examId: "sbi", exam: "SBI", label: "SBI — PO / Clerk (JA)", group: "Banking",
    mode: "photo", width: 200, height: 230, minKB: 20, maxKB: 50, physical: "4.5 × 3.5 cm",
    face: 0.7, notes: BANK_PHOTO_NOTES, source: SBI_SRC, verified: true,
    aliases: "state bank po clerk junior associate",
  },
  {
    id: "sbi-signature", examId: "sbi", exam: "SBI", label: "SBI — PO / Clerk (JA)", group: "Banking",
    mode: "signature", width: 140, height: 60, minKB: 10, maxKB: 20,
    notes: BANK_SIGN_NOTES, source: SBI_SRC, verified: true, aliases: "state bank po clerk junior associate",
  },
  {
    id: "sbi-thumb", examId: "sbi", exam: "SBI", label: "SBI — left thumb impression", group: "Banking",
    mode: "thumb", width: 240, height: 240, minKB: 20, maxKB: 50, dpi: 200, physical: "3 × 3 cm",
    notes: BANK_THUMB_NOTES, source: SBI_SRC, verified: true, aliases: "state bank clerk thumb impression",
  },
  {
    id: "sbi-declaration", examId: "sbi", exam: "SBI", label: "SBI — handwritten declaration", group: "Banking",
    mode: "declaration", width: 800, height: 400, minKB: 50, maxKB: 100, dpi: 200, physical: "10 × 5 cm",
    notes: BANK_DECL_NOTES, source: SBI_SRC, verified: true, aliases: "state bank clerk hand written declaration",
  },

  // ── Railways ────────────────────────────────────────────────────────────
  {
    id: "rrb-photo", examId: "rrb", exam: "RRB", label: "RRB — NTPC / Group D / ALP", group: "Railways",
    mode: "photo", width: 350, height: 450, minKB: 30, maxKB: 50, dpi: 254, physical: "35 × 45 mm",
    face: 0.72,
    notes: [
      "White or light background, photo not older than 3 months",
      "Sources quote 20–50, 20–70 and 30–70 KB — 30–50 KB passes all of them",
    ],
    source: { label: "RRB NTPC 2025 application guide (PracticeMock)", url: "https://www.practicemock.com/blog/how-to-apply-for-rrb-ntpc-2025-complete-step-by-step-application-guide/" },
    verified: false, aliases: "railway ntpc group d alp je cen",
  },
  {
    id: "rrb-signature", examId: "rrb", exam: "RRB", label: "RRB — NTPC / Group D / ALP", group: "Railways",
    mode: "signature", width: 400, height: 160, minKB: 30, maxKB: 40, physical: "50 × 20 mm",
    pxChosen: true,
    notes: [
      "Running hand, black ink on white paper — not BLOCK/CAPITAL letters",
      "Sources quote 10–40, 30–49 and 30–70 KB — 30–40 KB passes all of them",
    ],
    source: { label: "RRB NTPC 2025 documents (PW)", url: "https://www.pw.live/railway/exams/documents-required-to-apply-for-rrb-ntpc-2025" },
    verified: false, aliases: "railway ntpc group d alp je cen",
  },

  // ── NTA ─────────────────────────────────────────────────────────────────
  {
    id: "neet-photo", examId: "neet", exam: "NEET", label: "NEET (UG) 2026", group: "NTA",
    mode: "photo", width: 413, height: 531, minKB: 10, maxKB: 200, dpi: 300, physical: "3.5 × 4.5 cm",
    pxChosen: true, face: 0.8,
    notes: [
      "80% of the image should be your face, ears visible, no mask, white background",
      "A live photo is captured too and matched with Aadhaar",
      "Keep 6–8 passport and 4–6 postcard (4″×6″) prints for the exam centre",
    ],
    source: NEET_SRC, verified: true, aliases: "nta medical neet ug",
  },
  {
    id: "neet-postcard", examId: "neet", exam: "NEET", label: "NEET — postcard print (4″ × 6″)", group: "NTA",
    mode: "photo", width: 1200, height: 1800, minKB: 100, maxKB: 2000, dpi: 300, physical: "4 × 6 in",
    pxChosen: true, face: 0.5,
    notes: [
      "For printing at a studio — the 2026 form does not ask you to upload it",
      "White background; take the same photo as your passport-size one",
    ],
    source: NEET_SRC, verified: true, aliases: "nta medical postcard post card 4x6 print",
  },
  {
    id: "neet-signature", examId: "neet", exam: "NEET", label: "NEET (UG) 2026", group: "NTA",
    mode: "signature", width: 413, height: 177, minKB: 10, maxKB: 100, dpi: 300, physical: "3.5 × 1.5 cm",
    pxChosen: true, notes: ["Sign on white paper; JPG/JPEG, 10–100 KB"],
    source: NEET_SRC, verified: true, aliases: "nta medical neet ug",
  },
  {
    id: "jee-photo", examId: "jee", exam: "JEE Main", label: "JEE (Main) 2026", group: "NTA",
    mode: "photo", width: 413, height: 531, minKB: 10, maxKB: 200, dpi: 300, physical: "3.5 × 4.5 cm",
    pxChosen: true, face: 0.8,
    notes: [
      "Colour photo, 80% face (ears visible, no mask), white background",
      "A live photo is captured too — keep the same look",
    ],
    source: JEE_SRC, verified: true, aliases: "nta jee mains engineering",
  },
  {
    id: "jee-signature", examId: "jee", exam: "JEE Main", label: "JEE (Main) 2026", group: "NTA",
    mode: "signature", width: 413, height: 177, minKB: 10, maxKB: 100, dpi: 300, physical: "3.5 × 1.5 cm",
    pxChosen: true, notes: ["JPG/JPEG, 10–100 KB, clearly legible"],
    source: JEE_SRC, verified: true, aliases: "nta jee mains engineering",
  },
  {
    id: "cuet-photo", examId: "cuet", exam: "CUET", label: "CUET (UG) 2026", group: "NTA",
    mode: "photo", width: 413, height: 531, minKB: 10, maxKB: 200, dpi: 300, physical: "3.5 × 4.5 cm",
    pxChosen: true, face: 0.8,
    notes: ["Colour photo, 80% face (ears visible, no mask), white background"],
    source: CUET_SRC, verified: true, aliases: "nta cuet ug central university",
  },
  {
    id: "cuet-signature", examId: "cuet", exam: "CUET", label: "CUET (UG) 2026", group: "NTA",
    mode: "signature", width: 413, height: 177, minKB: 10, maxKB: 50, dpi: 300, physical: "3.5 × 1.5 cm",
    pxChosen: true, notes: ["JPG/JPEG, 10–50 KB, clearly legible"],
    source: CUET_SRC, verified: true, aliases: "nta cuet ug central university",
  },

  // ── GATE ────────────────────────────────────────────────────────────────
  {
    id: "gate-photo", examId: "gate", exam: "GATE", label: "GATE 2027", group: "GATE",
    mode: "photo", width: 413, height: 531, minKB: 5, maxKB: 600, dpi: 300, physical: "3.5 × 4.5 cm",
    pxChosen: true, pxMax: [530, 690], face: 0.66,
    notes: [
      "Allowed: 200×260 to 530×690 px, aspect ratio 0.66–0.89",
      "Face 60–70% of the photo, white background, nothing else in frame",
    ],
    source: GATE_SRC, verified: true, aliases: "goaps iit engineering",
  },
  {
    id: "gate-signature", examId: "gate", exam: "GATE", label: "GATE 2027", group: "GATE",
    mode: "signature", width: 450, height: 150, minKB: 3, maxKB: 300,
    pxChosen: true, pxMax: [580, 180],
    notes: [
      "Allowed: 250×80 to 580×180 px, height : width between 1 : 2.75 and 1 : 3.75",
      "Signature should cover 70–80% of the image; black or dark-blue ink",
    ],
    source: GATE_SRC, verified: true, aliases: "goaps iit engineering",
  },

  // ── State PSC (generic) ─────────────────────────────────────────────────
  {
    id: "spsc-photo", examId: "spsc", exam: "State PSC", label: "State PSC — common size", group: "State PSC",
    mode: "photo", width: 276, height: 354, minKB: 20, maxKB: 50, dpi: 200, physical: "3.5 × 4.5 cm",
    face: 0.72,
    notes: [
      "State commissions differ — if yours lists other numbers, use Custom",
      "Some (e.g. UPPSC) want photo + signature in one image",
    ],
    source: { label: "UP PCS application form guide (Careers360)", url: "https://competition.careers360.com/articles/up-pcs-application-form" },
    verified: false, aliases: "uppsc bpsc mppsc rpsc mpsc tnpsc kpsc wbpsc hpsc pcs",
  },
  {
    id: "spsc-signature", examId: "spsc", exam: "State PSC", label: "State PSC — common size", group: "State PSC",
    mode: "signature", width: 276, height: 118, minKB: 10, maxKB: 20, dpi: 200, physical: "3.5 × 1.5 cm",
    notes: ["State commissions differ — if yours lists other numbers, use Custom"],
    source: { label: "UP PCS application form guide (Careers360)", url: "https://competition.careers360.com/articles/up-pcs-application-form" },
    verified: false, aliases: "uppsc bpsc mppsc rpsc mpsc tnpsc kpsc wbpsc hpsc pcs",
  },
];

export const CUSTOM_ID = "custom";

export interface CustomSpec {
  width: number;
  height: number;
  minKB: number;
  maxKB: number;
  dpi: number | null;
  ext: "jpg" | "jpeg";
  nameDate: boolean;
  /** let the pixels grow (same shape) if the minimum KB is out of reach */
  allowGrow: boolean;
}

export const CUSTOM_DEFAULTS: Record<ExamMode, CustomSpec> = {
  photo: { width: 350, height: 450, minKB: 20, maxKB: 50, dpi: null, ext: "jpg", nameDate: false, allowGrow: false },
  signature: { width: 300, height: 120, minKB: 10, maxKB: 20, dpi: null, ext: "jpg", nameDate: false, allowGrow: false },
  thumb: { width: 240, height: 240, minKB: 20, maxKB: 50, dpi: null, ext: "jpg", nameDate: false, allowGrow: false },
  declaration: { width: 800, height: 400, minKB: 50, maxKB: 100, dpi: null, ext: "jpg", nameDate: false, allowGrow: false },
};

export function customPreset(mode: ExamMode, c: CustomSpec): ExamPreset {
  return {
    id: CUSTOM_ID, examId: CUSTOM_ID, exam: "Custom", label: "Custom size", group: "Custom",
    mode, width: c.width, height: c.height, minKB: c.minKB, maxKB: c.maxKB,
    dpi: c.dpi ?? undefined, face: mode === "photo" ? 0.72 : undefined, nameDate: c.nameDate,
    pxFixed: !c.allowGrow,
    notes: ["Type the exact numbers from your notification"],
    source: { label: "Your exam notification", url: "" }, verified: false, ext: c.ext,
  };
}

export const presetsFor = (mode: ExamMode) => PRESETS.filter((p) => p.mode === mode);

export function findPreset(id: string): ExamPreset | undefined {
  return PRESETS.find((p) => p.id === id);
}

/** Same exam in another mode (IBPS photo → IBPS signature), else that mode's first preset. */
export function counterpart(examId: string, mode: ExamMode): string {
  if (examId === CUSTOM_ID) return CUSTOM_ID;
  return (PRESETS.find((p) => p.examId === examId && p.mode === mode) ?? presetsFor(mode)[0]).id;
}

export function presetFilename(p: ExamPreset, w = p.width, h = p.height): string {
  const slug = p.examId === CUSTOM_ID ? "exam" : p.examId;
  return `${slug}-${p.mode}-${w}x${h}.${p.ext ?? "jpg"}`;
}

/** Largest scale the output may grow to (1 = fixed pixels). */
export function maxScale(p: ExamPreset): number {
  if (p.pxFixed) return 1;
  const cap = p.pxMax ? Math.min(p.pxMax[0] / p.width, p.pxMax[1] / p.height) : 4;
  return Math.max(1, Math.min(4, cap));
}

/** Portals differ on KB = 1000 or 1024 bytes; aim inside both readings. */
export function kbWindow(p: Pick<ExamPreset, "minKB" | "maxKB">) {
  const strict = { min: p.minKB * 1024, max: p.maxKB * 1000 };
  // a very narrow custom window (e.g. 20–20 KB) has no strict overlap
  return strict.min <= strict.max ? strict : { min: p.minKB * 1000, max: p.maxKB * 1024 };
}
