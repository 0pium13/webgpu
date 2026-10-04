import ToolSeoSection from "@/components/ToolSeoSection";
import { toolMetadata, toolJsonLd } from "@/lib/toolMeta";

export const metadata = toolMetadata("noise-remover");

export default function NoiseRemoverLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: toolJsonLd("noise-remover") }}
      />
      {children}
      <ToolSeoSection slug="noise-remover" />
    </>
  );
}
