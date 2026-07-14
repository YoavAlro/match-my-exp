import { z } from 'zod';
import {
  ProfileRevisionSchema,
  ProfileSchema,
  type Profile,
  type ProfileRevision,
} from '../contracts';
import type { ProfileStorageAdapter } from './storage';

const MAX_REVISIONS_PER_PROFILE = 20;

const StoredProfilesSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    profiles: z.record(z.string(), ProfileSchema),
    revisions: z.record(
      z.string(),
      z.array(ProfileRevisionSchema).max(MAX_REVISIONS_PER_PROFILE),
    ),
  })
  .refine(
    ({ profiles }) =>
      Object.entries(profiles).every(
        ([profileId, profile]) => profile.id === profileId,
      ),
    'Profile keys must match profile identifiers',
  )
  .refine(
    ({ profiles, revisions }) =>
      Object.entries(revisions).every(
        ([profileId, entries]) =>
          profiles[profileId] !== undefined &&
          entries.every(
            ({ profileId: revisionProfileId }) =>
              revisionProfileId === profileId,
          ),
      ),
    'Revision keys must match profile identifiers',
  );

type StoredProfiles = z.infer<typeof StoredProfilesSchema>;

export interface ProfileStorageMigration {
  fromVersion: number;
  toVersion: number;
  migrate(value: unknown): unknown;
}

export class ProfileRepositoryError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ProfileRepositoryError';
    this.code = code;
  }
}

const emptyState = (): StoredProfiles => ({
  schemaVersion: 1,
  profiles: {},
  revisions: {},
});

const storageVersion = (value: unknown) => {
  if (
    value !== null &&
    typeof value === 'object' &&
    'schemaVersion' in value &&
    typeof value.schemaVersion === 'number' &&
    Number.isSafeInteger(value.schemaVersion)
  ) {
    return value.schemaVersion;
  }
  return null;
};

const clone = <Value>(value: Value): Value => structuredClone(value);

export class ProfileRepository {
  readonly #storage: ProfileStorageAdapter;
  readonly #migrations: Map<number, ProfileStorageMigration>;

