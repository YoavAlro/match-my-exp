import { AriaPreviewRegistry, type ResolvedAriaOperation } from './aria';
import { KeyboardBindingRegistry, type KeyboardBindingInput } from './keyboard';
import {
  MovementPreviewRegistry,
  type ResolvedMoveOperation,
} from './movement';
import { StylePreviewRegistry, type ResolvedStyleOperation } from './style';

export interface MixedPreviewInput {
  previewId: string;
  styles: ResolvedStyleOperation[];
  moves: ResolvedMoveOperation[];
  aria: ResolvedAriaOperation[];
  keyboard: KeyboardBindingInput[];
}

export class MixedPreviewError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'MixedPreviewError';
    this.code = code;
  }
}

export class MixedPreviewTransaction {
  readonly #styles: StylePreviewRegistry;
  readonly #moves: MovementPreviewRegistry;
  readonly #aria: AriaPreviewRegistry;
  readonly #keyboard: KeyboardBindingRegistry;
  #activePreviewId: string | null = null;

  constructor(
    styles: StylePreviewRegistry,
    moves: MovementPreviewRegistry,
    aria: AriaPreviewRegistry,
    keyboard: KeyboardBindingRegistry,
  ) {
    this.#styles = styles;
    this.#moves = moves;
    this.#aria = aria;
    this.#keyboard = keyboard;
  }

  apply(input: MixedPreviewInput) {
    if (this.#activePreviewId !== null) {
      throw new MixedPreviewError('mixed_preview_already_active');
    }
    const applied: ('styles' | 'moves' | 'aria' | 'keyboard')[] = [];
    try {
      if (input.styles.length > 0) {
        this.#styles.apply(input.previewId, input.styles);
        applied.push('styles');
      }
      if (input.moves.length > 0) {
        this.#moves.apply(input.previewId, input.moves);
        applied.push('moves');
      }
      if (input.aria.length > 0) {
        this.#aria.apply(input.previewId, input.aria);
        applied.push('aria');
      }
      if (input.keyboard.length > 0) {
        this.#keyboard.register(input.keyboard);
        applied.push('keyboard');
      }
    } catch {
      this.#rollbackApplied(input.previewId, applied);
      throw new MixedPreviewError('mixed_preview_rejected');
    }
    this.#activePreviewId = input.previewId;
  }

  rollback() {
    if (this.#activePreviewId === null) {
      return [];
    }
    const previewId = this.#activePreviewId;
    this.#activePreviewId = null;
    this.#keyboard.disable();
    const conflicts = [
      ...this.#aria.rollback(previewId).map((id) => `aria:${id}`),
      ...this.#moves.rollback(previewId).map((id) => `move:${id}`),
    ];
    this.#styles.rollback(previewId);
    return conflicts;
  }

  #rollbackApplied(
    previewId: string,
    applied: ('styles' | 'moves' | 'aria' | 'keyboard')[],
  ) {
    for (const kind of applied.toReversed()) {
      if (kind === 'keyboard') {
        this.#keyboard.disable();
      } else if (kind === 'aria') {
        this.#aria.rollback(previewId);
      } else if (kind === 'moves') {
        this.#moves.rollback(previewId);
      } else {
        this.#styles.rollback(previewId);
      }
    }
  }
}
