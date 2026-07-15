import {
  ActiveTabCoordinator,
  handlePanelReadinessRequest,
  type RuntimeSender,
  type TabSnapshot,
} from './coordination';

type BrowserRuntimeApi = Pick<typeof browser, 'runtime' | 'tabs'>;

const senderSnapshot = (
  sender: Parameters<
    Parameters<BrowserRuntimeApi['runtime']['onMessage']['addListener']>[0]
  >[1],
): RuntimeSender => ({
  ...(sender.id === undefined ? {} : { id: sender.id }),
  ...(sender.url === undefined ? {} : { url: sender.url }),
  ...(sender.frameId === undefined ? {} : { frameId: sender.frameId }),
  ...(sender.documentId === undefined ? {} : { documentId: sender.documentId }),
  ...(sender.tab?.id === undefined ? {} : { tab: { id: sender.tab.id } }),
});

const tabSnapshot = (
  tab: { id?: number | undefined; url?: string | undefined } | undefined,
): TabSnapshot | undefined => {
  if (tab === undefined) {
    return undefined;
  }
  return {
    ...(tab.id === undefined ? {} : { id: tab.id }),
    ...(tab.url === undefined ? {} : { url: tab.url }),
  };
};

export const installRuntimeCoordination = (
  api: BrowserRuntimeApi,
  existingCoordinator?: ActiveTabCoordinator,
) => {
  const extensionBaseUrl = api.runtime.getURL('/');
  const coordinator =
    existingCoordinator ??
    new ActiveTabCoordinator(api.runtime.id, extensionBaseUrl);

  api.runtime.onMessage.addListener((message, sender) => {
    if (
      message === null ||
      typeof message !== 'object' ||
      !('type' in message) ||
      message.type !== 'panel.readiness.request'
    ) {
      return undefined;
    }
    return handlePanelReadinessRequest(
      message,
      senderSnapshot(sender),
      coordinator,
      async () => {
        const [activeTab] = await api.tabs.query({
          active: true,
          currentWindow: true,
        });
        if (activeTab?.url?.startsWith('https://')) {
          return tabSnapshot(activeTab);
        }
        return tabSnapshot(activeTab);
      },
    );
  });
  api.tabs.onActivated.addListener(() => coordinator.invalidate());
  api.tabs.onUpdated.addListener((tabId, change) => {
    if (change.url !== undefined || change.status === 'loading') {
      coordinator.invalidate(tabId);
    }
  });
  api.tabs.onRemoved.addListener((tabId) => coordinator.invalidate(tabId));
  return coordinator;
};
