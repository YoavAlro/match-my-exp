import { z } from 'zod';
import { CompatibleProviderConfigSchema } from './compatible';
import { CredentialVault } from './credentials';

const OfficialConfigSchema = z.strictObject({
  provider: z.enum(['openai', 'anthropic', 'gemini']),
  model: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z0-9._:-]+$/),
});

const CompatibleConfigSchema = z.strictObject({
  provider: z.literal('compatible'),
  config: CompatibleProviderConfigSchema,
});

export const ProviderConfigurationSchema = z.discriminatedUnion('provider', [
  OfficialConfigSchema,
  CompatibleConfigSchema,
]);

export type ProviderConfiguration = z.infer<typeof ProviderConfigurationSchema>;

interface LocalStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const SETTINGS_KEY = 'providerSettings';

export class ProviderSettingsService {
  readonly #storage: LocalStorageArea;
  readonly #vault: CredentialVault;

  constructor(storage: LocalStorageArea, vault: CredentialVault) {
    this.#storage = storage;
    this.#vault = vault;
  }

  async configure(
    input: unknown,
    confirmCompatibleRisk: (origin: string) => Promise<boolean> = async () =>
      false,
  ) {
    const configuration = ProviderConfigurationSchema.parse(input);
    const current = await this.#read();
    if (configuration.provider === 'compatible') {
      const origin = new URL(configuration.config.endpoint).origin;
      const currentOrigin =
        current?.provider === 'compatible'
          ? new URL(current.config.endpoint).origin
          : null;
      if (origin !== currentOrigin && !(await confirmCompatibleRisk(origin))) {
        throw new ProviderSettingsError('compatible_origin_not_confirmed');
      }
      if (currentOrigin !== null && currentOrigin !== origin) {
        await this.#vault.forget('compatible');
      }
    }
    await this.#storage.set({ [SETTINGS_KEY]: configuration });
    return structuredClone(configuration);
  }

  async setCredential(
    providerId: ProviderConfiguration['provider'],
    credential: string,
    validate: (credential: string) => Promise<boolean>,
  ) {
    if (!(await validate(credential))) {
      throw new ProviderSettingsError('credential_validation_failed');
    }
    await this.#vault.set(providerId, credential);
    return this.#vault.status(providerId);
  }

  async status() {
    const configuration = await this.#read();
    if (configuration === null) {
      return { configuration: null, credential: null };
    }
    return {
      configuration: structuredClone(configuration),
      credential: await this.#vault.status(configuration.provider),
    };
  }

  forgetCredential(providerId: ProviderConfiguration['provider']) {
    return this.#vault.forget(providerId);
  }

  async clearAll() {
    await Promise.all([
      this.#storage.set({ [SETTINGS_KEY]: null }),
      this.#vault.clear(),
    ]);
  }

  async #read() {
    const stored = await this.#storage.get(SETTINGS_KEY);
    const value = stored[SETTINGS_KEY];
    return value === undefined || value === null
      ? null
      : ProviderConfigurationSchema.parse(value);
  }
}

export class ProviderSettingsError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ProviderSettingsError';
    this.code = code;
  }
}
