import type { Metadata } from "next";

/**
 * Per-tool SEO. Tool pages are client components, so each route folder
 * gets a tiny layout.tsx that pulls its metadata + JSON-LD from here.
 * Titles are written the way people actually search, with the site's
 * USP (free, no upload, no watermark) doing the differentiating.
 */

const SITE = "https://webgpu.in";

export type ToolFaq = { q: string; a: string };

export type ToolMeta = {
  slug: string;
  /** <title> without the brand suffix (root template appends it). */
  title: string;
  description: string;
  keywords: string[];
  /** JSON-LD SoftwareApplication name. */
  appName: string;
  /** Visible FAQ section + FAQPage JSON-LD (top-traffic tools only). */
  faqs?: ToolFaq[];
};

export const TOOL_META: Record<string, ToolMeta> = {
  subtitles: {
    slug: "subtitles",
    title: "Free Auto Subtitle Generator — Hinglish + 27 Languages",
    description:
      "Generate subtitles for any video or audio free, right in your browser. Hinglish captions built in, plus Hindi, Tamil, Telugu, Bengali, Urdu and 27 languages. Nothing gets uploaded — export SRT, VTT or text.",
    keywords: [
      "auto subtitle generator", "free subtitle generator", "hinglish subtitles",
      "add subtitles to video free", "hindi subtitle generator", "srt generator",
      "subtitles without uploading", "whisper subtitles online",
    ],
    appName: "Auto Subtitles — free subtitle generator",
    faqs: [
      {
        q: "Is this subtitle generator really free?",
        a: "Yes — completely. No watermark, no per-minute limits, no signup, no credits. The AI runs on your own device, so there is no server bill for us to pass on to you.",
      },
      {
        q: "Are my videos uploaded anywhere?",
        a: "No. The transcription model (OpenAI's Whisper) runs inside your browser on your GPU or CPU. Your video never leaves your machine — you can even disconnect from the internet after the model loads.",
      },
      {
        q: "What are Hinglish captions?",
        a: "Hindi speech written in Roman script — \"kya kar rahe ho\" instead of \"क्या कर रहे हो\". It is how most Indian creators caption Reels and Shorts, and this is one of the only tools with a dedicated Hinglish mode.",
      },
      {
        q: "Which languages are supported?",
        a: "27+ languages including Hindi, Urdu, Bengali, Tamil, Telugu, Kannada, Malayalam, Marathi, Gujarati, Punjabi, plus English, Spanish, Arabic, Chinese and more. You can also translate any of them to English.",
      },
      {
        q: "What subtitle formats can I export?",
        a: "SRT (works in Premiere, CapCut, DaVinci, YouTube), VTT for the web, and plain text. Lines appear live as they are transcribed, and you can edit before exporting.",
      },
    ],
  },
  "bg-remove": {
    slug: "bg-remove",
    title: "Free Background Remover — No Upload, No Watermark",
    description:
      "Remove image backgrounds free with clean AI edges — no watermark, no signup, no upload. The model runs in your browser, so your photos stay on your device. Full resolution PNG export.",
    keywords: [
      "remove background free", "background remover no watermark", "remove bg",
      "transparent background maker", "background eraser online", "product photo background",
    ],
    appName: "Background Remover — free, no upload",
    faqs: [
      {
        q: "Is there a watermark or resolution limit?",
        a: "No watermark, and you download the full-resolution result. Most \"free\" background removers give you a tiny preview and charge for the real file — this one doesn't, because the AI runs on your device instead of our servers.",
      },
      {
        q: "Do my photos get uploaded?",
        a: "Never. The model runs entirely in your browser. Product shots, personal photos, unreleased designs — nothing leaves your machine.",
      },
      {
        q: "How good are the edges?",
        a: "The model handles hair, fur and semi-transparent edges well. For product photography — the most common use — the edges are consistently clean enough for stores and ads.",
      },
      {
        q: "Can I batch process images?",
        a: "One at a time today, but with no daily limits — run as many as you like, back to back.",
      },
    ],
  },
  upscale: {
    slug: "upscale",
    title: "Free AI Image Upscaler — 4K, Face Restore, No Limits",
    description:
      "Upscale images to 4K free with real AI detail reconstruction and face restoration. No credits, no watermark, no upload — the model runs on your GPU, in your browser.",
    keywords: [
      "ai image upscaler free", "upscale image to 4k", "image enhancer free",
      "face restoration ai", "increase image resolution", "upscaler no watermark",
    ],
    appName: "AI Upscaler — free 4K image enhancer",
    faqs: [
      {
        q: "How is this different from just resizing?",
        a: "Resizing stretches pixels; AI upscaling reconstructs detail — edges sharpen, textures return, faces get restored by a dedicated model. The output genuinely contains more usable detail than the input.",
      },
      {
        q: "Is it really unlimited and free?",
        a: "Yes. No credits, no queue, no watermark. Because your own GPU does the work, we have no per-image cost to recover.",
      },
      {
        q: "What does face restoration do?",
        a: "A second model specifically rebuilds facial detail — eyes, skin texture, hair — which generic upscalers tend to smear. Ideal for old photos and low-res portraits.",
      },
      {
        q: "Do my images stay private?",
        a: "Completely. Everything runs in your browser; nothing is uploaded, logged or stored.",
      },
    ],
  },
  erase: {
    slug: "erase",
    title: "Magic Eraser — Remove Objects From Photos Free",
    description:
      "Remove unwanted objects, people and text from photos free. Paint over anything and AI rebuilds what was behind it — no upload, no watermark, right in your browser.",
    keywords: [
      "remove objects from photos free", "magic eraser online", "remove people from photos",
      "remove text from image", "photo cleanup ai", "inpainting free",
    ],
    appName: "Magic Eraser — free object remover",
    faqs: [
      {
        q: "What can I remove from a photo?",
        a: "People in the background, power lines, watermarks on your own work, trash, photobombers, text — paint over it and the AI reconstructs what was plausibly behind it.",
      },
      {
        q: "Does it leave a smudge like other erasers?",
        a: "It uses a proper inpainting model (the same class of AI behind commercial \"magic erasers\"), not a blur or clone stamp — backgrounds like brick, sky and foliage rebuild convincingly.",
      },
      {
        q: "Is my photo uploaded for processing?",
        a: "No — the inpainting model runs on your device. Private photos stay private.",
      },
      {
        q: "Is there a limit on photo size or edits?",
        a: "No limits and no watermark. Erase, check the result, erase again — iterate as much as you need.",
      },
    ],
  },
  convert: {
    slug: "convert",
    title: "Free Video Converter — MP4, MP3, GIF, Compress",
    description:
      "Convert and compress video free in your browser: MP4, MP3, GIF, WebM and more. No upload sites, no ads, no file-size tricks — files never leave your device.",
    keywords: [
      "video converter free", "mp4 to mp3", "video to gif", "compress video online free",
      "video converter no upload", "convert video without watermark",
    ],
    appName: "Converter — free video & audio converter",
    faqs: [
      {
        q: "Why is a no-upload converter better?",
        a: "Converter sites upload your file to their server, convert it, then make you download it back — slow, capped, and your file sits on someone's server. Here the conversion runs locally, so a 2GB file starts instantly and stays yours.",
      },
      {
        q: "What formats are supported?",
        a: "MP4, WebM, MOV, MKV, AVI in; MP4, MP3, WAV, GIF, WebM out — plus compression with a quality slider. It is real FFmpeg, running in your browser.",
      },
      {
        q: "Is there a file size limit?",
        a: "No hard limit from us — it depends on your device's memory. Multi-gigabyte files work on most modern machines.",
      },
      {
        q: "Are there ads or bundled junk?",
        a: "None. No ads, no \"downloader\" buttons that aren't, no email capture. Drop a file, pick a format, done.",
      },
    ],
  },
  rotoscope: {
    slug: "rotoscope",
    title: "AI Rotoscope — Cut Out Objects From Video Free",
    description:
      "Cut out and track any object across video frames with one click, free in your browser. AI segmentation (SAM 2) with nothing uploaded — export with transparency.",
    keywords: [
      "video rotoscope free", "remove video background", "cut out object from video",
      "video segmentation ai", "green screen without green screen",
    ],
    appName: "Rotoscope — free AI video cutout",
  },
  "image-to-3d": {
    slug: "image-to-3d",
    title: "Image to 3D Model Free — Export GLB, OBJ, STL",
    description:
      "Turn one photo into a real 3D model free, in your browser. Export GLB, OBJ or STL for games, AR, or 3D printing. No upload, no queue, no credits.",
    keywords: [
      "image to 3d model free", "photo to 3d", "2d to 3d converter",
      "glb generator", "image to stl", "ai 3d model generator",
    ],
    appName: "Image to 3D — free photo to 3D model",
  },
  pdf: {
    slug: "pdf",
    title: "Free PDF Editor — Merge, Split, Compress, Edit Text",
    description:
      "Edit PDFs free without uploading them: merge, split, compress, convert, edit text. Contracts and documents never leave your device — no signup, no page limits.",
    keywords: [
      "pdf editor free", "merge pdf without uploading", "compress pdf free",
      "split pdf", "edit pdf text free", "private pdf tools",
    ],
    appName: "PDF Studio — free private PDF editor",
  },
  voice: {
    slug: "voice",
    title: "Free AI Voice Generator — English & Hindi TTS",
    description:
      "Studio-quality AI text-to-speech free, in English, Hindi and more. No credits, no character limits, no signup — the voices run in your browser.",
    keywords: [
      "ai voice generator free", "text to speech free", "hindi text to speech",
      "tts no character limit", "voiceover generator free",
    ],
    appName: "Voice Studio — free AI text to speech",
  },
  webcam: {
    slug: "webcam",
    title: "AI Webcam Enhancer — Real-Time Beautify & Auto-Frame",
    description:
      "Enhance your webcam in real time, free: AI upscaling, skin retouch, lighting fix and auto-framing for calls and streams. Runs locally — your camera feed stays on your device.",
    keywords: [
      "webcam enhancer", "ai webcam filter", "look better on video calls",
      "webcam beautify", "auto frame webcam",
    ],
    appName: "Webcam Studio — real-time AI enhancer",
  },
  chat: {
    slug: "chat",
    title: "Private AI Chat — Run an LLM in Your Browser",
    description:
      "Chat with a real AI model that runs entirely on your GPU, in your browser. Works offline once loaded, keeps every conversation on your device. Free, no signup.",
    keywords: [
      "private ai chat", "local llm browser", "offline ai chat",
      "chatgpt alternative private", "run llm locally",
    ],
    appName: "Local AI Chat — private in-browser LLM",
  },
  code: {
    slug: "code",
    title: "Vibe Coder — Describe an App, Watch It Build",
    description:
      "Describe an app in plain words and watch AI build and run it live in your browser. Use a local model or your own API key. Free and private.",
    keywords: [
      "ai app builder free", "vibe coding", "ai code generator browser",
      "build app from description",
    ],
    appName: "Vibe Coder — AI app builder",
  },
};

