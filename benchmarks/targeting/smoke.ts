import { chromium } from 'playwright';
import { capturePageContext } from './extract';
import { fixtureById, prepareFixture } from './fixtures';

const fixture = fixtureById.get('static-article');
if (fixture === undefined) {
  throw new Error('Static smoke fixture is missing');
}

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await prepareFixture(page, fixture);
  const captured = await capturePageContext(page, 'smoke');
  if (captured.oracle['article-main'] === undefined) {
    throw new Error('Smoke extractor did not capture the target');
  }
} finally {
  await browser.close();
}
