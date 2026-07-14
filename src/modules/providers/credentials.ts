import { z } from 'zod';

const CredentialStateSchema = z.strictObject({
  schemaVersion: z.literal(1),
  credentials: z.record(z.string(), z.string().min(1).max(8_192)),
});

type CredentialState = z.infer<typeof CredentialStateSchema>;

interface LocalStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const STORAGE_KEY = 'providerCredentials';

const emptyState = (): CredentialState => ({
  schemaVersion: 1,
  credentials: {},
});

const identifier = async (value: string) => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .slice(0, 6)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
};

export class CredentialVault {
  readonly #storage: LocalStorageArea;

  constructor(storage: LocalStorageArea) {
    this.#storage = storage;
  }

  async set(providerId: string, credential: string) {
    if (!/^[a-z0-9-]{1,40}$/.test(providerId)) {
      throw new Error('Invalid provider identifier');
    }
    const state = await this.#read();
    state.credentials[providerId] = z
      .string()
      .min(1)
      .max(8_192)
      .parse(credential);
    await this.#write(state);
  }

  async forget(providerId: string) {
    const state = await this.#read();
    if (state.credentials[providerId] === undefined) {
      return false;
    }
    state.credentials = Object.fromEntries(
      Object.entries(state.credentials).filter(
        ([storedId]) => storedId !== providerId,
      ),
    );
    await this.#write(state);
    return true;
  }

  async status(providerId: string) {
    const credential = (await this.#read()).credentials[providerId];
    return credential === undefined
      ? { present: false as const, identifier: null }
      : { present: true as const, identifier: await identifier(credential) };
  }

  async readForProviderCall(providerId: string) {
    const credential = (await this.#read()).credentials[providerId];
    if (credential === undefined) {
      throw new ProviderCredentialError('credential_missing');
    }
    return credential;
  }

  async clear() {
    await this.#write(emptyState());
  }

  async #read() {
    const stored = await this.#storage.get(STORAGE_KEY);
    return stored[STORAGE_KEY] === undefined
      ? emptyState()
      : CredentialStateSchema.parse(stored[STORAGE_KEY]);
  }

  async #write(state: CredentialState) {
    await this.#storage.set({
      [STORAGE_KEY]: CredentialStateSchema.parse(state),
    });
  }
}

export class ProviderCredentialError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ProviderCredentialError';
    this.code = code;
  }
}
