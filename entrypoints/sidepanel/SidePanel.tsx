export function SidePanel() {
  return (
    <main className="shell">
      <header className="brand">
        <span className="brand__mark" aria-hidden="true">
          M
        </span>
        <div>
          <p className="brand__eyebrow">Personal web layer</p>
          <h1>Match My Exp</h1>
        </div>
      </header>

      <section className="welcome" aria-labelledby="welcome-title">
        <p className="welcome__step">Foundation ready</p>
        <h2 id="welcome-title">Make the web fit you.</h2>
        <p>
          Chat-driven website personalization will appear here as each safe
          capability is completed.
        </p>
      </section>

      <footer className="status">
        <span className="status__dot" aria-hidden="true" />
        Local-first by design
      </footer>
    </main>
  );
}
