import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page } from 'playwright';
import type { BenchmarkCategory } from './schemas';

export interface FixtureDefinition {
  id: string;
  category: BenchmarkCategory;
  file: string;
  initialPath: string;
  viewport: { width: number; height: number };
  setup: 'none' | 'open-inbox';
}

export const fixtureDefinitions: readonly FixtureDefinition[] = [
  {
    id: 'static-article',
    category: 'static',
    file: 'static.html',
    initialPath: '/report',
    viewport: { width: 1280, height: 800 },
    setup: 'none',
  },
  {
    id: 'subscription-plans',
    category: 'repeated',
    file: 'repeated.html',
    initialPath: '/plans',
    viewport: { width: 1280, height: 800 },
    setup: 'none',
  },
  {
    id: 'spa-inbox',
    category: 'spa',
    file: 'spa.html',
    initialPath: '/app',
    viewport: { width: 1280, height: 800 },
    setup: 'open-inbox',
  },
  {
    id: 'responsive-desktop',
    category: 'responsive',
    file: 'responsive.html',
    initialPath: '/knowledge',
    viewport: { width: 1280, height: 800 },
    setup: 'none',
  },
  {
    id: 'responsive-mobile',
    category: 'responsive',
    file: 'responsive.html',
    initialPath: '/knowledge',
    viewport: { width: 390, height: 844 },
    setup: 'none',
  },
  {
    id: 'shadow-preferences',
    category: 'shadow',
    file: 'shadow.html',
    initialPath: '/settings',
    viewport: { width: 1280, height: 800 },
    setup: 'none',
  },
];

export const fixtureById = new Map(
  fixtureDefinitions.map((fixture) => [fixture.id, fixture]),
);

const fixturePath = (file: string) =>
  resolve('benchmarks/targeting/fixtures', file);

export const prepareFixture = async (
  page: Page,
  fixture: FixtureDefinition,
) => {
  const html = await readFile(fixturePath(fixture.file), 'utf8');
  await page.setViewportSize(fixture.viewport);
  await page.route('https://targeting.test/**', (route) =>
    route.fulfill({ body: html, contentType: 'text/html' }),
  );
  await page.goto(`https://targeting.test${fixture.initialPath}`);
  if (fixture.setup === 'open-inbox') {
    await page.getByRole('button', { name: 'Open inbox' }).click();
    await page.waitForURL('https://targeting.test/app/inbox');
  }
};
