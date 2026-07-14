import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicProvider } from './anthropic';
import { CompatibleProvider } from './compatible';
import { CredentialVault } from './credentials';
import { GeminiProvider } from './gemini';

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
  assistantMessage: 'I can improve the page.',
  clarification: null,
  operations: [
    {
      kind: 'style',
      operationId: 'style-main',
      target: { kind: 'ephemeral', elementId: 'element-main' },
      declarations: [{ property: 'color', value: 'red' }],
    },
  ],
};

describe('provider parity adapters', () => {
  let vault: CredentialVault;

  beforeEach(async () => {
    vault = new CredentialVault(new MemoryStorage());
    await vault.set('anthropic', 'anthropic-key');
    await vault.set('gemini', 'gemini-key');
    await vault.set('compatible', 'compatible-key');
  });

  it('normalizes Anthropic tool output and required browser headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'claude-test',
          content: [
            { type: 'tool_use', name: 'submit_proposal', input: proposal },
          ],
          usage: { input_tokens: 40, output_tokens: 20 },
        }),
        { status: 200 },
      ),
    );
    const result = await new AnthropicProvider(vault, fetchMock).propose({
      model: 'claude-test',
      userMessage: 'Improve contrast',
      pageContext,
    });

    expect(result).toMatchObject({
      proposal,
      model: 'claude-test',
      usage: { inputTokens: 40, outputTokens: 20 },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers).toMatchObject({
      'x-api-key': 'anthropic-key',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    });
    expect(JSON.parse(init.body as string)).toMatchObject({
      tool_choice: { type: 'tool', name: 'submit_proposal' },
    });
  });

  it('normalizes Gemini structured JSON and usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(proposal) }] } },
          ],
          usageMetadata: { promptTokenCount: 50, candidatesTokenCount: 25 },
        }),
        { status: 200 },
      ),
    );
    const result = await new GeminiProvider(vault, fetchMock).propose({
      model: 'gemini-test',
      userMessage: 'Improve contrast',
      pageContext,
    });

    expect(result).toMatchObject({
      proposal,
      model: 'gemini-test',
      usage: { inputTokens: 50, outputTokens: 25 },
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent',
    );
    expect(init.headers).toMatchObject({ 'x-goog-api-key': 'gemini-key' });
    expect(JSON.parse(init.body as string)).toMatchObject({
      generationConfig: { responseMimeType: 'application/json' },
    });
  });

  it('fails closed on missing Anthropic tools and Gemini safety blocks', async () => {
    await expect(
      new AnthropicProvider(
        vault,
        vi
          .fn()
          .mockResolvedValue(
            new Response(JSON.stringify({ content: [] }), { status: 200 }),
          ),
      ).propose({
        model: 'claude-test',
        userMessage: 'Request',
        pageContext,
      }),
    ).rejects.toMatchObject({ code: 'provider_output_missing' });

    await expect(
      new GeminiProvider(
        vault,
        vi
          .fn()
          .mockResolvedValue(
            new Response(
              JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }),
              { status: 200 },
            ),
          ),
      ).propose({
        model: 'gemini-test',
        userMessage: 'Request',
        pageContext,
      }),
    ).rejects.toMatchObject({ code: 'provider_safety_block' });
  });

  it('redacts transport, HTTP, malformed, and invalid proposal failures', async () => {
    const anthropic = new AnthropicProvider(
      vault,
      vi.fn().mockResolvedValue(new Response(null, { status: 401 })),
    );
    await expect(
      anthropic.propose({
        model: 'claude-test',
        userMessage: 'Request',
        pageContext,
      }),
    ).rejects.toMatchObject({
      code: 'provider_http_401',
      message: 'provider_http_401',
    });

    const gemini = new GeminiProvider(
      vault,
      vi.fn().mockResolvedValue(new Response('private malformed body')),
    );
    await expect(
      gemini.propose({
        model: 'gemini-test',
        userMessage: 'Request',
        pageContext,
      }),
    ).rejects.toMatchObject({
      code: 'provider_response_invalid',
      message: 'provider_response_invalid',
    });
  });

  it('uses only explicit compatible endpoint capabilities', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          model: 'compatible-model',
          output: [
            {
              content: [
                { type: 'output_text', text: JSON.stringify(proposal) },
              ],
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new CompatibleProvider(
      vault,
      {
        endpoint: 'https://models.example/v1/responses',
        model: 'compatible-model',
        authentication: 'x-api-key',
        structuredOutput: 'openai-responses-json-schema',
        storeFalse: true,
      },
      fetchMock,
    );

    expect(
      await provider.propose({
        userMessage: 'Improve contrast',
        pageContext,
      }),
    ).toMatchObject({ proposal, model: 'compatible-model' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://models.example/v1/responses');
    expect(init.headers).toMatchObject({ 'x-api-key': 'compatible-key' });
    expect(init.redirect).toBe('error');
    expect(JSON.parse(init.body as string)).toMatchObject({ store: false });
  });

  it('rejects unsafe or implicit compatible endpoint configuration', () => {
    for (const endpoint of [
      'http://models.example/v1/responses',
      'https://user:pass@models.example/v1/responses',
      'https://models.example/v1/responses?mode=unsafe',
      'https://models.example/v1/responses#fragment',
    ]) {
      expect(
        () =>
          new CompatibleProvider(vault, {
            endpoint,
            model: 'model',
            authentication: 'bearer',
            structuredOutput: 'openai-responses-json-schema',
            storeFalse: true,
          }),
      ).toThrow();
    }
  });

  it('normalizes Anthropic transport, cancellation, size, and proposal failures', async () => {
    const requests = [
      {
        fetch: vi
          .fn()
          .mockRejectedValue(new DOMException('private', 'AbortError')),
        code: 'provider_cancelled',
      },
      {
        fetch: vi.fn().mockRejectedValue(new Error('private transport body')),
        code: 'provider_transport_failure',
      },
      {
        fetch: vi
          .fn()
          .mockResolvedValue(new Response('not json', { status: 200 })),
        code: 'provider_response_invalid',
      },
      {
        fetch: vi
          .fn()
          .mockResolvedValue(
            new Response('x'.repeat(1024 * 1024 + 1), { status: 200 }),
          ),
        code: 'provider_response_too_large',
      },
      {
        fetch: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              content: [
                {
                  type: 'tool_use',
                  name: 'submit_proposal',
                  input: { ...proposal, javascript: 'alert(1)' },
                },
              ],
            }),
          ),
        ),
        code: 'provider_proposal_invalid',
      },
    ];
    for (const request of requests) {
      await expect(
        new AnthropicProvider(vault, request.fetch).propose({
          model: 'claude-test',
          userMessage: 'Request',
          pageContext,
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({ code: request.code, message: request.code });
    }

    const fallback = await new AnthropicProvider(
      vault,
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            content: [
              { type: 'tool_use', name: 'submit_proposal', input: proposal },
            ],
          }),
        ),
      ),
    ).propose({
      model: 'claude-fallback',
      userMessage: 'Request',
      pageContext,
    });
    expect(fallback).toMatchObject({
      model: 'claude-fallback',
      usage: { inputTokens: 0, outputTokens: 0 },
    });
  });

  it('normalizes Gemini transport, output, size, and model failures', async () => {
    await expect(
      new GeminiProvider(vault, vi.fn()).propose({
        model: '../invalid model',
        userMessage: 'Request',
        pageContext,
      }),
    ).rejects.toMatchObject({ code: 'provider_model_invalid' });

    const cases = [
      {
        fetch: vi
          .fn()
          .mockRejectedValue(new DOMException('private', 'AbortError')),
        code: 'provider_cancelled',
      },
      {
        fetch: vi.fn().mockRejectedValue(new Error('private')),
        code: 'provider_transport_failure',
      },
      {
        fetch: vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
        code: 'provider_http_503',
      },
      {
        fetch: vi
          .fn()
          .mockResolvedValue(new Response('x'.repeat(1024 * 1024 + 1))),
        code: 'provider_response_too_large',
      },
      {
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({}))),
        code: 'provider_output_missing',
      },
      {
        fetch: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              candidates: [
                {
                  content: {
                    parts: [
                      {
                        text: JSON.stringify({
                          ...proposal,
                          javascript: 'alert(1)',
                        }),
                      },
                    ],
                  },
                },
              ],
            }),
          ),
        ),
        code: 'provider_proposal_invalid',
      },
    ];
    for (const testCase of cases) {
      await expect(
        new GeminiProvider(vault, testCase.fetch).propose({
          model: 'gemini-test',
          userMessage: 'Request',
          pageContext,
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({
        code: testCase.code,
        message: testCase.code,
      });
    }
  });

  it('normalizes compatible transport, HTTP, output, size, and proposal failures', async () => {
    const config = {
      endpoint: 'https://models.example/v1/responses',
      model: 'compatible-model',
      authentication: 'bearer' as const,
      structuredOutput: 'openai-responses-json-schema' as const,
      storeFalse: true as const,
    };
    const cases = [
      {
        fetch: vi.fn().mockRejectedValue(new Error('private')),
        code: 'provider_transport_failure',
      },
      {
        fetch: vi.fn().mockResolvedValue(new Response(null, { status: 500 })),
        code: 'provider_http_500',
      },
      {
        fetch: vi.fn().mockResolvedValue(new Response('not json')),
        code: 'provider_response_invalid',
      },
      {
        fetch: vi
          .fn()
          .mockResolvedValue(new Response('x'.repeat(1024 * 1024 + 1))),
        code: 'provider_response_too_large',
      },
      {
        fetch: vi.fn().mockResolvedValue(new Response(JSON.stringify({}))),
        code: 'provider_output_missing',
      },
      {
        fetch: vi.fn().mockResolvedValue(
          new Response(
            JSON.stringify({
              output: [
                {
                  content: [
                    {
                      type: 'output_text',
                      text: JSON.stringify({ ...proposal, html: '<script>' }),
                    },
                  ],
                },
              ],
            }),
          ),
        ),
        code: 'provider_proposal_invalid',
      },
    ];
    for (const testCase of cases) {
      await expect(
        new CompatibleProvider(vault, config, testCase.fetch).propose({
          userMessage: 'Request',
          pageContext,
          signal: new AbortController().signal,
        }),
      ).rejects.toMatchObject({
        code: testCase.code,
        message: testCase.code,
      });
    }
  });
});
