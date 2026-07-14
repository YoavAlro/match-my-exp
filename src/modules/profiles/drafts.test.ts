import { beforeEach, describe, expect, it } from 'vitest';
import { inspectDocument } from '../inspection';
import type { ProposalOperation } from '../contracts';
import { ProfileDraftError, ProfileDraftService } from './drafts';
import { ProfileRepository } from './repository';
import { MemoryProfileStorage } from './storage';

const conversationId = '00000000-0000-4000-8000-000000000099';

const ids = () => {
  let next = 1;
  return () =>
    `00000000-0000-4000-8000-${(next++).toString().padStart(12, '0')}`;
};

const times = () => {
  let minute = 0;
  return () => `2026-07-15T12:${(minute++).toString().padStart(2, '0')}:00Z`;
};

const inspectedDraft = () => {
  document.body.innerHTML = '<main><button id="save">Save</button></main>';
  let next = 0;
  const inspection = inspectDocument(
    document,
    { origin: 'https://example.com', path: '/account', title: 'Account' },
    { createElementId: () => `element-draft-${next++}` },
  );
  const target = inspection.context.elements.find(
    ({ text }) => text === 'Save',
  );
  if (target === undefined) {
    throw new Error('Draft target is missing');
  }
  const operations: ProposalOperation[] = [
    {
      kind: 'style',
      operationId: 'style-save',
      target: { kind: 'ephemeral', elementId: target.elementId },
      declarations: [{ property: 'color', value: 'red' }],
    },
  ];
  return { inspection, operations };
};

describe('ProfileDraftService', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('prepares an inspectable durable review before saving', async () => {
    const repository = new ProfileRepository(new MemoryProfileStorage());
    const service = new ProfileDraftService(repository, ids(), times());
    const { inspection, operations } = inspectedDraft();

    const review = await service.prepare({
      name: 'Readable account',
      origin: 'https://example.com',
      pathPattern: '/account',
      intentSummary: 'Increase save button contrast.',
      conversationId,
      operations,
      inspection,
    });

    expect(review).toMatchObject({
      profile: {
        revision: 1,
        origin: 'https://example.com',
        pathPattern: '/account',
        operations: [
          {
            kind: 'style',
            target: {
              kind: 'durable',
              element: { selector: '#save' },
            },
          },
        ],
      },
      advanced: { operationCount: 1 },
      conflictingProfileIds: [],
    });
    expect(JSON.stringify(review.advanced)).not.toContain('element-draft');
    expect(JSON.stringify(review.advanced)).not.toContain('credential');

    const saved = await service.save(review);
    expect(await repository.get(saved.id)).toEqual(saved);
  });

  it('requires explicit overlap replacement and creates a revision', async () => {
    const repository = new ProfileRepository(new MemoryProfileStorage());
    const service = new ProfileDraftService(repository, ids(), times());
    const firstDraft = inspectedDraft();
    const firstReview = await service.prepare({
      name: 'First profile',
      origin: 'https://example.com',
      pathPattern: '/account/*',
      intentSummary: 'First intent.',
      conversationId,
      ...firstDraft,
    });
    const first = await service.save(firstReview);

    const secondDraft = inspectedDraft();
    const secondReview = await service.prepare({
      name: 'Replacement profile',
      origin: 'https://example.com',
      pathPattern: '/account/*',
      intentSummary: 'Replacement intent.',
      conversationId,
      ...secondDraft,
    });

    expect(secondReview.conflictingProfileIds).toEqual([first.id]);
    await expect(service.save(secondReview)).rejects.toMatchObject({
      code: 'profile_overlap_requires_resolution',
    });
    await expect(
      service.save(secondReview, '00000000-0000-4000-8000-000000000088'),
    ).rejects.toMatchObject({ code: 'replacement_does_not_resolve_conflict' });

    const replaced = await service.save(secondReview, first.id);
    expect(replaced).toMatchObject({
      id: first.id,
      revision: 2,
      name: 'Replacement profile',
    });
    expect(
      (await repository.history(first.id)).map(({ revision }) => revision),
    ).toEqual([1]);
  });

  it('rejects empty and stale drafts before persistence', async () => {
    const repository = new ProfileRepository(new MemoryProfileStorage());
    const service = new ProfileDraftService(repository, ids(), times());
    const { inspection, operations } = inspectedDraft();

    await expect(
      service.prepare({
        name: 'Empty',
        origin: 'https://example.com',
        pathPattern: '/account',
        intentSummary: 'Empty.',
        conversationId,
        operations: [],
        inspection,
      }),
    ).rejects.toBeInstanceOf(ProfileDraftError);

    document.querySelector('#save')?.remove();
    await expect(
      service.prepare({
        name: 'Stale',
        origin: 'https://example.com',
        pathPattern: '/account',
        intentSummary: 'Stale.',
        conversationId,
        operations,
        inspection,
      }),
    ).rejects.toThrow();
    expect(await repository.listByOrigin('https://example.com')).toEqual([]);
  });
});
