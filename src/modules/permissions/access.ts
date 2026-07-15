import { z } from 'zod';
import { CanonicalOriginSchema } from '../contracts';

export const ProviderDestinationSchema = z.strictObject({
  id: z.enum(['openai', 'anthropic', 'gemini', 'compatible']),
  origin: CanonicalOriginSchema,
});

export type ProviderDestination = z.infer<typeof ProviderDestinationSchema>;

export const ConsentRecordSchema = z.strictObject({
  schemaVersion: z.literal(1),
  pageOrigin: CanonicalOriginSchema,
  provider: ProviderDestinationSchema,
  grantedAt: z.iso.datetime({ offset: true }),
});

const ConsentRecordsSchema = z.array(ConsentRecordSchema).max(1_000);

export type ConsentRecord = z.infer<typeof ConsentRecordSchema>;

export interface ConsentStorage {
  read(): Promise<readonly ConsentRecord[]>;
  write(records: readonly ConsentRecord[]): Promise<void>;
}

interface LocalStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const CONSENT_STORAGE_KEY = 'siteProviderConsents';

export class ChromeConsentStorage implements ConsentStorage {
  readonly #storage: LocalStorageArea;

  constructor(storage: LocalStorageArea) {
    this.#storage = storage;
  }

  async read() {
    const stored = await this.#storage.get(CONSENT_STORAGE_KEY);
    return ConsentRecordsSchema.parse(stored[CONSENT_STORAGE_KEY] ?? []);
  }

  async write(records: readonly ConsentRecord[]) {
    await this.#storage.set({
      [CONSENT_STORAGE_KEY]: ConsentRecordsSchema.parse(records),
    });
  }
}

export interface HostPermissionAdapter {
  contains(originPatterns: readonly string[]): Promise<boolean>;
  request(originPatterns: readonly string[]): Promise<boolean>;
  remove(originPatterns: readonly string[]): Promise<boolean>;
}

export interface DisclosureRequest {
  pageOrigin: string;
  provider: ProviderDestination;
  data: readonly [
    'visible page text',
    'semantic attributes',
    'layout and style samples',
    'page path',
  ];
}

export type AccessResult =
  | { status: 'ready'; pageOrigin: string }
  | { status: 'denied'; pageOrigin: string }
  | { status: 'unsupported' };

export class SiteAccessService {
  readonly #permissions: HostPermissionAdapter;
  readonly #consents: ConsentStorage;
  readonly #now: () => string;

  constructor(
    permissions: HostPermissionAdapter,
    consents: ConsentStorage,
    now: () => string = () => new Date().toISOString(),
  ) {
    this.#permissions = permissions;
    this.#consents = consents;
    this.#now = now;
  }

  async readiness(
    pageUrl: string,
    providerInput: unknown,
  ): Promise<AccessResult> {
    const parsed = parsePageOrigin(pageUrl);
    if (parsed === null) {
      return { status: 'unsupported' };
    }
    const provider = ProviderDestinationSchema.parse(providerInput);
    const origins = requiredOrigins(parsed, provider.origin);
    const [permission, records] = await Promise.all([
      this.#permissions.contains(origins),
      this.#consents.read(),
    ]);
    return permission && hasConsent(records, parsed, provider)
      ? { status: 'ready', pageOrigin: parsed }
      : { status: 'denied', pageOrigin: parsed };
  }

  async request(
    pageUrl: string,
    providerInput: unknown,
    confirm: (request: DisclosureRequest) => Promise<boolean>,
  ): Promise<AccessResult> {
    const pageOrigin = parsePageOrigin(pageUrl);
    if (pageOrigin === null) {
      return { status: 'unsupported' };
    }
    const provider = ProviderDestinationSchema.parse(providerInput);
    const existing = await this.readiness(pageUrl, provider);
    if (existing.status === 'ready') {
      return existing;
    }
    const confirmed = await confirm({
      pageOrigin,
      provider,
      data: [
        'visible page text',
        'semantic attributes',
        'layout and style samples',
        'page path',
      ],
    });
    if (!confirmed) {
      return { status: 'denied', pageOrigin };
    }
    const granted = await this.#permissions.request(
      requiredOrigins(pageOrigin, provider.origin),
    );
    if (!granted) {
      return { status: 'denied', pageOrigin };
    }
    const records = await this.#consents.read();
    const next = records.filter(
      (record) =>
        record.pageOrigin !== pageOrigin ||
        record.provider.id !== provider.id ||
        record.provider.origin !== provider.origin,
    );
    next.push({
      schemaVersion: 1,
      pageOrigin,
      provider,
      grantedAt: this.#now(),
    });
    await this.#consents.write(next);
    return { status: 'ready', pageOrigin };
  }

  async revoke(pageUrl: string) {
    const pageOrigin = parsePageOrigin(pageUrl);
    if (pageOrigin === null) {
      return false;
    }
    const removed = await this.#permissions.remove([originPattern(pageOrigin)]);
    const records = await this.#consents.read();
    await this.#consents.write(
      records.filter((record) => record.pageOrigin !== pageOrigin),
    );
    return removed;
  }
}

export class MemoryConsentStorage implements ConsentStorage {
  #records: ConsentRecord[] = [];

  async read() {
    return ConsentRecordsSchema.parse(structuredClone(this.#records));
  }

  async write(records: readonly ConsentRecord[]) {
    this.#records = ConsentRecordsSchema.parse(structuredClone([...records]));
  }
}

const hasConsent = (
  records: readonly ConsentRecord[],
  pageOrigin: string,
  provider: ProviderDestination,
) =>
  records.some(
    (record) =>
      record.schemaVersion === 1 &&
      record.pageOrigin === pageOrigin &&
      record.provider.id === provider.id &&
      record.provider.origin === provider.origin,
  );

const originPattern = (origin: string) => `${origin}/*`;

const requiredOrigins = (pageOrigin: string, providerOrigin: string) => [
  ...new Set([originPattern(pageOrigin), originPattern(providerOrigin)]),
];

const parsePageOrigin = (pageUrl: string) => {
  try {
    const url = new URL(pageUrl);
    const local =
      url.hostname === 'localhost' ||
      url.hostname.endsWith('.localhost') ||
      url.hostname === '127.0.0.1' ||
      url.hostname === '[::1]';
    if (
      url.protocol !== 'https:' ||
      local ||
      url.username !== '' ||
      url.password !== ''
    ) {
      return null;
    }
    return url.origin;
  } catch {
    return null;
  }
};
