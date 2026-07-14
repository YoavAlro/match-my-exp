export interface ProfileStorageAdapter {
  read(): Promise<unknown | undefined>;
  write(value: unknown): Promise<void>;
}

interface LocalStorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

const STORAGE_KEY = 'profileRepository';

export class ChromeProfileStorage implements ProfileStorageAdapter {
  readonly #storage: LocalStorageArea;

  constructor(storage: LocalStorageArea) {
    this.#storage = storage;
  }

  async read() {
    const stored = await this.#storage.get(STORAGE_KEY);
    return stored[STORAGE_KEY];
  }

  async write(value: unknown) {
    await this.#storage.set({ [STORAGE_KEY]: value });
  }
}

export class MemoryProfileStorage implements ProfileStorageAdapter {
  #value: unknown | undefined;
  #maximumBytes: number;
  #failNextWrite = false;

  constructor(value?: unknown, maximumBytes = Number.POSITIVE_INFINITY) {
    this.#value = value === undefined ? undefined : structuredClone(value);
    this.#maximumBytes = maximumBytes;
  }

  get snapshot() {
    return this.#value === undefined ? undefined : structuredClone(this.#value);
  }

  set maximumBytes(value: number) {
    this.#maximumBytes = value;
  }

  failNextWrite() {
    this.#failNextWrite = true;
  }

  async read() {
    return this.snapshot;
  }

  async write(value: unknown) {
    if (this.#failNextWrite) {
      this.#failNextWrite = false;
      throw new Error('Injected storage failure');
    }
    const bytes = new TextEncoder().encode(JSON.stringify(value)).length;
    if (bytes > this.#maximumBytes) {
      throw new Error('Storage quota exceeded');
    }
    this.#value = structuredClone(value);
  }
}
