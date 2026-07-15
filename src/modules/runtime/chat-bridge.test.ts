import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActiveTabCoordinator } from './coordination';
import { installPanelChatBridge } from './chat-bridge';

const requestId = '00000000-0000-4000-8000-000000000001';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('installPanelChatBridge', () => {
  it('inspects, calls the configured provider, previews, and discards', async () => {
    let listener:
      | ((message: unknown, sender: object) => Promise<unknown> | undefined)
      | undefined;
    const storageState: Record<string, unknown> = {
      providerSettings: {
        provider: 'compatible',
        config: {
          endpoint: 'https://models.example/v1/responses',
          model: 'model',
          authentication: 'bearer',
          structuredOutput: 'openai-responses-json-schema',
          storeFalse: true,
        },
      },
      providerCredentials: {
        schemaVersion: 1,
        credentials: { compatible: 'test-key' },
      },
      siteProviderConsents: [
        {
          schemaVersion: 1,
          pageOrigin: 'https://example.com',
          provider: {
            id: 'compatible',
            origin: 'https://models.example',
          },
          grantedAt: '2026-07-15T13:00:00Z',
        },
      ],
    };
    const sendMessage = vi.fn().mockImplementation((_tabId, message) => {
      if (message.type === 'page.inspect.request') {
        return {
          schemaVersion: 1,
          type: 'page.inspect.response',
          requestId: message.requestId,
          context: {
            schemaVersion: 1,
            origin: 'https://example.com',
            path: '/account',
            title: 'Account',
            elements: [],
          },
        };
      }
      if (message.type === 'profile.compile.request') {
        return {
          schemaVersion: 1,
          type: 'profile.compile.response',
          requestId: message.requestId,
          previewId: message.previewId,
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
        };
      }
      if (message.type === 'profile.apply') {
        return {
          schemaVersion: 1,
          type: 'profile.apply.response',
          requestId: message.requestId,
          profileId: message.profileId,
          revision: message.revision,
        };
      }
      if (message.type === 'proposal.preview') {
        return { status: 'previewed' };
      }
      return { status: 'ok' };
    });
    const api = {
      runtime: {
        onMessage: {
          addListener: (value: typeof listener) => {
            listener = value;
          },
        },
      },
      permissions: {
        contains: vi.fn().mockResolvedValue(true),
        request: vi.fn(),
        remove: vi.fn(),
      },
      scripting: { executeScript: vi.fn().mockResolvedValue([]) },
      storage: {
        local: {
          get: vi
            .fn()
            .mockImplementation(async () => structuredClone(storageState)),
          set: vi.fn().mockImplementation(async (items) => {
            Object.assign(storageState, structuredClone(items));
          }),
        },
      },
      tabs: { sendMessage },
    };
    const responseBody = JSON.stringify({
      model: 'model',
      output: [
        {
          content: [
            {
              type: 'output_text',
              text: JSON.stringify({
                schemaVersion: 1,
                assistantMessage: 'Preview ready',
                clarification: null,
                operations: [
                  {
                    kind: 'style',
                    operationId: 'style-main',
                    target: {
                      kind: 'ephemeral',
                      elementId: 'element-main',
                    },
                    declarations: [{ property: 'color', value: 'red' }],
                  },
                ],
              }),
            },
          ],
        },
      ],
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(async () => new Response(responseBody)),
    );
    const coordinator = new ActiveTabCoordinator(
      'extension-id',
      'chrome-extension://extension-id/',
    );
    coordinator.update({ id: 7, url: 'https://example.com/account' });
    installPanelChatBridge(
      api as unknown as Parameters<typeof installPanelChatBridge>[0],
      coordinator,
    );
    const sender = {
      id: 'extension-id',
      url: 'chrome-extension://extension-id/sidepanel.html',
    };

    const response = await listener?.(
      {
        schemaVersion: 1,
        type: 'panel.chat.submit',
        requestId,
        message: 'Increase contrast',
      },
      sender,
    );

    expect(response).toMatchObject({
      status: 'preview',
      assistantMessage: 'Preview ready',
      previewId: expect.any(String),
    });
    expect(api.scripting.executeScript).toHaveBeenCalledOnce();
    expect(sendMessage.mock.calls.map((call) => call[1].type)).toEqual([
      'page.inspect.request',
      'proposal.preview',
    ]);
    const firstPreviewId = (response as { previewId: string }).previewId;
    expect(
      await listener?.(
        {
          schemaVersion: 1,
          type: 'panel.preview.keep',
          requestId: '00000000-0000-4000-8000-000000000002',
          previewId: firstPreviewId,
          intent: 'Increase contrast',
        },
        sender,
      ),
    ).toMatchObject({ status: 'kept' });
    const storedProfiles = storageState.profileRepository as {
      schemaVersion: number;
      profiles: Record<string, unknown>;
    };
    expect(storedProfiles.schemaVersion).toBe(1);
    expect(Object.values(storedProfiles.profiles)).toEqual([
      expect.objectContaining({ pathPattern: '/account', revision: 1 }),
    ]);

    const second = await listener?.(
      {
        schemaVersion: 1,
        type: 'panel.chat.submit',
        requestId: '00000000-0000-4000-8000-000000000003',
        message: 'Increase contrast again',
      },
      sender,
    );
    const secondPreviewId = (second as { previewId: string }).previewId;
    const third = await listener?.(
      {
        schemaVersion: 1,
        type: 'panel.chat.submit',
        requestId: '00000000-0000-4000-8000-000000000004',
        message: 'Increase contrast once more',
      },
      sender,
    );
    const previewId = (third as { previewId: string }).previewId;
    expect(secondPreviewId).not.toBe(previewId);
    expect(api.scripting.executeScript).toHaveBeenCalledOnce();
    expect(
      sendMessage.mock.calls.some(
        (call) =>
          call[1].type === 'preview.rollback' &&
          call[1].previewId === secondPreviewId,
      ),
    ).toBe(true);
    expect(
      await listener?.(
        {
          schemaVersion: 1,
          type: 'panel.preview.discard',
          requestId: '00000000-0000-4000-8000-000000000005',
          previewId,
        },
        sender,
      ),
    ).toMatchObject({ status: 'discarded' });
    expect(sendMessage.mock.calls.at(-1)?.[1].type).toBe('preview.rollback');
    sendMessage.mockResolvedValueOnce(undefined);
    await expect(
      listener?.(
        {
          schemaVersion: 1,
          type: 'panel.preview.keep',
          requestId: '00000000-0000-4000-8000-000000000006',
          previewId,
          intent: 'Increase contrast',
        },
        sender,
      ),
    ).rejects.toThrow();
  });

  it('ignores untrusted and unrelated panel messages', () => {
    let listener:
      | ((message: unknown, sender: object) => Promise<unknown> | undefined)
      | undefined;
    const api = {
      runtime: {
        onMessage: {
          addListener: (value: typeof listener) => {
            listener = value;
          },
        },
      },
      permissions: {
        contains: vi.fn(),
        request: vi.fn(),
        remove: vi.fn(),
      },
      scripting: { executeScript: vi.fn() },
      storage: { local: { get: vi.fn(), set: vi.fn() } },
      tabs: { sendMessage: vi.fn() },
    };
    const coordinator = new ActiveTabCoordinator(
      'extension-id',
      'chrome-extension://extension-id/',
    );
    installPanelChatBridge(
      api as unknown as Parameters<typeof installPanelChatBridge>[0],
      coordinator,
    );

    expect(listener?.({ type: 'other' }, {})).toBeUndefined();
    expect(
      listener?.(
        {
          schemaVersion: 1,
          type: 'panel.chat.submit',
          requestId,
          message: 'Request',
        },
        {
          id: 'other-extension',
          url: 'chrome-extension://other/sidepanel.html',
        },
      ),
    ).toBeUndefined();
  });

  it('rejects a provider result after the active page changes', async () => {
    let listener:
      | ((message: unknown, sender: object) => Promise<unknown> | undefined)
      | undefined;
    let releaseFetch: ((response: Response) => void) | undefined;
    const pendingFetch = new Promise<Response>((resolve) => {
      releaseFetch = resolve;
    });
    const fetchMock = vi.fn().mockReturnValue(pendingFetch);
    vi.stubGlobal('fetch', fetchMock);
    const sendMessage = vi.fn().mockImplementation((_tabId, message) => {
      if (message.type === 'page.inspect.request') {
        return {
          schemaVersion: 1,
          type: 'page.inspect.response',
          requestId: message.requestId,
          context: {
            schemaVersion: 1,
            origin: 'https://example.com',
            path: '/account',
            title: 'Account',
            elements: [],
          },
        };
      }
      return { status: 'previewed' };
    });
    const storageState = {
      providerSettings: {
        provider: 'compatible',
        config: {
          endpoint: 'https://models.example/v1/responses',
          model: 'model',
          authentication: 'bearer',
          structuredOutput: 'openai-responses-json-schema',
          storeFalse: true,
        },
      },
      providerCredentials: {
        schemaVersion: 1,
        credentials: { compatible: 'test-key' },
      },
      siteProviderConsents: [
        {
          schemaVersion: 1,
          pageOrigin: 'https://example.com',
          provider: {
            id: 'compatible',
            origin: 'https://models.example',
          },
          grantedAt: '2026-07-15T13:00:00Z',
        },
      ],
    };
    const api = {
      runtime: {
        onMessage: {
          addListener: (value: typeof listener) => {
            listener = value;
          },
        },
      },
      permissions: {
        contains: vi.fn().mockResolvedValue(true),
        request: vi.fn(),
        remove: vi.fn(),
      },
      scripting: {
        executeScript: vi
          .fn()
          .mockResolvedValue([{ frameId: 0, documentId: 'document-a' }]),
      },
      storage: {
        local: {
          get: vi.fn().mockResolvedValue(storageState),
          set: vi.fn(),
        },
      },
      tabs: { query: vi.fn(), sendMessage },
    };
    const coordinator = new ActiveTabCoordinator(
      'extension-id',
      'chrome-extension://extension-id/',
    );
    coordinator.update({ id: 7, url: 'https://example.com/account' });
    installPanelChatBridge(
      api as unknown as Parameters<typeof installPanelChatBridge>[0],
      coordinator,
    );
    const request = listener?.(
      {
        schemaVersion: 1,
        type: 'panel.chat.submit',
        requestId,
        message: 'Increase contrast',
      },
      {
        id: 'extension-id',
        url: 'chrome-extension://extension-id/sidepanel.html',
      },
    );
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    coordinator.invalidate(7);
    releaseFetch?.(
      new Response(
        JSON.stringify({
          model: 'model',
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({
                    schemaVersion: 1,
                    assistantMessage: 'Preview ready',
                    clarification: null,
                    operations: [
                      {
                        kind: 'style',
                        operationId: 'style-main',
                        target: {
                          kind: 'ephemeral',
                          elementId: 'element-main',
                        },
                        declarations: [{ property: 'color', value: 'red' }],
                      },
                    ],
                  }),
                },
              ],
            },
          ],
        }),
      ),
    );

    await expect(request).rejects.toThrow('Active page changed during request');
    expect(
      sendMessage.mock.calls.some(
        (call) => call[1].type === 'proposal.preview',
      ),
    ).toBe(false);
  });
});
