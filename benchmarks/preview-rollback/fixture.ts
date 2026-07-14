import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { Page } from 'playwright';

const fixturePath = resolve('benchmarks/preview-rollback/fixtures/atomic.html');

export const prepareAtomicFixture = async (page: Page) => {
  const html = await readFile(fixturePath, 'utf8');
  await page.route('https://preview.test/**', (route) =>
    route.fulfill({ body: html, contentType: 'text/html' }),
  );
  await page.goto('https://preview.test/fixture');
};
