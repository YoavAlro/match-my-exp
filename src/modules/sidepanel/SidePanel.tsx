import { useEffect, useState } from 'react';
import {
  PanelChatResponseSchema,
  PanelReadinessRequestSchema,
  PanelReadinessResponseSchema,
  type PanelChatResponse,
  type PanelReadinessResponse,
} from '../contracts';
import {
  ChromeConsentStorage,
  SiteAccessService,
  type AccessResult,
} from '../permissions';
import {
  CredentialVault,
  ProviderSettingsService,
  type ProviderConfiguration,
} from '../providers';

export type ReadinessLoader = () => Promise<PanelReadinessResponse>;
export type SiteAccessRequester = (
  pageUrl: string,
  provider: {
    id: 'openai' | 'anthropic' | 'gemini' | 'compatible';
    origin: string;
  },
) => Promise<AccessResult>;
export type ProviderConfigurer = (input: {
  configuration: ProviderConfiguration;
  credential: string;
}) => Promise<void>;
export type PanelCommandSender = (
  command: unknown,
) => Promise<PanelChatResponse>;

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

const requestBrowserSiteAccess: SiteAccessRequester = async (
  pageUrl,
  provider,
) => {
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
    provider,
    async ({ pageOrigin, provider, data }) =>
      window.confirm(
        `Allow Match My Exp to send ${data.join(', ')} from ${pageOrigin} to ${provider.origin}?`,
      ),
  );
};

const configureBrowserProvider: ProviderConfigurer = async ({
  configuration,
  credential,
}) => {
  if (typeof browser === 'undefined') {
    throw new Error('Browser provider storage is unavailable');
  }
  const vault = new CredentialVault(browser.storage.local);
  const settings = new ProviderSettingsService(browser.storage.local, vault);
  await settings.configure(configuration, async (origin) =>
    window.confirm(
      `Trust ${origin} to receive page context and use the supplied credential?`,
    ),
  );
  await settings.setCredential(
    configuration.provider,
    credential,
    async (value) => value.trim().length > 0,
  );
};

