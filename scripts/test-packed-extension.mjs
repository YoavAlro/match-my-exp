import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:https';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { chromium } from 'playwright';

const extensionSource = resolve('.output/chrome-mv3');
const artifactDirectory = resolve('.output/packed-artifacts');
const siteOrigin = 'https://site-a.packed.test';
let providerOrigin;
let providerEndpoint;
const accountColor = 'rgb(220, 20, 60)';
const shadowColor = 'rgb(0, 0, 255)';
const report = {
  schemaVersion: 1,
  status: 'running',
  stage: 'setup',
  completedStages: [],
  providerRequestCount: 0,
  panelErrorCount: 0,
};
const temporaryDirectories = [];
let activeContext;
let providerServer;
let heldRequestObserved = false;
let releaseHeldRequest;

const heldRequestGate = new Promise((resolvePromise) => {
  releaseHeldRequest = resolvePromise;
});

const executeFile = promisify(execFile);

const complete = (stage) => {
  report.stage = stage;
  report.completedStages.push(stage);
  process.stdout.write(`Packed stage passed: ${stage}\n`);
};

const waitFor = async (read, accept, description, timeout = 15_000) => {
  const deadline = Date.now() + timeout;
  const readTimedOut = Symbol('read-timed-out');
  while (Date.now() < deadline) {
    const value = await Promise.race([
      read(),
      new Promise((resolvePromise) =>
        setTimeout(() => resolvePromise(readTimedOut), 1_000),
      ),
    ]);
    if (value !== readTimedOut && accept(value)) {
      return value;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
  }
  throw new Error(`Timed out waiting for ${description}`);
};

const fixtureBody = (path) => {
  if (path === '/shadow') {
    return `<!doctype html><title>Shadow Fixture</title><style>button{color:black}</style><main><div id="shadow-host"></div></main><script>document.querySelector('#shadow-host').attachShadow({mode:'open'}).innerHTML='<button id="shadow-save">Shadow Save</button>'</script>`;
  }
  return `<!doctype html><title>Account Fixture</title><style>button{color:black}</style><main><button id="save">Save</button></main>`;
};

const providerResponse = async (payload) => {
  const userInput = payload.input?.find((entry) => entry.role === 'user');
  const submitted = JSON.parse(userInput?.content ?? '{}');
  const pageContext = submitted.pageContext;
  const target = pageContext?.elements?.find(
    (element) =>
      element.accessibleName === 'Save' ||
      element.accessibleName === 'Shadow Save',
  );
  assert.ok(target?.elementId);
  const isShadow = pageContext.path === '/shadow';
  const isHeld = submitted.request === 'Hold a stale green preview.';
  report.providerRequestCount += 1;
  if (isHeld) {
    heldRequestObserved = true;
    await heldRequestGate;
  }
  return {
    model: 'packed-model',
    output: [
      {
        content: [
          {
            type: 'output_text',
            text: JSON.stringify({
              schemaVersion: 1,
              assistantMessage: 'Preview ready',
              clarification: null,
              operations: [
                {
                  kind: 'style',
                  operationId: isShadow
                    ? 'style-shadow-save'
                    : 'style-account-save',
                  target: {
                    kind: 'ephemeral',
                    elementId: target.elementId,
                  },
                  declarations: [
                    {
                      property: 'color',
                      value: isHeld ? 'green' : isShadow ? 'blue' : 'crimson',
                    },
                  ],
                },
              ],
            }),
          },
        ],
      },
    ],
  };
};

const startProviderServer = async () => {
  const certificateDirectory = await mkdtemp(
    resolve(tmpdir(), 'match-my-exp-certificate-'),
  );
  temporaryDirectories.push(certificateDirectory);
  const keyPath = resolve(certificateDirectory, 'key.pem');
  const certificatePath = resolve(certificateDirectory, 'certificate.pem');
  await executeFile('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    keyPath,
    '-out',
    certificatePath,
    '-days',
    '1',
    '-subj',
    '/CN=127.0.0.1',
  ]);
  const server = createServer(
    {
      key: await readFile(keyPath),
      cert: await readFile(certificatePath),
    },
    (request, response) => {
      if (request.method !== 'POST') {
        response.writeHead(405).end();
        return;
      }
      const chunks = [];
      let bytes = 0;
      request.on('data', (chunk) => {
        bytes += chunk.length;
        if (bytes <= 1024 * 1024) {
          chunks.push(chunk);
        }
      });
      request.on('end', async () => {
        try {
          assert.ok(bytes <= 1024 * 1024);
          const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          const body = JSON.stringify(await providerResponse(payload));
          response.writeHead(200, {
            'access-control-allow-origin': '*',
            'content-type': 'application/json',
          });
          response.end(body);
        } catch {
          response.writeHead(400).end();
        }
      });
    },
  );
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  providerServer = server;
  providerOrigin = `https://127.0.0.1:${address.port}`;
  providerEndpoint = `${providerOrigin}/v1/responses`;
};

