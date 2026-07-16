export type DynamicPageReason = 'navigation' | 'subtree' | 'shadow-root';

export interface DynamicPageCoordinatorOptions {
  document: Document;
  onSettled: (reasons: ReadonlySet<DynamicPageReason>) => void | Promise<void>;
  maximumAddedElements?: number;
}

export class DynamicPageCoordinator {
  readonly #document: Document;
  readonly #onSettled: DynamicPageCoordinatorOptions['onSettled'];
  readonly #maximumAddedElements: number;
  readonly #observers = new Map<Document | ShadowRoot, MutationObserver>();
  readonly #pending = new Set<DynamicPageReason>();
  #scheduled = false;
  #running = false;
  #route: string;

  constructor(options: DynamicPageCoordinatorOptions) {
    this.#document = options.document;
    this.#onSettled = options.onSettled;
    this.#maximumAddedElements = options.maximumAddedElements ?? 200;
    this.#route = options.document.location?.pathname ?? '/';
  }

  start() {
    if (this.#observers.size > 0) {
      return;
    }
    this.#observe(this.#document);
    this.#discoverRoots(this.#document.documentElement);
  }

  stop() {
    for (const observer of this.#observers.values()) {
      observer.disconnect();
    }
    this.#observers.clear();
    this.#pending.clear();
    this.#scheduled = false;
  }

  navigate(path: string) {
    if (path !== this.#route) {
      this.#route = path;
      this.#queue('navigation');
    }
  }

  registerShadowRoot(root: ShadowRoot) {
    if (!this.#observers.has(root)) {
      this.#observe(root);
      this.#queue('shadow-root');
    }
  }

  #observe(root: Document | ShadowRoot) {
    const observer = new MutationObserver((records) => {
      let added = 0;
      let relevant = false;
      for (const record of records) {
        for (const node of record.addedNodes) {
          if (!(node instanceof Element) || isOwned(node)) {
            continue;
          }
          added += 1;
          if (added > this.#maximumAddedElements) {
            break;
          }
          relevant = true;
          this.#discoverRoots(node);
        }
      }
      if (relevant) {
        this.#queue('subtree');
      }
    });
    observer.observe(root, { childList: true, subtree: true });
    this.#observers.set(root, observer);
  }

  #discoverRoots(root: Element | null) {
    if (root === null) {
      return;
    }
    const candidates = [root];
    for (
      let index = 0;
      index < candidates.length && index < this.#maximumAddedElements;
      index += 1
    ) {
      const element = candidates[index] as Element;
      if (
        element.shadowRoot !== null &&
        !this.#observers.has(element.shadowRoot)
      ) {
        this.#observe(element.shadowRoot);
        this.#pending.add('shadow-root');
      }
      for (const child of element.children) {
        if (candidates.length >= this.#maximumAddedElements) {
          break;
        }
        candidates.push(child);
      }
      for (const child of element.shadowRoot?.children ?? []) {
        if (candidates.length >= this.#maximumAddedElements) {
          break;
        }
        candidates.push(child);
      }
    }
  }

  #queue(reason: DynamicPageReason) {
    this.#pending.add(reason);
    if (this.#scheduled) {
      return;
    }
    this.#scheduled = true;
    queueMicrotask(() => void this.#flush());
  }

  async #flush() {
    if (this.#running) {
      this.#scheduled = false;
      this.#queue('subtree');
      return;
    }
    this.#scheduled = false;
    if (this.#pending.size === 0) {
      return;
    }
    const reasons = new Set(this.#pending);
    this.#pending.clear();
    this.#running = true;
    try {
      await this.#onSettled(reasons);
    } finally {
      this.#running = false;
      if (this.#pending.size > 0) {
        this.#queue('subtree');
      }
    }
  }
}

const isOwned = (element: Element) =>
  element.hasAttribute('data-match-my-exp-owned') ||
  element.hasAttribute('data-match-my-exp-style');
