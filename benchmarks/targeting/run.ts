import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';
import { runCase, type CaseResult } from './campaign';
import { loadCorpus, readCorpusSource } from './corpus';
import { capturePageContext } from './extract';
import { fixtureById, prepareFixture } from './fixtures';
import { targetingSystemPrompt } from './prompt';
import { AzureTargetingProvider } from './provider';

const sha256 = (value: string) =>
  createHash('sha256').update(value).digest('hex');

const caseSeed = (caseId: string) => sha256(caseId).slice(0, 8);

const main = async () => {
  const workingTree = execFileSync('git', ['status', '--porcelain'], {
    encoding: 'utf8',
  }).trim();
  if (workingTree.length > 0) {
    throw new Error('Commit the frozen benchmark before running live evidence');
  }

  const provider = new AzureTargetingProvider();
  const corpus = await loadCorpus();
  const browser = await chromium.launch({ headless: true });
  const pages = new Map<string, Awaited<ReturnType<typeof browser.newPage>>>();
  const contexts: [string, unknown][] = [];
  const results: CaseResult[] = [];
  try {
    for (const benchmarkCase of corpus.cases) {
      const definition = fixtureById.get(benchmarkCase.fixtureId);
      if (
        definition === undefined ||
        definition.category !== benchmarkCase.category
      ) {
        throw new Error('Benchmark case references an invalid fixture');
      }
      let page = pages.get(definition.id);
      if (page === undefined) {
        page = await browser.newPage();
        await prepareFixture(page, definition);
        pages.set(definition.id, page);
      }
      const captured = await capturePageContext(
        page,
        caseSeed(benchmarkCase.id),
      );
      contexts.push([benchmarkCase.id, captured.context]);
      const result = await runCase(benchmarkCase, { page, captured }, provider);
      results.push(result);
      process.stdout.write(
        `${result.success ? 'PASS' : 'FAIL'} ${result.id}${result.failure === undefined ? '' : `: ${result.failure}`}\n`,
      );
    }
  } finally {
    await browser.close();
  }

  const categories = ['static', 'spa', 'repeated', 'responsive', 'shadow'];
  const categorySummary = Object.fromEntries(
    categories.map((category) => {
      const categoryResults = results.filter(
        (result) => result.category === category,
      );
      return [
        category,
        {
          successful: categoryResults.filter(({ success }) => success).length,
          total: categoryResults.length,
        },
      ];
    }),
  );
  const successful = results.filter(({ success }) => success).length;
  const ambiguousMutations = results.filter(
    ({ ambiguousMutation }) => ambiguousMutation,
  ).length;
  const ambiguousClarifications = results.filter(
    (result) =>
      result.expectedInitialDecision === 'clarify' &&
      result.actualInitialDecision === 'clarify' &&
      result.failure !== 'irrelevant_clarification_question',
  ).length;
  const ambiguousTotal = results.filter(
    ({ expectedInitialDecision }) => expectedInitialDecision === 'clarify',
  ).length;
  const categoryGate = Object.values(categorySummary).every(
    ({ successful: categorySuccessful, total }) =>
      total === 5 && categorySuccessful >= 4,
  );
  const responseModels = [
    ...new Set(
      results.flatMap(({ providerCalls }) =>
        providerCalls.map(({ responseModel }) => responseModel),
      ),
    ),
  ];
  const passed =
    results.length === 25 &&
    successful >= 23 &&
    categoryGate &&
    ambiguousMutations === 0 &&
    ambiguousClarifications === ambiguousTotal &&
    responseModels.length === 1;

  const evidence = {
    schemaVersion: 1,
    benchmarkVersion: 1,
    sourceCommit: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    recordedAt: new Date().toISOString(),
    provider: 'azure-openai',
    deployment: provider.model,
    responseModels,
    configuration: {
      reasoningEffort: 'low',
      maxOutputTokens: 1_024,
      semanticRetries: 0,
      idStrategy: 'case-id-sha256-prefix',
    },
    hashes: {
      corpusSha256: sha256(await readCorpusSource()),
      promptSha256: sha256(targetingSystemPrompt),
      contextsSha256: sha256(
        JSON.stringify(
          contexts.toSorted(([left], [right]) => left.localeCompare(right)),
        ),
      ),
    },
    summary: {
      passed,
      successful,
      total: results.length,
      successRate: successful / results.length,
      ambiguousClarifications,
      ambiguousTotal,
      ambiguousMutations,
      categoryGate,
      categories: categorySummary,
    },
    cases: results,
  };

  const evidenceDirectory = resolve('benchmarks/targeting/evidence');
  await mkdir(evidenceDirectory, { recursive: true });
  await writeFile(
    resolve(evidenceDirectory, `azure-${provider.model}.json`),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
  process.stdout.write(
    `SUMMARY ${successful}/${results.length}, ambiguous mutations ${ambiguousMutations}\n`,
  );
  if (!passed) {
    process.exitCode = 1;
  }
};

await main();
