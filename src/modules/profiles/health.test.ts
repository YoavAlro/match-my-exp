import { beforeEach, describe, expect, it } from 'vitest';
import type { Profile } from '../contracts';
import { StylePreviewRegistry } from '../transforms';
import { ProfileApplicationService } from './application';
import { ProfileHealthService } from './health';
import { ProfileRepository } from './repository';
import { MemoryProfileStorage } from './storage';

const createProfile = (selector: string): Profile => ({
  schemaVersion: 1,
  id: '00000000-0000-4000-8000-000000000001',
  name: 'Dynamic account',
  enabled: true,
  origin: 'https://example.com',
  pathPattern: '/account',
  intentSummary: 'Adapt the account page.',
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
  createdAt: '2026-07-15T14:00:00Z',
  updatedAt: '2026-07-15T14:00:00Z',
});

const setup = async (selector: string) => {
  const repository = new ProfileRepository(new MemoryProfileStorage());
  await repository.create(createProfile(selector));
  const styles = new StylePreviewRegistry(() => true);
  const application = new ProfileApplicationService(repository, styles);
  return {
    repository,
    styles,
    health: new ProfileHealthService(repository, application),
  };
};

describe('ProfileHealthService', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('allows late dynamic targets inside the settling window', async () => {
    const { repository, styles, health } = await setup('#late');
    let waits = 0;

    expect(
      await health.applySettled(document, 'https://example.com/account', {
        attempts: 3,
        wait: async () => {
          waits += 1;
          const target = document.body.appendChild(
            document.createElement('div'),
          );
          target.id = 'late';
        },
      }),
    ).toEqual({ status: 'applied' });
    expect(waits).toBe(1);
    expect(styles.activeCount).toBe(1);
    expect(await repository.get(createProfile('#late').id)).toMatchObject({
      enabled: true,
      health: { state: 'healthy' },
      revision: 1,
    });
  });

  it('disables settled missing targets with bounded diagnostics', async () => {
    const { repository, styles, health } = await setup('#missing');

    expect(
      await health.applySettled(document, 'https://example.com/account', {
        attempts: 2,
        wait: async () => undefined,
        now: () => '2026-07-15T14:01:00Z',
      }),
    ).toEqual({
      status: 'needs-repair',
      profileId: createProfile('#missing').id,
    });
    expect(styles.activeCount).toBe(0);
    expect(await repository.get(createProfile('#missing').id)).toMatchObject({
      enabled: false,
      revision: 2,
      health: {
        state: 'needs-repair',
        diagnostics: [
          {
            code: 'missing-target',
            message:
              'A required page target did not appear within the settling window.',
          },
        ],
      },
    });
  });

  it('treats route changes as interruption without disabling the profile', async () => {
    const { repository, health } = await setup('#late');
    let url = 'https://example.com/account';

    expect(
      await health.applySettled(document, url, {
        attempts: 3,
        currentUrl: () => url,
        wait: async () => {
          url = 'https://example.com/other';
        },
      }),
    ).toEqual({ status: 'interrupted' });
    expect(await repository.get(createProfile('#late').id)).toMatchObject({
      enabled: true,
      revision: 1,
    });
  });

  it('returns none without mutating health when no profile matches', async () => {
    const { repository, health } = await setup('#main');
    expect(
      await health.applySettled(document, 'https://example.com/other'),
    ).toEqual({ status: 'none' });
    expect(await repository.get(createProfile('#main').id)).toMatchObject({
      enabled: true,
      revision: 1,
    });
  });

  it('classifies ambiguous and rejected operations with bounded diagnostics', async () => {
    document.body.innerHTML = '<button>Save</button><button>Save</button>';
    const ambiguousRepository = new ProfileRepository(
      new MemoryProfileStorage(),
    );
    const ambiguous = createProfile('#unused');
    ambiguous.operations[0] = {
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
    await ambiguousRepository.create(ambiguous);
    const ambiguousHealth = new ProfileHealthService(
      ambiguousRepository,
      new ProfileApplicationService(
        ambiguousRepository,
        new StylePreviewRegistry(() => true),
      ),
    );
    expect(
      await ambiguousHealth.applySettled(
        document,
        'https://example.com/account',
        { now: () => '2026-07-15T14:01:00Z' },
      ),
    ).toMatchObject({ status: 'needs-repair' });
    expect(await ambiguousRepository.get(ambiguous.id)).toMatchObject({
      health: {
        diagnostics: [
          {
            code: 'ambiguous-target',
            message: 'A required page target matched more than one element.',
          },
        ],
      },
    });

    document.body.innerHTML = '<main id="main"></main>';
    const rejectedRepository = new ProfileRepository(
      new MemoryProfileStorage(),
    );
    const rejected = createProfile('#main');
    rejected.id = '00000000-0000-4000-8000-000000000002';
    rejected.operations = [
      {
        kind: 'aria',
        operationId: 'aria-main',
        target: {
          kind: 'durable',
          shadowHosts: [],
          element: { attributes: [], selector: '#main' },
        },
        attribute: 'aria-label',
        value: 'Main',
      },
    ];
    await rejectedRepository.create(rejected);
    const rejectedHealth = new ProfileHealthService(
      rejectedRepository,
      new ProfileApplicationService(
        rejectedRepository,
        new StylePreviewRegistry(() => true),
      ),
    );
    expect(
      await rejectedHealth.applySettled(
        document,
        'https://example.com/account',
        { now: () => '2026-07-15T14:01:00Z' },
      ),
    ).toMatchObject({ status: 'needs-repair' });
    expect(await rejectedRepository.get(rejected.id)).toMatchObject({
      health: {
        diagnostics: [
          {
            code: 'operation-rejected',
            message:
              'A profile operation was rejected during complete preflight.',
          },
        ],
      },
    });
  });

  it('rejects equal-specificity profile conflicts before settling', async () => {
    const repository = new ProfileRepository(new MemoryProfileStorage());
    await repository.create(createProfile('#one'));
    const second = createProfile('#two');
    second.id = '00000000-0000-4000-8000-000000000002';
    await repository.create(second);
    const health = new ProfileHealthService(
      repository,
      new ProfileApplicationService(
        repository,
        new StylePreviewRegistry(() => true),
      ),
    );

    await expect(
      health.applySettled(document, 'https://example.com/account'),
    ).rejects.toMatchObject({ code: 'profile_resolution_conflict' });
  });

  it('does not convert unexpected application failures into drift', async () => {
    const repository = new ProfileRepository(new MemoryProfileStorage());
    await repository.create(createProfile('#main'));
    const health = new ProfileHealthService(repository, {
      apply: async () => {
        throw new Error('unexpected private failure');
      },
      clear: () => false,
    } as unknown as ProfileApplicationService);

    await expect(
      health.applySettled(document, 'https://example.com/account'),
    ).rejects.toThrow('unexpected private failure');
    expect(await repository.get(createProfile('#main').id)).toMatchObject({
      enabled: true,
      revision: 1,
    });
  });
});
