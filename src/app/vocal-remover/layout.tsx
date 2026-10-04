import ToolSeoSection from "@/components/ToolSeoSection";
import { toolMetadata, toolJsonLd } from "@/lib/toolMeta";

export const metadata = toolMetadata("vocal-remover");

export default function VocalRemoverLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: toolJsonLd("vocal-remover") }}
      />
      {children}
      <ToolSeoSection slug="vocal-remover" />
    </>
  );
}
