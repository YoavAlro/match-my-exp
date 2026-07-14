import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AriaPreviewRegistry } from './aria';
import { KeyboardBindingRegistry } from './keyboard';
import { MixedPreviewError, MixedPreviewTransaction } from './mixed';
import { MovementPreviewRegistry } from './movement';
import { StylePreviewRegistry } from './style';

const target = (elementId: string) => ({
  kind: 'ephemeral' as const,
  elementId,
});

const setup = () => {
  document.body.innerHTML = `
    <section id="source"><button id="move">Move</button></section>
    <section id="destination"></section>
    <p id="style">Style</p>
    <section id="aria">ARIA</section>
    <button id="focus">Focus</button>`;
  const style = document.querySelector('#style') as HTMLElement;
  const move = document.querySelector('#move') as HTMLElement;
  const destination = document.querySelector('#destination') as HTMLElement;
  const aria = document.querySelector('#aria') as HTMLElement;
  const focus = document.querySelector('#focus') as HTMLElement;
  const styles = new StylePreviewRegistry(() => true);
  const moves = new MovementPreviewRegistry();
  const ariaRegistry = new AriaPreviewRegistry();
  const keyboard = new KeyboardBindingRegistry(document);
  const transaction = new MixedPreviewTransaction(
    styles,
    moves,
    ariaRegistry,
    keyboard,
  );
  return {
    style,
    move,
    destination,
    aria,
    focus,
    styles,
    keyboard,
    transaction,
  };
};

const mixedInput = (fixture: ReturnType<typeof setup>) => ({
  previewId: 'mixed-preview',
  styles: [
    {
      operation: {
        kind: 'style',
        operationId: 'style-main',
        target: target('element-style-main'),
        declarations: [{ property: 'color', value: 'red' }],
      },
      resolvedElementId: 'element-style-main',
      target: fixture.style,
    },
  ],
  moves: [
    {
      operation: {
        kind: 'move',
        operationId: 'move-main',
        target: target('element-move-main'),
        destination: target('element-move-main-destination'),
        placement: 'inside-end',
      },
      resolvedTargetId: 'element-move-main',
      resolvedDestinationId: 'element-move-main-destination',
      target: fixture.move,
      destination: fixture.destination,
    },
  ],
  aria: [
    {
      operation: {
        kind: 'aria',
        operationId: 'aria-main',
        target: target('element-aria-main'),
        attribute: 'aria-label',
        value: 'Account region',
      },
      resolvedElementId: 'element-aria-main',
      target: fixture.aria,
    },
  ],
  keyboard: [
    {
      operation: {
        kind: 'keyboard',
        operationId: 'keyboard-main',
        target: target('element-keyboard-main'),
        shortcut: {
          code: 'KeyM',
          alt: false,
          control: true,
          meta: false,
          shift: false,
        },
        action: 'focus',
      },
      resolvedElementId: 'element-keyboard-main',
      resolveTarget: () => fixture.focus,
    },
  ],
});

describe('MixedPreviewTransaction', () => {
  beforeAll(() => {
    const moveBefore = function (
      this: Element | ShadowRoot,
      node: Node,
      reference: Node | null,
    ) {
      this.insertBefore(node, reference);
    };
    Object.defineProperty(Element.prototype, 'moveBefore', {
      configurable: true,
      value: moveBefore,
    });
    Object.defineProperty(ShadowRoot.prototype, 'moveBefore', {
      configurable: true,
      value: moveBefore,
    });
  });

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('applies deterministic mixed primitives and rolls back in reverse', () => {
    const fixture = setup();
    fixture.transaction.apply(mixedInput(fixture));

    expect(fixture.styles.activeCount).toBe(1);
    expect(fixture.move.parentElement).toBe(fixture.destination);
    expect(fixture.aria.getAttribute('aria-label')).toBe('Account region');
    document.body.dispatchEvent(
      new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        code: 'KeyM',
        ctrlKey: true,
      }),
    );
    expect(document.activeElement).toBe(fixture.focus);

    expect(fixture.transaction.rollback()).toEqual([]);
    expect(fixture.styles.activeCount).toBe(0);
    expect(fixture.move.parentElement?.id).toBe('source');
    expect(fixture.aria.hasAttribute('aria-label')).toBe(false);
    expect(fixture.keyboard.inspect()).toEqual([]);
    expect(fixture.transaction.rollback()).toEqual([]);
  });

  it('compensates earlier primitives when a later primitive rejects', () => {
    const fixture = setup();
    const input = mixedInput(fixture);
    const keyboard = input.keyboard[0];
    if (keyboard === undefined) {
      throw new Error('Keyboard fixture is missing');
    }
    keyboard.operation.shortcut.code = 'KeyR';

    expect(() => fixture.transaction.apply(input)).toThrowError(
      expect.objectContaining<Partial<MixedPreviewError>>({
        code: 'mixed_preview_rejected',
      }),
    );
    expect(fixture.styles.activeCount).toBe(0);
    expect(fixture.move.parentElement?.id).toBe('source');
    expect(fixture.aria.hasAttribute('aria-label')).toBe(false);
    expect(fixture.keyboard.inspect()).toEqual([]);
  });

  it('permits only one active mixed preview', () => {
    const fixture = setup();
    expect(fixture.transaction.rollback()).toEqual([]);
    fixture.transaction.apply(mixedInput(fixture));
    expect(() => fixture.transaction.apply(mixedInput(fixture))).toThrowError(
      expect.objectContaining<Partial<MixedPreviewError>>({
        code: 'mixed_preview_already_active',
      }),
    );
    fixture.transaction.rollback();
  });

  it('supports empty primitive groups and compensates mid-transaction failure', () => {
    const fixture = setup();
    const input = mixedInput(fixture);
    input.moves = [];
    input.aria = [];
    input.keyboard = [];
    fixture.transaction.apply(input);
    expect(fixture.styles.activeCount).toBe(1);
    fixture.transaction.rollback();

    const failing = setup();
    const failingInput = mixedInput(failing);
    const aria = failingInput.aria[0];
    if (aria === undefined) {
      throw new Error('ARIA fixture is missing');
    }
    aria.operation = {
      ...aria.operation,
      attribute: 'role',
      value: 'button',
    };
    expect(() => failing.transaction.apply(failingInput)).toThrowError(
      MixedPreviewError,
    );
    expect(failing.styles.activeCount).toBe(0);
    expect(failing.move.parentElement?.id).toBe('source');
  });
});
