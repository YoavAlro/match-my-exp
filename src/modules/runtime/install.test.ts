import { describe, expect, it, vi } from 'vitest';
import { ActiveTabCoordinator } from './coordination';
import { installActionPanel, installRuntimeCoordination } from './install';

const requestId = '00000000-0000-4000-8000-000000000001';

describe('installRuntimeCoordination', () => {
  it('registers readiness and invalidation listeners', async () => {
    let messageListener:
      ((message: unknown, sender: object) => Promise<unknown>) | undefined;
    let activatedListener: (() => void) | undefined;
    let updatedListener:
      | ((tabId: number, change: { url?: string; status?: string }) => void)
      | undefined;
    let removedListener: ((tabId: number) => void) | undefined;
    const query = vi
      .fn()
      .mockResolvedValue([{ id: 12, url: 'https://example.com/account' }]);
    const api = {
      runtime: {
        id: 'extension-id',
        getURL: () => 'chrome-extension://extension-id/',
        onMessage: {
          addListener: (listener: typeof messageListener) => {
            messageListener = listener;
          },
        },
      },
      tabs: {
        query,
        onActivated: {
          addListener: (listener: () => void) => {
            activatedListener = listener;
          },
        },
        onUpdated: {
          addListener: (
            listener: (
              tabId: number,
              change: { url?: string; status?: string },
            ) => void,
          ) => {
            updatedListener = listener;
          },
        },
        onRemoved: {
          addListener: (listener: (tabId: number) => void) => {
            removedListener = listener;
          },
        },
      },
    };

    const coordinator = installRuntimeCoordination(
      api as unknown as Parameters<typeof installRuntimeCoordination>[0],
    );
    const response = await messageListener?.(
      {
        schemaVersion: 1,
        type: 'panel.readiness.request',
        requestId,
      },
      {
        id: 'extension-id',
        url: 'chrome-extension://extension-id/sidepanel.html',
      },
    );

    expect(response).toMatchObject({ readiness: 'ready', tabId: 12, epoch: 1 });
    expect(query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    activatedListener?.();
    query.mockResolvedValueOnce([]);
    expect(
      await messageListener?.(
        {
          schemaVersion: 1,
          type: 'panel.readiness.request',
          requestId: '00000000-0000-4000-8000-000000000002',
        },
        {
          id: 'extension-id',
          url: 'chrome-extension://extension-id/sidepanel.html',
        },
      ),
    ).toMatchObject({ readiness: 'unavailable' });
    expect(coordinator.readiness(requestId).readiness).toBe('unavailable');
    coordinator.update({ id: 12, url: 'https://example.com/account' });
    updatedListener?.(12, {});
    expect(coordinator.readiness(requestId).readiness).toBe('ready');
    updatedListener?.(12, { url: 'https://example.com/other' });
    expect(coordinator.readiness(requestId).readiness).toBe('unavailable');
    coordinator.update({ id: 12, url: 'https://example.com/account' });
    removedListener?.(12);
    expect(coordinator.readiness(requestId).readiness).toBe('unavailable');
  });

  it('captures the clicked tab before opening its side panel', async () => {
    let clicked: ((tab: { id?: number; url?: string }) => void) | undefined;
    const open = vi.fn().mockResolvedValue(undefined);
    const api = {
      action: {
        onClicked: {
          addListener: (listener: typeof clicked) => {
            clicked = listener;
          },
        },
      },
      sidePanel: { open },
    };
    const coordinator = new ActiveTabCoordinator(
      'extension-id',
      'chrome-extension://extension-id/',
    );
    installActionPanel(
      api as unknown as Parameters<typeof installActionPanel>[0],
      coordinator,
    );

    clicked?.({ url: 'https://example.com/account' });
    expect(open).not.toHaveBeenCalled();
    clicked?.({ id: 12, url: 'https://example.com/account' });

    expect(coordinator.readiness(requestId)).toMatchObject({
      readiness: 'ready',
      tabId: 12,
      origin: 'https://example.com',
      path: '/account',
    });
    expect(open).toHaveBeenCalledWith({ tabId: 12 });
    await Promise.resolve();
  });
});
