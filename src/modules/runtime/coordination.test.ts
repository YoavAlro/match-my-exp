import { describe, expect, it, vi } from 'vitest';
import {
  ActiveTabCoordinator,
  MAX_RUNTIME_MESSAGE_BYTES,
  handlePanelReadinessRequest,
  type RuntimeSender,
} from './coordination';

const extensionId = 'extension-id';
const extensionOrigin = 'chrome-extension://extension-id';
const requestId = '00000000-0000-4000-8000-000000000001';

const panelSender: RuntimeSender = {
  id: extensionId,
  url: `${extensionOrigin}/sidepanel.html`,
};

const readinessRequest = {
  schemaVersion: 1,
  type: 'panel.readiness.request',
  requestId,
};

const pageResponse = {
  schemaVersion: 1,
  type: 'page.inspect.response',
  requestId,
  context: {
    schemaVersion: 1,
    origin: 'https://example.com',
    path: '/account',
    title: 'Account',
    elements: [],
  },
};

describe('ActiveTabCoordinator', () => {
  it('derives readiness without reading page content', async () => {
    const coordinator = new ActiveTabCoordinator(extensionId, extensionOrigin);
    const queryActiveTab = vi.fn().mockResolvedValue({
      id: 7,
      url: 'https://example.com/account?token=private#section',
      title: 'Ignored tab title',
    });

    const response = await handlePanelReadinessRequest(
      readinessRequest,
      panelSender,
      coordinator,
      queryActiveTab,
    );

    expect(queryActiveTab).toHaveBeenCalledOnce();
    expect(response).toEqual({
      schemaVersion: 1,
      type: 'panel.readiness.response',
      requestId,
      readiness: 'ready',
      tabId: 7,
      origin: 'https://example.com',
      path: '/account',
      epoch: 1,
    });
    expect(
      await handlePanelReadinessRequest(
        {
          ...readinessRequest,
          requestId: '00000000-0000-4000-8000-000000000002',
        },
        panelSender,
        coordinator,
        queryActiveTab,
      ),
    ).toMatchObject({ readiness: 'ready', tabId: 7, epoch: 1 });
    expect(queryActiveTab).toHaveBeenCalledOnce();
  });

  it('classifies unavailable and unsupported tabs', () => {
    const coordinator = new ActiveTabCoordinator(extensionId, extensionOrigin);

    coordinator.update(undefined);
    expect(coordinator.readiness(requestId)).toMatchObject({
      readiness: 'unavailable',
      tabId: null,
      epoch: 0,
    });
    coordinator.update({ id: 2, url: 'chrome://settings/' });
    expect(coordinator.readiness(requestId)).toMatchObject({
      readiness: 'unsupported',
      tabId: 2,
      origin: null,
      path: null,
      epoch: 1,
    });
    expect(() => coordinator.beginPageRequest(requestId)).toThrow(
      'Active tab is not ready',
    );
    coordinator.update({ id: 3, url: 'https://localhost/private' });
    expect(coordinator.readiness(requestId).readiness).toBe('unsupported');
  });

  it('rejects forged panel senders and oversized messages', async () => {
    const coordinator = new ActiveTabCoordinator(extensionId, extensionOrigin);
    const query = vi.fn().mockResolvedValue({
      id: 1,
      url: 'https://example.com/',
    });

    for (const sender of [
      { ...panelSender, id: 'other-extension' },
      { ...panelSender, url: `${extensionOrigin}/options.html` },
    ]) {
      expect(
        await handlePanelReadinessRequest(
          readinessRequest,
          sender,
          coordinator,
          query,
        ),
      ).toBeUndefined();
    }
    const oversized = {
      ...readinessRequest,
      padding: 'x'.repeat(MAX_RUNTIME_MESSAGE_BYTES),
    };
    expect(
      await handlePanelReadinessRequest(
        oversized,
        panelSender,
        coordinator,
        query,
      ),
    ).toBeUndefined();
    expect(query).not.toHaveBeenCalled();
  });

  it('invalidates stale responses after tab and route changes', () => {
    const coordinator = new ActiveTabCoordinator(extensionId, extensionOrigin);
    coordinator.update({ id: 9, url: 'https://example.com/account' });
    const context = coordinator.beginPageRequest(requestId);
    const sender: RuntimeSender = {
      id: extensionId,
      tab: { id: 9 },
      frameId: 0,
      url: 'https://example.com/account',
    };

    expect(
      coordinator.validateContentResponse(pageResponse, sender, context),
    ).toMatchObject({ type: 'page.inspect.response' });

    coordinator.update({ id: 9, url: 'https://example.com/other' });
    expect(
      coordinator.validateContentResponse(pageResponse, sender, context),
    ).toBeNull();
    coordinator.update({ id: 10, url: 'https://example.com/account' });
    expect(
      coordinator.validateContentResponse(
        pageResponse,
        { ...sender, tab: { id: 10 } },
        context,
      ),
    ).toBeNull();
  });

  it('validates top frame, sender, request, document, and payload', () => {
    const coordinator = new ActiveTabCoordinator(extensionId, extensionOrigin);
    coordinator.update({ id: 4, url: 'https://example.com/account' });
    const context = {
      ...coordinator.beginPageRequest(requestId),
      documentId: 'document-one',
    };
    const sender: RuntimeSender = {
      id: extensionId,
      tab: { id: 4 },
      frameId: 0,
      documentId: 'document-one',
      url: 'https://example.com/account',
    };

    const invalidSenders = [
      { ...sender, id: 'other-extension' },
      { ...sender, frameId: 1 },
      { ...sender, tab: { id: 5 } },
      { ...sender, documentId: 'document-two' },
      { ...sender, url: 'https://example.com/other' },
    ];
    for (const invalidSender of invalidSenders) {
      expect(
        coordinator.validateContentResponse(
          pageResponse,
          invalidSender,
          context,
        ),
      ).toBeNull();
    }
    expect(
      coordinator.validateContentResponse(
        { ...pageResponse, requestId: '00000000-0000-4000-8000-000000000002' },
        sender,
        context,
      ),
    ).toBeNull();
    expect(
      coordinator.validateContentResponse(
        { ...pageResponse, schemaVersion: 2 },
        sender,
        context,
      ),
    ).toBeNull();
    expect(
      coordinator.validateContentResponse(
        { ...pageResponse, padding: 'x'.repeat(MAX_RUNTIME_MESSAGE_BYTES) },
        sender,
        context,
      ),
    ).toBeNull();
  });
});
