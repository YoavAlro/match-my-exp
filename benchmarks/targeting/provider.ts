import {
  TargetingDecisionSchema,
  TargetingDecisionJsonSchema,
  type TargetingDecision,
} from './schemas';
import { targetingSystemPrompt, type TargetingTurn } from './prompt';

interface ResponseContent {
  type?: string;
  text?: string;
}

interface ResponseOutput {
  type?: string;
  content?: ResponseContent[];
}

interface ResponsesApiBody {
  id?: string;
  model?: string;
  system_fingerprint?: string | null;
  output_text?: string;
  output?: ResponseOutput[];
}

export interface ProviderDecision {
  decision: TargetingDecision;
  responseId: string;
  responseModel: string;
  systemFingerprint: string | null;
}

export interface TargetingProvider {
  decide(turns: readonly TargetingTurn[]): Promise<ProviderDecision>;
}

export class BenchmarkProviderError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'BenchmarkProviderError';
    this.code = code;
  }
}

const readOutputText = (body: ResponsesApiBody) => {
  if (typeof body.output_text === 'string') {
    return body.output_text;
  }
  for (const output of body.output ?? []) {
    for (const content of output.content ?? []) {
      if (content.type === 'output_text' && typeof content.text === 'string') {
        return content.text;
      }
    }
  }
  throw new BenchmarkProviderError('missing_provider_output');
};

export class AzureTargetingProvider implements TargetingProvider {
  readonly model: string;
  readonly #apiKey: string;
  readonly #responsesUrl: string;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    const apiKey = environment.AZURE_API_KEY;
    const responsesUrl = environment.AZURE_OPENAI_RESPONSES_URL;
    if (apiKey === undefined || apiKey.length === 0) {
      throw new BenchmarkProviderError('missing_provider_api_key');
    }
    if (responsesUrl === undefined) {
      throw new BenchmarkProviderError('missing_provider_url');
    }
    const url = new URL(responsesUrl);
    const trustedHost =
      url.hostname.endsWith('.cognitiveservices.azure.com') ||
      url.hostname.endsWith('.openai.azure.com');
    if (
      url.protocol !== 'https:' ||
      !trustedHost ||
      !url.pathname.endsWith('/openai/v1/responses')
    ) {
      throw new BenchmarkProviderError('invalid_provider_url');
    }
    this.model = environment.AZURE_OPENAI_MODEL ?? 'gpt-5.6-luna';
    this.#apiKey = apiKey;
    this.#responsesUrl = responsesUrl;
  }

  async decide(turns: readonly TargetingTurn[]): Promise<ProviderDecision> {
    let response: Response;
    try {
      response = await fetch(this.#responsesUrl, {
        method: 'POST',
        headers: {
          'api-key': this.#apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          store: false,
          max_output_tokens: 1_024,
          reasoning: { effort: 'low' },
          input: [{ role: 'system', content: targetingSystemPrompt }, ...turns],
          text: {
            format: {
              type: 'json_schema',
              name: 'target_selection',
              strict: true,
              schema: TargetingDecisionJsonSchema,
            },
          },
        }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch {
      throw new BenchmarkProviderError('provider_transport_failure');
    }
    if (!response.ok) {
      throw new BenchmarkProviderError(`provider_http_${response.status}`);
    }
    const body = (await response.json()) as ResponsesApiBody;
    if (
      typeof body.id !== 'string' ||
      body.id.length === 0 ||
      typeof body.model !== 'string' ||
      body.model.length === 0
    ) {
      throw new BenchmarkProviderError('missing_provider_provenance');
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(readOutputText(body));
    } catch (error) {
      if (error instanceof BenchmarkProviderError) {
        throw error;
      }
      throw new BenchmarkProviderError('invalid_provider_json');
    }
    const decision = TargetingDecisionSchema.safeParse(parsed);
    if (!decision.success) {
      throw new BenchmarkProviderError('invalid_provider_decision');
    }
    return {
      decision: decision.data,
      responseId: body.id,
      responseModel: body.model,
      systemFingerprint: body.system_fingerprint ?? null,
    };
  }
}
