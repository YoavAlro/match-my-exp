import { describe, expect, it, vi } from 'vitest';
import type { Profile } from '../contracts';
import { MemoryConsentStorage, SiteAccessService } from '../permissions';
import type { ProfileApplicationService } from './application';
import { ProfileManagementService } from './management';
import { ProfileRepository } from './repository';
import { MemoryProfileStorage } from './storage';

const profile = (id: string, pathPattern: string): Profile => ({
  schemaVersion: 1,
  id,
  name: pathPattern,
  enabled: true,
  origin: 'https://example.com',
  pathPattern,
  intentSummary: 'Adapt the page.',
  conversationId: '00000000-0000-4000-8000-000000000099',
  operations: [
    {
      kind: 'style',
      operationId: 'style-main',
      target: {
        kind: 'durable',
        shadowHosts: [],
        element: { attributes: [], selector: '#main' },
      },
      declarations: [{ property: 'color', value: 'red' }],
    },
  ],
  revision: 1,
  health: { state: 'healthy' },
  createdAt: '2020-01-01T00:00:00Z',
  updatedAt: '2020-01-01T00:00:00Z',
});

describe('ProfileManagementService', () => {
  it('lists inspectable summaries and coordinates disable and delete', async () => {
    const repository = new ProfileRepository(new MemoryProfileStorage());
    const first = profile('00000000-0000-4000-8000-000000000001', '/account');
    const second = profile('00000000-0000-4000-8000-000000000002', '/settings');
    await repository.create(first);
    await repository.create(second);
    const clear = vi.fn().mockReturnValue(true);
    const access = { revoke: vi.fn().mockResolvedValue(true) };
    const service = new ProfileManagementService(
      repository,
      { clear } as unknown as ProfileApplicationService,
      access as unknown as SiteAccessService,
    );

    expect(await service.list('https://example.com')).toEqual([
      expect.objectContaining({
        id: first.id,
        pathPattern: '/account',
        enabled: true,
        operationCount: 1,
      }),
      expect.objectContaining({ id: second.id, pathPattern: '/settings' }),
    ]);
    expect(await service.disable(first.id)).toMatchObject({
      enabled: false,
      revision: 2,
    });
    expect(await service.delete(second.id)).toBe(true);
    expect(clear).toHaveBeenCalledTimes(2);
  });

  it('rolls back, disables origin profiles, and revokes permission', async () => {
    const repository = new ProfileRepository(new MemoryProfileStorage());
    const first = profile('00000000-0000-4000-8000-000000000001', '/account');
    const second = profile('00000000-0000-4000-8000-000000000002', '/settings');
    await repository.create(first);
    await repository.create(second);
    await repository.disable(second.id, '2026-07-15T16:00:30Z');
    const clear = vi.fn().mockReturnValue(true);
    const remove = vi.fn().mockResolvedValue(true);
    const access = new SiteAccessService(
      {
        contains: async () => true,
        request: async () => true,
        remove,
      },
      new MemoryConsentStorage(),
    );
    const service = new ProfileManagementService(
      repository,
      { clear } as unknown as ProfileApplicationService,
      access,
      () => '2026-07-15T16:01:00Z',
    );

    expect(await service.revoke('https://example.com')).toBe(true);
    expect(clear).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith('https://example.com/*');
    expect(await repository.enabledOrigins()).toEqual([]);
    expect((await repository.get(first.id))?.enabled).toBe(false);
    expect((await repository.get(second.id))?.enabled).toBe(false);
  });
});
