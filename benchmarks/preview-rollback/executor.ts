import { resolve } from 'node:path';
import type { Page } from 'playwright';
import {
  ProposalOperationSchema,
  type ProposalOperation,
} from '../../src/modules/contracts';

export interface PreviewRequest {
  previewId: string;
  expectedOrigin: string;
  expectedPath: string;
  operations: ProposalOperation[];
}

export interface PreviewResult {
  status: 'active' | 'rejected' | 'rolled-back';
  reason?: string;
  conflicts: string[];
  mutations: number;
}

export interface ApplyOptions {
  failAfterMutation?: number;
}

const browserRuntimePath = resolve(
  'benchmarks/preview-rollback/browser-runtime.js',
);

const installRuntime = async (page: Page) => {
  const installed = await page.evaluate(
    'typeof globalThis.previewRollbackSpike === "object"',
  );
  if (!installed) {
    await page.addScriptTag({ path: browserRuntimePath });
  }
};

const serialize = (value: unknown) => JSON.stringify(value);

export const applyPreview = async (
  page: Page,
  request: PreviewRequest,
  options: ApplyOptions = {},
) => {
  const operations = request.operations.map((operation) =>
    ProposalOperationSchema.parse(operation),
  );
  if (operations.some(({ kind }) => kind === 'keyboard')) {
    throw new Error('The rollback spike does not execute keyboard operations');
  }
  await installRuntime(page);
  return page.evaluate(
    `globalThis.previewRollbackSpike.apply(${serialize({ ...request, operations })}, ${serialize(options)})`,
  ) as Promise<PreviewResult>;
};

export const rollbackPreview = async (page: Page, previewId: string) => {
  await installRuntime(page);
  return page.evaluate(
    `globalThis.previewRollbackSpike.rollback(${serialize(previewId)})`,
  ) as Promise<PreviewResult>;
};

export const previewStatus = async (page: Page) => {
  await installRuntime(page);
  return page.evaluate('globalThis.previewRollbackSpike.status()') as Promise<{
    activePreviewId: string | null;
    markerCount: number;
  }>;
};
