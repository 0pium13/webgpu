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
    related: ["convert", "voice", "upscale", "noise-remover"],
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
      "bulk background remover", "amazon product photo white background", "flipkart product image white background",
    ],
    appName: "Background Remover — free, no upload",
    related: ["exam-photo", "erase", "upscale", "image-to-3d"],
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
        a: "Yes — drop up to 200 images (or a whole folder) at once. They run one after another on your GPU with a live progress grid, then download as a single ZIP. Change the output settings afterwards and every finished image re-renders instantly, without re-running the AI.",
      },
      {
        q: "Will the photos meet Amazon, Flipkart and Meesho image rules?",
        a: "Marketplace mode is built for it: a square canvas at 1000, 1500 or 2000 px, pure white #FFFFFF background, and the product centred to fill about 88% of the frame — inside Amazon.in and Flipkart's 85% rule. Export as JPG, with an optional soft contact shadow. Flipkart apparel needs light grey instead, which is one tap.",
      },
    ],
  },
  "exam-photo": {
    slug: "exam-photo",
    title: "Exam Photo Resizer — UPSC, SSC, IBPS Photo & Signature",
    description:
      "Resize your photo and signature to the exact pixels and KB for UPSC, SSC, IBPS, SBI, RRB, NEET, JEE and GATE forms. Face auto-crop, white background, name & date. Free, nothing uploaded.",
    keywords: [
      "exam photo resize", "upsc photo resize", "ssc photo signature resize", "ibps photo size",
      "photo resize 20kb to 50kb", "signature resize 10kb to 20kb", "neet photo size",
      "jee main photo size", "sbi po photo size", "rrb ntpc photo size", "gate photo size",
      "passport size photo for exam form", "photo with name and date for upsc",
      "photo ka size kaise kam kare", "photo kb kam kaise kare", "फोटो का साइज कम करें",
      "फोटो को 50 kb में कैसे करें", "सिग्नेचर का साइज कम करें",
    ],
    appName: "Exam Photo Resizer — exam photo & signature tool",
    related: ["bg-remove", "pdf", "upscale", "ocr"],
    faqs: [
      {
        q: "What photo and signature size do UPSC, SSC and IBPS ask for?",
        a: "IBPS and SBI (PO/Clerk): photo 200×230 px at 20–50 KB, signature 140×60 px at 10–20 KB, left thumb 240×240 px at 20–50 KB, handwritten declaration 800×400 px at 50–100 KB. NEET and JEE Main: photo 10–200 KB, signature 10–100 KB (CUET signature 10–50 KB). UPSC: photo 20–200 KB with your name and the date printed on it, and three signatures in one image. SSC now captures your photo live; the signature is 10–20 KB at about 6 × 2 cm. Pick your exam in the tool and it sets all of this for you, with a link to the source.",
      },
      {
        q: "How do I get my photo between 20 KB and 50 KB without ruining it?",
        a: "The tool resizes to the exact pixel size first, then searches JPEG quality for the best-looking file that still fits under the maximum — so you get the highest quality the limit allows, not a blurry guess. It also counts KB strictly (both 1000- and 1024-byte readings), which is why portals don't bounce the file.",
      },
      {
        q: "Is my photo uploaded to any server?",
        a: "No. Face detection, the white-background AI and the JPEG encoding all run inside your browser. Your face, signature and thumb impression never leave your phone or laptop — unlike most resizer sites, which upload them.",
      },
      {
        q: "Can it add my name and date on the photo for UPSC?",
        a: "Yes. Turn on Name & date and type them — they're printed in a clean white strip at the bottom, inside the required pixel size. The date defaults to today in DD-MM-YYYY; change it to the day the photo was taken.",
      },
      {
        q: "My background isn't white — can it fix that?",
        a: "Turn on White background. An AI model (downloaded once, then cached) cuts you out and puts you on pure white, all on your device. For signatures, Auto-clean removes shadows and grey paper and leaves crisp black ink.",
      },
      {
        q: "Why might a portal still reject my photo?",
        a: "Size is only half of it. Portals also reject blurry photos, glare on spectacles, caps or dark glasses, a face too small in the frame, or a photo that doesn't match your live capture or ID. And rules change between notifications — always compare with your official notice before you submit.",
      },
      {
        q: "फोटो और सिग्नेचर का साइज KB में कैसे कम करें?",
        a: "ऊपर अपनी परीक्षा चुनें (UPSC, SSC, IBPS, SBI, RRB, NEET, JEE, GATE), फोटो डालें — टूल चेहरा ढूंढकर सही साइज में क्रॉप करता है और JPEG को ठीक उतने KB में लाता है जितना फॉर्म मांगता है (जैसे 20–50 KB)। सिग्नेचर के लिए सफ़ेद कागज़ पर काले पेन से साइन करके फोटो लें। सब कुछ आपके फोन में ही होता है, कुछ भी अपलोड नहीं होता।",
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
    related: ["subtitles", "upscale", "pdf", "noise-remover", "vocal-remover"],
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
    related: ["convert", "exam-photo", "ocr"],
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
    related: ["subtitles", "chat", "vocal-remover"],
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
  "noise-remover": {
    slug: "noise-remover",
    title: "Free Background Noise Remover — Clean Voice in Audio & Video",
    description:
      "Remove background noise from audio and video free: fan, AC hum, traffic, hiss and music behind your voice. AI runs in your browser, so nothing is uploaded. No watermark, no signup. Download clean WAV or the same video with clean audio.",
    keywords: [
      "remove background noise from audio", "noise remover", "audio cleaner",
      "remove noise from video", "voice clarity", "remove fan noise from video",
      "background noise remover free", "awaaz saaf kare", "video ki awaaz saaf kare",
      "noise reduction online no upload",
    ],
    appName: "Noise Remover — free AI background noise removal",
    related: ["subtitles", "convert", "voice", "vocal-remover"],
    faqs: [
      { q: "What noise can it remove?", a: "Steady background sound behind a voice: ceiling fans, AC and cooler hum, traffic, mains hum, hiss, room rumble and background music. It's built for phone recordings made at home, outdoors or in a car." },
      { q: "Can it remove other people talking?", a: "No. It separates speech from noise, not one voice from another, so a crowd or someone talking next to you will mostly stay in. For that you need a quieter take." },
      { q: "Is my recording uploaded anywhere?", a: "No. The AI model (DeepFilterNet3, about 9MB) downloads once and runs inside your browser on your own CPU. Your audio and video never leave your device." },
      { q: "Does it work on video?", a: "Yes. Drop an MP4, MOV or WebM and you can download the same video with clean audio. The picture is copied as-is, never re-encoded, so there's no quality loss. You can also download just the clean audio as WAV." },
      { q: "Will my voice sound robotic?", a: "Pick the strength: Light keeps some room tone, Medium sounds natural on most voices, Strong handles loud fans and traffic, and Max removes everything but the voice. The Original/Cleaned switch lets you compare instantly while it plays." },
      { q: "How long can the file be, and does it work on phones?", a: "Up to 30 minutes per file. It runs on any modern phone or laptop, no GPU needed. A 30-second clip takes about a second on a laptop, a 5-minute file a few seconds." },
      { q: "Awaaz saaf karne ka free tool hai?", a: "Haan. Video ya audio daalo, fan, AC, traffic ka shor hat jaata hai aur awaaz saaf ho jaati hai. Bilkul free, koi watermark nahi, file upload nahi hoti." },
    ],
  },
  "vocal-remover": {
    slug: "vocal-remover",
    title: "Free Vocal Remover & Karaoke Maker — Split Stems, No Upload",
    description:
      "Remove vocals from any song free — make karaoke tracks, acapellas and instrumentals, or split into vocals, drums, bass and other stems. HTDemucs AI runs in your browser, nothing is uploaded. WAV download, no watermark.",
    keywords: [
      "vocal remover", "remove vocals from song", "karaoke maker", "instrumental maker",
      "stem splitter", "acapella extractor", "vocal remover free online", "split song into stems",
      "gaane se awaaz hataye", "song se voice kaise hataye", "karaoke track kaise banaye", "remove vocals without uploading",
    ],
    appName: "Vocal Remover — free karaoke & stem splitter",
    related: ["noise-remover", "subtitles", "convert", "voice"],
    faqs: [
      { q: "Is this vocal remover really free?", a: "Yes — no watermark, no per-song credits, no signup. The AI runs on your own GPU, so there is no server bill to pass on. Every stem downloads as a full-quality WAV." },
      { q: "Is my song uploaded anywhere?", a: "No. HTDemucs (by Meta AI Research) downloads once into your browser and separates the audio on your device. Your file never leaves your computer or phone." },
      { q: "How do I make a karaoke track from a Bollywood song?", a: "Drop the MP3 or video, keep \"Remove vocals\" selected and press the button. You get an instrumental (karaoke) track and a clean vocal track — gaane se awaaz hatane ka sabse aasaan tareeka. Use the instrumental for covers, Reels and riyaz." },
      { q: "What are 4 stems?", a: "The song split into vocals, drums, bass and everything else (guitars, keys, strings). Mute or solo any of them in the built-in mixer, then download each as a WAV or all of them as a ZIP — great for remixes, practice and sampling." },
      { q: "Can I use a video file?", a: "Yes. MP4, MOV and WebM videos work — the audio is pulled out in your browser. MP3, WAV, M4A, FLAC and OGG work too." },
      { q: "How good is it, and how long does it take?", a: "It uses HTDemucs v4, the open model studios benchmark against. On a recent laptop GPU a 4-minute song takes well under a minute; without WebGPU it runs on the CPU at roughly twice the song's length. Very dense mixes can keep a little reverb or backing harmony." },
      { q: "Can I use the separated tracks commercially?", a: "The separation software (Demucs by Meta AI Research) is MIT-licensed, but the song itself keeps its original copyright. Only use stems of music you own or have permission to use." },
    ],
  },
  ocr: {
    slug: "ocr",
    title: "Image to Text (OCR) — Hindi + English, Free, No Upload",
    description:
      "Extract text from photos, screenshots, scanned pages and PDFs free — Hindi and English, even mixed in one line. Runs in your browser on your GPU, nothing uploaded. Edit, copy or download .txt.",
    keywords: [
      "image to text", "hindi ocr", "photo se text nikale", "jpg to text",
      "image to text converter", "hindi image to text", "ocr online free", "extract text from image",
      "screenshot to text", "scanned pdf to text", "pdf to text hindi", "फोटो से टेक्स्ट निकालें", "हिंदी ocr",
    ],
    appName: "Image to Text — free Hindi + English OCR",
    related: ["pdf", "exam-photo", "subtitles"],
    faqs: [
      { q: "Can it read Hindi and English in the same image?", a: "Yes. One model reads Devanagari and English letters, digits and the ₹ sign together, so mixed lines like \"कुल राशि ₹12,500\" or \"PAN card की प्रति\" come out right. Marathi, Nepali and Sanskrit printed in Devanagari work too." },
      { q: "Are my photos or documents uploaded?", a: "No. The OCR model downloads once (about 13 MB) and runs inside your browser on your GPU, or CPU if there is no GPU. Bills, ID cards and letters never leave your device." },
      { q: "How accurate is it?", a: "On clean printed Hindi it gets more than 99% of characters right, and a full A4 page takes under a second on most GPUs. For phone photos, keep the page flat and well lit. Boxes marked in amber were read with low confidence and are worth a quick check." },
      { q: "Does it work on handwriting?", a: "Not yet. It is trained on printed text: books, notices, bills, screenshots, forms. Handwritten notes usually come out garbled." },
      { q: "Can I convert a scanned PDF to text?", a: "Yes. Drop a PDF and each page is rendered and read in turn (up to 30 pages at a time), with a thumbnail strip to check each one. Copy a page, copy everything, or download all the pages as one .txt file." },
      { q: "Is there a limit or a watermark?", a: "No limits, no signup, no watermark. It runs on your own device, so there is no per-page cost for us to charge you." },
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
