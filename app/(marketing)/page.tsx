export default function Home() {
  return (
    <main style={{ maxWidth: 720, margin: "0 auto", padding: "96px 24px" }}>
      <h1 style={{ fontSize: 44, letterSpacing: "-0.03em", lineHeight: 1.05 }}>
        Every client promise, tracked.
      </h1>
      <p style={{ color: "var(--muted)", marginTop: 16, fontSize: 18 }}>
        ConductFlow turns conversations from small client-service businesses into
        approved tasks and follow-up drafts — nothing sends without you.
      </p>
      <a href="/onboarding" style={{ display: "inline-block", marginTop: 32,
        background: "var(--accent)", color: "#fff", padding: "10px 18px",
        borderRadius: 10, fontWeight: 600 }}>Get started</a>
    </main>
  );
}
