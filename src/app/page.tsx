import Nav from "@/components/Nav";
import Hero from "@/components/Hero";
import ToolsGrid from "@/components/ToolsGrid";
import ValueStrip from "@/components/ValueStrip";
import Footer from "@/components/Footer";
import Reveal from "@/components/Reveal";
import { getContent } from "@/lib/content-store";

/**
 * Server component so the editable copy is read at request time and handed
 * to the client components below. Dynamic on purpose: an /admin save is live
 * on the very next request, with no redeploy and no stale cache.
 */
export const dynamic = "force-dynamic";

export default async function Home() {
  const content = await getContent();

  return (
    <main style={{ position: "relative", zIndex: 1 }}>
      <Nav />
      <Hero hero={content.hero} />
      <Reveal><ToolsGrid tools={content.tools} /></Reveal>
      <Reveal><ValueStrip /></Reveal>
      <Footer />
    </main>
  );
}