const installRoutes = (context) =>
  context.route(`${siteOrigin}/**`, (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      contentType: 'text/html',
      body: fixtureBody(path),
    });
  });

const launch = async (userDataDirectory, extensionPath) => {
  const context = await chromium.launchPersistentContext(userDataDirectory, {
    headless: true,
    channel: 'chromium',
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--ignore-certificate-errors',
    ],
  });
  activeContext = context;
  await installRoutes(context);
  return context;
};

const extensionWorker = async (context) =>
  context.serviceWorkers()[0] ?? context.waitForEvent('serviceworker');

const activateExtension = async (context, extensionId, page) => {
  const cdp = await context.browser().newBrowserCDPSession();
  const { targetInfos } = await cdp.send('Target.getTargets', {
    filter: [{ type: 'tab' }],
  });
  const target = targetInfos.find(
    ({ type, url }) => type === 'tab' && url === page.url(),
  );
  assert.ok(target);
  await cdp.send('Extensions.triggerAction', {
    id: extensionId,
    targetId: target.targetId,
  });
  return cdp;
};

const openPanelHarness = async (context, worker, fixture) => {
  const extensionId = new URL(worker.url()).hostname;
  await activateExtension(context, extensionId, fixture);
  const fixtureTab = await worker.evaluate(
    async (origin) => (await chrome.tabs.query({ url: `${origin}/*` }))[0],
    siteOrigin,
  );
  assert.ok(fixtureTab?.id);
  const panel = await context.newPage();
  panel.on('pageerror', () => {
    report.panelErrorCount += 1;
  });
  panel.on('dialog', (dialog) => void dialog.accept());
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await worker.evaluate(
    async (tabId) => chrome.tabs.update(tabId, { active: true }),
    fixtureTab.id,
  );
  await panel.getByText(`Ready for ${fixture.url()}`).waitFor();
  return panel;
};

const configureProvider = async (panel) => {
  await panel.getByRole('combobox').first().selectOption('compatible');
  await panel.getByLabel('Model').fill('packed-model');
  await panel.getByLabel('Responses endpoint').fill(providerEndpoint);
  await panel.getByLabel('Authentication').selectOption('bearer');
  await panel.getByLabel('API key', { exact: true }).fill('packed-test-key');
  await panel.getByRole('button', { name: 'Save provider' }).click();
  await panel.getByText('Provider configured').waitFor();
};

const grantCurrentSite = async (panel) => {
  const alreadyGranted = await panel
    .getByText('Site access granted')
    .isVisible()
    .catch(() => false);
  if (!alreadyGranted) {
    await panel.getByRole('button', { name: 'Grant site access' }).click();
  }
  await panel.getByText('Site access granted').waitFor();
};

const saveCurrentProfile = async (panel, page, selector, color, intent) => {
  await panel.getByLabel('Describe the change').fill(intent);
  await panel.getByRole('button', { name: 'Send' }).click();
  await panel.getByRole('button', { name: 'Keep preview' }).waitFor();
  await waitForColor(page, selector, color);
  await panel.getByRole('button', { name: 'Keep preview' }).click();
  await panel.getByText('Saved for this page.').waitFor();
};

const computedColor = (page, selector) =>
  page.locator(selector).evaluate((element) => getComputedStyle(element).color);

const waitForColor = (page, selector, color) =>
  waitFor(
    () => computedColor(page, selector),
    (value) => value === color,
    `${selector} color ${color}`,
  );

const registrations = (worker) =>
  worker.evaluate(() => chrome.scripting.getRegisteredContentScripts());

const waitForRegistrationCount = (worker, count) =>
  waitFor(
    () => registrations(worker),
    (value) => value.length === count,
    `${count} content-script registrations`,
  );

