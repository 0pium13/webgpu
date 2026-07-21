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
  /** Visible FAQ section + FAQPage JSON-LD. */
  faqs?: ToolFaq[];
  /** Sibling tool slugs for the contextual "More free tools" row. */
  related?: string[];
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
    related: ["convert", "voice", "upscale"],
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
    related: ["erase", "upscale", "image-to-3d"],
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
    related: ["bg-remove", "erase", "webcam"],
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
    related: ["bg-remove", "upscale", "rotoscope"],
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
    related: ["subtitles", "upscale", "pdf"],
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
    related: ["bg-remove", "erase", "convert"],
    faqs: [
      {
        q: "How does one-click rotoscoping work?",
        a: "Click the object once and a segmentation model (SAM 2 — the same family the film industry's tools build on) finds its exact outline, then tracks it across every frame. What used to be hours of hand-masking becomes a click and a scrub.",
      },
      {
        q: "Can it really replace a green screen?",
        a: "For most social and product work, yes — the cutout follows the subject without any special background. A proper green screen still wins for fine hair detail in broadcast work, but you get 90% of the result with 0% of the setup.",
      },
      {
        q: "Does my video get uploaded?",
        a: "No. Frames are processed on your own GPU in the browser. Client footage and unreleased edits never leave your machine.",
      },
      {
        q: "What do I get out at the end?",
        a: "The isolated subject with transparency, ready to composite over any background in your editor.",
      },
    ],
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
    related: ["bg-remove", "upscale"],
    faqs: [
      {
        q: "What formats does it export?",
        a: "GLB for games, web and AR; OBJ for 3D software like Blender; STL for 3D printing. All three, free, at full quality.",
      },
      {
        q: "What kind of photos work best?",
        a: "A single clear photo of one object — product shots, toys, furniture, sculptures. Centered subject, plain background, decent lighting. The background remover on this site makes a perfect prep step.",
      },
      {
        q: "Is this good enough to 3D print?",
        a: "For decorative prints and prototypes, yes — export the STL and slice it as usual. Precision engineering parts need real CAD; this is reconstruction from a photo, not measurement.",
      },
      {
        q: "Does my photo stay on my device?",
        a: "Yes. The reconstruction model runs in your browser — nothing is uploaded, including the generated model.",
      },
    ],
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
    related: ["convert"],
    faqs: [
      {
        q: "Why does it matter that PDFs aren't uploaded?",
        a: "Because PDFs are contracts, invoices, ID scans and salary slips — exactly the documents you should never hand to a random 'free PDF site'. Here every operation runs in your browser; the file never crosses the network.",
      },
      {
        q: "What can I do with my PDF?",
        a: "Merge multiple files, split pages out, compress file size, convert, and edit text directly in the document. No page limits, no daily quota.",
      },
      {
        q: "Can I really edit the text inside a PDF for free?",
        a: "Yes — click the text and type. Most tools lock text editing behind a subscription; this one doesn't, because there's no server cost to recover.",
      },
      {
        q: "Is there a file size limit?",
        a: "No fixed limit — it depends on your device's memory. Typical contracts and reports, even at hundreds of pages, are no problem.",
      },
    ],
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
    related: ["subtitles", "chat"],
    faqs: [
      {
        q: "Is there a character or word limit?",
        a: "No. Scripts, articles, full voiceovers — the voices are generated on your device, so there is no per-character bill and no monthly credit meter.",
      },
      {
        q: "Which languages are supported?",
        a: "English and Hindi lead the lineup, with more voices available in the studio. For Indian creator content — Reels voiceovers, explainer narration — the Hindi and English voices cover the vast majority of use.",
      },
      {
        q: "Can I use the audio commercially?",
        a: "Yes — the speech is generated locally by open models, and we add no watermark and claim no rights over your output.",
      },
      {
        q: "What if I need a premium cloud voice?",
        a: "The studio also accepts your own ElevenLabs API key as an optional tier — your key, your billing, used straight from the same interface.",
      },
    ],
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
    related: ["upscale", "voice"],
    faqs: [
      {
        q: "What does it actually improve?",
        a: "Live enhancement of your camera feed: AI upscaling for sharper detail, skin retouch, lighting correction and auto-framing that keeps you centered as you move — all in real time.",
      },
      {
        q: "Is my camera feed sent anywhere?",
        a: "No — and this is the tool where that matters most. The processing happens frame-by-frame on your own GPU. Nothing is recorded, streamed or stored by us.",
      },
      {
        q: "Will it keep up in real time?",
        a: "On a machine with a reasonable GPU, yes — that's the point of running on WebGPU. Older machines can lower the enhancement level to hold frame rate.",
      },
    ],
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
    related: ["code", "voice"],
    faqs: [
      {
        q: "How is this private when it's a website?",
        a: "The language model itself downloads into your browser and runs on your GPU. Your messages are never sent to a server — there is no server. Close the tab and the conversation is gone unless you save it.",
      },
      {
        q: "Does it work offline?",
        a: "Yes — once the model has downloaded, you can disconnect entirely and keep chatting. Useful on flights, and proof that nothing is leaving your machine.",
      },
      {
        q: "Which browsers can run it?",
        a: "Chrome, Edge or Brave on a machine with a GPU — the model engine needs full WebGPU. Safari can't run this one yet; that's a browser limitation, not a signup wall.",
      },
      {
        q: "How smart is a local model?",
        a: "Genuinely useful for drafting, summarising, coding help and questions — not at the level of the biggest cloud models. The trade is absolute privacy and zero cost, and for most day-to-day prompts it holds up well.",
      },
    ],
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
    related: ["chat"],
    faqs: [
      {
        q: "What does Vibe Coder actually do?",
        a: "You describe an app in plain words — 'a pomodoro timer with a dark theme' — and it writes the code and runs the result live in the browser, where you can keep refining it by talking.",
      },
      {
        q: "Do I need to pay for an AI model?",
        a: "No. It can run on a local model on your GPU for free. If you want a stronger model, plug in your own OpenRouter API key — your key, your billing, your choice.",
      },
      {
        q: "Which browsers does it need?",
        a: "For the free local-model mode: Chrome, Edge or Brave with a GPU, since the model runs on WebGPU. With your own API key it's lighter on hardware.",
      },
      {
        q: "Who owns the code it writes?",
        a: "You do, fully. Copy it out and use it anywhere — no license strings, no watermark comments.",
      },
    ],
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
      images: [{ url: `/og/${t.slug}`, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: t.title,
      description: t.description,
      images: [`/og/${t.slug}`],
    },
  };
}

/** Short display name — "Auto Subtitles" out of "Auto Subtitles — free …". */
export const toolShortName = (slug: string) =>
  TOOL_META[slug].appName.split("—")[0].trim();

/** SoftwareApplication + BreadcrumbList (+ optional FAQPage) JSON-LD. */
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
      // point at the sitewide entity in the root layout, not a loose copy
      publisher: { "@id": `${SITE}/#organization` },
      isPartOf: { "@id": `${SITE}/#website` },
    },
    {
      // Gives results the "webgpu.in › Auto Subtitles" trail instead of a
      // bare URL, and tells Google this page sits under the site root.
      "@type": "BreadcrumbList",
      "@id": `${SITE}/${t.slug}#breadcrumbs`,
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "WebGPU.in", item: SITE },
        {
          "@type": "ListItem",
          position: 2,
          name: toolShortName(slug),
          item: `${SITE}/${t.slug}`,
        },
      ],
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
