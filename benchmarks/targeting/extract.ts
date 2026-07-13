import { resolve } from 'node:path';
import type { Page } from 'playwright';
import {
  PageContextSchema,
  type PageContext,
} from '../../src/modules/contracts';

interface BrowserCapture {
  context: unknown;
  oracle: Record<string, string>;
  serializedBytes: number;
}

export interface CapturedPageContext {
  context: PageContext;
  oracle: Record<string, string>;
  serializedBytes: number;
}

const browserRuntimePath = resolve('benchmarks/targeting/browser-runtime.js');

const installBrowserRuntime = async (page: Page) => {
  const installed = await page.evaluate(
    'typeof globalThis.targetingBenchmark === "object"',
  );
  if (!installed) {
    await page.addScriptTag({ path: browserRuntimePath });
  }
};

export const capturePageContext = async (
  page: Page,
  seed: string,
): Promise<CapturedPageContext> => {
  await installBrowserRuntime(page);
  const captured = (await page.evaluate(
    `globalThis.targetingBenchmark.capture(${JSON.stringify(seed)})`,
  )) as BrowserCapture;
  if (captured.serializedBytes > 65_536) {
    throw new Error('Targeting context exceeds the 64 KiB budget');
  }
  const context = PageContextSchema.parse(captured.context);
  if (context.elements.length > 250) {
    throw new Error('Targeting context exceeds the 250 element budget');
  }
  return {
    context,
    oracle: captured.oracle,
    serializedBytes: captured.serializedBytes,
  };
};

export const clearTargetProbes = async (page: Page) => {
  await installBrowserRuntime(page);
  await page.evaluate('globalThis.targetingBenchmark.clearProbes()');
};

export const probeTargets = async (
  page: Page,
  elementIds: readonly string[],
) => {
  await installBrowserRuntime(page);
  return page.evaluate(
    `globalThis.targetingBenchmark.probe(${JSON.stringify(elementIds)})`,
  ) as Promise<number>;
};

export const countTargetProbes = async (page: Page) => {
  await installBrowserRuntime(page);
  return page.evaluate(
    'globalThis.targetingBenchmark.countProbes()',
  ) as Promise<number>;
};
