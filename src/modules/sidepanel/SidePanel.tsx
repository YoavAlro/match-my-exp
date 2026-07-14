import { useEffect, useState } from 'react';
import {
  PanelReadinessRequestSchema,
  PanelReadinessResponseSchema,
  type PanelReadinessResponse,
} from '../contracts';
import {
  ChromeConsentStorage,
  SiteAccessService,
  type AccessResult,
} from '../permissions';

export type ReadinessLoader = () => Promise<PanelReadinessResponse>;
export type SiteAccessRequester = (pageUrl: string) => Promise<AccessResult>;

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

const requestBrowserSiteAccess: SiteAccessRequester = async (pageUrl) => {
  if (typeof browser === 'undefined') {
    return { status: 'unsupported' };
  }
  const service = new SiteAccessService(
    {
      contains: (originPattern) =>
        browser.permissions.contains({ origins: [originPattern] }),
      request: (originPattern) =>
        browser.permissions.request({ origins: [originPattern] }),
      remove: (originPattern) =>
        browser.permissions.remove({ origins: [originPattern] }),
    },
    new ChromeConsentStorage(browser.storage.local),
  );
  return service.request(
    pageUrl,
    { id: 'openai', origin: 'https://api.openai.com' },
    async ({ pageOrigin, provider, data }) =>
      window.confirm(
        `Allow Match My Exp to send ${data.join(', ')} from ${pageOrigin} to ${provider.origin}?`,
      ),
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
  requestSiteAccess = requestBrowserSiteAccess,
}: {
  loadReadiness?: ReadinessLoader;
  requestSiteAccess?: SiteAccessRequester;
}) {
  const [readiness, setReadiness] = useState<PanelReadinessResponse | null>(
    null,
  );
  const [access, setAccess] = useState<AccessResult | null>(null);

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

  const pageUrl =
    readiness?.readiness === 'ready' &&
    readiness.origin !== null &&
    readiness.path !== null
      ? `${readiness.origin}${readiness.path}`
      : null;

  const grantSiteAccess = async () => {
    if (pageUrl === null) {
      return;
    }
    try {
      setAccess(await requestSiteAccess(pageUrl));
    } catch {
      setAccess({ status: 'denied', pageOrigin: readiness?.origin ?? pageUrl });
    }
  };

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
        {pageUrl !== null && access?.status !== 'ready' ? (
          <button type="button" onClick={() => void grantSiteAccess()}>
            Grant site access
          </button>
        ) : null}
        {access?.status === 'ready' ? <p>Site access granted</p> : null}
        {access?.status === 'denied' ? (
          <p>Site access was not granted</p>
        ) : null}
      </section>

      <footer className="status">
        <span className="status__dot" aria-hidden="true" />
        Local-first by design
      </footer>
    </main>
  );
}