const sendBrowserPanelCommand: PanelCommandSender = async (command) => {
  if (typeof browser === 'undefined') {
    throw new Error('Browser messaging is unavailable');
  }
  return PanelChatResponseSchema.parse(
    await browser.runtime.sendMessage(command),
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

const endpointOrigin = (endpoint: string) => {
  try {
    return new URL(endpoint).origin;
  } catch {
    return 'https://invalid.example';
  }
};

export function SidePanel({
  loadReadiness = loadBrowserReadiness,
  requestSiteAccess = requestBrowserSiteAccess,
  configureProvider = configureBrowserProvider,
  sendPanelCommand = sendBrowserPanelCommand,
}: {
  loadReadiness?: ReadinessLoader;
  requestSiteAccess?: SiteAccessRequester;
  configureProvider?: ProviderConfigurer;
  sendPanelCommand?: PanelCommandSender;
}) {
  const [readiness, setReadiness] = useState<PanelReadinessResponse | null>(
    null,
  );
  const [access, setAccess] = useState<AccessResult | null>(null);
  const [provider, setProvider] =
    useState<ProviderConfiguration['provider']>('openai');
  const [model, setModel] = useState('gpt-5');
  const [endpoint, setEndpoint] = useState('');
  const [compatibleAuthentication, setCompatibleAuthentication] = useState<
    'bearer' | 'x-api-key' | 'api-key'
  >('bearer');
  const [credential, setCredential] = useState('');
  const [providerReady, setProviderReady] = useState(false);
  const [message, setMessage] = useState('');
  const [chat, setChat] = useState<PanelChatResponse | null>(null);
  const [busy, setBusy] = useState(false);

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
      setAccess(await requestSiteAccess(pageUrl, providerDestination));
    } catch {
      setAccess({ status: 'denied', pageOrigin: readiness?.origin ?? pageUrl });
    }
  };

  const providerDestination =
    provider === 'openai'
      ? { id: provider, origin: 'https://api.openai.com' }
      : provider === 'anthropic'
        ? { id: provider, origin: 'https://api.anthropic.com' }
        : provider === 'gemini'
          ? {
              id: provider,
              origin: 'https://generativelanguage.googleapis.com',
            }
          : {
              id: provider,
              origin: endpointOrigin(endpoint),
            };

  const saveProvider = async () => {
    const configuration: ProviderConfiguration =
      provider === 'compatible'
        ? {
            provider,
            config: {
              endpoint,
              model,
              authentication: compatibleAuthentication,
              structuredOutput: 'openai-responses-json-schema',
              storeFalse: true,
            },
          }
        : { provider, model };
    setBusy(true);
    try {
      await configureProvider({ configuration, credential });
      setCredential('');
      setProviderReady(true);
    } finally {
      setBusy(false);
    }
  };

  const submitChat = async () => {
    if (message.trim().length === 0) {
      return;
    }
    setBusy(true);
    try {
      setChat(
        await sendPanelCommand({
          schemaVersion: 1,
          type: 'panel.chat.submit',
          requestId: crypto.randomUUID(),
          message: message.trim(),
        }),
      );
      setMessage('');
    } finally {
      setBusy(false);
    }
  };

  const actOnPreview = async (action: 'keep' | 'discard') => {
    if (chat?.previewId === null || chat?.previewId === undefined) {
      return;
    }
    setBusy(true);
    try {
      setChat(
        await sendPanelCommand({
          schemaVersion: 1,
          type: `panel.preview.${action}`,
          requestId: crypto.randomUUID(),
          previewId: chat.previewId,
        }),
      );
    } finally {
      setBusy(false);
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
        <fieldset>
          <legend>AI provider</legend>
          <label>
            Provider
            <select
              value={provider}
              onChange={(event) => {
                setProvider(
                  event.target.value as ProviderConfiguration['provider'],
                );
                setProviderReady(false);
              }}
            >
              <option value="compatible">OpenAI-compatible</option>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Gemini</option>
            </select>
          </label>
          <label>
            Model
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
            />
          </label>
          {provider === 'compatible' ? (
            <>
              <label>
                Responses endpoint
                <input
                  type="url"
                  value={endpoint}
                  onChange={(event) => setEndpoint(event.target.value)}
                />
              </label>
              <label>
                Authentication
                <select
                  value={compatibleAuthentication}
                  onChange={(event) =>
                    setCompatibleAuthentication(
                      event.target.value as 'bearer' | 'x-api-key' | 'api-key',
                    )
                  }
                >
                  <option value="bearer">Bearer</option>
                  <option value="x-api-key">X API key</option>
                  <option value="api-key">API key header</option>
                </select>
              </label>
            </>
          ) : null}
          <label>
            API key
            <input
              type="password"
              value={credential}
              onChange={(event) => setCredential(event.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={busy}
            onClick={() => void saveProvider()}
          >
            Save provider
          </button>
          {providerReady ? <p>Provider configured</p> : null}
        </fieldset>
        {access?.status === 'ready' && providerReady ? (
          <section aria-label="Website adaptation chat">
            <label>
              Describe the change
              <textarea
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => void submitChat()}
            >
              Send
            </button>
            {chat?.assistantMessage ? <p>{chat.assistantMessage}</p> : null}
            {chat?.clarificationQuestion ? (
              <p>{chat.clarificationQuestion}</p>
            ) : null}
            {chat?.status === 'preview' ? (
              <div>
                <button type="button" onClick={() => void actOnPreview('keep')}>
                  Keep preview
                </button>
                <button
                  type="button"
                  onClick={() => void actOnPreview('discard')}
                >
                  Discard preview
                </button>
              </div>
            ) : null}
          </section>
        ) : null}
      </section>

      <footer className="status">
        <span className="status__dot" aria-hidden="true" />
        Local-first by design
      </footer>
    </main>
  );
}
