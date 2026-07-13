import { afterEach, describe, expect, it, vi } from 'vitest';
import { AzureTargetingProvider, BenchmarkProviderError } from './provider';

const environment = {
  AZURE_API_KEY: 'test-key',
  AZURE_OPENAI_RESPONSES_URL:
    'https://resource.cognitiveservices.azure.com/openai/v1/responses',
  AZURE_OPENAI_MODEL: 'deployment-test',
};

const turns = [{ role: 'user' as const, content: '{"request":"test"}' }];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('AzureTargetingProvider', () => {
  it('returns validated decisions with response provenance', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          id: 'response-1',
          model: 'gpt-version-test',
          system_fingerprint: 'fingerprint-test',
          output_text: JSON.stringify({
            schemaVersion: 1,
            decision: 'select',
            selectedElementIds: ['element-test-1'],
            clarificationQuestion: null,
          }),
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await new AzureTargetingProvider(environment).decide(turns);

    expect(result).toMatchObject({
      responseId: 'response-1',
      responseModel: 'gpt-version-test',
      systemFingerprint: 'fingerprint-test',
      decision: { decision: 'select' },
    });
    const request = JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string);
    expect(request).toMatchObject({
      model: 'deployment-test',
      store: false,
      text: { format: { type: 'json_schema', strict: true } },
    });
  });

  it('redacts malformed provider output behind a fixed error code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: 'response-1',
            model: 'gpt-version-test',
            output_text: 'sensitive-provider-output',
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      new AzureTargetingProvider(environment).decide(turns),
    ).rejects.toEqual(
      expect.objectContaining({
        code: 'invalid_provider_json',
        message: 'invalid_provider_json',
      }),
    );
  });

  it('rejects non-Azure endpoints and redacts HTTP failures', async () => {
    expect(
      () =>
        new AzureTargetingProvider({
          ...environment,
          AZURE_OPENAI_RESPONSES_URL: 'https://example.com/openai/v1/responses',
        }),
    ).toThrowError(BenchmarkProviderError);

    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 429 })),
    );
    await expect(
      new AzureTargetingProvider(environment).decide(turns),
    ).rejects.toMatchObject({ code: 'provider_http_429' });
  });
});
