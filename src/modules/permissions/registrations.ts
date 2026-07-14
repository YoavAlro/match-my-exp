export interface ContentScriptRegistration {
  id: string;
  matches: string[];
  js: string[];
  runAt: 'document_idle';
  persistAcrossSessions: true;
}

export interface ContentScriptRegistrationAdapter {
  list(): Promise<readonly { id: string }[]>;
  register(registrations: readonly ContentScriptRegistration[]): Promise<void>;
  unregister(ids: readonly string[]): Promise<void>;
  hasOriginPermission(originPattern: string): Promise<boolean>;
}

interface ScriptingApi {
  getRegisteredContentScripts(): Promise<{ id: string }[]>;
  registerContentScripts(
    registrations: ContentScriptRegistration[],
  ): Promise<void>;
  unregisterContentScripts(filter: { ids: string[] }): Promise<void>;
}

interface PermissionsApi {
  contains(permissions: { origins: string[] }): Promise<boolean>;
}

export class ChromeContentScriptRegistrationAdapter implements ContentScriptRegistrationAdapter {
  readonly #scripting: ScriptingApi;
  readonly #permissions: PermissionsApi;

  constructor(scripting: ScriptingApi, permissions: PermissionsApi) {
    this.#scripting = scripting;
    this.#permissions = permissions;
  }

  list() {
    return this.#scripting.getRegisteredContentScripts();
  }

  async register(registrations: readonly ContentScriptRegistration[]) {
    await this.#scripting.registerContentScripts([...registrations]);
  }

  async unregister(ids: readonly string[]) {
    await this.#scripting.unregisterContentScripts({ ids: [...ids] });
  }

  hasOriginPermission(originPattern: string) {
    return this.#permissions.contains({ origins: [originPattern] });
  }
}

const REGISTRATION_PREFIX = 'match-my-exp-origin-';

const originPattern = (origin: string) => `${origin}/*`;

const registrationId = async (origin: string) => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(origin),
  );
  const suffix = Array.from(new Uint8Array(digest))
    .slice(0, 8)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return `${REGISTRATION_PREFIX}${suffix}`;
};

export class ContentScriptRegistrationService {
  readonly #adapter: ContentScriptRegistrationAdapter;

  constructor(adapter: ContentScriptRegistrationAdapter) {
    this.#adapter = adapter;
  }

  async reconcile(enabledOrigins: readonly string[]) {
    const desired = new Map<string, ContentScriptRegistration>();
    for (const origin of [...new Set(enabledOrigins)].toSorted()) {
      const pattern = originPattern(origin);
      if (!(await this.#adapter.hasOriginPermission(pattern))) {
        continue;
      }
      const id = await registrationId(origin);
      desired.set(id, {
        id,
        matches: [pattern],
        js: ['/content-scripts/content.js'],
        runAt: 'document_idle',
        persistAcrossSessions: true,
      });
    }

    const existing = (await this.#adapter.list()).filter(({ id }) =>
      id.startsWith(REGISTRATION_PREFIX),
    );
    const stale = existing
      .filter(({ id }) => !desired.has(id))
      .map(({ id }) => id);
    const existingIds = new Set(existing.map(({ id }) => id));
    const missing = [...desired.values()].filter(
      ({ id }) => !existingIds.has(id),
    );

    if (stale.length > 0) {
      await this.#adapter.unregister(stale);
    }
    if (missing.length > 0) {
      await this.#adapter.register(missing);
    }
    return { registered: missing.map(({ id }) => id), unregistered: stale };
  }
}
