import { ProviderRequestError } from './openai';

export interface ProviderRetryNotice {
  attempt: number;
  code: string;
}

export interface ProviderLifecycleOptions {
  maximumAttempts?: number;
  signal?: AbortSignal;
  onRetry?: (notice: ProviderRetryNotice) => void;
}

const retryable = new Set([
  'provider_transport_failure',
  'provider_http_429',
  'provider_http_500',
  'provider_http_502',
  'provider_http_503',
  'provider_http_504',
]);

export const withProviderLifecycle = async <Result>(
  operation: (attempt: number) => Promise<Result>,
  options: ProviderLifecycleOptions = {},
) => {
  const maximumAttempts = Math.max(
    1,
    Math.min(options.maximumAttempts ?? 1, 3),
  );
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    if (options.signal?.aborted) {
      throw new ProviderRequestError('provider_cancelled');
    }
    try {
      return await operation(attempt);
    } catch (error) {
      if (
        !(error instanceof ProviderRequestError) ||
        !retryable.has(error.code) ||
        attempt === maximumAttempts
      ) {
        throw error;
      }
      options.onRetry?.({ attempt, code: error.code });
    }
  }
  throw new ProviderRequestError('provider_retry_exhausted');
};
