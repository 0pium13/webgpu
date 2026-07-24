import Nav from "@/components/Nav";

export default function NotFound() {
  return (
    <div style={{ minHeight: "100vh" }}>
      <Nav />
      <div style={{ minHeight: "80vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <div style={{ maxWidth: 440, textAlign: "center" }}>
          <span className="mono" style={{ fontSize: 12, letterSpacing: "0.15em", color: "var(--accent)", textTransform: "uppercase" }}>
            404
          </span>
          <h1 style={{ fontSize: 28, fontWeight: 500, letterSpacing: "-0.02em", margin: "12px 0 10px" }}>
            This page doesn&apos;t exist
          </h1>
          <p style={{ fontSize: 14, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 24 }}>
            The link may be old or mistyped. All the tools are one click away from the home page.
          </p>
          <a href="/" style={{ background: "var(--accent)", color: "var(--on-accent)", borderRadius: 10, padding: "10px 22px", fontSize: 14, fontWeight: 500, textDecoration: "none" }}>
            Explore the tools
          </a>
        </div>
      </div>
    </div>
  );
}
