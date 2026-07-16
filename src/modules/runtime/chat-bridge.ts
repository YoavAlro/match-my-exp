import {
  PanelChatCommandSchema,
  PanelChatResponseSchema,
  ProfileSchema,
  RuntimeMessageSchema,
} from '../contracts';
import { ChromeConsentStorage, SiteAccessService } from '../permissions';
import { ChromeProfileStorage, ProfileRepository } from '../profiles';
import {
  AnthropicProvider,
  CompatibleProvider,
  CredentialVault,
  GeminiProvider,
  OpenAIProvider,
  ProviderRequestError,
  ProviderSettingsService,
} from '../providers';
import {
  ActiveTabCoordinator,
  type PageRequestContext,
  type RuntimeSender,
} from './coordination';

type BrowserChatApi = Pick<
  typeof browser,
  'permissions' | 'runtime' | 'scripting' | 'storage' | 'tabs'
>;

interface ActivePreview {
  previewId: string;
  origin: string;
  path: string;
}

const providerDestination = (
  configuration: Exclude<
    Awaited<ReturnType<ProviderSettingsService['status']>>['configuration'],
    null
  >,
) => {
  if (configuration.provider === 'openai') {
    return { id: configuration.provider, origin: 'https://api.openai.com' };
  }
  if (configuration.provider === 'anthropic') {
    return { id: configuration.provider, origin: 'https://api.anthropic.com' };
  }
  if (configuration.provider === 'gemini') {
    return {
      id: configuration.provider,
      origin: 'https://generativelanguage.googleapis.com',
    };
  }
  if ('config' in configuration) {
    return {
      id: configuration.provider,
      origin: new URL(configuration.config.endpoint).origin,
    };
  }
  throw new Error('Provider destination is unsupported');
};

const senderSnapshot = (sender: {
  id?: string | undefined;
  url?: string | undefined;
  tab?: { id?: number | undefined } | undefined;
}): RuntimeSender => ({
  ...(sender.id === undefined ? {} : { id: sender.id }),
  ...(sender.url === undefined ? {} : { url: sender.url }),
  ...(sender.tab?.id === undefined ? {} : { tab: { id: sender.tab.id } }),
});

const errorResponse = (requestId: string, error: unknown) => {
  let errorCode = 'request_failed';
  let assistantMessage = 'I could not complete that request. Please try again.';
  if (error instanceof ProviderRequestError) {
    errorCode = error.code;
    if (
      error.code === 'provider_http_401' ||
      error.code === 'provider_http_403'
    ) {
      assistantMessage = 'The provider rejected the API key.';
    } else if (error.code === 'provider_http_404') {
      assistantMessage = 'The provider endpoint or model was not found.';
    } else if (error.code === 'provider_http_400') {
      assistantMessage = 'The provider rejected the model or request format.';
    } else if (error.code === 'provider_transport_failure') {
      assistantMessage = 'The browser could not reach the provider endpoint.';
    } else if (
      error.code === 'provider_proposal_invalid' ||
      error.code === 'provider_output_missing'
    ) {
      assistantMessage = 'The provider returned an unusable response.';
    }
  } else if (error instanceof Error) {
    if (error.message === 'Active page changed during request') {
      errorCode = 'page_changed';
      assistantMessage = 'The page changed before I could finish.';
    } else if (error.message === 'M1 bridge accepts style proposals only') {
      errorCode = 'unsupported_operation';
      assistantMessage =
        'That response proposed an unsupported change. Try asking for a visual style change.';
    } else if (error.message === 'Site and provider access is not authorized') {
      errorCode = 'access_not_authorized';
      assistantMessage = 'Site or provider access needs to be granted again.';
    }
  }
  return PanelChatResponseSchema.parse({
    schemaVersion: 1,
    type: 'panel.chat.response',
    requestId,
    status: 'error',
    assistantMessage,
    previewId: null,
    clarificationQuestion: null,
    clarificationChoices: [],
    errorCode,
  });
};

