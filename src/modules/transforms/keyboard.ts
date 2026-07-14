import {
  ProfileOperationSchema,
  ProposalOperationSchema,
  type ProfileOperation,
  type ProposalOperation,
} from '../contracts';

type KeyboardOperation =
  | Extract<ProposalOperation, { kind: 'keyboard' }>
  | Extract<ProfileOperation, { kind: 'keyboard' }>;

export interface KeyboardBindingInput {
  operation: unknown;
  resolveTarget: () => Element | null;
  resolvedElementId?: string;
}

export interface InspectableShortcut {
  operationId: string;
  shortcut: KeyboardOperation['shortcut'];
  action: KeyboardOperation['action'];
}

export class KeyboardBindingError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'KeyboardBindingError';
    this.code = code;
  }
}

interface ActiveBinding {
  operation: KeyboardOperation;
  resolveTarget: () => Element | null;
}

const parseOperation = (input: unknown): KeyboardOperation => {
  const proposal = ProposalOperationSchema.safeParse(input);
  const profile = ProfileOperationSchema.safeParse(input);
  const operation = proposal.success
    ? proposal.data
    : profile.success
      ? profile.data
      : null;
  if (operation === null || operation.kind !== 'keyboard') {
    throw new KeyboardBindingError('invalid_keyboard_operation');
  }
  return operation;
};

const shortcutKey = (shortcut: KeyboardOperation['shortcut']) =>
  `${shortcut.code}:${Number(shortcut.alt)}:${Number(shortcut.control)}:${Number(shortcut.meta)}:${Number(shortcut.shift)}`;

const reserved = new Set([
  'KeyL:0:1:0:0',
  'KeyL:0:0:1:0',
  'KeyN:0:1:0:0',
  'KeyN:0:0:1:0',
  'KeyR:0:1:0:0',
  'KeyR:0:0:1:0',
  'KeyT:0:1:0:0',
  'KeyT:0:0:1:0',
  'KeyW:0:1:0:0',
  'KeyW:0:0:1:0',
  'KeyT:0:1:0:1',
  'KeyT:0:0:1:1',
  'ArrowLeft:1:0:0:0',
  'ArrowRight:1:0:0:0',
]);

const matches = (
  event: KeyboardEvent,
  shortcut: KeyboardOperation['shortcut'],
) =>
  event.code === shortcut.code &&
  event.altKey === shortcut.alt &&
  event.ctrlKey === shortcut.control &&
  event.metaKey === shortcut.meta &&
  event.shiftKey === shortcut.shift;

const editable = (target: EventTarget | null) =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement ||
  (target instanceof HTMLElement && target.isContentEditable);

export class KeyboardBindingRegistry {
  readonly #document: Document;
  readonly #bindings = new Map<string, ActiveBinding>();
  #listening = false;

  constructor(document: Document) {
    this.#document = document;
  }

  register(inputs: readonly KeyboardBindingInput[]) {
    const next = new Map<string, ActiveBinding>();
    const shortcuts = new Set<string>();
    for (const input of inputs) {
      const operation = parseOperation(input.operation);
      if (
        operation.target.kind === 'ephemeral' &&
        operation.target.elementId !== input.resolvedElementId
      ) {
        throw new KeyboardBindingError('resolved_target_mismatch');
      }
      if (
        !operation.shortcut.alt &&
        !operation.shortcut.control &&
        !operation.shortcut.meta
      ) {
        throw new KeyboardBindingError('modifier_required');
      }
      const key = shortcutKey(operation.shortcut);
      if (reserved.has(key)) {
        throw new KeyboardBindingError('reserved_shortcut');
      }
      if (shortcuts.has(key)) {
        throw new KeyboardBindingError('shortcut_conflict');
      }
      shortcuts.add(key);
      next.set(operation.operationId, {
        operation,
        resolveTarget: input.resolveTarget,
      });
    }
    this.disable();
    for (const [operationId, binding] of next) {
      this.#bindings.set(operationId, binding);
    }
    if (this.#bindings.size > 0) {
      this.#document.addEventListener('keydown', this.#onKeydown, true);
      this.#listening = true;
    }
  }

  inspect(): InspectableShortcut[] {
    return [...this.#bindings.values()].map(({ operation }) => ({
      operationId: operation.operationId,
      shortcut: structuredClone(operation.shortcut),
      action: operation.action,
    }));
  }

  disable() {
    if (this.#listening) {
      this.#document.removeEventListener('keydown', this.#onKeydown, true);
      this.#listening = false;
    }
    this.#bindings.clear();
  }

  readonly #onKeydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat || editable(event.target)) {
      return;
    }
    for (const { operation, resolveTarget } of this.#bindings.values()) {
      if (!matches(event, operation.shortcut)) {
        continue;
      }
      const target = resolveTarget();
      if (target === null || !target.isConnected) {
        return;
      }
      if (operation.action === 'focus') {
        if (target instanceof HTMLElement || target instanceof SVGElement) {
          target.focus({ preventScroll: true });
        }
      } else {
        target.scrollIntoView({
          behavior: 'smooth',
          block: operation.action === 'scroll-start' ? 'start' : 'center',
        });
      }
      event.preventDefault();
      return;
    }
  };
}
