import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const extensionSource = resolve('.output/chrome-mv3');
const liveEnabled = process.env.PACKED_LIVE === '1';
const liveCredential = liveEnabled ? process.env.AZURE_API_KEY : undefined;
const liveEndpoint = liveEnabled
  ? process.env.AZURE_OPENAI_RESPONSES_URL
  : undefined;
const liveModel = process.env.AZURE_OPENAI_MODEL ?? 'gpt-5.6-luna';
const userDataDir = await mkdtemp(resolve(tmpdir(), 'match-my-exp-packed-'));
const extensionPath = resolve(userDataDir, 'extension');
await cp(extensionSource, extensionPath, { recursive: true });
const manifestPath = resolve(extensionPath, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
manifest.host_permissions = [
  'https://packed.test/*',
  ...(liveEndpoint === undefined ? [] : [`${new URL(liveEndpoint).origin}/*`]),
];
await writeFile(manifestPath, JSON.stringify(manifest));

const context = await chromium.launchPersistentContext(userDataDir, {
  headless: true,
  channel: 'chromium',
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});

try {
  await context.route('https://packed.test/**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><title>Packed Fixture</title><main><button id="save">Save</button></main>',
    }),
  );
  const fixture = await context.newPage();
  await fixture.goto('https://packed.test/account');
  const worker =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent('serviceworker'));
  const extensionId = new URL(worker.url()).hostname;
  const panel = await context.newPage();
  panel.on('pageerror', (error) =>
    process.stdout.write(`Packed panel error: ${error.message}\n`),
  );
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await fixture.bringToFront();
  await panel.evaluate(() => location.reload());
  await panel.waitForLoadState();
  panel.on('dialog', (dialog) => void dialog.accept());

  await panel.getByRole('button', { name: 'Grant site access' }).click();
  await panel.getByText('Site access granted').waitFor();
  const fixtureTab = await worker.evaluate(
    async () => (await chrome.tabs.query({ url: 'https://packed.test/*' }))[0],
  );
  assert.ok(fixtureTab?.id);
  await worker.evaluate(
    async (tabId) =>
      chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-scripts/content.js'],
      }),
    fixtureTab.id,
  );
  const inspection = await worker.evaluate(
    async ({ tabId }) =>
      chrome.tabs.sendMessage(tabId, {
        schemaVersion: 1,
        type: 'page.inspect.request',
        requestId: crypto.randomUUID(),
        tabId,
        expectedOrigin: 'https://packed.test',
        expectedPath: '/account',
      }),
    { tabId: fixtureTab.id },
  );
  assert.ok(
    inspection.context.elements.some(
      (element) => element.accessibleName === 'Save' || element.text === 'Save',
    ),
  );

  if (liveCredential !== undefined && liveEndpoint !== undefined) {
    await panel.getByLabel('Provider').selectOption('compatible');
    await panel.getByLabel('Model').fill(liveModel);
    await panel.getByLabel('Responses endpoint').fill(liveEndpoint);
    await panel.getByLabel('Authentication').selectOption('api-key');
    await panel.getByLabel('API key', { exact: true }).fill(liveCredential);
    await panel.getByRole('button', { name: 'Save provider' }).click();
    await panel.getByText('Provider configured').waitFor();
    await panel
      .getByLabel('Describe the change')
      .fill('Make the Save button red.');
    await panel.getByRole('button', { name: 'Send' }).click();
    await panel.getByRole('button', { name: 'Discard preview' }).waitFor();
    const previewColor = await fixture
      .locator('#save')
      .evaluate((element) => getComputedStyle(element).color);
    assert.notEqual(previewColor, 'rgb(0, 0, 0)');
    await panel.getByRole('button', { name: 'Discard preview' }).click();
  }
} finally {
  await context.close();
  await rm(userDataDir, { recursive: true, force: true });
}

process.stdout.write(
  liveCredential === undefined
    ? 'Packed extension permission and inspection flow passed\n'
    : 'Packed extension live styling flow passed\n',
);
