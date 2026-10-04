import ToolSeoSection from "@/components/ToolSeoSection";
import { toolMetadata, toolJsonLd } from "@/lib/toolMeta";

export const metadata = toolMetadata("ocr");

export default function OcrLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: toolJsonLd("ocr") }}
      />
      {children}
      <ToolSeoSection slug="ocr" />
    </>
  );
}
