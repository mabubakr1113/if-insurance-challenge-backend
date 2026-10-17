export default function Home() {
  return (
    <main style={{ maxWidth: 560, margin: "0 auto", lineHeight: 1.6 }}>
      <h1 style={{ fontSize: "1.5rem" }}>If Home Watch API</h1>
      <p>
        JSON API for the If Home Watch prototype. Every endpoint lives under <code>/api</code> and needs the shared API
        key.
      </p>
      <p>
        <a href="/api/health">/api/health</a>
      </p>
    </main>
  );
}
