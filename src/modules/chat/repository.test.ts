import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import {
  ConversationRepository,
  ConversationRepositoryError,
} from './repository';
import {
  IndexedDbConversationStorage,
  MemoryConversationStorage,
} from './storage';

const conversationId = '00000000-0000-4000-8000-000000000001';
const messageId = '00000000-0000-4000-8000-000000000002';

const conversation = () => ({
  schemaVersion: 1 as const,
  id: conversationId,
  title: 'Account readability',
  createdAt: '2026-07-15T10:00:00Z',
  updatedAt: '2026-07-15T10:00:00Z',
  messages: [],
});

const message = () => ({
  schemaVersion: 1 as const,
  id: messageId,
  conversationId,
  role: 'user' as const,
  text: 'Increase the account page contrast.',
  createdAt: '2026-07-15T10:01:00Z',
});

describe('ConversationRepository', () => {
  it('handles unopened IndexedDB and empty memory storage lifecycles', async () => {
    const indexed = new IndexedDbConversationStorage();
    await indexed.close();
    await indexed.close();
    const memory = new MemoryConversationStorage();
    expect(memory.snapshot).toBeUndefined();
    expect(await memory.read()).toBeUndefined();
  });

  it('redacts IndexedDB open failures', async () => {
    const original = indexedDB;
    vi.stubGlobal('indexedDB', {
      open: () => {
        const request: Partial<IDBOpenDBRequest> = {};
        queueMicrotask(() => {
          request.onerror?.call(
            request as IDBOpenDBRequest,
            new Event('error'),
          );
        });
        return request as IDBOpenDBRequest;
      },
    });

    await expect(
      new IndexedDbConversationStorage('failing-database').read(),
    ).rejects.toThrow('IndexedDB open failed');
    vi.stubGlobal('indexedDB', original);
  });

  it('survives repository and IndexedDB restarts', async () => {
    const databaseName = `conversation-test-${crypto.randomUUID()}`;
    const firstStorage = new IndexedDbConversationStorage(databaseName);
    const first = new ConversationRepository(firstStorage);
    await first.create(conversation());
    await first.append(conversationId, message());
    await firstStorage.close();

    const secondStorage = new IndexedDbConversationStorage(databaseName);
    const second = new ConversationRepository(secondStorage);

    expect(await second.get(conversationId)).toEqual({
      ...conversation(),
      updatedAt: message().createdAt,
      messages: [message()],
    });
    await secondStorage.close();
  });

  it('retains only strict visible message fields', async () => {
    const repository = new ConversationRepository(
      new MemoryConversationStorage(),
    );
    await repository.create(conversation());

    for (const hostile of [
      { ...message(), credential: 'secret' },
      { ...message(), pageContext: { private: true } },
      { ...message(), hiddenPrompt: 'system instructions' },
      { ...message(), providerResponse: { raw: true } },
      { ...message(), role: 'system' },
    ]) {
      await expect(
        repository.append(conversationId, hostile),
      ).rejects.toThrow();
    }
    expect((await repository.get(conversationId))?.messages).toEqual([]);
  });

  it('orders, isolates, and deletes visible conversations', async () => {
    const repository = new ConversationRepository(
      new MemoryConversationStorage(),
    );
    await repository.create(conversation());
    await repository.create({
      ...conversation(),
      id: '00000000-0000-4000-8000-000000000003',
      title: 'Other site',
    });
    await repository.append(conversationId, message());

    expect((await repository.list()).map(({ id }) => id)).toEqual([
      conversationId,
      '00000000-0000-4000-8000-000000000003',
    ]);
    expect(await repository.delete(conversationId)).toBe(true);
    expect(await repository.delete(conversationId)).toBe(false);
    expect(await repository.get(conversationId)).toBeNull();
    await repository.deleteAll();
    expect(await repository.list()).toEqual([]);
  });

  it('rejects duplicates, unknown conversations, and time regressions', async () => {
    const repository = new ConversationRepository(
      new MemoryConversationStorage(),
    );
    await repository.create(conversation());
    await expect(repository.create(conversation())).rejects.toMatchObject({
      code: 'conversation_already_exists',
    });
    await repository.append(conversationId, message());
    await expect(
      repository.append(conversationId, message()),
    ).rejects.toMatchObject({ code: 'message_already_exists' });
    await expect(
      repository.append('00000000-0000-4000-8000-000000000099', message()),
    ).rejects.toMatchObject({ code: 'conversation_not_found' });
    await expect(
      repository.append(conversationId, {
        ...message(),
        id: '00000000-0000-4000-8000-000000000004',
        createdAt: '2026-07-15T09:59:00Z',
      }),
    ).rejects.toMatchObject({ code: 'message_time_regression' });
  });

  it('migrates copied state and preserves failed legacy data', async () => {
    const legacy = { schemaVersion: 0, items: {} };
    const storage = new MemoryConversationStorage(legacy);
    const repository = new ConversationRepository(storage, [
      {
        fromVersion: 0,
        toVersion: 1,
        migrate: () => ({ schemaVersion: 1, conversations: {} }),
      },
    ]);

    expect(await repository.list()).toEqual([]);
    expect(storage.snapshot).toEqual({ schemaVersion: 1, conversations: {} });

    const failedStorage = new MemoryConversationStorage(legacy);
    const failed = new ConversationRepository(failedStorage, [
      {
        fromVersion: 0,
        toVersion: 1,
        migrate: () => {
          throw new Error('private migration failure');
        },
      },
    ]);
    await expect(failed.list()).rejects.toEqual(
      expect.objectContaining<Partial<ConversationRepositoryError>>({
        code: 'migration_failed',
        message: 'migration_failed',
      }),
    );
    expect(failedStorage.snapshot).toEqual(legacy);
  });

  it('preserves previous state after quota and interrupted writes', async () => {
    const storage = new MemoryConversationStorage();
    const repository = new ConversationRepository(storage);
    await repository.create(conversation());
    const baseline = storage.snapshot;
    storage.maximumBytes = 10;

    await expect(
      repository.append(conversationId, message()),
    ).rejects.toMatchObject({ code: 'storage_write_failed' });
    expect(storage.snapshot).toEqual(baseline);

    storage.maximumBytes = Number.POSITIVE_INFINITY;
    storage.failNextWrite();
    await expect(repository.deleteAll()).rejects.toMatchObject({
      code: 'storage_write_failed',
    });
    expect(storage.snapshot).toEqual(baseline);
  });
});