  constructor(
    storage: ProfileStorageAdapter,
    migrations: readonly ProfileStorageMigration[] = [],
  ) {
    this.#storage = storage;
    this.#migrations = new Map(
      migrations.map((migration) => [migration.fromVersion, migration]),
    );
  }

  async get(profileId: string) {
    const state = await this.#readState();
    const profile = state.profiles[profileId];
    return profile === undefined ? null : clone(profile);
  }

  async listByOrigin(origin: string) {
    const state = await this.#readState();
    return Object.values(state.profiles)
      .filter((profile) => profile.origin === origin)
      .sort((left, right) => left.pathPattern.localeCompare(right.pathPattern))
      .map(clone);
  }

  async history(profileId: string) {
    const state = await this.#readState();
    return (state.revisions[profileId] ?? [])
      .toSorted((left, right) => right.revision - left.revision)
      .map(clone);
  }

  async create(input: unknown) {
    const profile = ProfileSchema.parse(input);
    if (profile.revision !== 1) {
      throw new ProfileRepositoryError('initial_revision_must_be_one');
    }
    const state = await this.#readState();
    if (state.profiles[profile.id] !== undefined) {
      throw new ProfileRepositoryError('profile_already_exists');
    }
    const next = clone(state);
    next.profiles[profile.id] = profile;
    next.revisions[profile.id] = [];
    await this.#writeState(next);
    return clone(profile);
  }

  async update(input: unknown) {
    const profile = ProfileSchema.parse(input);
    const state = await this.#readState();
    const current = state.profiles[profile.id];
    if (current === undefined) {
      throw new ProfileRepositoryError('profile_not_found');
    }
    if (
      profile.revision !== current.revision + 1 ||
      profile.createdAt !== current.createdAt ||
      profile.origin !== current.origin ||
      profile.conversationId !== current.conversationId ||
      new Date(profile.updatedAt).getTime() <
        new Date(current.updatedAt).getTime()
    ) {
      throw new ProfileRepositoryError('invalid_profile_update');
    }
    const next = clone(state);
    this.#archive(next, current, profile.updatedAt);
    next.profiles[profile.id] = profile;
    await this.#writeState(next);
    return clone(profile);
  }

  async disable(profileId: string, updatedAt: string) {
    const current = await this.get(profileId);
    if (current === null) {
      throw new ProfileRepositoryError('profile_not_found');
    }
    return this.update({
      ...current,
      enabled: false,
      revision: current.revision + 1,
      updatedAt,
    });
  }

  async delete(profileId: string) {
    const state = await this.#readState();
    if (state.profiles[profileId] === undefined) {
      return false;
    }
    const next = clone(state);
    next.profiles = Object.fromEntries(
      Object.entries(next.profiles).filter(
        ([storedId]) => storedId !== profileId,
      ),
    );
    next.revisions = Object.fromEntries(
      Object.entries(next.revisions).filter(
        ([storedId]) => storedId !== profileId,
      ),
    );
    await this.#writeState(next);
    return true;
  }

  async restore(profileId: string, revision: number, updatedAt: string) {
    const state = await this.#readState();
    const current = state.profiles[profileId];
    const archived = state.revisions[profileId]?.find(
      (entry) => entry.revision === revision,
    );
    if (current === undefined || archived === undefined) {
      throw new ProfileRepositoryError('revision_not_found');
    }
    if (new Date(updatedAt).getTime() < new Date(current.updatedAt).getTime()) {
      throw new ProfileRepositoryError('invalid_profile_update');
    }
    const restored = ProfileSchema.parse({
      ...archived.snapshot,
      id: current.id,
      revision: current.revision + 1,
      createdAt: current.createdAt,
      updatedAt,
    });
    const next = clone(state);
    this.#archive(next, current, updatedAt);
    next.profiles[profileId] = restored;
    await this.#writeState(next);
    return clone(restored);
  }

  #archive(state: StoredProfiles, profile: Profile, recordedAt: string) {
    const revision = ProfileRevisionSchema.parse({
      schemaVersion: 1,
      profileId: profile.id,
      revision: profile.revision,
      snapshot: profile,
      recordedAt,
    });
    state.revisions[profile.id] = [
      ...(state.revisions[profile.id] ?? []),
      revision,
    ].slice(-MAX_REVISIONS_PER_PROFILE);
  }

  async #readState(): Promise<StoredProfiles> {
    const stored = await this.#storage.read();
    if (stored === undefined) {
      return emptyState();
    }
    const current = StoredProfilesSchema.safeParse(stored);
    if (current.success) {
      return current.data;
    }

    let migrated: unknown = clone(stored);
    const visited = new Set<number>();
    while (storageVersion(migrated) !== 1) {
      const version = storageVersion(migrated);
      if (version === null || visited.has(version)) {
        throw new ProfileRepositoryError('migration_failed');
      }
      visited.add(version);
      const migration = this.#migrations.get(version);
      if (
        migration === undefined ||
        migration.toVersion <= migration.fromVersion
      ) {
        throw new ProfileRepositoryError('migration_failed');
      }
      try {
        migrated = migration.migrate(clone(migrated));
      } catch {
        throw new ProfileRepositoryError('migration_failed');
      }
    }
    const parsed = StoredProfilesSchema.safeParse(migrated);
    if (!parsed.success) {
      throw new ProfileRepositoryError('migration_failed');
    }
    await this.#writeState(parsed.data);
    return parsed.data;
  }

  async #writeState(state: StoredProfiles) {
    const parsed = StoredProfilesSchema.parse(state);
    try {
      await this.#storage.write(parsed);
    } catch {
      throw new ProfileRepositoryError('storage_write_failed');
    }
  }
}

export type { Profile, ProfileRevision };
