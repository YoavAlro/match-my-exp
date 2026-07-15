import { describe, expect, it, vi } from 'vitest';
import type { Profile } from '../contracts';
import { installProfileBridge } from './profile-bridge';

const profile = (): Profile => ({
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Account contrast',
  enabled: true,
  origin: 'https://example.com',
  pathPattern: '/account',
  intentSummary: 'Increase contrast.',
  conversationId: '00000000-0000-4000-8000-000000000002',
  operations: [
    {
      kind: 'style',
      operationId: 'style-main',
      target: {
        kind: 'durable',
        shadowHosts: [],
        element: { attributes: [], selector: '#main' },
      },
      declarations: [{ property: 'color', value: 'red' }],
    },
  ],
  revision: 1,
  health: { state: 'healthy' },
  createdAt: '2026-07-15T13:00:00Z',
  updatedAt: '2026-07-15T13:00:00Z',
});

describe('installProfileBridge', () => {
  it('returns only the deterministic profile to a permitted matching page', async () => {
    let messageListener:
      | ((message: unknown, sender: Record<string, unknown>) => unknown)
      | undefined;
    const stored = profile();
    const api = {
      runtime: {
        id: 'extension-id',
        onMessage: {
          addListener: (listener: typeof messageListener) => {
            messageListener = listener;
          },
        },
      },
      permissions: {
        contains: vi.fn().mockResolvedValue(true),
        onRemoved: { addListener: vi.fn() },
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({
            profileRepository: {
              schemaVersion: 1,
              profiles: { [stored.id]: stored },
              revisions: { [stored.id]: [] },
            },
          }),
          set: vi.fn(),
        },
      },
      tabs: { query: vi.fn(), sendMessage: vi.fn() },
    };
    installProfileBridge(
      api as unknown as Parameters<typeof installProfileBridge>[0],
    );

    const response = await messageListener?.(
      {
        schemaVersion: 1,
        type: 'profile.resolve.request',
        requestId: '00000000-0000-4000-8000-000000000003',
        expectedOrigin: 'https://example.com',
        expectedPath: '/account',
      },
      {
        id: 'extension-id',
        frameId: 0,
        url: 'https://example.com/account',
        tab: { id: 7 },
      },
    );

    expect(response).toMatchObject({
      type: 'profile.resolve.response',
      profile: { id: stored.id, revision: 1 },
    });
    expect(api.permissions.contains).toHaveBeenCalledWith({
      origins: ['https://example.com/*'],
    });
  });

  it('fails closed without permission and clears tabs after revocation', async () => {
    let messageListener:
      | ((message: unknown, sender: Record<string, unknown>) => unknown)
      | undefined;
    let removedListener:
      ((removed: { origins?: string[] }) => void) | undefined;
    const sendMessage = vi.fn().mockResolvedValue({ status: 'cleared' });
    const api = {
      runtime: {
        id: 'extension-id',
        onMessage: {
          addListener: (listener: typeof messageListener) => {
            messageListener = listener;
          },
        },
      },
      permissions: {
        contains: vi.fn().mockResolvedValue(false),
        onRemoved: {
          addListener: (listener: typeof removedListener) => {
            removedListener = listener;
          },
        },
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue({}),
          set: vi.fn(),
        },
      },
      tabs: {
        query: vi.fn().mockResolvedValue([{ id: 7 }]),
        sendMessage,
      },
    };
    installProfileBridge(
      api as unknown as Parameters<typeof installProfileBridge>[0],
    );
    const request = {
      schemaVersion: 1,
      type: 'profile.resolve.request',
      requestId: '00000000-0000-4000-8000-000000000003',
      expectedOrigin: 'https://example.com',
      expectedPath: '/account',
    };

    await expect(
      messageListener?.(request, {
        id: 'extension-id',
        frameId: 0,
        url: 'https://example.com/account',
        tab: { id: 7 },
      }),
    ).resolves.toMatchObject({ profile: null });
    expect(
      messageListener?.(request, {
        id: 'other-extension',
        frameId: 0,
        url: 'https://example.com/account',
        tab: { id: 7 },
      }),
    ).toBeUndefined();

    removedListener?.({ origins: ['https://example.com/*'] });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledOnce());
    expect(sendMessage.mock.calls[0]?.[1]).toMatchObject({
      type: 'profile.clear',
      expectedOrigin: 'https://example.com',
    });
  });
});
