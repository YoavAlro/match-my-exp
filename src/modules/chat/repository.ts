import { z } from 'zod';
import type { ConversationStorageAdapter } from './storage';

const VisibleMessageSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.uuid(),
  conversationId: z.uuid(),
  role: z.enum(['user', 'assistant']),
  text: z.string().min(1).max(20_000),
  createdAt: z.iso.datetime({ offset: true }),
});

const ConversationSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    id: z.uuid(),
    title: z.string().min(1).max(120),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
    messages: z.array(VisibleMessageSchema).max(1_000),
  })
  .refine(
    ({ id, messages }) =>
      messages.every(({ conversationId }) => conversationId === id),
    'Message conversation identifiers must match their aggregate',
  )
  .refine(
    ({ messages }) =>
      new Set(messages.map(({ id }) => id)).size === messages.length,
    'Message identifiers must be unique',
  );

const ConversationStateSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    conversations: z.record(z.string(), ConversationSchema),
  })
  .refine(
    ({ conversations }) =>
      Object.entries(conversations).every(
        ([conversationId, conversation]) => conversation.id === conversationId,
      ),
    'Conversation keys must match aggregate identifiers',
  );

export type VisibleMessage = z.infer<typeof VisibleMessageSchema>;
export type Conversation = z.infer<typeof ConversationSchema>;
type ConversationState = z.infer<typeof ConversationStateSchema>;

export interface ConversationMigration {
  fromVersion: number;
  toVersion: number;
  migrate(value: unknown): unknown;
}

export class ConversationRepositoryError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'ConversationRepositoryError';
    this.code = code;
  }
}

const emptyState = (): ConversationState => ({
  schemaVersion: 1,
  conversations: {},
});

const versionOf = (value: unknown) => {
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

export class ConversationRepository {
  readonly #storage: ConversationStorageAdapter;
  readonly #migrations: Map<number, ConversationMigration>;

  constructor(
    storage: ConversationStorageAdapter,
    migrations: readonly ConversationMigration[] = [],
  ) {
    this.#storage = storage;
    this.#migrations = new Map(
      migrations.map((migration) => [migration.fromVersion, migration]),
    );
  }

  async create(input: unknown) {
    const conversation = ConversationSchema.parse(input);
    if (conversation.messages.length !== 0) {
      throw new ConversationRepositoryError('conversation_must_start_empty');
    }
    const state = await this.#readState();
    if (state.conversations[conversation.id] !== undefined) {
      throw new ConversationRepositoryError('conversation_already_exists');
    }
    const next = structuredClone(state);
    next.conversations[conversation.id] = conversation;
    await this.#writeState(next);
    return structuredClone(conversation);
  }

  async append(conversationId: string, input: unknown) {
    const message = VisibleMessageSchema.parse(input);
    const state = await this.#readState();
    const conversation = state.conversations[conversationId];
    if (
      conversation === undefined ||
      message.conversationId !== conversationId
    ) {
      throw new ConversationRepositoryError('conversation_not_found');
    }
    if (conversation.messages.some(({ id }) => id === message.id)) {
      throw new ConversationRepositoryError('message_already_exists');
    }
    if (
      new Date(message.createdAt).getTime() <
      new Date(conversation.updatedAt).getTime()
    ) {
      throw new ConversationRepositoryError('message_time_regression');
    }
    const next = structuredClone(state);
    next.conversations[conversationId] = ConversationSchema.parse({
      ...conversation,
      updatedAt: message.createdAt,
      messages: [...conversation.messages, message],
    });
    await this.#writeState(next);
    return structuredClone(message);
  }

  async get(conversationId: string) {
    const state = await this.#readState();
    const conversation = state.conversations[conversationId];
    return conversation === undefined ? null : structuredClone(conversation);
  }

  async list() {
    const state = await this.#readState();
    return Object.values(state.conversations)
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((conversation) => structuredClone(conversation));
  }

  async delete(conversationId: string) {
    const state = await this.#readState();
    if (state.conversations[conversationId] === undefined) {
      return false;
    }
    const next = structuredClone(state);
    next.conversations = Object.fromEntries(
      Object.entries(next.conversations).filter(
        ([storedId]) => storedId !== conversationId,
      ),
    );
    await this.#writeState(next);
    return true;
  }

  async deleteAll() {
    await this.#writeState(emptyState());
  }

  async #readState(): Promise<ConversationState> {
    const stored = await this.#storage.read();
    if (stored === undefined) {
      return emptyState();
    }
    const current = ConversationStateSchema.safeParse(stored);
    if (current.success) {
      return current.data;
    }
    let migrated: unknown = structuredClone(stored);
    const visited = new Set<number>();
    while (versionOf(migrated) !== 1) {
      const version = versionOf(migrated);
      if (version === null || visited.has(version)) {
        throw new ConversationRepositoryError('migration_failed');
      }
      visited.add(version);
      const migration = this.#migrations.get(version);
      if (
        migration === undefined ||
        migration.toVersion <= migration.fromVersion
      ) {
        throw new ConversationRepositoryError('migration_failed');
      }
      try {
        migrated = migration.migrate(structuredClone(migrated));
      } catch {
        throw new ConversationRepositoryError('migration_failed');
      }
    }
    const parsed = ConversationStateSchema.safeParse(migrated);
    if (!parsed.success) {
      throw new ConversationRepositoryError('migration_failed');
    }
    await this.#writeState(parsed.data);
    return parsed.data;
  }

  async #writeState(state: ConversationState) {
    const parsed = ConversationStateSchema.parse(state);
    try {
      await this.#storage.write(parsed);
    } catch {
      throw new ConversationRepositoryError('storage_write_failed');
    }
  }
}
