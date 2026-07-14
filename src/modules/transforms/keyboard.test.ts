import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KeyboardBindingError, KeyboardBindingRegistry } from './keyboard';

const operation = (
  operationId: string,
  code: string,
  action: 'focus' | 'scroll-start' | 'scroll-center' = 'focus',
) => ({
  kind: 'keyboard',
  operationId,
  target: { kind: 'ephemeral', elementId: `element-${operationId}` },
  shortcut: {
    code,
    alt: false,
    control: true,
    meta: false,
    shift: false,
  },
  action,
});

const keydown = (
  target: Element,
  code: string,
  options: KeyboardEventInit = {},
) => {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    code,
    ctrlKey: true,
    ...options,
  });
  target.dispatchEvent(event);
  return event;
};

describe('KeyboardBindingRegistry', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('focuses exact dynamic targets and exposes inspectable bindings', () => {
    const button = document.body.appendChild(document.createElement('button'));
    const registry = new KeyboardBindingRegistry(document);
    registry.register([
      {
        operation: operation('focus-main', 'KeyM'),
        resolvedElementId: 'element-focus-main',
        resolveTarget: () => button,
      },
    ]);

    const event = keydown(document.body, 'KeyM');

    expect(document.activeElement).toBe(button);
    expect(event.defaultPrevented).toBe(true);
    expect(registry.inspect()).toEqual([
      {
        operationId: 'focus-main',
        shortcut: {
          code: 'KeyM',
          alt: false,
          control: true,
          meta: false,
          shift: false,
        },
        action: 'focus',
      },
    ]);
    registry.disable();
    button.blur();
    expect(keydown(document.body, 'KeyM').defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(button);
  });

  it('scrolls without activation and ignores editable controls', () => {
    const target = document.body.appendChild(document.createElement('section'));
    const input = document.body.appendChild(document.createElement('input'));
    const scrollIntoView = vi.fn();
    target.scrollIntoView = scrollIntoView;
    const registry = new KeyboardBindingRegistry(document);
    registry.register([
      {
        operation: operation('scroll-main', 'KeyS', 'scroll-center'),
        resolvedElementId: 'element-scroll-main',
        resolveTarget: () => target,
      },
    ]);

    expect(keydown(input, 'KeyS').defaultPrevented).toBe(false);
    expect(scrollIntoView).not.toHaveBeenCalled();
    expect(keydown(document.body, 'KeyS').defaultPrevented).toBe(true);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: 'smooth',
      block: 'center',
    });
  });

  it('rejects reserved, unmodified, conflicting, and mismatched shortcuts', () => {
    const target = document.body.appendChild(document.createElement('button'));
    const registry = new KeyboardBindingRegistry(document);
    const input = (value: unknown, id: string) => ({
      operation: value,
      resolvedElementId: `element-${id}`,
      resolveTarget: () => target,
    });

    expect(() =>
      registry.register([input(operation('reload', 'KeyR'), 'reload')]),
    ).toThrowError(
      expect.objectContaining<Partial<KeyboardBindingError>>({
        code: 'reserved_shortcut',
      }),
    );
    expect(() =>
      registry.register([
        input(
          {
            ...operation('plain', 'KeyP'),
            shortcut: {
              code: 'KeyP',
              alt: false,
              control: false,
              meta: false,
              shift: false,
            },
          },
          'plain',
        ),
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<KeyboardBindingError>>({
        code: 'modifier_required',
      }),
    );
    expect(() =>
      registry.register([
        input({ ...operation('invalid', 'KeyI'), kind: 'style' }, 'invalid'),
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<KeyboardBindingError>>({
        code: 'invalid_keyboard_operation',
      }),
    );
    expect(() =>
      registry.register([
        input(operation('one', 'KeyD'), 'one'),
        input(operation('two', 'KeyD'), 'two'),
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<KeyboardBindingError>>({
        code: 'shortcut_conflict',
      }),
    );
    expect(() =>
      registry.register([
        {
          ...input(operation('mismatch', 'KeyM'), 'mismatch'),
          resolvedElementId: 'element-other',
        },
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<KeyboardBindingError>>({
        code: 'resolved_target_mismatch',
      }),
    );
  });

  it('does nothing for missing, detached, repeated, or prehandled targets', () => {
    const target = document.body.appendChild(document.createElement('button'));
    let current: Element | null = null;
    const registry = new KeyboardBindingRegistry(document);
    registry.register([
      {
        operation: operation('dynamic', 'KeyM'),
        resolvedElementId: 'element-dynamic',
        resolveTarget: () => current,
      },
    ]);
    expect(keydown(document.body, 'KeyM').defaultPrevented).toBe(false);
    current = target;
    expect(
      keydown(document.body, 'KeyM', { repeat: true }).defaultPrevented,
    ).toBe(false);
    const handled = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'KeyM',
      ctrlKey: true,
    });
    handled.preventDefault();
    document.body.dispatchEvent(handled);
    expect(document.activeElement).not.toBe(target);
    target.remove();
    expect(keydown(document.body, 'KeyM').defaultPrevented).toBe(false);
  });
});
