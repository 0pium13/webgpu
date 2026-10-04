import ToolSeoSection from "@/components/ToolSeoSection";
import { toolMetadata, toolJsonLd } from "@/lib/toolMeta";

export const metadata = toolMetadata("exam-photo");

export default function ExamPhotoLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: toolJsonLd("exam-photo") }}
      />
      {children}
      <ToolSeoSection slug="exam-photo" />
    </>
  );
}
