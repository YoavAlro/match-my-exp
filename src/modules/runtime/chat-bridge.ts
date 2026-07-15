import {
  PanelChatCommandSchema,
  PanelChatResponseSchema,
  RuntimeMessageSchema,
} from '../contracts';
import {
  AnthropicProvider,
  CompatibleProvider,
  CredentialVault,
  GeminiProvider,
  OpenAIProvider,
  ProviderSettingsService,
} from '../providers';
import { ActiveTabCoordinator, type RuntimeSender } from './coordination';

type BrowserChatApi = Pick<
  typeof browser,
  'runtime' | 'scripting' | 'storage' | 'tabs'
>;

interface ActivePreview {
  previewId: string;
  origin: string;
  path: string;
}

const senderSnapshot = (sender: {
  id?: string | undefined;
  url?: string | undefined;
  tab?: { id?: number | undefined } | undefined;
}): RuntimeSender => ({
  ...(sender.id === undefined ? {} : { id: sender.id }),
  ...(sender.url === undefined ? {} : { url: sender.url }),
  ...(sender.tab?.id === undefined ? {} : { tab: { id: sender.tab.id } }),
});

export const installPanelChatBridge = (
  api: BrowserChatApi,
  coordinator: ActiveTabCoordinator,
) => {
  const vault = new CredentialVault(api.storage.local);
  const settings = new ProviderSettingsService(api.storage.local, vault);
  const active = new Map<number, ActivePreview>();
  const injected = new Set<string>();

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
    return handleCommand(command.data);
  });

  const handleCommand = async (
    command: ReturnType<typeof PanelChatCommandSchema.parse>,
  ) => {
    const context = coordinator.beginPageRequest(command.requestId);
    if (command.type === 'panel.preview.keep') {
      const preview = active.get(context.tabId);
      if (preview?.previewId !== command.previewId) {
        throw new Error('Preview is not active');
      }
      active.delete(context.tabId);
      return PanelChatResponseSchema.parse({
        schemaVersion: 1,
        type: 'panel.chat.response',
        requestId: command.requestId,
        status: 'kept',
        assistantMessage: '',
        previewId: command.previewId,
        clarificationQuestion: null,
        clarificationChoices: [],
      });
    }
    if (command.type === 'panel.preview.discard') {
      await api.tabs.sendMessage(context.tabId, {
        schemaVersion: 1,
        type: 'preview.rollback',
        requestId: command.requestId,
        previewId: command.previewId,
        expectedOrigin: context.origin,
        expectedPath: context.path,
      });
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
      await api.tabs.sendMessage(context.tabId, {
        schemaVersion: 1,
        type: 'preview.rollback',
        requestId: command.requestId,
        previewId: previous.previewId,
        expectedOrigin: previous.origin,
        expectedPath: previous.path,
      });
      active.delete(context.tabId);
    }

    const injectionKey = `${context.tabId}:${context.epoch}`;
    if (!injected.has(injectionKey)) {
      await api.scripting.executeScript({
        target: { tabId: context.tabId, frameIds: [0] },
        files: ['/content-scripts/content.js'],
      });
      injected.add(injectionKey);
    }
    const inspectionRaw = await api.tabs.sendMessage(context.tabId, {
      schemaVersion: 1,
      type: 'page.inspect.request',
      requestId: command.requestId,
      tabId: context.tabId,
      expectedOrigin: context.origin,
      expectedPath: context.path,
    });
    const inspection = RuntimeMessageSchema.parse(inspectionRaw);
    if (inspection.type !== 'page.inspect.response') {
      throw new Error('Inspection response is invalid');
    }

    const configured = await settings.status();
    if (configured.configuration === null) {
      throw new Error('Provider is not configured');
    }
    const provider = configured.configuration;
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
    await api.tabs.sendMessage(context.tabId, {
      schemaVersion: 1,
      type: 'proposal.preview',
      requestId: command.requestId,
      previewId,
      expectedOrigin: context.origin,
      expectedPath: context.path,
      operations: result.proposal.operations,
    });
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
