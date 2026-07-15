import { describe, expect, it, vi } from 'vitest';
import {
  ChromeConsentStorage,
  MemoryConsentStorage,
  SiteAccessService,
  type HostPermissionAdapter,
} from './access';

class MemoryPermissions implements HostPermissionAdapter {
  readonly origins = new Set<string>();
  grantRequests: string[][] = [];
  removals: string[][] = [];
  allowRequest = true;

  async contains(originPatterns: readonly string[]) {
    return originPatterns.every((origin) => this.origins.has(origin));
  }

  async request(originPatterns: readonly string[]) {
    this.grantRequests.push([...originPatterns]);
    if (this.allowRequest) {
      originPatterns.forEach((origin) => this.origins.add(origin));
    }
    return this.allowRequest;
  }

  async remove(originPatterns: readonly string[]) {
    this.removals.push([...originPatterns]);
    return originPatterns.some((origin) => this.origins.delete(origin));
  }
}

const openai = {
  id: 'openai' as const,
  origin: 'https://api.openai.com',
};

describe('SiteAccessService', () => {
  it('discloses and requests only the canonical current origin', async () => {
    const permissions = new MemoryPermissions();
    const consents = new MemoryConsentStorage();
    const service = new SiteAccessService(
      permissions,
      consents,
      () => '2026-07-15T09:00:00Z',
    );
    const confirm = vi.fn().mockResolvedValue(true);

    const result = await service.request(
      'https://example.com/account?token=private#section',
      openai,
      confirm,
    );

    expect(result).toEqual({
      status: 'ready',
      pageOrigin: 'https://example.com',
    });
    expect(permissions.grantRequests).toEqual([
      ['https://example.com/*', 'https://api.openai.com/*'],
    ]);
    expect(confirm).toHaveBeenCalledWith({
      pageOrigin: 'https://example.com',
      provider: openai,
      data: [
        'visible page text',
        'semantic attributes',
        'layout and style samples',
        'page path',
      ],
    });
    expect(await consents.read()).toEqual([
      {
        schemaVersion: 1,
        pageOrigin: 'https://example.com',
        provider: openai,
        grantedAt: '2026-07-15T09:00:00Z',
      },
    ]);
  });

  it('keeps repeated ready requests idempotent', async () => {
    const permissions = new MemoryPermissions();
    const consents = new MemoryConsentStorage();
    const service = new SiteAccessService(permissions, consents);
    const confirm = vi.fn().mockResolvedValue(true);

    await service.request('https://example.com/account', openai, confirm);
    await service.request('https://example.com/other', openai, confirm);

    expect(confirm).toHaveBeenCalledOnce();
    expect(permissions.grantRequests).toEqual([
      ['https://example.com/*', 'https://api.openai.com/*'],
    ]);
    expect(await consents.read()).toHaveLength(1);
  });

  it('stores nothing when disclosure or browser permission is denied', async () => {
    const permissions = new MemoryPermissions();
    const consents = new MemoryConsentStorage();
    const service = new SiteAccessService(permissions, consents);

    expect(
      await service.request('https://example.com/', openai, async () => false),
    ).toEqual({ status: 'denied', pageOrigin: 'https://example.com' });
    expect(permissions.grantRequests).toEqual([]);
    expect(await consents.read()).toEqual([]);

    permissions.allowRequest = false;
    expect(
      await service.request('https://example.com/', openai, async () => true),
    ).toEqual({ status: 'denied', pageOrigin: 'https://example.com' });
    expect(await consents.read()).toEqual([]);
  });

  it('ties readiness to the selected provider destination', async () => {
    const permissions = new MemoryPermissions();
    const consents = new MemoryConsentStorage();
    const service = new SiteAccessService(permissions, consents);
    await service.request('https://example.com/', openai, async () => true);

    expect(await service.readiness('https://example.com/path', openai)).toEqual(
      { status: 'ready', pageOrigin: 'https://example.com' },
    );
    expect(
      await service.readiness('https://example.com/path', {
        id: 'compatible',
        origin: 'https://models.example',
      }),
    ).toEqual({ status: 'denied', pageOrigin: 'https://example.com' });
  });

  it('rejects unsupported pages before prompting or permission access', async () => {
    const permissions = new MemoryPermissions();
    const service = new SiteAccessService(
      permissions,
      new MemoryConsentStorage(),
    );
    const confirm = vi.fn().mockResolvedValue(true);

    for (const url of [
      'http://example.com/',
      'https://localhost/private',
      'chrome://settings/',
      'not a url',
    ]) {
      expect(await service.request(url, openai, confirm)).toEqual({
        status: 'unsupported',
      });
    }
    expect(confirm).not.toHaveBeenCalled();
    expect(permissions.grantRequests).toEqual([]);
  });

  it('revokes browser access and every consent for an origin', async () => {
    const permissions = new MemoryPermissions();
    const consents = new MemoryConsentStorage();
    const service = new SiteAccessService(permissions, consents);
    await service.request('https://example.com/', openai, async () => true);
    await service.request(
      'https://example.com/',
      { id: 'gemini', origin: 'https://generativelanguage.googleapis.com' },
      async () => true,
    );

    expect(await service.revoke('https://example.com/account')).toBe(true);
    expect(permissions.removals).toEqual([['https://example.com/*']]);
    expect(await consents.read()).toEqual([]);
    expect(await service.revoke('https://example.com/account')).toBe(false);
  });

  it('validates consent records at the trusted storage boundary', async () => {
    const get = vi.fn().mockResolvedValue({ siteProviderConsents: [] });
    const set = vi.fn().mockResolvedValue(undefined);
    const storage = new ChromeConsentStorage({ get, set });

    expect(await storage.read()).toEqual([]);
    await storage.write([
      {
        schemaVersion: 1,
        pageOrigin: 'https://example.com',
        provider: openai,
        grantedAt: '2026-07-15T09:00:00Z',
      },
    ]);
    expect(get).toHaveBeenCalledWith('siteProviderConsents');
    expect(set).toHaveBeenCalledOnce();
    await expect(
      storage.write([
        {
          schemaVersion: 1,
          pageOrigin: 'https://example.com',
          provider: { ...openai, credential: 'secret' },
          grantedAt: '2026-07-15T09:00:00Z',
        } as never,
      ]),
    ).rejects.toThrow();
  });
});
