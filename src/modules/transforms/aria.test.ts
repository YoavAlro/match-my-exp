import axe from 'axe-core';
import { beforeEach, describe, expect, it } from 'vitest';
import { AriaPreviewError, AriaPreviewRegistry } from './aria';

const target = (elementId: string) => ({
  kind: 'ephemeral' as const,
  elementId,
});

const operation = (
  operationId: string,
  attribute: string,
  value: string | null,
) => ({
  kind: 'aria',
  operationId,
  target: target(`element-${operationId}`),
  attribute,
  value,
});

const resolved = (
  element: Element,
  operationId: string,
  attribute: string,
  value: string | null,
) => ({
  target: element,
  resolvedElementId: `element-${operationId}`,
  operation: operation(operationId, attribute, value),
});

describe('AriaPreviewRegistry', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('applies and exactly rolls back conservative attributes', async () => {
    document.body.innerHTML =
      '<main><section id="region">Content</section></main>';
    const region = document.querySelector('#region') as HTMLElement;
    const registry = new AriaPreviewRegistry();

    registry.apply('preview-aria', [
      resolved(region, 'label', 'aria-label', 'Account region'),
      resolved(region, 'role', 'role', 'region'),
    ]);

    expect(region.getAttribute('aria-label')).toBe('Account region');
    expect(region.getAttribute('role')).toBe('region');
    expect(
      (
        await axe.run(document.body, {
          rules: { 'color-contrast': { enabled: false } },
        })
      ).violations,
    ).toEqual([]);
    expect(registry.rollback('preview-aria')).toEqual([]);
    expect(region.hasAttribute('aria-label')).toBe(false);
    expect(region.hasAttribute('role')).toBe(false);
    expect(registry.rollback('preview-aria')).toEqual([]);
  });

  it('preserves page-authored conflicts during rollback', () => {
    const region = document.body.appendChild(document.createElement('section'));
    region.setAttribute('aria-label', 'Original');
    const registry = new AriaPreviewRegistry();
    registry.apply('preview-conflict', [
      resolved(region, 'label', 'aria-label', 'Preview'),
    ]);
    region.setAttribute('aria-label', 'Page override');

    expect(registry.rollback('preview-conflict')).toEqual(['label']);
    expect(region.getAttribute('aria-label')).toBe('Page override');
  });

  it('rejects hiding focused content and unsafe role implications', () => {
    document.body.innerHTML =
      '<section id="region"><button>Focused</button></section>';
    const region = document.querySelector('#region') as HTMLElement;
    const button = document.querySelector('button') as HTMLButtonElement;
    button.focus();
    const registry = new AriaPreviewRegistry();

    expect(() =>
      registry.apply('preview-hidden', [
        resolved(region, 'hidden', 'aria-hidden', 'true'),
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<AriaPreviewError>>({
        code: 'cannot_hide_focused_content',
      }),
    );
    expect(() =>
      registry.apply('preview-role', [
        resolved(button, 'role', 'role', 'presentation'),
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<AriaPreviewError>>({
        code: 'presentation_role_on_interactive_target',
      }),
    );
    expect(() =>
      registry.apply('preview-button-role', [
        resolved(region, 'button-role', 'role', 'button'),
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<AriaPreviewError>>({
        code: 'role_not_allowed',
      }),
    );
  });

  it('requires ARIA references in the same root', () => {
    document.body.innerHTML =
      '<p id="description">Description</p><button>Save</button>';
    const button = document.querySelector('button') as HTMLButtonElement;
    const registry = new AriaPreviewRegistry();

    registry.apply('preview-reference', [
      resolved(button, 'describe', 'aria-describedby', 'description'),
    ]);
    expect(button.getAttribute('aria-describedby')).toBe('description');
    registry.rollback('preview-reference');
    expect(() =>
      registry.apply('preview-missing', [
        resolved(button, 'missing', 'aria-labelledby', 'unknown-id'),
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<AriaPreviewError>>({
        code: 'aria_reference_missing',
      }),
    );
  });

  it('rejects duplicate writes, mismatched targets, and preview reuse', () => {
    const region = document.body.appendChild(document.createElement('section'));
    const registry = new AriaPreviewRegistry();
    expect(() =>
      registry.apply('preview-duplicate', [
        resolved(region, 'one', 'aria-label', 'One'),
        resolved(region, 'two', 'aria-label', 'Two'),
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<AriaPreviewError>>({
        code: 'duplicate_aria_write',
      }),
    );
    expect(() =>
      registry.apply('preview-mismatch', [
        {
          ...resolved(region, 'mismatch', 'aria-label', 'Label'),
          resolvedElementId: 'element-other',
        },
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<AriaPreviewError>>({
        code: 'resolved_target_mismatch',
      }),
    );
    registry.apply('preview-same', [
      resolved(region, 'same', 'aria-label', 'Same'),
    ]);
    registry.apply('preview-same', [
      resolved(region, 'same', 'aria-label', 'Same'),
    ]);
    expect(() =>
      registry.apply('preview-same', [
        resolved(region, 'different', 'aria-label', 'Different'),
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<AriaPreviewError>>({
        code: 'preview_id_conflict',
      }),
    );
  });

  it('supports durable null-removal and rejects invalid preview state', () => {
    const region = document.body.appendChild(document.createElement('section'));
    region.setAttribute('aria-label', 'Original');
    const durableOperation = {
      kind: 'aria',
      operationId: 'durable-label',
      target: {
        kind: 'durable',
        shadowHosts: [],
        element: { attributes: [], selector: '#region' },
      },
      attribute: 'aria-label',
      value: null,
    };
    region.id = 'region';
    const registry = new AriaPreviewRegistry();

    registry.apply('preview-durable', [
      { operation: durableOperation, target: region },
    ]);
    expect(region.hasAttribute('aria-label')).toBe(false);
    expect(registry.rollback('preview-durable')).toEqual([]);
    expect(region.getAttribute('aria-label')).toBe('Original');

    expect(() => registry.apply('invalid id', [])).toThrowError(
      expect.objectContaining<Partial<AriaPreviewError>>({
        code: 'invalid_preview',
      }),
    );
    region.remove();
    expect(() =>
      registry.apply('preview-disconnected', [
        {
          operation: {
            ...operation('disconnected', 'aria-label', 'Label'),
          },
          target: region,
          resolvedElementId: 'element-disconnected',
        },
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<AriaPreviewError>>({
        code: 'disconnected_target',
      }),
    );
  });
});
