import { describe, expect, it, vi } from 'vitest';
import { withProviderLifecycle } from './lifecycle';
import { ProviderRequestError } from './openai';

describe('withProviderLifecycle', () => {
  it('retries bounded transient failures with visible notices', async () => {
    const notices = vi.fn();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new ProviderRequestError('provider_http_429'))
      .mockResolvedValue('success');

    expect(
      await withProviderLifecycle(operation, {
        maximumAttempts: 2,
        onRetry: notices,
      }),
    ).toBe('success');
    expect(operation).toHaveBeenCalledTimes(2);
    expect(notices).toHaveBeenCalledWith({
      attempt: 1,
      code: 'provider_http_429',
    });
  });

  it('does not retry refusals, malformed output, cancellation, or unknown errors', async () => {
    for (const error of [
      new ProviderRequestError('provider_refusal'),
      new ProviderRequestError('provider_response_invalid'),
      new ProviderRequestError('provider_cancelled'),
      new Error('private failure'),
    ]) {
      const operation = vi.fn().mockRejectedValue(error);
      await expect(
        withProviderLifecycle(operation, { maximumAttempts: 3 }),
      ).rejects.toBe(error);
      expect(operation).toHaveBeenCalledOnce();
    }
  });

  it('stops at the bounded maximum and honors pre-cancellation', async () => {
    const operation = vi
      .fn()
      .mockRejectedValue(new ProviderRequestError('provider_http_503'));
    await expect(
      withProviderLifecycle(operation, { maximumAttempts: 10 }),
    ).rejects.toMatchObject({ code: 'provider_http_503' });
    expect(operation).toHaveBeenCalledTimes(3);

    const controller = new AbortController();
    controller.abort();
    await expect(
      withProviderLifecycle(vi.fn(), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'provider_cancelled' });
  });
});
