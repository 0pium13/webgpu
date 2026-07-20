import ToolSeoSection from "@/components/ToolSeoSection";
import { toolMetadata, toolJsonLd } from "@/lib/toolMeta";

export const metadata = toolMetadata("rotoscope");

export default function RotoscopeLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: toolJsonLd("rotoscope") }}
      />
      {children}
      <ToolSeoSection slug="rotoscope" />
    </>
  );
}
