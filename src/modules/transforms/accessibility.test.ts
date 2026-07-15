import axe from 'axe-core';
import { computeAccessibleName, getRole } from 'dom-accessibility-api';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { AriaPreviewRegistry } from './aria';
import { KeyboardBindingRegistry } from './keyboard';
import { MixedPreviewTransaction } from './mixed';
import { MovementPreviewRegistry } from './movement';
import { StylePreviewRegistry } from './style';

const target = (elementId: string) => ({
  kind: 'ephemeral' as const,
  elementId,
});

describe('representative accessibility workflow', () => {
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
    document.body.innerHTML = `
      <header><h1>Account</h1></header>
      <nav aria-label="Primary"><a href="#details">Details</a></nav>
      <main>
        <p id="live" role="status" aria-live="polite">Account saved</p>
        <section id="actions" aria-label="Account actions">
          <button id="primary">Primary action</button>
        </section>
        <section id="source">
          <button id="secondary">Secondary action</button>
        </section>
        <section id="details">Details content</section>
        <button id="shortcut">Shortcut target</button>
      </main>`;
  });

  it('preserves semantics and restores every rich operation', async () => {
    const actions = document.querySelector('#actions') as HTMLElement;
    const secondary = document.querySelector('#secondary') as HTMLElement;
    const details = document.querySelector('#details') as HTMLElement;
    const shortcut = document.querySelector('#shortcut') as HTMLElement;
    const live = document.querySelector('#live') as HTMLElement;
    const keyboard = new KeyboardBindingRegistry(document);
    const transaction = new MixedPreviewTransaction(
      new StylePreviewRegistry(() => true),
      new MovementPreviewRegistry(),
      new AriaPreviewRegistry(),
      keyboard,
    );

    transaction.apply({
      previewId: 'accessibility-preview',
      styles: [],
      moves: [
        {
          operation: {
            kind: 'move',
            operationId: 'move-secondary',
            target: target('element-secondary'),
            destination: target('element-actions'),
            placement: 'inside-start',
          },
          resolvedTargetId: 'element-secondary',
          resolvedDestinationId: 'element-actions',
          target: secondary,
          destination: actions,
        },
      ],
      aria: [
        {
          operation: {
            kind: 'aria',
            operationId: 'label-details',
            target: target('element-details'),
            attribute: 'aria-label',
            value: 'Account details',
          },
          resolvedElementId: 'element-details',
          target: details,
        },
        {
          operation: {
            kind: 'aria',
            operationId: 'role-details',
            target: target('element-details'),
            attribute: 'role',
            value: 'region',
          },
          resolvedElementId: 'element-details',
          target: details,
        },
      ],
      keyboard: [
        {
          operation: {
            kind: 'keyboard',
            operationId: 'focus-shortcut',
            target: target('element-shortcut'),
            shortcut: {
              code: 'KeyM',
              alt: false,
              control: true,
              meta: false,
              shift: false,
            },
            action: 'focus',
          },
          resolvedElementId: 'element-shortcut',
          resolveTarget: () => shortcut,
        },
      ],
    });

    expect(
      [...document.querySelectorAll('button')].map(({ id }) => id),
    ).toEqual(['secondary', 'primary', 'shortcut']);
    expect(computeAccessibleName(details)).toBe('Account details');
    expect(getRole(details)).toBe('region');
    expect(getRole(document.querySelector('header') as Element)).toBe('banner');
    expect(getRole(document.querySelector('nav') as Element)).toBe(
      'navigation',
    );
    expect(getRole(document.querySelector('main') as Element)).toBe('main');
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe('Account saved');
    const shortcutEvent = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'KeyM',
      ctrlKey: true,
    });
    document.body.dispatchEvent(shortcutEvent);
    expect(shortcutEvent.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(shortcut);
    expect(
      (
        await axe.run(document.body, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);

    expect(transaction.rollback()).toEqual([]);
    expect(
      [...document.querySelectorAll('button')].map(({ id }) => id),
    ).toEqual(['primary', 'secondary', 'shortcut']);
    expect(details.hasAttribute('aria-label')).toBe(false);
    expect(details.hasAttribute('role')).toBe(false);
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(live.textContent).toBe('Account saved');
    shortcut.blur();
    const rolledBackShortcut = new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      code: 'KeyM',
      ctrlKey: true,
    });
    document.body.dispatchEvent(rolledBackShortcut);
    expect(rolledBackShortcut.defaultPrevented).toBe(false);
    expect(document.activeElement).not.toBe(shortcut);
  });
});
