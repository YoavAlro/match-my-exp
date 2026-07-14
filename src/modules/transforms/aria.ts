import {
  ProfileOperationSchema,
  ProposalOperationSchema,
  type ProfileOperation,
  type ProposalOperation,
} from '../contracts';

type AriaOperation =
  | Extract<ProposalOperation, { kind: 'aria' }>
  | Extract<ProfileOperation, { kind: 'aria' }>;

export interface ResolvedAriaOperation {
  operation: unknown;
  target: Element;
  resolvedElementId?: string;
}

interface AttributeState {
  present: boolean;
  value: string | null;
}

interface JournalEntry {
  operationId: string;
  target: Element;
  attribute: string;
  before: AttributeState;
  applied: AttributeState;
}

interface ActiveAriaPreview {
  signature: string;
  targets: Element[];
  journal: JournalEntry[];
}

const allowedRoles = new Set([
  'banner',
  'complementary',
  'contentinfo',
  'main',
  'navigation',
  'none',
  'note',
  'presentation',
  'region',
  'status',
]);

const state = (target: Element, attribute: string): AttributeState => ({
  present: target.hasAttribute(attribute),
  value: target.getAttribute(attribute),
});

const sameState = (left: AttributeState, right: AttributeState) =>
  left.present === right.present && left.value === right.value;

const parseOperation = (input: unknown): AriaOperation => {
  const proposal = ProposalOperationSchema.safeParse(input);
  const profile = ProfileOperationSchema.safeParse(input);
  const operation = proposal.success
    ? proposal.data
    : profile.success
      ? profile.data
      : null;
  if (operation === null || operation.kind !== 'aria') {
    throw new AriaPreviewError('invalid_aria_operation');
  }
  return operation;
};

const validatePolicy = (operation: AriaOperation, target: Element) => {
  if (!target.isConnected) {
    throw new AriaPreviewError('disconnected_target');
  }
  if (
    target.ownerDocument.activeElement !== null &&
    operation.attribute === 'aria-hidden' &&
    operation.value === 'true' &&
    target.contains(target.ownerDocument.activeElement)
  ) {
    throw new AriaPreviewError('cannot_hide_focused_content');
  }
  if (operation.attribute === 'role' && operation.value !== null) {
    if (!allowedRoles.has(operation.value)) {
      throw new AriaPreviewError('role_not_allowed');
    }
    if (
      (operation.value === 'none' || operation.value === 'presentation') &&
      target.matches('a[href],button,input,select,textarea,[tabindex]')
    ) {
      throw new AriaPreviewError('presentation_role_on_interactive_target');
    }
  }
  if (
    (operation.attribute === 'aria-labelledby' ||
      operation.attribute === 'aria-describedby') &&
    operation.value !== null
  ) {
    const root = target.getRootNode();
    const ids = operation.value.split(/\s+/).filter(Boolean);
    if (
      ids.length === 0 ||
      !(root instanceof Document || root instanceof ShadowRoot) ||
      ids.some((id) =>
        root instanceof Document
          ? root.getElementById(id) === null
          : ![...root.querySelectorAll('[id]')].some(
              (element) => element.id === id,
            ),
      )
    ) {
      throw new AriaPreviewError('aria_reference_missing');
    }
  }
};

export class AriaPreviewError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'AriaPreviewError';
    this.code = code;
  }
}

export class AriaPreviewRegistry {
  readonly #previews = new Map<string, ActiveAriaPreview>();

  apply(previewId: string, inputs: readonly ResolvedAriaOperation[]) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(previewId) || inputs.length === 0) {
      throw new AriaPreviewError('invalid_preview');
    }
    const operations = inputs.map((input) => {
      const operation = parseOperation(input.operation);
      if (
        operation.target.kind === 'ephemeral' &&
        operation.target.elementId !== input.resolvedElementId
      ) {
        throw new AriaPreviewError('resolved_target_mismatch');
      }
      validatePolicy(operation, input.target);
      return { operation, target: input.target };
    });
    const cells = new Map<Element, Set<string>>();
    for (const { operation, target } of operations) {
      const attributes = cells.get(target) ?? new Set<string>();
      if (attributes.has(operation.attribute)) {
        throw new AriaPreviewError('duplicate_aria_write');
      }
      attributes.add(operation.attribute);
      cells.set(target, attributes);
    }
    const signature = operations
      .map(
        ({ operation }) =>
          `${operation.operationId}:${operation.attribute}:${operation.value ?? 'null'}`,
      )
      .join('|');
    const existing = this.#previews.get(previewId);
    if (existing !== undefined) {
      if (
        existing.signature === signature &&
        existing.targets.every(
          (target, index) => target === operations[index]?.target,
        )
      ) {
        return;
      }
      throw new AriaPreviewError('preview_id_conflict');
    }

    const journal: JournalEntry[] = [];
    try {
      for (const { operation, target } of operations) {
        const before = state(target, operation.attribute);
        if (operation.value === null) {
          target.removeAttribute(operation.attribute);
        } else {
          target.setAttribute(operation.attribute, operation.value);
        }
        journal.push({
          operationId: operation.operationId,
          target,
          attribute: operation.attribute,
          before,
          applied: state(target, operation.attribute),
        });
      }
    } catch {
      rollback(journal);
      throw new AriaPreviewError('aria_commit_failed');
    }
    this.#previews.set(previewId, {
      signature,
      targets: operations.map(({ target }) => target),
      journal,
    });
  }

  rollback(previewId: string) {
    const preview = this.#previews.get(previewId);
    if (preview === undefined) {
      return [];
    }
    this.#previews.delete(previewId);
    return rollback(preview.journal);
  }
}

const rollback = (journal: readonly JournalEntry[]) => {
  const conflicts: string[] = [];
  for (const entry of journal.toReversed()) {
    if (!sameState(state(entry.target, entry.attribute), entry.applied)) {
      conflicts.push(entry.operationId);
      continue;
    }
    if (entry.before.present) {
      entry.target.setAttribute(entry.attribute, entry.before.value ?? '');
    } else {
      entry.target.removeAttribute(entry.attribute);
    }
  }
  return conflicts;
};
