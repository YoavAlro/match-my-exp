import { describe, expect, it, vi } from 'vitest';
import { CredentialVault } from './credentials';
import { ProviderSettingsError, ProviderSettingsService } from './settings';

class MemoryStorage {
  value: Record<string, unknown> = {};

  async get() {
    return structuredClone(this.value);
  }

  async set(items: Record<string, unknown>) {
    this.value = { ...this.value, ...structuredClone(items) };
  }
}

describe('ProviderSettingsService', () => {
  it('stores official configuration and exposes only credential status', async () => {
    const storage = new MemoryStorage();
    const vault = new CredentialVault(storage);
    const service = new ProviderSettingsService(storage, vault);
    await service.configure({ provider: 'openai', model: 'gpt-test' });
    await service.setCredential('openai', 'sk-private', async () => true);

    const status = await service.status();

    expect(status).toMatchObject({
      configuration: { provider: 'openai', model: 'gpt-test' },
      credential: { present: true },
    });
    expect(JSON.stringify(status)).not.toContain('sk-private');
    expect(await service.forgetCredential('openai')).toBe(true);
    expect((await service.status()).credential).toEqual({
      present: false,
      identifier: null,
    });
  });

  it('validates credentials before replacing stored values', async () => {
    const storage = new MemoryStorage();
    const vault = new CredentialVault(storage);
    const service = new ProviderSettingsService(storage, vault);
    await service.configure({ provider: 'anthropic', model: 'claude-test' });
    await vault.set('anthropic', 'old-key');

    await expect(
      service.setCredential('anthropic', 'bad-key', async () => false),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ProviderSettingsError>>({
        code: 'credential_validation_failed',
      }),
    );
    expect(await vault.readForProviderCall('anthropic')).toBe('old-key');
  });

  it('requires compatible-origin confirmation and clears rebound credentials', async () => {
    const storage = new MemoryStorage();
    const vault = new CredentialVault(storage);
    const service = new ProviderSettingsService(storage, vault);
    const config = (endpoint: string) => ({
      provider: 'compatible',
      config: {
        endpoint,
        model: 'model',
        authentication: 'bearer',
        structuredOutput: 'openai-responses-json-schema',
        storeFalse: true,
      },
    });

    await expect(
      service.configure(config('https://one.example/v1/responses')),
    ).rejects.toMatchObject({ code: 'compatible_origin_not_confirmed' });
    const confirm = vi.fn().mockResolvedValue(true);
    await service.configure(
      config('https://one.example/v1/responses'),
      confirm,
    );
    await vault.set('compatible', 'bound-key');
    await service.configure(
      config('https://two.example/v1/responses'),
      confirm,
    );

    expect(confirm).toHaveBeenCalledWith('https://two.example');
    expect(await vault.status('compatible')).toMatchObject({ present: false });
  });

  it('clears configuration and every credential', async () => {
    const storage = new MemoryStorage();
    const vault = new CredentialVault(storage);
    const service = new ProviderSettingsService(storage, vault);
    await service.configure({ provider: 'gemini', model: 'gemini-test' });
    await vault.set('gemini', 'key');
    await vault.set('openai', 'other-key');

    await service.clearAll();

    expect(await service.status()).toEqual({
      configuration: null,
      credential: null,
    });
    expect(await vault.status('gemini')).toMatchObject({ present: false });
    expect(await vault.status('openai')).toMatchObject({ present: false });
  });
});
