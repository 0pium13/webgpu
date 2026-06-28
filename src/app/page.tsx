"use client";

import Nav from "@/components/Nav";
import Hero from "@/components/Hero";
import CapabilityMatrix from "@/components/CapabilityMatrix";
import Leaderboard from "@/components/Leaderboard";
import Showcase from "@/components/Showcase";
import NewsSection from "@/components/NewsSection";
import CommunityCTA from "@/components/CommunityCTA";
import Footer from "@/components/Footer";
import Reveal from "@/components/Reveal";

export default function Home() {
  return (
    <main style={{ position: "relative", zIndex: 1 }}>
      <Nav />
      <Hero />
      <Reveal><CapabilityMatrix /></Reveal>
      <Reveal><Leaderboard /></Reveal>
      <Reveal><Showcase /></Reveal>
      <Reveal><NewsSection /></Reveal>
      <Reveal><CommunityCTA /></Reveal>
      <Footer />
    </main>
  );
}