/** Next metadata for a tool route's layout. */
export function toolMetadata(slug: string): Metadata {
  const t = TOOL_META[slug];
  return {
    title: t.title,
    description: t.description,
    keywords: t.keywords,
    alternates: { canonical: `/${t.slug}` },
    openGraph: {
      title: t.title,
      description: t.description,
      url: `/${t.slug}`,
      siteName: "WebGPU.in",
      type: "website",
    },
    twitter: { card: "summary", title: t.title, description: t.description },
  };
}

/** SoftwareApplication (+ optional FAQPage) JSON-LD for a tool. */
export function toolJsonLd(slug: string): string {
  const t = TOOL_META[slug];
  const graph: object[] = [
    {
      "@type": "SoftwareApplication",
      "@id": `${SITE}/${t.slug}#app`,
      name: t.appName,
      url: `${SITE}/${t.slug}`,
      description: t.description,
      applicationCategory: "MultimediaApplication",
      operatingSystem: "Any (runs in the browser)",
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
      publisher: { "@type": "Organization", name: "WebGPU.in", url: SITE },
    },
  ];
  if (t.faqs?.length) {
    graph.push({
      "@type": "FAQPage",
      "@id": `${SITE}/${t.slug}#faq`,
      mainEntity: t.faqs.map((f) => ({
        "@type": "Question",
        name: f.q,
        acceptedAnswer: { "@type": "Answer", text: f.a },
      })),
    });
  }
  return JSON.stringify({ "@context": "https://schema.org", "@graph": graph });
}
