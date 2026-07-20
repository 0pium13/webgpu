import ToolSeoSection from "@/components/ToolSeoSection";
import { toolMetadata, toolJsonLd } from "@/lib/toolMeta";

export const metadata = toolMetadata("bg-remove");

export default function BgRemoveLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: toolJsonLd("bg-remove") }}
      />
      {children}
      <ToolSeoSection slug="bg-remove" />
    </>
  );
}
