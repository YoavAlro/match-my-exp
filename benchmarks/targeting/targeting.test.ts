import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { chromium, type Browser } from 'playwright';
import { runCase } from './campaign';
import { loadCorpus } from './corpus';
import { evaluateSelection } from './evaluate';
import { capturePageContext, countTargetProbes } from './extract';
import { fixtureById, fixtureDefinitions, prepareFixture } from './fixtures';
import type { ProviderDecision, TargetingProvider } from './provider';
import { TargetingDecisionSchema, type TargetingDecision } from './schemas';

class FakeProvider implements TargetingProvider {
  readonly #decisions: ProviderDecision[];

  constructor(decisions: ProviderDecision[]) {
    this.#decisions = decisions;
  }

  async decide() {
    const decision = this.#decisions.shift();
    if (decision === undefined) {
      throw new Error('No fake decision remains');
    }
    return decision;
  }
}

const providerDecision = (decision: TargetingDecision): ProviderDecision => ({
  decision,
  responseId: 'response-test',
  responseModel: 'model-test',
  systemFingerprint: 'fingerprint-test',
});

describe('targeting benchmark', () => {
  let browser: Browser;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
  });

  afterAll(async () => {
    await browser.close();
  });

  it('has a balanced frozen corpus with explicit ambiguity cases', async () => {
    const corpus = await loadCorpus();
    expect(corpus.cases).toHaveLength(25);
    for (const category of [
      'static',
      'spa',
      'repeated',
      'responsive',
      'shadow',
    ]) {
      const cases = corpus.cases.filter(
        (benchmarkCase) => benchmarkCase.category === category,
      );
      expect(cases).toHaveLength(5);
      expect(
        cases.filter(({ initialDecision }) => initialDecision === 'clarify'),
      ).toHaveLength(1);
    }
  });

  it('captures bounded browser contexts and every oracle target', async () => {
    const corpus = await loadCorpus();
    for (const fixture of fixtureDefinitions) {
      const page = await browser.newPage();
      await prepareFixture(page, fixture);
      const captured = await capturePageContext(page, 'test');
      expect(captured.context.elements.length).toBeLessThanOrEqual(250);
      expect(captured.serializedBytes).toBeLessThanOrEqual(65_536);
      const serialized = JSON.stringify(captured.context);
      expect(serialized).not.toContain('data-benchmark');
      expect(serialized).not.toContain('password-static-secret');
      expect(serialized).not.toContain('hidden-static-secret');
      expect(serialized).not.toContain('closed-shadow-secret');
      expect(serialized).not.toContain('hidden-labelled-secret');
      expect(serialized).not.toContain('script-labelled-secret');
      expect(serialized).not.toContain('hidden-form-label-secret');
      expect(serialized).not.toContain('textarea-form-secret');
      expect(serialized).not.toContain('nested-hidden-secret');
      expect(serialized).not.toContain('nested-aria-secret');
      expect(serialized).not.toContain('nested-display-secret');
      expect(serialized).not.toContain('nested-opacity-secret');
      expect(serialized).not.toContain('hidden-ancestor-form-secret');
      expect(serialized).not.toContain('external-textarea-secret');
      for (const benchmarkCase of corpus.cases.filter(
        ({ fixtureId }) => fixtureId === fixture.id,
      )) {
        for (const key of benchmarkCase.expectedTargetKeys) {
          expect(captured.oracle[key]).toMatch(/^element-test-/);
        }
      }
      if (fixture.id === 'spa-inbox') {
        expect(captured.context.path).toBe('/app/inbox');
      }
      if (fixture.id === 'shadow-preferences') {
        expect(
          captured.context.elements.some(
            ({ shadowHostId }) => shadowHostId !== undefined,
          ),
        ).toBe(true);
      }
      if (fixture.id === 'responsive-desktop') {
        expect(captured.oracle['desktop-sidebar']).toBeDefined();
        expect(captured.oracle['mobile-bottom-nav']).toBeUndefined();
      }
      if (fixture.id === 'responsive-mobile') {
        expect(captured.oracle['desktop-sidebar']).toBeUndefined();
        expect(captured.oracle['mobile-bottom-nav']).toBeDefined();
      }
      await page.close();
    }
  }, 60_000);

  it('scores exact targets and rejects unknown or extra identifiers', async () => {
    const corpus = await loadCorpus();
    const benchmarkCase = corpus.cases.find(
      ({ id }) => id === 'static-section-headings',
    );
    if (benchmarkCase === undefined) {
      throw new Error('Benchmark corpus is empty');
    }
    const fixture = fixtureById.get(benchmarkCase.fixtureId);
    if (fixture === undefined) {
      throw new Error('Benchmark fixture is missing');
    }
    const page = await browser.newPage();
    await prepareFixture(page, fixture);
    const captured = await capturePageContext(page, 'score');
    const expected = benchmarkCase.expectedTargetKeys.map(
      (key) => captured.oracle[key] ?? '',
    );
    const exactDecision: TargetingDecision = {
      schemaVersion: 1,
      decision: 'select',
      selectedElementIds: expected.toReversed(),
      clarificationQuestion: null,
    };
    expect(
      evaluateSelection(
        exactDecision,
        benchmarkCase,
        captured.context,
        captured.oracle,
      ),
    ).toMatchObject({ validIds: true, exactTargets: true });
    const extraValidId = captured.context.elements.find(
      ({ elementId }) => !expected.includes(elementId),
    )?.elementId;
    if (extraValidId === undefined) {
      throw new Error('No extra valid element ID exists');
    }
    expect(
      evaluateSelection(
        {
          ...exactDecision,
          selectedElementIds: [...expected, extraValidId],
        },
        benchmarkCase,
        captured.context,
        captured.oracle,
      ),
    ).toMatchObject({ validIds: true, exactTargets: false });
    expect(
      evaluateSelection(
        {
          ...exactDecision,
          selectedElementIds: [...expected, 'element-score-unknown'],
        },
        benchmarkCase,
        captured.context,
        captured.oracle,
      ),
    ).toMatchObject({ validIds: false, exactTargets: false });
    await page.close();
  });

  it('enforces relevant clarification and probe behavior', async () => {
    const corpus = await loadCorpus();
    const benchmarkCase = corpus.cases.find(
      ({ id }) => id === 'repeated-ambiguous-renew',
    );
    if (benchmarkCase === undefined) {
      throw new Error('Ambiguity case is missing');
    }
    const fixture = fixtureById.get(benchmarkCase.fixtureId);
    if (fixture === undefined) {
      throw new Error('Benchmark fixture is missing');
    }
    const page = await browser.newPage();
    await prepareFixture(page, fixture);
    const captured = await capturePageContext(page, 'campaign');
    const expectedElementId =
      captured.oracle[benchmarkCase.expectedTargetKeys[0] ?? ''];
    if (expectedElementId === undefined) {
      throw new Error('Expected target is missing');
    }

    const passing = await runCase(
      benchmarkCase,
      { page, captured },
      new FakeProvider([
        providerDecision({
          schemaVersion: 1,
          decision: 'clarify',
          selectedElementIds: [],
          clarificationQuestion: 'Which Renew button and plan do you mean?',
        }),
        providerDecision({
          schemaVersion: 1,
          decision: 'select',
          selectedElementIds: [expectedElementId],
          clarificationQuestion: null,
        }),
      ]),
    );
    expect(passing).toMatchObject({ success: true, ambiguousMutation: false });
    expect(await countTargetProbes(page)).toBe(1);

    const wrongSelection = await runCase(
      benchmarkCase,
      { page, captured },
      new FakeProvider([
        providerDecision({
          schemaVersion: 1,
          decision: 'select',
          selectedElementIds: [expectedElementId],
          clarificationQuestion: null,
        }),
      ]),
    );
    expect(wrongSelection).toMatchObject({
      success: false,
      ambiguousMutation: true,
      failure: 'expected_initial_clarification',
    });

    const irrelevant = await runCase(
      benchmarkCase,
      { page, captured },
      new FakeProvider([
        providerDecision({
          schemaVersion: 1,
          decision: 'clarify',
          selectedElementIds: [],
          clarificationQuestion: 'Can you clarify?',
        }),
      ]),
    );
    expect(irrelevant).toMatchObject({
      success: false,
      ambiguousMutation: false,
      failure: 'irrelevant_clarification_question',
    });
    expect(await countTargetProbes(page)).toBe(0);

    const echoedRequest = await runCase(
      benchmarkCase,
      { page, captured },
      new FakeProvider([
        providerDecision({
          schemaVersion: 1,
          decision: 'clarify',
          selectedElementIds: [],
          clarificationQuestion: 'Make the Renew button for the plan larger.',
        }),
      ]),
    );
    expect(echoedRequest).toMatchObject({
      success: false,
      failure: 'irrelevant_clarification_question',
    });
    await page.close();
  });

  it('requires clarification decisions to contain no target IDs', () => {
    expect(
      TargetingDecisionSchema.safeParse({
        schemaVersion: 1,
        decision: 'clarify',
        selectedElementIds: [],
        clarificationQuestion: 'Which Save button?',
      }).success,
    ).toBe(true);
    expect(
      TargetingDecisionSchema.safeParse({
        schemaVersion: 1,
        decision: 'clarify',
        selectedElementIds: ['element-test-1'],
        clarificationQuestion: 'Which Save button?',
      }).success,
    ).toBe(false);
  });
});
