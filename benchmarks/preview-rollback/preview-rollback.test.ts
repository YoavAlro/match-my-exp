import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chromium, type Browser, type Page } from 'playwright';
import type { ProposalOperation } from '../../src/modules/contracts';
import {
  applyPreview,
  previewStatus,
  rollbackPreview,
  type PreviewRequest,
} from './executor';
import { prepareAtomicFixture } from './fixture';

const target = (elementId: string) => ({
  kind: 'ephemeral' as const,
  elementId,
});

const styleOperation: ProposalOperation = {
  kind: 'style',
  operationId: 'style-target',
  target: target('element-style'),
  declarations: [{ property: 'color', value: 'rgb(200, 10, 20)' }],
};

const moveOperation: ProposalOperation = {
  kind: 'move',
  operationId: 'move-source',
  target: target('element-source'),
  destination: target('element-destination'),
  placement: 'inside-end',
};

const ariaOperation: ProposalOperation = {
  kind: 'aria',
  operationId: 'label-target',
  target: target('element-aria'),
  attribute: 'aria-label',
  value: 'Preview label',
};

const request = (
  previewId: string,
  operations: ProposalOperation[] = [
    styleOperation,
    moveOperation,
    ariaOperation,
  ],
): PreviewRequest => ({
  previewId,
  expectedOrigin: 'https://preview.test',
  expectedPath: '/fixture',
  operations,
});

const pageState = (page: Page) =>
  page.evaluate(() => {
    const source = document.querySelector('[data-spike-id="element-source"]');
    const sourceParent = document.querySelector(
      '[data-spike-id="element-source-parent"]',
    );
    const styleTarget = document.querySelector(
      '[data-spike-id="element-style"]',
    ) as HTMLElement;
    const ariaTarget = document.querySelector('[data-spike-id="element-aria"]');
    return {
      sourceParentId: source?.parentElement?.getAttribute('data-spike-id'),
      sourceOrder: Array.from(sourceParent?.children ?? []).map((element) =>
        element.getAttribute('data-spike-id'),
      ),
      sourceIdentity: source === window.fixtureSource,
      focusedId: document.activeElement?.getAttribute('data-spike-id'),
      clickCount: window.fixtureClicks,
      styleAttribute: styleTarget.getAttribute('style'),
      color: styleTarget.style.getPropertyValue('color'),
      colorPriority: styleTarget.style.getPropertyPriority('color'),
      ariaLabel: ariaTarget?.getAttribute('aria-label'),
      pageClass: styleTarget.className,
      pageBackground: styleTarget.style.backgroundColor,
      pageAttribute: ariaTarget?.getAttribute('data-page-change'),
      pageSibling: document.querySelector('[data-page-sibling]')?.textContent,
    };
  });

