import Nav from "@/components/Nav";
import HomeCopy from "@/components/HomeCopy";
import ValueStrip from "@/components/ValueStrip";
import Footer from "@/components/Footer";
import Reveal from "@/components/Reveal";

export default function Home() {
  return (
    <main style={{ position: "relative", zIndex: 1 }}>
      <Nav />
      <HomeCopy />
      <Reveal><ValueStrip /></Reveal>
      <Footer />
    </main>
  );
}
