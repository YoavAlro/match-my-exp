import { beforeEach, describe, expect, it } from 'vitest';
import type { Profile } from '../contracts';
import { StylePreviewRegistry } from '../transforms';
import {
  ProfileApplicationError,
  ProfileApplicationService,
} from './application';
import { ProfileRepository } from './repository';
import { MemoryProfileStorage } from './storage';

const profile = (
  id: string,
  pathPattern = '/account',
  selector = '#main',
): Profile => ({
  schemaVersion: 1,
  id,
  name: 'Account profile',
  enabled: true,
  origin: 'https://example.com',
  pathPattern,
  intentSummary: 'Increase account contrast.',
  conversationId: '00000000-0000-4000-8000-000000000099',
  operations: [
    {
      kind: 'style',
      operationId: 'style-main',
      target: {
        kind: 'durable',
        shadowHosts: [],
        element: { attributes: [], selector },
      },
      declarations: [{ property: 'color', value: 'red' }],
    },
  ],
  revision: 1,
  health: { state: 'healthy' },
  createdAt: '2026-07-15T13:00:00Z',
  updatedAt: '2026-07-15T13:00:00Z',
});

describe('ProfileApplicationService', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '<main id="main">Account</main>';
  });

  it('applies one matching profile idempotently without a provider', async () => {
    const repository = new ProfileRepository(new MemoryProfileStorage());
    const stored = profile('00000000-0000-4000-8000-000000000001');
    await repository.create(stored);
    const styles = new StylePreviewRegistry(() => true);
    const service = new ProfileApplicationService(repository, styles);

    expect(
      await service.apply(
        document,
        'https://example.com/account?token=private#section',
      ),
    ).toEqual({ status: 'applied', profileId: stored.id, revision: 1 });
    expect(
      await service.apply(document, 'https://example.com/account'),
    ).toEqual({
      status: 'applied',
      profileId: stored.id,
      revision: 1,
    });
    expect(styles.activeCount).toBe(1);
    expect(
      document.querySelectorAll('style[data-match-my-exp-owned]'),
    ).toHaveLength(1);
  });

  it('clears active state on no match or permission loss', async () => {
    const repository = new ProfileRepository(new MemoryProfileStorage());
    const stored = profile('00000000-0000-4000-8000-000000000001');
    await repository.create(stored);
    const styles = new StylePreviewRegistry(() => true);
    const service = new ProfileApplicationService(repository, styles);
    await service.apply(document, 'https://example.com/account');

    expect(await service.apply(document, 'https://example.com/other')).toEqual({
      status: 'none',
    });
    expect(styles.activeCount).toBe(0);
    expect(service.clear()).toBe(false);
  });

  it('preflights missing and ambiguous targets before style mutation', async () => {
    const missingRepository = new ProfileRepository(new MemoryProfileStorage());
    await missingRepository.create(
      profile('00000000-0000-4000-8000-000000000001', '/account', '#missing'),
    );
    const styles = new StylePreviewRegistry(() => true);
    await expect(
      new ProfileApplicationService(missingRepository, styles).apply(
        document,
        'https://example.com/account',
      ),
    ).rejects.toMatchObject({ code: 'profile_target_missing' });
    expect(styles.activeCount).toBe(0);

    document.body.innerHTML =
      '<main><button>Save</button><button>Save</button></main>';
    const ambiguousProfile = profile('00000000-0000-4000-8000-000000000002');
    ambiguousProfile.operations[0] = {
      kind: 'style',
      operationId: 'style-main',
      target: {
        kind: 'durable',
        shadowHosts: [],
        element: {
          tag: 'button',
          role: 'button',
          accessibleName: 'Save',
          attributes: [],
        },
      },
      declarations: [{ property: 'color', value: 'red' }],
    };
    const ambiguousRepository = new ProfileRepository(
      new MemoryProfileStorage(),
    );
    await ambiguousRepository.create(ambiguousProfile);
    await expect(
      new ProfileApplicationService(ambiguousRepository, styles).apply(
        document,
        'https://example.com/account',
      ),
    ).rejects.toMatchObject({ code: 'profile_target_ambiguous' });
    expect(styles.activeCount).toBe(0);
  });

  it('fails closed on profile conflicts and unsupported rich operations', async () => {
    const conflictRepository = new ProfileRepository(
      new MemoryProfileStorage(),
    );
    await conflictRepository.create(
      profile('00000000-0000-4000-8000-000000000001'),
    );
    await conflictRepository.create(
      profile('00000000-0000-4000-8000-000000000002'),
    );
    const styles = new StylePreviewRegistry(() => true);
    await expect(
      new ProfileApplicationService(conflictRepository, styles).apply(
        document,
        'https://example.com/account',
      ),
    ).rejects.toBeInstanceOf(ProfileApplicationError);

    const rich = profile('00000000-0000-4000-8000-000000000003');
    rich.operations = [
      {
        kind: 'aria',
        operationId: 'aria-main',
        target: {
          kind: 'durable',
          shadowHosts: [],
          element: { attributes: [], selector: '#main' },
        },
        attribute: 'aria-label',
        value: 'Main account',
      },
    ];
    const richRepository = new ProfileRepository(new MemoryProfileStorage());
    await richRepository.create(rich);
    await expect(
      new ProfileApplicationService(richRepository, styles).apply(
        document,
        'https://example.com/account',
      ),
    ).rejects.toMatchObject({ code: 'unsupported_profile_operation' });
  });

  it('reapplies from persisted state after a worker-style restart', async () => {
    const storage = new MemoryProfileStorage();
    const repository = new ProfileRepository(storage);
    await repository.create(profile('00000000-0000-4000-8000-000000000001'));
    const firstStyles = new StylePreviewRegistry(() => true);
    await new ProfileApplicationService(repository, firstStyles).apply(
      document,
      'https://example.com/account',
    );
    firstStyles.rollbackAll();

    const restartedRepository = new ProfileRepository(
      new MemoryProfileStorage(storage.snapshot),
    );
    const restartedStyles = new StylePreviewRegistry(() => true);
    const restarted = new ProfileApplicationService(
      restartedRepository,
      restartedStyles,
    );

    expect(
      await restarted.apply(document, 'https://example.com/account'),
    ).toMatchObject({ status: 'applied' });
    expect(restartedStyles.activeCount).toBe(1);
  });
});
