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
export type ProviderStatusLoader = () => Promise<Awaited<
  ReturnType<ProviderSettingsService['status']>
> | null>;
export type SiteAccessLoader = (
  pageUrl: string,
  provider: {
    id: 'openai' | 'anthropic' | 'gemini' | 'compatible';
    origin: string;
  },
) => Promise<AccessResult | null>;
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
      contains: (originPatterns) =>
        browser.permissions.contains({ origins: [...originPatterns] }),
      request: (originPatterns) =>
        browser.permissions.request({ origins: [...originPatterns] }),
      remove: (originPatterns) =>
        browser.permissions.remove({ origins: [...originPatterns] }),
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

const loadBrowserSiteAccess: SiteAccessLoader = async (pageUrl, provider) => {
  if (typeof browser === 'undefined') {
    return null;
  }
  const service = new SiteAccessService(
    {
      contains: (originPatterns) =>
        browser.permissions.contains({ origins: [...originPatterns] }),
      request: (originPatterns) =>
        browser.permissions.request({ origins: [...originPatterns] }),
      remove: (originPatterns) =>
        browser.permissions.remove({ origins: [...originPatterns] }),
    },
    new ChromeConsentStorage(browser.storage.local),
  );
  return service.readiness(pageUrl, provider);
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

const loadBrowserProviderStatus: ProviderStatusLoader = async () => {
  if (typeof browser === 'undefined') {
    return null;
  }
  const vault = new CredentialVault(browser.storage.local);
  return new ProviderSettingsService(browser.storage.local, vault).status();
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

const destinationFor = (
  provider: ProviderConfiguration['provider'],
  endpoint: string,
) =>
  provider === 'openai'
    ? { id: provider, origin: 'https://api.openai.com' }
    : provider === 'anthropic'
      ? { id: provider, origin: 'https://api.anthropic.com' }
      : provider === 'gemini'
        ? {
            id: provider,
            origin: 'https://generativelanguage.googleapis.com',
          }
        : { id: provider, origin: endpointOrigin(endpoint) };

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  error?: boolean;
}

export function SidePanel({
  loadReadiness = loadBrowserReadiness,
  requestSiteAccess = requestBrowserSiteAccess,
  configureProvider = configureBrowserProvider,
  loadProviderStatus = loadBrowserProviderStatus,
  checkSiteAccess = loadBrowserSiteAccess,
  sendPanelCommand = sendBrowserPanelCommand,
}: {
  loadReadiness?: ReadinessLoader;
  requestSiteAccess?: SiteAccessRequester;
  configureProvider?: ProviderConfigurer;
  loadProviderStatus?: ProviderStatusLoader;
  checkSiteAccess?: SiteAccessLoader;
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
  const [previewIntent, setPreviewIntent] = useState('');
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    let active = true;
    const refresh = () => {
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
    };
    const pageChanged = () => {
      setAccess(null);
      setChat(null);
      setPreviewIntent('');
      setMessages([]);
      refresh();
    };
    refresh();
    const refreshInterval = window.setInterval(refresh, 1_000);
    if (typeof browser !== 'undefined') {
      browser.tabs.onActivated.addListener(pageChanged);
      browser.tabs.onUpdated.addListener(pageChanged);
    }
    return () => {
      active = false;
      window.clearInterval(refreshInterval);
      if (typeof browser !== 'undefined') {
        browser.tabs.onActivated.removeListener(pageChanged);
        browser.tabs.onUpdated.removeListener(pageChanged);
      }
    };
  }, [loadReadiness]);

  useEffect(() => {
    let active = true;
    void loadProviderStatus()
      .then((status) => {
        if (!active || status === null) {
          return;
        }
        const configuration = status.configuration;
        if (configuration === null) {
          setShowSettings(true);
          return;
        }
        setProvider(configuration.provider);
        if (configuration.provider === 'compatible') {
          setModel(configuration.config.model);
          setEndpoint(configuration.config.endpoint);
          setCompatibleAuthentication(configuration.config.authentication);
        } else {
          setModel(configuration.model);
        }
        setProviderReady(status.credential?.present === true);
        setShowSettings(status.credential?.present !== true);
      })
      .catch(() => setShowSettings(true));
    return () => {
      active = false;
    };
  }, [loadProviderStatus]);

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
    setErrorMessage(null);
    try {
      setAccess(
        await requestSiteAccess(pageUrl, destinationFor(provider, endpoint)),
      );
    } catch {
      setAccess({ status: 'denied', pageOrigin: readiness?.origin ?? pageUrl });
      setErrorMessage('Site access could not be granted.');
    }
  };

  useEffect(() => {
    let active = true;
    if (pageUrl !== null && providerReady) {
      void checkSiteAccess(pageUrl, destinationFor(provider, endpoint))
        .then((result) => {
          if (active && result !== null) {
            setAccess(result);
          }
        })
        .catch(() => {
          if (active) {
            setAccess({
              status: 'denied',
              pageOrigin: readiness?.origin ?? pageUrl,
            });
          }
        });
    }
    return () => {
      active = false;
    };
  }, [
    checkSiteAccess,
    endpoint,
    pageUrl,
    provider,
    providerReady,
    readiness?.origin,
  ]);

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
    setErrorMessage(null);
    try {
      await configureProvider({ configuration, credential });
      setCredential('');
      setProviderReady(true);
      setShowSettings(false);
    } catch {
      setErrorMessage(
        'Provider setup failed. Check the settings and try again.',
      );
    } finally {
      setBusy(false);
    }
  };

  const submitChat = async () => {
    const intent = message.trim();
    if (intent.length === 0) {
      return;
    }
    setBusy(true);
    setErrorMessage(null);
    setMessages((current) => [
      ...current,
      { id: crypto.randomUUID(), role: 'user', content: intent },
    ]);
    try {
      const response = await sendPanelCommand({
        schemaVersion: 1,
        type: 'panel.chat.submit',
        requestId: crypto.randomUUID(),
        message: intent,
      });
      setChat(response);
      setPreviewIntent(response.status === 'preview' ? intent : '');
      setMessage('');
      const baseAssistantContent =
        response.status === 'clarification'
          ? response.clarificationQuestion
          : response.assistantMessage;
      const assistantContent =
        response.status === 'error' && response.errorCode !== undefined
          ? `${baseAssistantContent} (${response.errorCode})`
          : baseAssistantContent;
      if (assistantContent !== null && assistantContent.length > 0) {
        setMessages((current) => [
          ...current,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: assistantContent,
            ...(response.status === 'error' ? { error: true } : {}),
          },
        ]);
      }
    } catch {
      setErrorMessage('The extension could not complete the request.');
    } finally {
      setBusy(false);
    }
  };

  const actOnPreview = async (action: 'keep' | 'discard') => {
    if (chat?.previewId === null || chat?.previewId === undefined) {
      return;
    }
    setBusy(true);
    setErrorMessage(null);
    try {
      const base = {
        schemaVersion: 1 as const,
        requestId: crypto.randomUUID(),
        previewId: chat.previewId,
      };
      const response = await sendPanelCommand(
        action === 'keep'
          ? {
              ...base,
              type: 'panel.preview.keep',
              intent: previewIntent,
            }
          : { ...base, type: 'panel.preview.discard' },
      );
      setChat(response);
      setPreviewIntent('');
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: 'assistant',
          content:
            response.assistantMessage ||
            (action === 'keep' ? 'Saved for this page.' : 'Preview discarded.'),
        },
      ]);
    } catch {
      setErrorMessage('The preview is no longer available.');
    } finally {
      setBusy(false);
    }
  };

  const canChat = access?.status === 'ready' && providerReady;

  return (
    <main className="shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand__mark" aria-hidden="true">
            M
          </span>
          <div>
            <h1>Match My Exp</h1>
            <span>Personal web layer</span>
          </div>
        </div>
        <button
          className="icon-button"
          type="button"
          aria-label="Settings"
          aria-pressed={showSettings}
          onClick={() => setShowSettings((current) => !current)}
        >
          <span aria-hidden="true">...</span>
        </button>
      </header>

      <section className="page-context" aria-label="Current page">
        <span
          className={`context-dot context-dot--${readiness?.readiness ?? 'checking'}`}
          aria-hidden="true"
        />
        <p role="status">{readinessText(readiness)}</p>
        <div className="context-badges">
          {providerReady ? <span>Provider configured</span> : null}
          {access?.status === 'ready' ? <span>Site access granted</span> : null}
        </div>
      </section>

      {showSettings ? (
        <section className="settings-panel" aria-label="Provider settings">
          <div className="settings-panel__heading">
            <div>
              <span className="eyebrow">Connection</span>
              <h2>AI provider</h2>
            </div>
            {providerReady ? (
              <button type="button" onClick={() => setShowSettings(false)}>
                Close
              </button>
            ) : null}
          </div>
          <fieldset>
            <legend className="sr-only">AI provider configuration</legend>
            <label>
              Provider
              <select
                value={provider}
                onChange={(event) => {
                  setProvider(
                    event.target.value as ProviderConfiguration['provider'],
                  );
                  setProviderReady(false);
                  setAccess(null);
                  setChat(null);
                  setMessages([]);
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
                    onChange={(event) => {
                      setEndpoint(event.target.value);
                      setProviderReady(false);
                      setAccess(null);
                      setChat(null);
                      setMessages([]);
                    }}
                  />
                </label>
                <label>
                  Authentication
                  <select
                    value={compatibleAuthentication}
                    onChange={(event) =>
                      setCompatibleAuthentication(
                        event.target.value as
                          'bearer' | 'x-api-key' | 'api-key',
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
                autoComplete="off"
                placeholder={providerReady ? 'Enter a replacement key' : ''}
                value={credential}
                onChange={(event) => setCredential(event.target.value)}
              />
            </label>
            <button
              className="primary-button"
              type="button"
              disabled={busy || credential.trim().length === 0}
              onClick={() => void saveProvider()}
            >
              Save provider
            </button>
          </fieldset>
        </section>
      ) : null}

      <section className="conversation" aria-label="Website adaptation chat">
        {messages.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state__spark" aria-hidden="true">
              *
            </span>
            <h2 id="welcome-title">Make the web fit you.</h2>
            <p>
              Describe one visual change. I’ll preview it before anything is
              saved.
            </p>
            {canChat ? (
              <div className="suggestions" aria-label="Example requests">
                <button
                  type="button"
                  onClick={() => setMessage('Increase the text contrast')}
                >
                  Increase contrast
                </button>
                <button
                  type="button"
                  onClick={() => setMessage('Make the text larger')}
                >
                  Make text larger
                </button>
                <button
                  type="button"
                  onClick={() => setMessage('Add more spacing between lines')}
                >
                  Add line spacing
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="message-list" aria-live="polite">
            {messages.map((entry) => (
              <article
                className={`message message--${entry.role}${entry.error === true ? ' message--error' : ''}`}
                key={entry.id}
                {...(entry.error === true ? { role: 'alert' } : {})}
              >
                <span>{entry.role === 'user' ? 'You' : 'Match'}</span>
                <p>{entry.content}</p>
              </article>
            ))}
          </div>
        )}

        {busy ? (
          <div className="thinking" role="status">
            <span />
            <span />
            <span />
            Inspecting this page
          </div>
        ) : null}

        {chat?.status === 'clarification' &&
        chat.clarificationChoices.length > 0 ? (
          <div className="suggestions" aria-label="Clarification choices">
            {chat.clarificationChoices.map((choice) => (
              <button
                type="button"
                key={choice}
                onClick={() => setMessage(choice)}
              >
                {choice}
              </button>
            ))}
          </div>
        ) : null}

        {chat?.status === 'preview' ? (
          <div className="preview-card">
            <div>
              <span className="eyebrow">Live preview</span>
              <p>
                Keep this change for the current page, or restore the original.
              </p>
            </div>
            <div className="preview-card__actions">
              <button
                className="primary-button"
                type="button"
                disabled={busy}
                onClick={() => void actOnPreview('keep')}
              >
                Keep preview
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void actOnPreview('discard')}
              >
                Discard preview
              </button>
            </div>
          </div>
        ) : null}

        {!providerReady && !showSettings ? (
          <div className="gate-card">
            <p>Connect your AI provider to start chatting.</p>
            <button
              className="primary-button"
              type="button"
              onClick={() => setShowSettings(true)}
            >
              Configure provider
            </button>
          </div>
        ) : null}

        {providerReady && pageUrl !== null && access?.status !== 'ready' ? (
          <div className="gate-card">
            <p>
              Allow this site and provider before page context is inspected.
            </p>
            <button
              className="primary-button"
              type="button"
              onClick={() => void grantSiteAccess()}
            >
              Grant site access
            </button>
          </div>
        ) : null}

        {errorMessage === null ? null : (
          <p className="error-banner" role="alert">
            {errorMessage}
          </p>
        )}
      </section>

      <footer className="composer-area">
        {canChat ? (
          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              void submitChat();
            }}
          >
            <label className="sr-only" htmlFor="adaptation-message">
              Describe the change
            </label>
            <textarea
              id="adaptation-message"
              rows={1}
              placeholder="Ask for a change..."
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void submitChat();
                }
              }}
            />
            <button
              className="send-button"
              type="submit"
              aria-label="Send"
              disabled={busy || message.trim().length === 0}
            >
              <span aria-hidden="true">&gt;</span>
            </button>
          </form>
        ) : null}
        <p className="local-note">
          <span aria-hidden="true" /> Local-first. Preview before save.
        </p>
      </footer>
    </main>
  );
}