const writeReport = async () => {
  await mkdir(artifactDirectory, { recursive: true });
  const output = JSON.stringify(report, null, 2);
  for (const forbidden of ['packed-test-key', 'private', 'token=']) {
    assert.equal(output.includes(forbidden), false);
  }
  await writeFile(resolve(artifactDirectory, 'result.json'), `${output}\n`);
};

try {
  await rm(artifactDirectory, { recursive: true, force: true });
  await startProviderServer();
  const sourceManifestText = await readFile(
    resolve(extensionSource, 'manifest.json'),
    'utf8',
  );
  const sourceManifest = JSON.parse(sourceManifestText);

  report.stage = 'fresh-install';
  const freshDirectory = await mkdtemp(
    resolve(tmpdir(), 'match-my-exp-fresh-'),
  );
  temporaryDirectories.push(freshDirectory);
  const freshExtension = resolve(freshDirectory, 'extension');
  await cp(extensionSource, freshExtension, { recursive: true });
  let context = await launch(freshDirectory, freshExtension);
  let worker = await extensionWorker(context);
  const freshManifest = await worker.evaluate(() =>
    chrome.runtime.getManifest(),
  );
  assert.deepEqual(freshManifest.host_permissions ?? [], []);
  assert.deepEqual(freshManifest.optional_host_permissions, ['https://*/*']);
  const freshPermissions = await worker.evaluate(() =>
    chrome.permissions.getAll(),
  );
  assert.deepEqual(freshPermissions.origins ?? [], []);
  complete('fresh-install');
  await context.close();
  activeContext = undefined;

  report.stage = 'predecessor-profile-setup';
  const matrixDirectory = await mkdtemp(
    resolve(tmpdir(), 'match-my-exp-matrix-'),
  );
  temporaryDirectories.push(matrixDirectory);
  const matrixExtension = resolve(matrixDirectory, 'extension');
  await cp(extensionSource, matrixExtension, { recursive: true });
  const predecessorManifest = {
    ...sourceManifest,
    version: '0.0.1',
    host_permissions: [`${siteOrigin}/*`, `${providerOrigin}/*`],
  };
  await writeFile(
    resolve(matrixExtension, 'manifest.json'),
    JSON.stringify(predecessorManifest),
  );
  context = await launch(matrixDirectory, matrixExtension);
  worker = await extensionWorker(context);
  const account = await context.newPage();
  await account.goto(`${siteOrigin}/account`);
  const panel = await openPanelHarness(context, worker, account);
  await configureProvider(panel);
  await grantCurrentSite(panel);
  await saveCurrentProfile(
    panel,
    account,
    '#save',
    accountColor,
    'Make the Save button crimson.',
  );
  await waitForColor(account, '#save', accountColor);
  await waitForRegistrationCount(worker, 1);

  await account.goto(`${siteOrigin}/shadow`);
  await panel.getByText(`Ready for ${siteOrigin}/shadow`).waitFor();
  await grantCurrentSite(panel);
  await saveCurrentProfile(
    panel,
    account,
    '#shadow-save',
    shadowColor,
    'Make the Shadow Save button blue.',
  );
  await waitForColor(account, '#shadow-save', shadowColor);

  await account.goto(`${siteOrigin}/account`);
  const other = await context.newPage();
  await other.goto(`${siteOrigin}/other`);
  const accountTab = await worker.evaluate(
    async (url) => (await chrome.tabs.query({ url }))[0],
    `${siteOrigin}/account`,
  );
  assert.ok(accountTab?.id);
  await worker.evaluate(
    async (tabId) => chrome.tabs.update(tabId, { active: true }),
    accountTab.id,
  );
  await panel.getByText(`Ready for ${siteOrigin}/account`).waitFor();
  await grantCurrentSite(panel);
  await panel
    .getByLabel('Describe the change')
    .fill('Hold a stale green preview.');
  await panel.getByRole('button', { name: 'Send' }).click();
  await waitFor(
    async () => heldRequestObserved,
    (observed) => observed,
    'held provider request',
  );
  const otherTab = await worker.evaluate(
    async (url) => (await chrome.tabs.query({ url }))[0],
    `${siteOrigin}/other`,
  );
  assert.ok(otherTab?.id);
  await worker.evaluate(
    async (tabId) => chrome.tabs.update(tabId, { active: true }),
    otherTab.id,
  );
  releaseHeldRequest();
  await panel.getByRole('alert').waitFor();
  await waitForColor(account, '#save', accountColor);
  await waitForColor(other, '#save', 'rgb(0, 0, 0)');

  const storedState = await worker.evaluate(() =>
    chrome.storage.local.get('profileRepository'),
  );
  const storedProfiles = Object.values(
    storedState.profileRepository?.profiles ?? {},
  );
  assert.equal(storedProfiles.length, 2);
  assert.equal(
    JSON.stringify(storedProfiles).includes('"kind":"ephemeral"'),
    false,
  );
  assert.equal(report.providerRequestCount, 3);
  complete('predecessor-profile-setup');
  await context.close();
  activeContext = undefined;

  report.stage = 'candidate-update-reload-spa-shadow';
  await writeFile(
    resolve(matrixExtension, 'manifest.json'),
    sourceManifestText,
  );
  assert.equal(
    await readFile(resolve(matrixExtension, 'manifest.json'), 'utf8'),
    sourceManifestText,
  );
  context = await launch(matrixDirectory, matrixExtension);
  worker = await extensionWorker(context);
  assert.equal(
    await worker.evaluate(() => chrome.runtime.getManifest().version),
    sourceManifest.version,
  );
  const retainedAccess = await worker.evaluate(
    async ({ site, provider }) =>
      chrome.permissions.contains({ origins: [site, provider] }),
    { site: `${siteOrigin}/*`, provider: `${providerOrigin}/*` },
  );
  assert.equal(retainedAccess, true);
  await waitForRegistrationCount(worker, 1);
  const candidatePage = await context.newPage();
  await candidatePage.goto(`${siteOrigin}/account`);
  await waitForColor(candidatePage, '#save', accountColor);
  assert.equal(report.providerRequestCount, 3);

  await candidatePage.reload();
  await waitForColor(candidatePage, '#save', accountColor);
  await candidatePage.evaluate(() => history.pushState({}, '', '/other'));
  await waitForColor(candidatePage, '#save', 'rgb(0, 0, 0)');
  await candidatePage.evaluate(() => history.pushState({}, '', '/account'));
  await waitForColor(candidatePage, '#save', accountColor);

  await candidatePage.goto(`${siteOrigin}/shadow`);
  await waitForColor(candidatePage, '#shadow-save', shadowColor);
  assert.equal(report.providerRequestCount, 3);
  complete('candidate-update-reload-spa-shadow');

  report.stage = 'worker-termination';
  const cdp = await context.browser().newBrowserCDPSession();
  const { targetInfos } = await cdp.send('Target.getTargets');
  const workerTarget = targetInfos.find(
    ({ type, url }) =>
      type === 'service_worker' &&
      url.startsWith(`chrome-extension://${new URL(worker.url()).hostname}/`),
  );
  assert.ok(workerTarget);
  await cdp.send('Target.closeTarget', { targetId: workerTarget.targetId });
  await candidatePage.reload();
  await waitForColor(candidatePage, '#shadow-save', shadowColor);
  assert.equal(report.providerRequestCount, 3);
  complete('worker-termination');

  report.stage = 'browser-restart-and-revocation';
  await context.close();
  activeContext = undefined;
  context = await launch(matrixDirectory, matrixExtension);
  worker = await extensionWorker(context);
  await waitForRegistrationCount(worker, 1);
  const restartedPage = await context.newPage();
  await restartedPage.goto(`${siteOrigin}/account`);
  await waitForColor(restartedPage, '#save', accountColor);
  assert.equal(report.providerRequestCount, 3);

  const removed = await worker.evaluate(
    async (origin) => chrome.permissions.remove({ origins: [`${origin}/*`] }),
    siteOrigin,
  );
  assert.equal(removed, true);
  await waitForColor(restartedPage, '#save', 'rgb(0, 0, 0)');
  await waitForRegistrationCount(worker, 0);
  await restartedPage.reload();
  await waitForColor(restartedPage, '#save', 'rgb(0, 0, 0)');
  assert.equal(report.providerRequestCount, 3);
  complete('browser-restart-and-revocation');

  report.status = 'passed';
  report.stage = 'complete';
} catch (error) {
  report.status = 'failed';
  report.failureType =
    error instanceof Error && error.name.length > 0
      ? error.name
      : 'UnknownError';
  throw error;
} finally {
  if (activeContext !== undefined) {
    await activeContext.close();
  }
  if (providerServer !== undefined) {
    await new Promise((resolvePromise) => providerServer.close(resolvePromise));
  }
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
  await writeReport();
}

process.stdout.write('Packed extension lifecycle matrix passed\n');
