import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  StylePreviewError,
  StylePreviewRegistry,
  type ResolvedStyleOperation,
} from './style';

const operation = (
  operationId: string,
  property = 'color',
  value = 'rgb(200, 10, 20)',
) => ({
  kind: 'style',
  operationId,
  target: { kind: 'ephemeral', elementId: `element-${operationId}` },
  declarations: [{ property, value }],
});

const resolved = (
  target: Element,
  operationId: string,
  property?: string,
  value?: string,
): ResolvedStyleOperation => ({
  target,
  operation: operation(operationId, property, value),
  resolvedElementId: `element-${operationId}`,
});

describe('StylePreviewRegistry', () => {
  it('isolates ownership tokens across registries', () => {
    document.body.innerHTML = '<button id="save">Save</button>';
    const target = document.querySelector('#save');
    if (target === null) {
      throw new Error('Fixture target is missing');
    }
    const operation = {
      kind: 'style' as const,
      operationId: 'style-save',
      target: { kind: 'ephemeral' as const, elementId: 'element-save' },
      declarations: [{ property: 'color' as const, value: 'red' }],
    };
    const preview = new StylePreviewRegistry(() => true);
    const durable = new StylePreviewRegistry(() => true);
    preview.apply('preview-one', [
      { operation, resolvedElementId: 'element-save', target },
    ]);
    durable.apply('profile-one', [
      { operation, resolvedElementId: 'element-save', target },
    ]);

    preview.rollback('preview-one');

    expect(target.getAttribute('data-match-my-exp-style')).toMatch(
      /^mme-[0-9]+-[0-9]+-style-save$/,
    );
    expect(durable.activeCount).toBe(1);
  });

  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('scopes rules to exact targets and rolls back owned state', () => {
    document.body.innerHTML = `
      <div id="first" style="padding: 2px" data-match-my-exp-style="page-token"></div>
      <div id="second"></div>
      <div id="unrelated"></div>`;
    const first = document.querySelector('#first') as HTMLElement;
    const second = document.querySelector('#second') as HTMLElement;
    const registry = new StylePreviewRegistry(() => true);

    expect(
      registry.apply('preview-one', [
        resolved(first, 'first-color'),
        resolved(second, 'second-size', 'font-size', '20px'),
      ]),
    ).toEqual({ previewId: 'preview-one', operationCount: 2 });

    const style = document.querySelector(
      'style[data-match-my-exp-owned="style-preview"]',
    );
    expect(style?.textContent).toContain('color: rgb(200, 10, 20) !important');
    expect(style?.textContent).toContain('font-size: 20px !important');
    expect(first.getAttribute('data-match-my-exp-style')).toContain(
      'page-token',
    );
    expect(second.hasAttribute('data-match-my-exp-style')).toBe(true);
    expect(
      document
        .querySelector('#unrelated')
        ?.hasAttribute('data-match-my-exp-style'),
    ).toBe(false);

    expect(registry.rollback('preview-one')).toBe(true);
    expect(registry.rollback('preview-one')).toBe(false);
    expect(first.getAttribute('style')).toBe('padding: 2px');
    expect(first.getAttribute('data-match-my-exp-style')).toBe('page-token');
    expect(second.hasAttribute('data-match-my-exp-style')).toBe(false);
    expect(document.querySelector('style[data-match-my-exp-owned]')).toBeNull();
  });

  it('is idempotent and rejects preview ID reuse for different content', () => {
    const first = document.body.appendChild(document.createElement('div'));
    const second = document.body.appendChild(document.createElement('div'));
    const registry = new StylePreviewRegistry(() => true);
    const input = [resolved(first, 'target-color')];

    registry.apply('preview-idempotent', input);
    registry.apply('preview-idempotent', input);

    expect(registry.activeCount).toBe(1);
    expect(
      document.querySelectorAll('style[data-match-my-exp-owned]'),
    ).toHaveLength(1);
    expect(() =>
      registry.apply('preview-idempotent', [resolved(second, 'target-color')]),
    ).toThrowError(
      expect.objectContaining<Partial<StylePreviewError>>({
        code: 'preview_id_conflict',
      }),
    );
  });

  it('validates replacement before removing an active preview', () => {
    const target = document.body.appendChild(document.createElement('div'));
    const registry = new StylePreviewRegistry(
      (_property, value) => value !== 'unsupported-value',
    );
    registry.apply('preview-replace', [resolved(target, 'original')]);
    const originalToken = target.getAttribute('data-match-my-exp-style');

    expect(() =>
      registry.replace('preview-replace', [
        resolved(target, 'invalid', 'color', 'unsupported-value'),
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<StylePreviewError>>({
        code: 'unsupported_css_value',
      }),
    );
    expect(target.getAttribute('data-match-my-exp-style')).toBe(originalToken);

    registry.replace('preview-replace', [
      resolved(target, 'replacement', 'color', 'blue'),
    ]);
    expect(target.getAttribute('data-match-my-exp-style')).not.toBe(
      originalToken,
    );
    expect(
      document.querySelectorAll('style[data-match-my-exp-owned]'),
    ).toHaveLength(1);
    expect(document.querySelector('style')?.textContent).toContain(
      'color: blue !important',
    );
  });

  it('rejects hostile and unsupported declarations before mutation', () => {
    const target = document.body.appendChild(document.createElement('div'));
    const registry = new StylePreviewRegistry(() => true);
    const hostile = [
      operation('url', 'color', 'url(https://attacker.example/pixel)'),
      operation('script', 'color', 'expression(alert(1))'),
      operation('generated', 'content', '"injected"'),
      operation('priority', 'color', 'red !important'),
      { ...operation('unknown'), javascript: 'alert(1)' },
    ];

    for (const candidate of hostile) {
      expect(() =>
        registry.apply(`preview-${candidate.operationId}`, [
          {
            target,
            operation: candidate,
            resolvedElementId: `element-${candidate.operationId}`,
          },
        ]),
      ).toThrowError(StylePreviewError);
    }
    expect(target.hasAttribute('data-match-my-exp-style')).toBe(false);
    expect(document.querySelector('style[data-match-my-exp-owned]')).toBeNull();
  });

  it('rejects excessive operations, duplicate cells, and disconnected targets', () => {
    const target = document.createElement('div');
    document.body.append(target);
    const registry = new StylePreviewRegistry(() => true);

    expect(() =>
      registry.apply(
        'preview-excessive',
        Array.from({ length: 65 }, (_, index) =>
          resolved(target, `operation-${index}`),
        ),
      ),
    ).toThrowError(
      expect.objectContaining<Partial<StylePreviewError>>({
        code: 'invalid_operation_count',
      }),
    );
    expect(() =>
      registry.apply('invalid id', [resolved(target, 'valid')]),
    ).toThrowError(
      expect.objectContaining<Partial<StylePreviewError>>({
        code: 'invalid_preview_id',
      }),
    );
    expect(() =>
      registry.apply('preview-duplicate-id', [
        resolved(target, 'same', 'color', 'red'),
        resolved(
          document.body.appendChild(document.createElement('div')),
          'same',
          'font-size',
          '20px',
        ),
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<StylePreviewError>>({
        code: 'duplicate_operation_id',
      }),
    );
    expect(() =>
      registry.apply('preview-duplicate', [
        resolved(target, 'one'),
        resolved(target, 'two'),
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<StylePreviewError>>({
        code: 'duplicate_target_property',
      }),
    );
    expect(() =>
      registry.apply('preview-mismatch', [
        {
          ...resolved(target, 'mismatch'),
          resolvedElementId: 'element-other',
        },
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<StylePreviewError>>({
        code: 'resolved_target_mismatch',
      }),
    );
    target.remove();
    expect(() =>
      registry.apply('preview-detached', [resolved(target, 'detached')]),
    ).toThrowError(
      expect.objectContaining<Partial<StylePreviewError>>({
        code: 'disconnected_target',
      }),
    );
    expect(document.querySelector('style[data-match-my-exp-owned]')).toBeNull();
  });

  it('compensates token writes when style sheet commit fails', () => {
    const target = document.body.appendChild(document.createElement('div'));
    const registry = new StylePreviewRegistry(() => true);
    const append = vi.spyOn(document.head, 'append').mockImplementation(() => {
      throw new Error('injected failure');
    });

    expect(() =>
      registry.apply('preview-failure', [resolved(target, 'failure')]),
    ).toThrowError(
      expect.objectContaining<Partial<StylePreviewError>>({
        code: 'style_commit_failed',
      }),
    );
    expect(target.hasAttribute('data-match-my-exp-style')).toBe(false);
    expect(registry.activeCount).toBe(0);
    append.mockRestore();
  });

  it('creates root-local style sheets for open shadow targets', () => {
    const host = document.body.appendChild(document.createElement('div'));
    const shadowRoot = host.attachShadow({ mode: 'open' });
    const target = shadowRoot.appendChild(document.createElement('button'));
    const registry = new StylePreviewRegistry(() => true);

    registry.apply('preview-shadow', [resolved(target, 'shadow-target')]);

    expect(
      shadowRoot.querySelector('style[data-match-my-exp-owned]'),
    ).not.toBeNull();
    expect(
      document.head.querySelector('style[data-match-my-exp-owned]'),
    ).toBeNull();
    registry.rollbackAll();
    expect(
      shadowRoot.querySelector('style[data-match-my-exp-owned]'),
    ).toBeNull();
    expect(target.hasAttribute('data-match-my-exp-style')).toBe(false);
  });
});
