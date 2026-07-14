import { useEffect, useState } from 'react';
import {
  PanelReadinessRequestSchema,
  PanelReadinessResponseSchema,
  type PanelReadinessResponse,
} from '../contracts';

export type ReadinessLoader = () => Promise<PanelReadinessResponse>;

const unavailableResponse = (): PanelReadinessResponse => ({
  schemaVersion: 1,
  type: 'panel.readiness.response',
  requestId: crypto.randomUUID(),
  readiness: 'unavailable',
  tabId: null,
  origin: null,
  path: null,
  epoch: 0,
});

const loadBrowserReadiness: ReadinessLoader = async () => {
  if (typeof browser === 'undefined') {
    return unavailableResponse();
  }
  const request = PanelReadinessRequestSchema.parse({
    schemaVersion: 1,
    type: 'panel.readiness.request',
    requestId: crypto.randomUUID(),
  });
  return PanelReadinessResponseSchema.parse(
    await browser.runtime.sendMessage(request),
  );
};

const readinessText = (readiness: PanelReadinessResponse | null) => {
  if (readiness === null) {
    return 'Checking current site';
  }
  if (readiness.readiness === 'ready') {
    return `Ready for ${readiness.origin}${readiness.path}`;
  }
  if (readiness.readiness === 'unsupported') {
    return 'This page is not supported';
  }
  return 'No active page available';
};

export function SidePanel({
  loadReadiness = loadBrowserReadiness,
}: {
  loadReadiness?: ReadinessLoader;
}) {
  const [readiness, setReadiness] = useState<PanelReadinessResponse | null>(
    null,
  );

  useEffect(() => {
    let active = true;
    void loadReadiness()
      .then((result) => {
        if (active) {
          setReadiness(result);
        }
      })
      .catch(() => {
        if (active) {
          setReadiness(unavailableResponse());
        }
      });
    return () => {
      active = false;
    };
  }, [loadReadiness]);

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
        <p role="status">{readinessText(readiness)}</p>
      </section>

      <footer className="status">
        <span className="status__dot" aria-hidden="true" />
        Local-first by design
      </footer>
    </main>
  );
}
