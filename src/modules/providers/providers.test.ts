import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CredentialVault, ProviderCredentialError } from './credentials';
import { OpenAIProvider, ProviderRequestError } from './openai';

class MemoryStorage {
  value: Record<string, unknown> = {};

  async get() {
    return structuredClone(this.value);
  }

  async set(items: Record<string, unknown>) {
    this.value = { ...this.value, ...structuredClone(items) };
  }
}

const pageContext = {
  schemaVersion: 1 as const,
  origin: 'https://example.com',
  path: '/account',
  title: 'Account',
  elements: [],
};

const proposal = {
  schemaVersion: 1,
  assistantMessage: 'I can increase the contrast.',
  clarification: null,
  operations: [
    {
      kind: 'style',
      operationId: 'style-main',
      target: { kind: 'ephemeral', elementId: 'element-main' },
      declarations: [{ property: 'color', value: '#111111' }],
    },
  ],
};

const successResponse = (overrides: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      model: 'gpt-5-test',
      output: [
        {
          type: 'message',
          content: [{ type: 'output_text', text: JSON.stringify(proposal) }],
        },
      ],
      usage: { input_tokens: 120, output_tokens: 30 },
      ...overrides,
    }),
    { status: 200 },
  );

describe('CredentialVault', () => {
  it('stores credentials while exposing only presence and digest', async () => {
    const storage = new MemoryStorage();
    const vault = new CredentialVault(storage);

    expect(await vault.status('openai')).toEqual({
      present: false,
      identifier: null,
    });
    await vault.set('openai', 'sk-private-value');

    const status = await vault.status('openai');
    expect(status.present).toBe(true);
    expect(status.identifier).toMatch(/^[a-f0-9]{12}$/);
    expect(JSON.stringify(status)).not.toContain('sk-private-value');
    expect(await vault.readForProviderCall('openai')).toBe('sk-private-value');
    expect(await vault.forget('openai')).toBe(true);
    expect(await vault.forget('openai')).toBe(false);
    await expect(vault.readForProviderCall('openai')).rejects.toBeInstanceOf(
      ProviderCredentialError,
    );
  });

  it('clears all credentials and rejects malformed storage', async () => {
    const storage = new MemoryStorage();
    const vault = new CredentialVault(storage);
    await vault.set('openai', 'one');
    await vault.set('gemini', 'two');
    await vault.clear();
    expect(await vault.status('openai')).toMatchObject({ present: false });
    storage.value.providerCredentials = {
      schemaVersion: 1,
      credentials: { openai: 'key' },
      pageContext: 'private',
    };
    await expect(vault.status('openai')).rejects.toThrow();
  });
});

describe('OpenAIProvider', () => {
  let vault: CredentialVault;

  beforeEach(async () => {
    vault = new CredentialVault(new MemoryStorage());
    await vault.set('openai', 'sk-test-key');
  });

  it('uses fixed hardened transport and validates structured proposals', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successResponse());
    const provider = new OpenAIProvider(vault, fetchMock);

    const result = await provider.propose({
      model: 'gpt-5-test',
      userMessage: 'Increase contrast',
      pageContext,
    });

    expect(result).toMatchObject({
      proposal,
      model: 'gpt-5-test',
      usage: { inputTokens: 120, outputTokens: 30 },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/responses');
    expect(init).toMatchObject({
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
    expect(init.headers).toMatchObject({
      authorization: 'Bearer sk-test-key',
    });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: 'gpt-5-test',
      store: false,
      text: { format: { type: 'json_schema', strict: true } },
    });
  });

  it('uses request metadata fallbacks and an external cancellation signal', async () => {
    const response = successResponse({ model: null, usage: null });
    const fetchMock = vi.fn().mockResolvedValue(response);
    const provider = new OpenAIProvider(vault, fetchMock);
    const controller = new AbortController();

    const result = await provider.propose({
      model: 'gpt-fallback',
      userMessage: 'Request',
      pageContext,
      signal: controller.signal,
    });

    expect(result).toMatchObject({
      model: 'gpt-fallback',
      usage: { inputTokens: 0, outputTokens: 0 },
    });
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit).signal).toBeInstanceOf(
      AbortSignal,
    );
  });

  it('returns fixed errors for HTTP, malformed, refused, and hostile output', async () => {
    const cases = [
      {
        response: new Response(null, { status: 429 }),
        code: 'provider_http_429',
      },
      {
        response: new Response('not json', { status: 200 }),
        code: 'provider_response_invalid',
      },
      {
        response: successResponse({
          output: [{ content: [{ type: 'refusal', refusal: 'No' }] }],
        }),
        code: 'provider_refusal',
      },
      {
        response: successResponse({
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({ ...proposal, javascript: 'alert(1)' }),
                },
              ],
            },
          ],
        }),
        code: 'provider_proposal_invalid',
      },
      {
        response: successResponse({ output: [] }),
        code: 'provider_output_missing',
      },
    ];

    for (const testCase of cases) {
      const provider = new OpenAIProvider(
        vault,
        vi.fn().mockResolvedValue(testCase.response),
      );
      await expect(
        provider.propose({
          model: 'gpt-5-test',
          userMessage: 'Request',
          pageContext,
        }),
      ).rejects.toEqual(
        expect.objectContaining<Partial<ProviderRequestError>>({
          code: testCase.code,
          message: testCase.code,
        }),
      );
    }
  });

  it('redacts cancellation, transport, size, and model failures', async () => {
    const cancelled = new OpenAIProvider(
      vault,
      vi.fn().mockRejectedValue(new DOMException('private', 'AbortError')),
    );
    await expect(
      cancelled.propose({
        model: 'gpt-5-test',
        userMessage: 'Request',
        pageContext,
      }),
    ).rejects.toMatchObject({ code: 'provider_cancelled' });

    const transport = new OpenAIProvider(
      vault,
      vi.fn().mockRejectedValue(new Error('private network body')),
    );
    await expect(
      transport.propose({
        model: 'gpt-5-test',
        userMessage: 'Request',
        pageContext,
      }),
    ).rejects.toMatchObject({
      code: 'provider_transport_failure',
      message: 'provider_transport_failure',
    });

    const oversized = new OpenAIProvider(
      vault,
      vi
        .fn()
        .mockResolvedValue(
          new Response('x'.repeat(1024 * 1024 + 1), { status: 200 }),
        ),
    );
    await expect(
      oversized.propose({
        model: 'gpt-5-test',
        userMessage: 'Request',
        pageContext,
      }),
    ).rejects.toMatchObject({ code: 'provider_response_too_large' });

    await expect(
      new OpenAIProvider(vault, vi.fn()).propose({
        model: '../invalid model',
        userMessage: 'Request',
        pageContext,
      }),
    ).rejects.toMatchObject({ code: 'provider_model_invalid' });

    const largeContext = {
      ...pageContext,
      elements: Array.from({ length: 1_000 }, (_, index) => ({
        elementId: `element-${index}`,
        tag: 'p',
        text: 'x'.repeat(512),
        attributes: [],
        computedStyles: [],
        bounds: { x: 0, y: 0, width: 0, height: 0 },
      })),
    };
    await expect(
      new OpenAIProvider(vault, vi.fn()).propose({
        model: 'gpt-5-test',
        userMessage: 'Request',
        pageContext: largeContext,
      }),
    ).rejects.toMatchObject({ code: 'provider_request_too_large' });
  });
});
