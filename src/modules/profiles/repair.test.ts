import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Profile } from '../contracts';
import { inspectDocument } from '../inspection';
import { ProfileDraftService } from './drafts';
import { ProfileRepairError, ProfileRepairService } from './repair';
import { ProfileRepository } from './repository';
import { MemoryProfileStorage } from './storage';

const profileId = '00000000-0000-4000-8000-000000000001';

const brokenProfile = (): Profile => ({
  schemaVersion: 1,
  id: profileId,
  name: 'Account profile',
  enabled: false,
  origin: 'https://example.com',
  pathPattern: '/account',
  intentSummary: 'Increase account contrast.',
  conversationId: '00000000-0000-4000-8000-000000000099',
  operations: [
    {
      kind: 'style',
      operationId: 'style-main',
      target: {
        kind: 'durable',
        shadowHosts: [],
        element: { attributes: [], selector: '#old' },
      },
      declarations: [{ property: 'color', value: 'red' }],
    },
  ],
  revision: 1,
  health: {
    state: 'needs-repair',
    diagnostics: [
      {
        code: 'missing-target',
        operationId: 'style-main',
        message: 'The old target is missing.',
      },
    ],
    detectedAt: '2026-07-15T15:00:00Z',
  },
  createdAt: '2026-07-15T14:00:00Z',
  updatedAt: '2026-07-15T15:00:00Z',
});

describe('ProfileRepairService', () => {
  beforeEach(() => {
    document.body.innerHTML = '<main><button id="new">Save</button></main>';
  });

  it('requires user initiation, discloses destination, and creates a review', async () => {
    const repository = new ProfileRepository(new MemoryProfileStorage());
    await repository.create(brokenProfile());
    const drafts = new ProfileDraftService(
      repository,
      () => '00000000-0000-4000-8000-000000000002',
      () => '2026-07-15T15:01:00Z',
    );
    const repair = new ProfileRepairService(repository, drafts);
    let next = 0;
    const inspection = inspectDocument(
      document,
      { origin: 'https://example.com', path: '/account', title: 'Account' },
      { createElementId: () => `element-repair-${next++}` },
    );
    const target = inspection.context.elements.find(
      ({ text }) => text === 'Save',
    );
    if (target === undefined) {
      throw new Error('Repair target is missing');
    }
    const propose = vi.fn().mockResolvedValue([
      {
        kind: 'style',
        operationId: 'style-main',
        target: { kind: 'ephemeral', elementId: target.elementId },
        declarations: [{ property: 'color', value: 'blue' }],
      },
    ]);

    const review = await repair.beginUserRepair(
      profileId,
      { id: 'openai', origin: 'https://api.openai.com' },
      inspection,
      propose,
    );

    const expectedProfile = brokenProfile();
    const diagnostics =
      expectedProfile.health.state === 'needs-repair'
        ? expectedProfile.health.diagnostics
        : [];
    expect(propose).toHaveBeenCalledWith({
      profileId,
      diagnostics,
      provider: { id: 'openai', origin: 'https://api.openai.com' },
    });
    expect(review.profile.operations[0]).toMatchObject({
      kind: 'style',
      target: { kind: 'durable', element: { selector: '#new' } },
    });
  });

  it('reject preserves the disabled revision and accept creates a healthy revision', async () => {
    const repository = new ProfileRepository(new MemoryProfileStorage());
    await repository.create(brokenProfile());
    const drafts = new ProfileDraftService(
      repository,
      () => '00000000-0000-4000-8000-000000000002',
      () => '2026-07-15T15:01:00Z',
    );
    const repair = new ProfileRepairService(
      repository,
      drafts,
      () => '2026-07-15T15:02:00Z',
    );
    let next = 0;
    const inspection = inspectDocument(
      document,
      { origin: 'https://example.com', path: '/account', title: 'Account' },
      { createElementId: () => `element-repair-${next++}` },
    );
    const target = inspection.context.elements.find(
      ({ text }) => text === 'Save',
    );
    if (target === undefined) {
      throw new Error('Repair target is missing');
    }
    const review = await repair.beginUserRepair(
      profileId,
      { id: 'openai', origin: 'https://api.openai.com' },
      inspection,
      async () => [
        {
          kind: 'style',
          operationId: 'style-main',
          target: { kind: 'ephemeral', elementId: target.elementId },
          declarations: [{ property: 'color', value: 'blue' }],
        },
      ],
    );

    expect(repair.reject()).toEqual({ status: 'rejected' });
    expect(await repository.get(profileId)).toEqual(brokenProfile());

    const accepted = await repair.accept(profileId, review);
    expect(accepted).toMatchObject({
      id: profileId,
      revision: 2,
      enabled: true,
      health: { state: 'healthy' },
    });
    expect(
      (await repository.history(profileId)).map(({ revision }) => revision),
    ).toEqual([1]);
  });

  it('rejects healthy or enabled profiles from repair', async () => {
    const repository = new ProfileRepository(new MemoryProfileStorage());
    const healthy = brokenProfile();
    healthy.enabled = true;
    healthy.health = { state: 'healthy' };
    await repository.create(healthy);
    const repair = new ProfileRepairService(
      repository,
      new ProfileDraftService(repository),
    );
    const inspection = inspectDocument(document, {
      origin: 'https://example.com',
      path: '/account',
      title: 'Account',
    });

    await expect(
      repair.beginUserRepair(
        profileId,
        { id: 'openai', origin: 'https://api.openai.com' },
        inspection,
        async () => [],
      ),
    ).rejects.toBeInstanceOf(ProfileRepairError);
  });
});
