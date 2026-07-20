import ToolSeoSection from "@/components/ToolSeoSection";
import { toolMetadata, toolJsonLd } from "@/lib/toolMeta";

export const metadata = toolMetadata("image-to-3d");

export default function ImageTo3dLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: toolJsonLd("image-to-3d") }}
      />
      {children}
      <ToolSeoSection slug="image-to-3d" />
    </>
  );
}
