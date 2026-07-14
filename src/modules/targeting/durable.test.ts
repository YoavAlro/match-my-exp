import { beforeEach, describe, expect, it } from 'vitest';
import { PageInspection, inspectDocument } from '../inspection';
import {
  DurableTargetError,
  compileDurableTarget,
  resolveDurableTarget,
} from './durable';

const location = {
  origin: 'https://example.com',
  path: '/account',
  title: 'Account',
};

const inspect = () => {
  let next = 0;
  return inspectDocument(document, location, {
    createElementId: () => `element-target-${next++}`,
  });
};

const ephemeralFor = (inspection: PageInspection, element: Element) => {
  const record = inspection.context.elements.find(
    ({ elementId }) => inspection.resolve(elementId) === element,
  );
  if (record === undefined) {
    throw new Error('Element was not inspected');
  }
  return { kind: 'ephemeral', elementId: record.elementId };
};

describe('durable targeting', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('compiles stable semantic strategies and resolves exactly', () => {
    document.body.innerHTML = `
      <main><button id="save" data-testid="save-control" aria-label="Save settings">Save</button></main>`;
    const button = document.querySelector('button') as HTMLButtonElement;
    const inspection = inspect();

    const durable = compileDurableTarget(
      inspection,
      ephemeralFor(inspection, button),
    );

    expect(durable.element).toMatchObject({
      tag: 'button',
      role: 'button',
      accessibleName: 'Save settings',
      selector: '#save',
      attributes: expect.arrayContaining([
        { name: 'id', value: 'save' },
        { name: 'data-testid', value: 'save-control' },
      ]),
    });
    expect(resolveDurableTarget(document, durable)).toEqual({
      status: 'resolved',
      element: button,
    });
  });

  it('uses stable strategies before structural fallback after reordering', () => {
    document.body.innerHTML = `
      <main><section id="first"><button id="save">Save</button></section><section id="second"></section></main>`;
    const button = document.querySelector('button') as HTMLButtonElement;
    const inspection = inspect();
    const durable = compileDurableTarget(
      inspection,
      ephemeralFor(inspection, button),
    );

    document.querySelector('#second')?.append(button);

    expect(resolveDurableTarget(document, durable)).toEqual({
      status: 'resolved',
      element: button,
    });
  });

  it('returns ambiguous or missing instead of choosing a candidate', () => {
    document.body.innerHTML =
      '<main><button>Renew</button><button>Renew</button></main>';
    const ambiguous = {
      kind: 'durable',
      shadowHosts: [],
      element: {
        tag: 'button',
        role: 'button',
        accessibleName: 'Renew',
        attributes: [],
      },
    };

    expect(resolveDurableTarget(document, ambiguous)).toEqual({
      status: 'ambiguous',
    });
    document.querySelectorAll('button').forEach((button) => button.remove());
    expect(resolveDurableTarget(document, ambiguous)).toEqual({
      status: 'missing',
    });
  });

  it('uses bounded structural paths when no stable semantic anchor exists', () => {
    document.body.innerHTML =
      '<main><div><span></span></div><div></div></main>';
    const span = document.querySelector('span') as HTMLSpanElement;
    const inspection = inspect();
    const durable = compileDurableTarget(
      inspection,
      ephemeralFor(inspection, span),
    );

    expect(durable.element.childPath).toBeDefined();
    expect(resolveDurableTarget(document, durable)).toEqual({
      status: 'resolved',
      element: span,
    });
    document.querySelector('main > div:last-child')?.append(span);
    expect(resolveDurableTarget(document, durable)).toEqual({
      status: 'missing',
    });
  });

  it('compiles and resolves explicit nested open-shadow host chains', () => {
    const outer = document.body.appendChild(
      document.createElement('account-shell'),
    );
    outer.id = 'account-shell';
    const outerRoot = outer.attachShadow({ mode: 'open' });
    const inner = outerRoot.appendChild(
      document.createElement('settings-panel'),
    );
    inner.id = 'settings-panel';
    const innerRoot = inner.attachShadow({ mode: 'open' });
    const button = innerRoot.appendChild(document.createElement('button'));
    button.id = 'save';
    button.textContent = 'Save';
    const inspection = inspect();
    const durable = compileDurableTarget(
      inspection,
      ephemeralFor(inspection, button),
    );

    expect(durable.shadowHosts).toHaveLength(2);
    expect(resolveDurableTarget(document, durable)).toEqual({
      status: 'resolved',
      element: button,
    });
    inner.remove();
    expect(resolveDurableTarget(document, durable)).toEqual({
      status: 'missing',
    });
  });

  it('rejects closed-shadow and stale ephemeral compilation', () => {
    const host = document.body.appendChild(
      document.createElement('private-panel'),
    );
    const root = host.attachShadow({ mode: 'closed' });
    const button = root.appendChild(document.createElement('button'));
    const context = {
      schemaVersion: 1 as const,
      origin: 'https://example.com',
      path: '/account',
      title: 'Account',
      elements: [
        {
          elementId: 'element-closed',
          tag: 'button',
          attributes: [],
          computedStyles: [],
          bounds: { x: 0, y: 0, width: 0, height: 0 },
        },
      ],
    };
    const closedInspection = new PageInspection(
      context,
      new Map([['element-closed', button]]),
    );

    expect(() =>
      compileDurableTarget(closedInspection, {
        kind: 'ephemeral',
        elementId: 'element-closed',
      }),
    ).toThrowError(
      expect.objectContaining<Partial<DurableTargetError>>({
        code: 'closed_shadow_root',
      }),
    );

    document.body.innerHTML = '<button>Detached</button>';
    const inspection = inspect();
    const ephemeral = ephemeralFor(
      inspection,
      document.querySelector('button') as Element,
    );
    document.querySelector('button')?.remove();
    expect(() => compileDurableTarget(inspection, ephemeral)).toThrowError(
      expect.objectContaining<Partial<DurableTargetError>>({
        code: 'ephemeral_target_missing',
      }),
    );
  });
});
