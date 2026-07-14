import { describe, expect, it, vi } from 'vitest';
import {
  ChromeContentScriptRegistrationAdapter,
  ContentScriptRegistrationService,
  type ContentScriptRegistration,
  type ContentScriptRegistrationAdapter,
} from './registrations';

class MemoryRegistrationAdapter implements ContentScriptRegistrationAdapter {
  readonly registrations = new Map<string, ContentScriptRegistration>();
  readonly permissions = new Set<string>();
  registeredBatches: ContentScriptRegistration[][] = [];
  unregisteredBatches: string[][] = [];

  async list() {
    return [...this.registrations.values()].map(({ id }) => ({ id }));
  }

  async register(registrations: readonly ContentScriptRegistration[]) {
    this.registeredBatches.push(structuredClone([...registrations]));
    for (const registration of registrations) {
      this.registrations.set(registration.id, structuredClone(registration));
    }
  }

  async unregister(ids: readonly string[]) {
    this.unregisteredBatches.push([...ids]);
    for (const id of ids) {
      this.registrations.delete(id);
    }
  }

  async hasOriginPermission(originPattern: string) {
    return this.permissions.has(originPattern);
  }
}

describe('ContentScriptRegistrationService', () => {
  it('maps the Chrome scripting and permission APIs without widening access', async () => {
    const getRegisteredContentScripts = vi
      .fn()
      .mockResolvedValue([{ id: 'one' }]);
    const registerContentScripts = vi.fn().mockResolvedValue(undefined);
    const unregisterContentScripts = vi.fn().mockResolvedValue(undefined);
    const contains = vi.fn().mockResolvedValue(true);
    const adapter = new ChromeContentScriptRegistrationAdapter(
      {
        getRegisteredContentScripts,
        registerContentScripts,
        unregisterContentScripts,
      },
      { contains },
    );
    const registration: ContentScriptRegistration = {
      id: 'one',
      matches: ['https://example.com/*'],
      js: ['/content-scripts/content.js'],
      runAt: 'document_idle',
      persistAcrossSessions: true,
    };

    expect(await adapter.list()).toEqual([{ id: 'one' }]);
    await adapter.register([registration]);
    await adapter.unregister(['one']);
    expect(await adapter.hasOriginPermission('https://example.com/*')).toBe(
      true,
    );
    expect(registerContentScripts).toHaveBeenCalledWith([registration]);
    expect(unregisterContentScripts).toHaveBeenCalledWith({ ids: ['one'] });
    expect(contains).toHaveBeenCalledWith({
      origins: ['https://example.com/*'],
    });
  });

  it('registers only unique enabled origins with permission', async () => {
    const adapter = new MemoryRegistrationAdapter();
    adapter.permissions.add('https://one.example/*');
    adapter.permissions.add('https://two.example/*');
    const service = new ContentScriptRegistrationService(adapter);

    const result = await service.reconcile([
      'https://two.example',
      'https://one.example',
      'https://one.example',
      'https://denied.example',
    ]);

    expect(result.registered).toHaveLength(2);
    expect(adapter.registrations.size).toBe(2);
    expect([...adapter.registrations.values()]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          matches: ['https://one.example/*'],
          js: ['/content-scripts/content.js'],
          runAt: 'document_idle',
          persistAcrossSessions: true,
        }),
        expect.objectContaining({ matches: ['https://two.example/*'] }),
      ]),
    );
  });

  it('is idempotent across startup and worker recreation', async () => {
    const adapter = new MemoryRegistrationAdapter();
    adapter.permissions.add('https://one.example/*');
    const first = new ContentScriptRegistrationService(adapter);
    const initial = await first.reconcile(['https://one.example']);
    const second = new ContentScriptRegistrationService(adapter);
    const repeated = await second.reconcile(['https://one.example']);

    expect(initial.registered).toHaveLength(1);
    expect(repeated).toEqual({ registered: [], unregistered: [] });
    expect(adapter.registeredBatches).toHaveLength(1);
  });

  it('removes revoked or unused owned registrations only', async () => {
    const adapter = new MemoryRegistrationAdapter();
    adapter.permissions.add('https://one.example/*');
    adapter.permissions.add('https://two.example/*');
    const service = new ContentScriptRegistrationService(adapter);
    await service.reconcile(['https://one.example', 'https://two.example']);
    adapter.registrations.set('other-feature-registration', {
      id: 'other-feature-registration',
      matches: ['https://other.example/*'],
      js: ['/other.js'],
      runAt: 'document_idle',
      persistAcrossSessions: true,
    });
    adapter.permissions.delete('https://two.example/*');

    const result = await service.reconcile([
      'https://one.example',
      'https://two.example',
    ]);

    expect(result.unregistered).toHaveLength(1);
    expect(adapter.registrations.has('other-feature-registration')).toBe(true);
    expect(
      [...adapter.registrations.values()].some(
        ({ matches }) => matches[0] === 'https://two.example/*',
      ),
    ).toBe(false);

    const removed = await service.reconcile([]);
    expect(removed.unregistered).toHaveLength(1);
    expect(adapter.registrations.has('other-feature-registration')).toBe(true);
  });
});