export const installPanelChatBridge = (
  api: BrowserChatApi,
  coordinator: ActiveTabCoordinator,
) => {
  const vault = new CredentialVault(api.storage.local);
  const settings = new ProviderSettingsService(api.storage.local, vault);
  const access = new SiteAccessService(
    {
      contains: (origins) =>
        api.permissions.contains({ origins: [...origins] }),
      request: (origins) => api.permissions.request({ origins: [...origins] }),
      remove: (origins) => api.permissions.remove({ origins: [...origins] }),
    },
    new ChromeConsentStorage(api.storage.local),
  );
  const profiles = new ProfileRepository(
    new ChromeProfileStorage(api.storage.local),
  );
  const active = new Map<number, ActivePreview>();
  const injected = new Map<string, string | undefined>();

  api.runtime.onMessage.addListener((raw, sender) => {
    if (
      raw === null ||
      typeof raw !== 'object' ||
      !('type' in raw) ||
      typeof raw.type !== 'string' ||
      !raw.type.startsWith('panel.') ||
      raw.type === 'panel.readiness.request'
    ) {
      return undefined;
    }
    const command = PanelChatCommandSchema.safeParse(raw);
    if (
      !command.success ||
      !coordinator.isTrustedPanelSender(senderSnapshot(sender))
    ) {
      return undefined;
    }
    return handleCommand(command.data).catch((error: unknown) =>
      errorResponse(command.data.requestId, error),
    );
  });

  const handleCommand = async (
    command: ReturnType<typeof PanelChatCommandSchema.parse>,
  ) => {
    let context: PageRequestContext;
    try {
      context = coordinator.beginPageRequest(command.requestId);
    } catch {
      const [tab] = await api.tabs.query({ active: true, currentWindow: true });
      coordinator.update(
        tab === undefined
          ? undefined
          : {
              ...(tab.id === undefined ? {} : { id: tab.id }),
              ...(tab.url === undefined ? {} : { url: tab.url }),
            },
      );
      context = coordinator.beginPageRequest(command.requestId);
    }
    const assertCurrent = () => {
      if (!coordinator.isCurrent(context)) {
        throw new Error('Active page changed during request');
      }
    };
    const sendToPage = (message: unknown) =>
      context.documentId === undefined
        ? api.tabs.sendMessage(context.tabId, message)
        : api.tabs.sendMessage(context.tabId, message, {
            documentId: context.documentId,
          });
    if (
      !(await api.permissions.contains({
        origins: [`${context.origin}/*`],
      }))
    ) {
      throw new Error('Site access is not authorized');
    }
    assertCurrent();
    if (command.type === 'panel.preview.keep') {
      const preview = active.get(context.tabId);
      if (preview !== undefined && preview.previewId !== command.previewId) {
        throw new Error('Preview is not active');
      }
      const compiled = RuntimeMessageSchema.parse(
        await sendToPage({
          schemaVersion: 1,
          type: 'profile.compile.request',
          requestId: command.requestId,
          previewId: command.previewId,
          expectedOrigin: context.origin,
          expectedPath: context.path,
        }),
      );
      if (
        compiled.type !== 'profile.compile.response' ||
        compiled.requestId !== command.requestId ||
        compiled.previewId !== command.previewId
      ) {
        throw new Error('Compiled profile response is invalid');
      }
      assertCurrent();
      const now = new Date().toISOString();
      const existing = (await profiles.listByOrigin(context.origin)).find(
        (profile) => profile.pathPattern === context.path,
      );
      const name = command.intent.slice(0, 80);
      const stored =
        existing === undefined
          ? await profiles.create(
              ProfileSchema.parse({
                schemaVersion: 1,
                id: crypto.randomUUID(),
                name,
                enabled: true,
                origin: context.origin,
                pathPattern: context.path,
                intentSummary: command.intent,
                conversationId: crypto.randomUUID(),
                operations: compiled.operations,
                revision: 1,
                health: { state: 'healthy' },
                createdAt: now,
                updatedAt: now,
              }),
            )
          : await profiles.update(
              ProfileSchema.parse({
                ...existing,
                name,
                enabled: true,
                intentSummary: command.intent,
                operations: compiled.operations,
                revision: existing.revision + 1,
                health: { state: 'healthy' },
                updatedAt: now,
              }),
            );
      const applied = RuntimeMessageSchema.parse(
        await sendToPage({
          schemaVersion: 1,
          type: 'profile.apply',
          requestId: command.requestId,
          profileId: stored.id,
          revision: stored.revision,
          operations: stored.operations,
          expectedOrigin: context.origin,
          expectedPath: context.path,
        }),
      );
      if (
        applied.type !== 'profile.apply.response' ||
        applied.requestId !== command.requestId ||
        applied.profileId !== stored.id ||
        applied.revision !== stored.revision
      ) {
        throw new Error('Profile application response is invalid');
      }
      assertCurrent();
      active.delete(context.tabId);
      return PanelChatResponseSchema.parse({
        schemaVersion: 1,
        type: 'panel.chat.response',
        requestId: command.requestId,
        status: 'kept',
        assistantMessage: 'Saved for this page.',
        previewId: command.previewId,
        clarificationQuestion: null,
        clarificationChoices: [],
      });
    }
    if (command.type === 'panel.preview.discard') {
      await sendToPage({
        schemaVersion: 1,
        type: 'preview.rollback',
        requestId: command.requestId,
        previewId: command.previewId,
        expectedOrigin: context.origin,
        expectedPath: context.path,
      });
      assertCurrent();
      active.delete(context.tabId);
      return PanelChatResponseSchema.parse({
        schemaVersion: 1,
        type: 'panel.chat.response',
        requestId: command.requestId,
        status: 'discarded',
        assistantMessage: '',
        previewId: command.previewId,
        clarificationQuestion: null,
        clarificationChoices: [],
      });
    }

    const previous = active.get(context.tabId);
    if (previous !== undefined) {
      await sendToPage({
        schemaVersion: 1,
        type: 'preview.rollback',
        requestId: command.requestId,
        previewId: previous.previewId,
        expectedOrigin: previous.origin,
        expectedPath: previous.path,
      });
      assertCurrent();
      active.delete(context.tabId);
    }

    const configured = await settings.status();
    if (configured.configuration === null) {
      throw new Error('Provider is not configured');
    }
    const provider = configured.configuration;
    const authorization = await access.readiness(
      `${context.origin}${context.path}`,
      providerDestination(provider),
    );
    if (authorization.status !== 'ready') {
      throw new Error('Site and provider access is not authorized');
    }
    assertCurrent();

    const injectionKey = `${context.tabId}:${context.epoch}`;
    if (!injected.has(injectionKey)) {
      const results = await api.scripting.executeScript({
        target: { tabId: context.tabId, frameIds: [0] },
        files: ['/content-scripts/content.js'],
      });
      injected.set(
        injectionKey,
        results.find(({ frameId }) => frameId === 0)?.documentId,
      );
    }
    const documentId = injected.get(injectionKey);
    if (documentId !== undefined) {
      context.documentId = documentId;
    }
    assertCurrent();
    const inspectionRaw = await sendToPage({
      schemaVersion: 1,
      type: 'page.inspect.request',
      requestId: command.requestId,
      tabId: context.tabId,
      expectedOrigin: context.origin,
      expectedPath: context.path,
    });
    const inspection = RuntimeMessageSchema.parse(inspectionRaw);
    if (
      inspection.type !== 'page.inspect.response' ||
      inspection.requestId !== command.requestId
    ) {
      throw new Error('Inspection response is invalid');
    }
    assertCurrent();
    let result;
    if (provider.provider === 'compatible') {
      result = await new CompatibleProvider(vault, provider.config).propose({
        userMessage: command.message,
        pageContext: inspection.context,
      });
    } else if (provider.provider === 'openai') {
      result = await new OpenAIProvider(vault).propose({
        model: provider.model,
        userMessage: command.message,
        pageContext: inspection.context,
      });
    } else if (provider.provider === 'anthropic') {
      result = await new AnthropicProvider(vault).propose({
        model: provider.model,
        userMessage: command.message,
        pageContext: inspection.context,
      });
    } else {
      result = await new GeminiProvider(vault).propose({
        model: provider.model,
        userMessage: command.message,
        pageContext: inspection.context,
      });
    }
    assertCurrent();
    if (result.proposal.clarification !== null) {
      return PanelChatResponseSchema.parse({
        schemaVersion: 1,
        type: 'panel.chat.response',
        requestId: command.requestId,
        status: 'clarification',
        assistantMessage: result.proposal.assistantMessage,
        previewId: null,
        clarificationQuestion: result.proposal.clarification.question,
        clarificationChoices: result.proposal.clarification.choices,
      });
    }
    if (result.proposal.operations.some(({ kind }) => kind !== 'style')) {
      throw new Error('M1 bridge accepts style proposals only');
    }
    const previewId = crypto.randomUUID();
    const previewed = await sendToPage({
      schemaVersion: 1,
      type: 'proposal.preview',
      requestId: command.requestId,
      previewId,
      expectedOrigin: context.origin,
      expectedPath: context.path,
      operations: result.proposal.operations,
    });
    if (
      previewed === null ||
      typeof previewed !== 'object' ||
      !('status' in previewed) ||
      previewed.status !== 'previewed'
    ) {
      throw new Error('Preview response is invalid');
    }
    assertCurrent();
    active.set(context.tabId, {
      previewId,
      origin: context.origin,
      path: context.path,
    });
    return PanelChatResponseSchema.parse({
      schemaVersion: 1,
      type: 'panel.chat.response',
      requestId: command.requestId,
      status: 'preview',
      assistantMessage: result.proposal.assistantMessage,
      previewId,
      clarificationQuestion: null,
      clarificationChoices: [],
    });
  };

  return { vault, settings };
};
