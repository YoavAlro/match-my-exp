import {
  PanelReadinessRequestSchema,
  PanelReadinessResponseSchema,
  RuntimeMessageSchema,
  type PanelReadinessResponse,
  type RuntimeMessage,
} from '../contracts';

export const MAX_RUNTIME_MESSAGE_BYTES = 64 * 1024;

export interface TabSnapshot {
  id?: number;
  url?: string;
}

export interface RuntimeSender {
  id?: string;
  url?: string;
  frameId?: number;
  documentId?: string;
  tab?: { id?: number };
}

export interface PageRequestContext {
  requestId: string;
  tabId: number;
  origin: string;
  path: string;
  epoch: number;
  documentId?: string;
}

interface ActiveIdentity {
  key: string;
  tabId: number | null;
  origin: string | null;
  path: string | null;
  readiness: PanelReadinessResponse['readiness'];
}

const messageSize = (value: unknown) => {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

const identityFromTab = (tab: TabSnapshot | undefined): ActiveIdentity => {
  if (tab?.id === undefined || tab.url === undefined) {
    return {
      key: 'unavailable',
      tabId: null,
      origin: null,
      path: null,
      readiness: 'unavailable',
    };
  }
  try {
    const url = new URL(tab.url);
    const localHost =
      url.hostname === 'localhost' ||
      url.hostname.endsWith('.localhost') ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]';
    if (
      url.protocol !== 'https:' ||
      localHost ||
      url.username !== '' ||
      url.password !== ''
    ) {
      return {
        key: `${tab.id}:${tab.url}`,
        tabId: tab.id,
        origin: null,
        path: null,
        readiness: 'unsupported',
      };
    }
    return {
      key: `${tab.id}:${url.origin}${url.pathname}`,
      tabId: tab.id,
      origin: url.origin,
      path: url.pathname,
      readiness: 'ready',
    };
  } catch {
    return {
      key: `${tab.id}:invalid-url`,
      tabId: tab.id,
      origin: null,
      path: null,
      readiness: 'unsupported',
    };
  }
};

const senderUrlMatches = (
  senderUrl: string | undefined,
  origin: string,
  path: string,
) => {
  if (senderUrl === undefined) {
    return false;
  }
  try {
    const url = new URL(senderUrl);
    return url.origin === origin && url.pathname === path;
  } catch {
    return false;
  }
};

export class ActiveTabCoordinator {
  readonly #extensionId: string;
  readonly #extensionBaseUrl: string;
  #epoch = 0;
  #active: ActiveIdentity = identityFromTab(undefined);

  constructor(extensionId: string, extensionBaseUrl: string) {
    this.#extensionId = extensionId;
    this.#extensionBaseUrl = extensionBaseUrl.endsWith('/')
      ? extensionBaseUrl
      : `${extensionBaseUrl}/`;
  }

  update(tab: TabSnapshot | undefined) {
    const next = identityFromTab(tab);
    if (next.key !== this.#active.key) {
      this.#epoch += 1;
      this.#active = next;
    }
    return this.#active;
  }

  invalidate(tabId?: number) {
    if (tabId === undefined || this.#active.tabId === tabId) {
      this.#epoch += 1;
      this.#active = identityFromTab(undefined);
    }
  }

  readiness(requestId: string): PanelReadinessResponse {
    return PanelReadinessResponseSchema.parse({
      schemaVersion: 1,
      type: 'panel.readiness.response',
      requestId,
      readiness: this.#active.readiness,
      tabId: this.#active.tabId,
      origin: this.#active.origin,
      path: this.#active.path,
      epoch: this.#epoch,
    });
  }

  beginPageRequest(requestId: string): PageRequestContext {
    if (
      this.#active.readiness !== 'ready' ||
      this.#active.tabId === null ||
      this.#active.origin === null ||
      this.#active.path === null
    ) {
      throw new Error('Active tab is not ready');
    }
    return {
      requestId,
      tabId: this.#active.tabId,
      origin: this.#active.origin,
      path: this.#active.path,
      epoch: this.#epoch,
    };
  }

  validateContentResponse(
    raw: unknown,
    sender: RuntimeSender,
    context: PageRequestContext,
  ): RuntimeMessage | null {
    if (messageSize(raw) > MAX_RUNTIME_MESSAGE_BYTES) {
      return null;
    }
    const parsed = RuntimeMessageSchema.safeParse(raw);
    if (
      !parsed.success ||
      parsed.data.type !== 'page.inspect.response' ||
      parsed.data.requestId !== context.requestId ||
      sender.id !== this.#extensionId ||
      sender.tab?.id !== context.tabId ||
      sender.frameId !== 0 ||
      !senderUrlMatches(sender.url, context.origin, context.path) ||
      context.epoch !== this.#epoch ||
      this.#active.tabId !== context.tabId ||
      this.#active.origin !== context.origin ||
      this.#active.path !== context.path ||
      (context.documentId !== undefined &&
        sender.documentId !== context.documentId)
    ) {
      return null;
    }
    return parsed.data;
  }

  isTrustedPanelSender(sender: RuntimeSender) {
    if (sender.id !== this.#extensionId || sender.url === undefined) {
      return false;
    }
    try {
      const url = new URL(sender.url);
      return (
        sender.url.startsWith(this.#extensionBaseUrl) &&
        url.pathname.endsWith('/sidepanel.html')
      );
    } catch {
      return false;
    }
  }
}

export const handlePanelReadinessRequest = async (
  raw: unknown,
  sender: RuntimeSender,
  coordinator: ActiveTabCoordinator,
  queryActiveTab: () => Promise<TabSnapshot | undefined>,
) => {
  if (messageSize(raw) > MAX_RUNTIME_MESSAGE_BYTES) {
    return undefined;
  }
  const request = PanelReadinessRequestSchema.safeParse(raw);
  if (!request.success || !coordinator.isTrustedPanelSender(sender)) {
    return undefined;
  }
  coordinator.update(await queryActiveTab());
  return coordinator.readiness(request.data.requestId);
};
