import {
  ProfileOperationSchema,
  ProposalOperationSchema,
  type ProfileOperation,
  type ProposalOperation,
} from '../contracts';

type MoveOperation =
  | Extract<ProposalOperation, { kind: 'move' }>
  | Extract<ProfileOperation, { kind: 'move' }>;

type MoveParent = Element | ShadowRoot;
type StatePreservingParent = MoveParent & {
  moveBefore(node: Node, reference: Node | null): void;
};

export interface ResolvedMoveOperation {
  operation: unknown;
  target: Element;
  destination: Element;
  resolvedTargetId?: string;
  resolvedDestinationId?: string;
}

interface MoveJournal {
  operationId: string;
  target: Element;
  originalParent: MoveParent;
  appliedParent: MoveParent;
  source: Comment;
  start: Comment;
  end: Comment;
}

interface ActiveMovementPreview {
  signature: string;
  targets: Element[];
  journal: MoveJournal[];
}

const forbiddenTags = new Set([
  'HTML',
  'HEAD',
  'BODY',
  'SCRIPT',
  'STYLE',
  'IFRAME',
  'OBJECT',
  'EMBED',
]);

export class MovementPreviewError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'MovementPreviewError';
    this.code = code;
  }
}

const parseOperation = (input: unknown): MoveOperation => {
  const proposal = ProposalOperationSchema.safeParse(input);
  const profile = ProfileOperationSchema.safeParse(input);
  const operation = proposal.success
    ? proposal.data
    : profile.success
      ? profile.data
      : null;
  if (operation === null || operation.kind !== 'move') {
    throw new MovementPreviewError('invalid_move_operation');
  }
  return operation;
};

const supportsMoveBefore = (
  parent: MoveParent,
): parent is StatePreservingParent =>
  typeof (parent as Partial<StatePreservingParent>).moveBefore === 'function';

const moveBefore = (parent: MoveParent, node: Node, reference: Node | null) => {
  if (!supportsMoveBefore(parent)) {
    throw new MovementPreviewError('move_before_unavailable');
  }
  parent.moveBefore(node, reference);
};

const placement = (operation: MoveOperation, destination: Element) => {
  if (operation.placement === 'before' || operation.placement === 'after') {
    const parent = destination.parentNode;
    if (!(parent instanceof Element || parent instanceof ShadowRoot)) {
      throw new MovementPreviewError('invalid_destination_parent');
    }
    return {
      parent,
      reference:
        operation.placement === 'before'
          ? destination
          : destination.nextSibling,
    };
  }
  return {
    parent: destination,
    reference:
      operation.placement === 'inside-start' ? destination.firstChild : null,
  };
};

const rollback = (journal: readonly MoveJournal[]) => {
  const conflicts: string[] = [];
  for (const entry of journal.toReversed()) {
    const owned =
      entry.target.parentNode === entry.appliedParent &&
      entry.target.previousSibling === entry.start &&
      entry.target.nextSibling === entry.end &&
      entry.source.parentNode === entry.originalParent;
    if (owned) {
      moveBefore(entry.originalParent, entry.target, entry.source);
    } else {
      conflicts.push(entry.operationId);
    }
    entry.source.remove();
    entry.start.remove();
    entry.end.remove();
  }
  return conflicts;
};

export class MovementPreviewRegistry {
  readonly #previews = new Map<string, ActiveMovementPreview>();

  apply(previewId: string, inputs: readonly ResolvedMoveOperation[]) {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(previewId) || inputs.length === 0) {
      throw new MovementPreviewError('invalid_preview');
    }
    const targets = new Set<Element>();
    const compiled = inputs.map((input) => {
      const operation = parseOperation(input.operation);
      if (
        operation.target.kind === 'ephemeral' &&
        (operation.destination.kind !== 'ephemeral' ||
          operation.target.elementId !== input.resolvedTargetId ||
          operation.destination.elementId !== input.resolvedDestinationId)
      ) {
        throw new MovementPreviewError('resolved_target_mismatch');
      }
      if (
        !input.target.isConnected ||
        !input.destination.isConnected ||
        forbiddenTags.has(input.target.tagName)
      ) {
        throw new MovementPreviewError('forbidden_or_stale_target');
      }
      if (targets.has(input.target)) {
        throw new MovementPreviewError('duplicate_move_target');
      }
      targets.add(input.target);
      const root = input.target.getRootNode();
      if (
        root !== input.destination.getRootNode() ||
        !(root instanceof Document || root instanceof ShadowRoot)
      ) {
        throw new MovementPreviewError('cross_root_move');
      }
      const compiledPlacement = placement(operation, input.destination);
      if (
        input.target === input.destination ||
        input.target.contains(compiledPlacement.parent)
      ) {
        throw new MovementPreviewError('move_cycle');
      }
      if (!supportsMoveBefore(compiledPlacement.parent)) {
        throw new MovementPreviewError('move_before_unavailable');
      }
      return { ...input, operation, ...compiledPlacement };
    });
    const signature = compiled
      .map(({ operation }) => `${operation.operationId}:${operation.placement}`)
      .join('|');
    const existing = this.#previews.get(previewId);
    if (existing !== undefined) {
      if (
        existing.signature === signature &&
        existing.targets.every(
          (target, index) => target === compiled[index]?.target,
        )
      ) {
        return;
      }
      throw new MovementPreviewError('preview_id_conflict');
    }

    const journal: MoveJournal[] = [];
    try {
      for (const item of compiled) {
        const originalParent = item.target.parentNode;
        if (!(
          originalParent instanceof Element ||
          originalParent instanceof ShadowRoot
        )) {
          throw new MovementPreviewError('invalid_source_parent');
        }
        const source = new Comment(`match-my-exp:${previewId}:source`);
        const start = new Comment(`match-my-exp:${previewId}:start`);
        const end = new Comment(`match-my-exp:${previewId}:end`);
        originalParent.insertBefore(source, item.target);
        item.parent.insertBefore(start, item.reference);
        item.parent.insertBefore(end, item.reference);
        moveBefore(item.parent, item.target, end);
        journal.push({
          operationId: item.operation.operationId,
          target: item.target,
          originalParent,
          appliedParent: item.parent,
          source,
          start,
          end,
        });
      }
    } catch (error) {
      rollback(journal);
      throw error instanceof MovementPreviewError
        ? error
        : new MovementPreviewError('movement_commit_failed');
    }
    this.#previews.set(previewId, {
      signature,
      targets: compiled.map(({ target }) => target),
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
