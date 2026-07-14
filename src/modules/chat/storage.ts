export interface ConversationStorageAdapter {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

const STORE_NAME = 'conversation-state';
const STATE_KEY = 'current';

export class IndexedDbConversationStorage implements ConversationStorageAdapter {
  readonly #databaseName: string;
  #database: Promise<IDBDatabase> | null = null;

  constructor(databaseName = 'match-my-exp-conversations') {
    this.#databaseName = databaseName;
  }

  async read() {
    const database = await this.#open();
    return new Promise<unknown | undefined>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readonly');
      const request = transaction.objectStore(STORE_NAME).get(STATE_KEY);
      request.onsuccess = () => resolve(request.result as unknown | undefined);
      request.onerror = () =>
        reject(request.error ?? new Error('IndexedDB read failed'));
    });
  }

  async write(value: unknown) {
    const database = await this.#open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE_NAME, 'readwrite');
      transaction
        .objectStore(STORE_NAME)
        .put(structuredClone(value), STATE_KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(transaction.error ?? new Error('IndexedDB write failed'));
      transaction.onabort = () =>
        reject(transaction.error ?? new Error('IndexedDB write aborted'));
    });
  }

  async close() {
    if (this.#database !== null) {
      (await this.#database).close();
      this.#database = null;
    }
  }

  #open() {
    this.#database ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.#databaseName, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(request.error ?? new Error('IndexedDB open failed'));
    });
    return this.#database;
  }
}

export class MemoryConversationStorage implements ConversationStorageAdapter {
  #value: unknown | undefined;
  #maximumBytes = Number.POSITIVE_INFINITY;
  #failWrite = false;

  constructor(value?: unknown) {
    this.#value = value === undefined ? undefined : structuredClone(value);
  }

  get snapshot() {
    return this.#value === undefined ? undefined : structuredClone(this.#value);
  }

  set maximumBytes(value: number) {
    this.#maximumBytes = value;
  }

  failNextWrite() {
    this.#failWrite = true;
  }

  async read() {
    return this.snapshot;
  }

  async write(value: unknown) {
    if (this.#failWrite) {
      this.#failWrite = false;
      throw new Error('Injected conversation write failure');
    }
    const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
    if (bytes > this.#maximumBytes) {
      throw new Error('Conversation quota exceeded');
    }
    this.#value = structuredClone(value);
  }
}
