import { beforeEach, describe, expect, it } from 'vitest';
import { inspectDocument } from './inspect';

const location = {
  origin: 'https://example.com',
  path: '/account',
  title: 'Account',
};

const sequentialIds = () => {
  let next = 0;
  return () => `element-test-${next++}`;
};

describe('inspectDocument', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    document.body.innerHTML = '';
  });

  it('extracts accessible semantics and keeps resolution private', () => {
    document.body.innerHTML = `
      <main aria-label="Account settings">
        <h1>Account</h1>
        <button aria-label="Save preferences">Save</button>
      </main>`;
    const inspection = inspectDocument(document, location, {
      createElementId: sequentialIds(),
    });
    const button = inspection.context.elements.find(
      ({ accessibleName }) => accessibleName === 'Save preferences',
    );

    expect(button).toMatchObject({ role: 'button', text: 'Save' });
    expect(inspection.resolve(button?.elementId ?? '')).toBe(
      document.querySelector('button'),
    );
    expect(JSON.stringify(inspection.context)).not.toContain(
      'data-match-my-exp',
    );
  });

  it('excludes hidden trees, scripts, raw HTML, and form values', () => {
    document.body.innerHTML = `
      <main>
        <p>Visible text</p>
        <div hidden>hidden-secret</div>
        <div aria-hidden="true">aria-hidden-secret</div>
        <div style="display: none">display-secret</div>
        <div style="visibility: hidden">visibility-secret</div>
        <div style="opacity: 0">opacity-secret</div>
        <script>script-secret</script>
        <style>.secret { color: red; }</style>
        <input aria-label="Password" value="input-secret" />
        <textarea aria-label="Notes">textarea-secret</textarea>
        <div data-private="attribute-secret"><span>Safe child</span></div>
      </main>`;

    const serialized = JSON.stringify(
      inspectDocument(document, location, {
        createElementId: sequentialIds(),
      }).context,
    );

    for (const secret of [
      'hidden-secret',
      'aria-hidden-secret',
      'display-secret',
      'visibility-secret',
      'opacity-secret',
      'script-secret',
      'input-secret',
      'textarea-secret',
      'attribute-secret',
      '<main>',
    ]) {
      expect(serialized).not.toContain(secret);
    }
    expect(serialized).toContain('Visible text');
    expect(serialized).toContain('Safe child');
  });

  it('traverses nested open shadow roots and excludes closed roots', () => {
    const openHost = document.body.appendChild(document.createElement('div'));
    const openRoot = openHost.attachShadow({ mode: 'open' });
    const nestedHost = openRoot.appendChild(document.createElement('section'));
    nestedHost.setAttribute('aria-label', 'Open settings');
    const nestedRoot = nestedHost.attachShadow({ mode: 'open' });
    const button = nestedRoot.appendChild(document.createElement('button'));
    button.textContent = 'Open action';
    const closedHost = document.body.appendChild(document.createElement('div'));
    const closedRoot = closedHost.attachShadow({ mode: 'closed' });
    closedRoot.append('closed-shadow-secret');

    const context = inspectDocument(document, location, {
      createElementId: sequentialIds(),
    }).context;
    const shadowButton = context.elements.find(
      ({ text }) => text === 'Open action',
    );

    expect(shadowButton?.shadowHostId).toBeDefined();
    expect(JSON.stringify(context)).not.toContain('closed-shadow-secret');
  });

  it('enforces element, text, and serialized-byte budgets', () => {
    document.body.innerHTML = `<main>${Array.from(
      { length: 20 },
      (_, index) => `<p>${index}-${'x'.repeat(100)}</p>`,
    ).join('')}</main>`;

    const inspection = inspectDocument(document, location, {
      createElementId: sequentialIds(),
      budget: {
        maxElements: 8,
        maxTextCharacters: 12,
        maxSerializedBytes: 8_000,
      },
    });

    expect(inspection.context.elements.length).toBeLessThanOrEqual(8);
    expect(
      inspection.context.elements.every(
        ({ text }) => (text?.length ?? 0) <= 12,
      ),
    ).toBe(true);
    expect(
      new TextEncoder().encode(JSON.stringify(inspection.context)).length,
    ).toBeLessThanOrEqual(8_000);

    const pruned = inspectDocument(document, location, {
      createElementId: sequentialIds(),
      budget: { maxSerializedBytes: 1_000 },
    });
    expect(
      new TextEncoder().encode(JSON.stringify(pruned.context)).length,
    ).toBeLessThanOrEqual(1_000);
    expect(() =>
      inspectDocument(document, location, {
        createElementId: sequentialIds(),
        budget: { maxSerializedBytes: 10 },
      }),
    ).toThrow('Inspection context cannot fit the byte budget');
  });

  it('captures settled SPA paths without query strings or fragments', () => {
    document.body.innerHTML = '<main>Inbox</main>';

    const context = inspectDocument(
      document,
      { ...location, path: '/app/inbox', title: 'Inbox' },
      { createElementId: sequentialIds() },
    ).context;

    expect(context).toMatchObject({ path: '/app/inbox', title: 'Inbox' });
    expect(() =>
      inspectDocument(
        document,
        { ...location, path: '/app/inbox?token=private' },
        { createElementId: sequentialIds() },
      ),
    ).toThrow();
  });

  it('rejects non-opaque or duplicate generated identifiers', () => {
    document.body.innerHTML = '<main><p>One</p></main>';
    expect(() =>
      inspectDocument(document, location, {
        createElementId: () => 'semantic-main',
      }),
    ).toThrow('Inspection element IDs must be unique and opaque');
    expect(() =>
      inspectDocument(document, location, {
        createElementId: () => 'element-duplicate',
      }),
    ).toThrow('Inspection element IDs must be unique and opaque');
    expect(
      inspectDocument(document, location).context.elements[0]?.elementId,
    ).toMatch(/^element-/);
  });
});
