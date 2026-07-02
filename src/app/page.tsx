"use client";

import Nav from "@/components/Nav";
import Hero from "@/components/Hero";
import ToolsGrid from "@/components/ToolsGrid";
import Footer from "@/components/Footer";
import Reveal from "@/components/Reveal";

export default function Home() {
  return (
    <main style={{ position: "relative", zIndex: 1 }}>
      <Nav />
      <Hero />
      <Reveal><ToolsGrid /></Reveal>
      <Footer />
    </main>
  );
}
