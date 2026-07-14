import { describe, expect, it, vi } from 'vitest';
import type { Profile } from '../contracts';
import { ProfileRepository, ProfileRepositoryError } from './repository';
import { ChromeProfileStorage, MemoryProfileStorage } from './storage';

const profileId = '00000000-0000-4000-8000-000000000001';
const otherProfileId = '00000000-0000-4000-8000-000000000002';
const conversationId = '00000000-0000-4000-8000-000000000003';

const timestamp = (minute: number) =>
  `2026-07-15T08:${minute.toString().padStart(2, '0')}:00Z`;

const durableTarget = {
  kind: 'durable' as const,
  shadowHosts: [],
  element: { attributes: [], selector: '#main' },
};

const createProfile = (
  id = profileId,
  origin = 'https://example.com',
): Profile => ({
  schemaVersion: 1,
  id,
  name: 'Readable account',
  enabled: true,
  origin,
  pathPattern: '/account/*',
  intentSummary: 'Increase account page contrast.',
  conversationId,
  operations: [
    {
      kind: 'style',
      operationId: 'style-main',
      target: durableTarget,
      declarations: [{ property: 'color', value: '#111111' }],
    },
  ],
  revision: 1,
  health: { state: 'healthy' },
  createdAt: timestamp(0),
  updatedAt: timestamp(0),
});

