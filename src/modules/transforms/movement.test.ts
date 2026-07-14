import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MovementPreviewError, MovementPreviewRegistry } from './movement';

const moveBefore = function (
  this: Element | ShadowRoot,
  node: Node,
  reference: Node | null,
) {
  this.insertBefore(node, reference);
};

const target = (elementId: string) => ({
  kind: 'ephemeral' as const,
  elementId,
});

const operation = (
  operationId: string,
  placement: 'before' | 'after' | 'inside-start' | 'inside-end' = 'inside-end',
) => ({
  kind: 'move',
  operationId,
  target: target(`element-${operationId}`),
  destination: target(`element-${operationId}-destination`),
  placement,
});

describe('MovementPreviewRegistry', () => {
  beforeAll(() => {
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
    document.body.innerHTML = '';
  });

  it('moves and restores the same live node with listeners intact', () => {
    document.body.innerHTML = `
      <section id="source"><button>Move</button></section>
      <section id="destination"></section>`;
    const source = document.querySelector('button') as HTMLButtonElement;
    const destination = document.querySelector('#destination') as HTMLElement;
    let clicks = 0;
    source.addEventListener('click', () => {
      clicks += 1;
    });
    const registry = new MovementPreviewRegistry();

    registry.apply('preview-move', [
      {
        operation: operation('source'),
        target: source,
        destination,
        resolvedTargetId: 'element-source',
        resolvedDestinationId: 'element-source-destination',
      },
    ]);

    expect(source.parentElement).toBe(destination);
    source.click();
    expect(clicks).toBe(1);
    expect(registry.rollback('preview-move')).toEqual([]);
    expect(source.parentElement?.id).toBe('source');
    source.click();
    expect(clicks).toBe(2);
    expect(registry.rollback('preview-move')).toEqual([]);
  });

  it('preserves page-owned relocation conflicts and removes markers', () => {
    document.body.innerHTML = `
      <section id="source"><button>Move</button></section>
      <section id="destination"></section>
      <section id="page"></section>`;
    const source = document.querySelector('button') as HTMLButtonElement;
    const destination = document.querySelector('#destination') as HTMLElement;
    const pageOwned = document.querySelector('#page') as HTMLElement;
    const registry = new MovementPreviewRegistry();
    registry.apply('preview-conflict', [
      {
        operation: operation('source'),
        target: source,
        destination,
        resolvedTargetId: 'element-source',
        resolvedDestinationId: 'element-source-destination',
      },
    ]);
    pageOwned.append(source);

    expect(registry.rollback('preview-conflict')).toEqual(['source']);
    expect(source.parentElement).toBe(pageOwned);
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_COMMENT);
    let markers = 0;
    while (walker.nextNode()) {
      markers += 1;
    }
    expect(markers).toBe(0);
  });

  it('rejects cross-root, forbidden, cycle, and duplicate moves before writes', () => {
    document.body.innerHTML =
      '<main><div id="parent"><span id="child"></span></div></main>';
    const parent = document.querySelector('#parent') as HTMLElement;
    const child = document.querySelector('#child') as HTMLElement;
    const registry = new MovementPreviewRegistry();

    expect(() =>
      registry.apply('preview-cycle', [
        {
          operation: operation('parent'),
          target: parent,
          destination: child,
          resolvedTargetId: 'element-parent',
          resolvedDestinationId: 'element-parent-destination',
        },
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<MovementPreviewError>>({
        code: 'move_cycle',
      }),
    );

    const host = document.body.appendChild(document.createElement('div'));
    const shadow = host.attachShadow({ mode: 'open' });
    const shadowDestination = shadow.appendChild(document.createElement('div'));
    expect(() =>
      registry.apply('preview-cross', [
        {
          operation: operation('child'),
          target: child,
          destination: shadowDestination,
          resolvedTargetId: 'element-child',
          resolvedDestinationId: 'element-child-destination',
        },
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<MovementPreviewError>>({
        code: 'cross_root_move',
      }),
    );

    expect(() =>
      registry.apply('preview-forbidden', [
        {
          operation: operation('body'),
          target: document.body,
          destination: parent,
          resolvedTargetId: 'element-body',
          resolvedDestinationId: 'element-body-destination',
        },
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<MovementPreviewError>>({
        code: 'forbidden_or_stale_target',
      }),
    );

    expect(parent.contains(child)).toBe(true);
  });

  it('supports same-open-shadow movement and idempotent preview IDs', () => {
    const host = document.body.appendChild(document.createElement('div'));
    const root = host.attachShadow({ mode: 'open' });
    const sourceParent = root.appendChild(document.createElement('section'));
    const source = sourceParent.appendChild(document.createElement('button'));
    const destination = root.appendChild(document.createElement('section'));
    const registry = new MovementPreviewRegistry();
    const input = {
      operation: operation('shadow'),
      target: source,
      destination,
      resolvedTargetId: 'element-shadow',
      resolvedDestinationId: 'element-shadow-destination',
    };

    registry.apply('preview-shadow', [input]);
    registry.apply('preview-shadow', [input]);
    expect(source.parentElement).toBe(destination);
    expect(() =>
      registry.apply('preview-shadow', [
        { ...input, operation: operation('shadow', 'before') },
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<MovementPreviewError>>({
        code: 'preview_id_conflict',
      }),
    );
    expect(registry.rollback('preview-shadow')).toEqual([]);
    expect(source.parentElement).toBe(sourceParent);
  });

  it('supports every placement and rejects invalid preflight state', () => {
    for (const placement of [
      'before',
      'after',
      'inside-start',
      'inside-end',
    ] as const) {
      document.body.innerHTML = `
        <section id="source"><button>Move</button></section>
        <section id="destination"><span>Child</span></section>`;
      const source = document.querySelector('button') as HTMLElement;
      const destination = document.querySelector('#destination') as HTMLElement;
      const registry = new MovementPreviewRegistry();
      registry.apply(`preview-${placement}`, [
        {
          operation: operation('placement', placement),
          target: source,
          destination,
          resolvedTargetId: 'element-placement',
          resolvedDestinationId: 'element-placement-destination',
        },
      ]);
      expect(registry.rollback(`preview-${placement}`)).toEqual([]);
      expect(source.parentElement?.id).toBe('source');
    }

    document.body.innerHTML = '<section><button></button><div></div></section>';
    const source = document.querySelector('button') as HTMLElement;
    const destination = document.querySelector('div') as HTMLElement;
    const registry = new MovementPreviewRegistry();
    expect(() => registry.apply('invalid id', [])).toThrowError(
      expect.objectContaining<Partial<MovementPreviewError>>({
        code: 'invalid_preview',
      }),
    );
    expect(() =>
      registry.apply('preview-mismatch', [
        {
          operation: operation('mismatch'),
          target: source,
          destination,
          resolvedTargetId: 'element-other',
          resolvedDestinationId: 'element-mismatch-destination',
        },
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<MovementPreviewError>>({
        code: 'resolved_target_mismatch',
      }),
    );
    expect(() =>
      registry.apply('preview-same-node', [
        {
          operation: operation('same-node'),
          target: source,
          destination: source,
          resolvedTargetId: 'element-same-node',
          resolvedDestinationId: 'element-same-node-destination',
        },
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<MovementPreviewError>>({
        code: 'move_cycle',
      }),
    );
    expect(registry.rollback('missing')).toEqual([]);

    const originalMoveBefore = Object.getOwnPropertyDescriptor(
      Element.prototype,
      'moveBefore',
    );
    Reflect.deleteProperty(Element.prototype, 'moveBefore');
    expect(() =>
      registry.apply('preview-no-api', [
        {
          operation: operation('no-api'),
          target: source,
          destination,
          resolvedTargetId: 'element-no-api',
          resolvedDestinationId: 'element-no-api-destination',
        },
      ]),
    ).toThrowError(
      expect.objectContaining<Partial<MovementPreviewError>>({
        code: 'move_before_unavailable',
      }),
    );
    if (originalMoveBefore !== undefined) {
      Object.defineProperty(
        Element.prototype,
        'moveBefore',
        originalMoveBefore,
      );
    }
  });
});