describe('atomic preview and rollback spike', () => {
  let browser: Browser;
  let page: Page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  beforeEach(async () => {
    page = await browser.newPage();
    await prepareAtomicFixture(page);
    await previewStatus(page);
  }, 60_000);

  afterAll(async () => {
    await browser.close();
  });

  it('applies and rejects a mixed preview without replacing live nodes', async () => {
    await page.locator('[data-spike-id="element-source"]').focus();
    const baseline = await pageState(page);

    const applied = await applyPreview(page, request('preview-success'));

    expect(applied).toMatchObject({ status: 'active', conflicts: [] });
    expect(await pageState(page)).toMatchObject({
      sourceParentId: 'element-destination',
      sourceIdentity: true,
      focusedId: 'element-source',
      color: 'rgb(200, 10, 20)',
      colorPriority: '',
      ariaLabel: 'Preview label',
    });
    await page.locator('[data-spike-id="element-source"]').click();
    expect((await pageState(page)).clickCount).toBe(1);

    const rolledBack = await rollbackPreview(page, 'preview-success');

    expect(rolledBack).toMatchObject({
      status: 'rolled-back',
      conflicts: [],
    });
    expect(await pageState(page)).toMatchObject({
      ...baseline,
      clickCount: 1,
      focusedId: 'element-source',
    });
    expect(await previewStatus(page)).toEqual({
      activePreviewId: null,
      markerCount: 0,
    });
    await page.close();
  });

  it('preflights every target before making a connected DOM change', async () => {
    const baseline = await pageState(page);
    const invalidMove: ProposalOperation = {
      ...moveOperation,
      target: target('element-missing'),
    };

    const result = await applyPreview(
      page,
      request('preview-preflight', [styleOperation, invalidMove]),
    );

    expect(result).toMatchObject({
      status: 'rejected',
      reason: 'target_resolution_failed',
      mutations: 0,
    });
    expect(await pageState(page)).toEqual(baseline);
    expect((await previewStatus(page)).markerCount).toBe(0);

    await page.evaluate(() => {
      const styleTarget = document.querySelector(
        '[data-spike-id="element-style"]',
      );
      styleTarget?.after(styleTarget.cloneNode(true));
    });
    expect(
      await applyPreview(page, request('preview-ambiguous', [styleOperation])),
    ).toMatchObject({
      status: 'rejected',
      reason: 'target_resolution_failed',
      mutations: 0,
    });
    await page.close();
  });

  it('supports every contract movement placement', async () => {
    for (const placement of [
      'before',
      'after',
      'inside-start',
      'inside-end',
    ] as const) {
      await page.close();
      page = await browser.newPage();
      await prepareAtomicFixture(page);
      await previewStatus(page);
      const operation: ProposalOperation = {
        ...moveOperation,
        placement,
      };

      expect(
        await applyPreview(
          page,
          request(`preview-placement-${placement}`, [operation]),
        ),
      ).toMatchObject({ status: 'active', conflicts: [] });
      expect(
        await page.evaluate((expectedPlacement) => {
          const source = document.querySelector(
            '[data-spike-id="element-source"]',
          );
          const destination = document.querySelector(
            '[data-spike-id="element-destination"]',
          );
          if (expectedPlacement === 'before') {
            return source?.nextElementSibling === destination;
          }
          if (expectedPlacement === 'after') {
            return destination?.nextElementSibling === source;
          }
          if (expectedPlacement === 'inside-start') {
            return destination?.firstElementChild === source;
          }
          return destination?.lastElementChild === source;
        }, placement),
      ).toBe(true);
      expect(
        await rollbackPreview(page, `preview-placement-${placement}`),
      ).toMatchObject({ status: 'rolled-back', conflicts: [] });
      expect((await pageState(page)).sourceOrder).toEqual([
        'element-source-before',
        'element-source',
        'element-source-after',
      ]);
    }
    await page.close();
  });

  it('compensates every injected interruption boundary', async () => {
    for (
      let failAfterMutation = 1;
      failAfterMutation <= 6;
      failAfterMutation += 1
    ) {
      await page.close();
      page = await browser.newPage();
      await prepareAtomicFixture(page);
      await previewStatus(page);
      const baseline = await pageState(page);

      const result = await applyPreview(
        page,
        request(`preview-interrupt-${failAfterMutation}`),
        { failAfterMutation },
      );

      expect(result).toMatchObject({
        status: 'rejected',
        reason: 'injected_interruption',
        conflicts: [],
      });
      expect(await pageState(page)).toEqual(baseline);
      expect((await previewStatus(page)).markerCount).toBe(0);
    }
    await page.close();
  });

  it('preserves unrelated page writes during rollback', async () => {
    await applyPreview(page, request('preview-unrelated'));
    await page.evaluate(() => {
      const styleTarget = document.querySelector(
        '[data-spike-id="element-style"]',
      ) as HTMLElement;
      const ariaTarget = document.querySelector(
        '[data-spike-id="element-aria"]',
      );
      const sourceParent = document.querySelector(
        '[data-spike-id="element-source-parent"]',
      );
      styleTarget.classList.add('page-owned');
      styleTarget.style.backgroundColor = 'rgb(1, 2, 3)';
      ariaTarget?.setAttribute('data-page-change', 'preserved');
      const sibling = document.createElement('span');
      sibling.setAttribute('data-page-sibling', 'true');
      sibling.textContent = 'Page sibling';
      sourceParent?.append(sibling);
    });

    const result = await rollbackPreview(page, 'preview-unrelated');

    expect(result.conflicts).toEqual([]);
    expect(await pageState(page)).toMatchObject({
      sourceParentId: 'element-source-parent',
      color: 'rgb(10, 20, 30)',
      colorPriority: 'important',
      ariaLabel: 'Original label',
      pageClass: 'page-owned',
      pageBackground: 'rgb(1, 2, 3)',
      pageAttribute: 'preserved',
      pageSibling: 'Page sibling',
    });
    await page.close();
  });

  it('preserves page overrides and reports write conflicts', async () => {
    await applyPreview(page, request('preview-conflict'));
    await page.evaluate(() => {
      const styleTarget = document.querySelector(
        '[data-spike-id="element-style"]',
      ) as HTMLElement;
      const ariaTarget = document.querySelector(
        '[data-spike-id="element-aria"]',
      );
      const source = document.querySelector('[data-spike-id="element-source"]');
      const third = document.querySelector('[data-spike-id="element-third"]');
      styleTarget.style.color = 'rgb(2, 100, 40)';
      ariaTarget?.setAttribute('aria-label', 'Page label');
      third?.append(source as Node);
    });

    const result = await rollbackPreview(page, 'preview-conflict');

    expect(result.conflicts).toEqual([
      'label-target:attribute',
      'move-source:move',
      'style-target:style',
    ]);
    expect(await pageState(page)).toMatchObject({
      sourceParentId: 'element-third',
      color: 'rgb(2, 100, 40)',
      ariaLabel: 'Page label',
    });
    expect((await previewStatus(page)).markerCount).toBe(0);
    await page.close();
  });

  it('rolls back an active preview on SPA navigation', async () => {
    const baseline = await pageState(page);
    await applyPreview(page, request('preview-navigation'));

    await page.evaluate(() => history.pushState({}, '', '/next-route'));
    await expect
      .poll(() => previewStatus(page))
      .toEqual({
        activePreviewId: null,
        markerCount: 0,
      });

    expect(new URL(page.url()).pathname).toBe('/next-route');
    expect(await pageState(page)).toEqual(baseline);
    await page.close();
  });

  it('cleans the old document before traditional navigation', async () => {
    await applyPreview(page, request('preview-pagehide'));
    await page.evaluate(() => {
      globalThis.addEventListener('pagehide', () => {
        const source = document.querySelector(
          '[data-spike-id="element-source"]',
        );
        const styleTarget = document.querySelector(
          '[data-spike-id="element-style"]',
        ) as HTMLElement;
        const ariaTarget = document.querySelector(
          '[data-spike-id="element-aria"]',
        );
        sessionStorage.setItem(
          'pagehide-state',
          JSON.stringify({
            sourceParentId:
              source?.parentElement?.getAttribute('data-spike-id'),
            color: styleTarget.style.getPropertyValue('color'),
            priority: styleTarget.style.getPropertyPriority('color'),
            ariaLabel: ariaTarget?.getAttribute('aria-label'),
          }),
        );
      });
    });

    await page.goto('https://preview.test/next-document');

    expect(
      JSON.parse(
        (await page.evaluate(() => sessionStorage.getItem('pagehide-state'))) ??
          '{}',
      ),
    ).toEqual({
      sourceParentId: 'element-source-parent',
      color: 'rgb(10, 20, 30)',
      priority: 'important',
      ariaLabel: 'Original label',
    });
    await page.close();
  });

  it('enforces same-root movement for open shadow trees', async () => {
    const sameRootMove: ProposalOperation = {
      kind: 'move',
      operationId: 'move-shadow',
      target: target('element-shadow-source'),
      destination: target('element-shadow-destination'),
      placement: 'inside-end',
    };
    const applied = await applyPreview(
      page,
      request('preview-shadow', [sameRootMove]),
    );
    expect(applied.status).toBe('active');
    expect((await rollbackPreview(page, 'preview-shadow')).conflicts).toEqual(
      [],
    );

    const crossRootMove: ProposalOperation = {
      ...sameRootMove,
      operationId: 'move-cross-shadow',
      destination: target('element-other-shadow-destination'),
    };
    expect(
      await applyPreview(
        page,
        request('preview-cross-shadow', [crossRootMove]),
      ),
    ).toMatchObject({
      status: 'rejected',
      reason: 'cross_root_move',
      mutations: 0,
    });
    await page.close();
  });

  it('keeps apply and rollback idempotent by preview ID', async () => {
    const first = await applyPreview(page, request('preview-idempotent'));
    const second = await applyPreview(page, request('preview-idempotent'));
    const other = await applyPreview(page, request('preview-other'));

    expect(first.status).toBe('active');
    expect(second).toMatchObject({ status: 'active', mutations: 0 });
    expect(other).toMatchObject({
      status: 'rejected',
      reason: 'preview_already_active',
    });
    expect((await rollbackPreview(page, 'preview-idempotent')).status).toBe(
      'rolled-back',
    );
    expect((await rollbackPreview(page, 'preview-idempotent')).mutations).toBe(
      0,
    );
    expect(
      await applyPreview(page, request('preview-idempotent')),
    ).toMatchObject({ status: 'rejected', reason: 'preview_id_reused' });
    await page.close();
  });
});

declare global {
  interface Window {
    fixtureSource: Element;
    fixtureClicks: number;
  }
}