describe('ProfileRepository', () => {
  it('creates isolated profiles and returns defensive copies', async () => {
    const storage = new MemoryProfileStorage();
    const repository = new ProfileRepository(storage);
    const first = createProfile();
    const second = createProfile(otherProfileId, 'https://other.example');

    await repository.create(first);
    await repository.create(second);

    const loaded = await repository.get(profileId);
    expect(loaded).toEqual(first);
    if (loaded === null) {
      throw new Error('Profile was not created');
    }
    loaded.name = 'Mutated copy';
    expect((await repository.get(profileId))?.name).toBe('Readable account');
    expect(await repository.listByOrigin('https://example.com')).toEqual([
      first,
    ]);
    expect(await repository.listByOrigin('https://missing.example')).toEqual(
      [],
    );
  });

  it('updates, disables, restores, and deletes with immutable history', async () => {
    const repository = new ProfileRepository(new MemoryProfileStorage());
    const original = await repository.create(createProfile());
    const updated = await repository.update({
      ...original,
      name: 'Updated account',
      revision: 2,
      updatedAt: timestamp(1),
    });
    const disabled = await repository.disable(profileId, timestamp(2));

    expect(updated.revision).toBe(2);
    expect(disabled).toMatchObject({ revision: 3, enabled: false });
    expect(
      (await repository.history(profileId)).map(({ revision }) => revision),
    ).toEqual([2, 1]);

    const restored = await repository.restore(profileId, 1, timestamp(3));
    expect(restored).toMatchObject({
      revision: 4,
      name: 'Readable account',
      enabled: true,
    });
    expect(
      (await repository.history(profileId)).map(({ revision }) => revision),
    ).toEqual([3, 2, 1]);
    expect(await repository.delete(profileId)).toBe(true);
    expect(await repository.delete(profileId)).toBe(false);
    expect(await repository.get(profileId)).toBeNull();
    expect(await repository.history(profileId)).toEqual([]);
  });

  it('bounds revision history to the newest twenty snapshots', async () => {
    const repository = new ProfileRepository(new MemoryProfileStorage());
    let current = await repository.create(createProfile());
    for (let revision = 2; revision <= 23; revision += 1) {
      current = await repository.update({
        ...current,
        name: `Revision ${revision}`,
        revision,
        updatedAt: timestamp(revision),
      });
    }

    const history = await repository.history(profileId);
    expect(history).toHaveLength(20);
    expect(history[0]?.revision).toBe(22);
    expect(history.at(-1)?.revision).toBe(3);
  });

  it('rejects malformed aggregates and invalid revision transitions', async () => {
    const repository = new ProfileRepository(new MemoryProfileStorage());
    const profile = createProfile();

    await expect(
      repository.create({ ...profile, credential: 'secret' }),
    ).rejects.toThrow();
    await repository.create(profile);
    await expect(repository.create(profile)).rejects.toMatchObject({
      code: 'profile_already_exists',
    });
    await expect(
      repository.update({
        ...profile,
        revision: 3,
        updatedAt: timestamp(1),
      }),
    ).rejects.toMatchObject({ code: 'invalid_profile_update' });
    await expect(
      repository.update({
        ...profile,
        id: otherProfileId,
        revision: 2,
        updatedAt: timestamp(1),
      }),
    ).rejects.toMatchObject({ code: 'profile_not_found' });
    await expect(
      repository.restore(profileId, 99, timestamp(2)),
    ).rejects.toMatchObject({ code: 'revision_not_found' });
    await repository.update({
      ...profile,
      revision: 2,
      updatedAt: timestamp(2),
    });
    await expect(
      repository.restore(profileId, 1, timestamp(1)),
    ).rejects.toMatchObject({ code: 'invalid_profile_update' });
  });

  it('commits only fully validated migrations', async () => {
    const profile = createProfile();
    const legacy = {
      schemaVersion: 0,
      items: { [profile.id]: profile },
    };
    const storage = new MemoryProfileStorage(legacy);
    const repository = new ProfileRepository(storage, [
      {
        fromVersion: 0,
        toVersion: 1,
        migrate: (value) => {
          const items = (value as typeof legacy).items;
          return { schemaVersion: 1, profiles: items, revisions: {} };
        },
      },
    ]);

    expect(await repository.get(profile.id)).toEqual(profile);
    expect(storage.snapshot).toMatchObject({ schemaVersion: 1 });

    const invalidStorage = new MemoryProfileStorage(legacy);
    const invalidRepository = new ProfileRepository(invalidStorage, [
      {
        fromVersion: 0,
        toVersion: 1,
        migrate: () => ({ schemaVersion: 1, profiles: { bad: profile } }),
      },
    ]);
    await expect(invalidRepository.get(profile.id)).rejects.toMatchObject({
      code: 'migration_failed',
    });
    expect(invalidStorage.snapshot).toEqual(legacy);

    const throwingStorage = new MemoryProfileStorage(legacy);
    const throwingRepository = new ProfileRepository(throwingStorage, [
      {
        fromVersion: 0,
        toVersion: 1,
        migrate: () => {
          throw new Error('private migration failure');
        },
      },
    ]);
    await expect(throwingRepository.get(profile.id)).rejects.toMatchObject({
      code: 'migration_failed',
      message: 'migration_failed',
    });
    expect(throwingStorage.snapshot).toEqual(legacy);
  });

  it('preserves previous state on quota and interrupted writes', async () => {
    const storage = new MemoryProfileStorage();
    const repository = new ProfileRepository(storage);
    const original = await repository.create(createProfile());
    const before = storage.snapshot;
    storage.maximumBytes = 10;

    await expect(
      repository.update({
        ...original,
        revision: 2,
        updatedAt: timestamp(1),
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<ProfileRepositoryError>>({
        code: 'storage_write_failed',
      }),
    );
    expect(storage.snapshot).toEqual(before);

    storage.maximumBytes = Number.POSITIVE_INFINITY;
    storage.failNextWrite();
    await expect(
      repository.disable(profileId, timestamp(2)),
    ).rejects.toMatchObject({ code: 'storage_write_failed' });
    expect(storage.snapshot).toEqual(before);
  });

  it('uses one trusted chrome storage key', async () => {
    const get = vi.fn().mockResolvedValue({ profileRepository: { value: 1 } });
    const set = vi.fn().mockResolvedValue(undefined);
    const storage = new ChromeProfileStorage({ get, set });

    expect(await storage.read()).toEqual({ value: 1 });
    await storage.write({ value: 2 });

    expect(get).toHaveBeenCalledWith('profileRepository');
    expect(set).toHaveBeenCalledWith({ profileRepository: { value: 2 } });
  });
});
