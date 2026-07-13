import { createHash } from 'node:crypto';
import type { Page } from 'playwright';
import { evaluateSelection } from './evaluate';
import {
  clearTargetProbes,
  countTargetProbes,
  probeTargets,
  type CapturedPageContext,
} from './extract';
import { appendClarificationTurns, createInitialTurns } from './prompt';
import {
  BenchmarkProviderError,
  type ProviderDecision,
  type TargetingProvider,
} from './provider';
import type {
  BenchmarkCase,
  BenchmarkCategory,
  TargetingDecision,
} from './schemas';

export interface PreparedFixture {
  page: Page;
  captured: CapturedPageContext;
}

export interface ProviderCallEvidence {
  responseIdSha256: string;
  responseModel: string;
  systemFingerprint: string | null;
}

export interface CaseResult {
  id: string;
  category: BenchmarkCategory;
  fixtureId: string;
  expectedInitialDecision: 'select' | 'clarify';
  actualInitialDecision?: 'select' | 'clarify';
  initialSelectedElementIds?: string[];
  clarificationQuestion?: string | null;
  finalSelectedElementIds?: string[];
  expectedElementIds: string[];
  providerCalls: ProviderCallEvidence[];
  success: boolean;
  ambiguousMutation: boolean;
  failure?: string;
}

const hashResponseId = (responseId: string) =>
  createHash('sha256').update(responseId).digest('hex');

const providerEvidence = ({
  responseId,
  responseModel,
  systemFingerprint,
}: ProviderDecision): ProviderCallEvidence => ({
  responseIdSha256: hashResponseId(responseId),
  responseModel,
  systemFingerprint,
});

const expectedIds = (benchmarkCase: BenchmarkCase, fixture: PreparedFixture) =>
  benchmarkCase.expectedTargetKeys
    .map((key) => {
      const elementId = fixture.captured.oracle[key];
      if (elementId === undefined) {
        throw new Error('missing_oracle_target');
      }
      return elementId;
    })
    .toSorted();

const applyProbe = async (
  fixture: PreparedFixture,
  decision: TargetingDecision,
) => {
  const contextIds = new Set(
    fixture.captured.context.elements.map(({ elementId }) => elementId),
  );
  if (
    decision.decision !== 'select' ||
    !decision.selectedElementIds.every((elementId) => contextIds.has(elementId))
  ) {
    return 0;
  }
  return probeTargets(fixture.page, decision.selectedElementIds);
};

const isRelevantClarification = (
  benchmarkCase: BenchmarkCase,
  question: string,
) => {
  const normalizedQuestion = question.trim().toLowerCase();
  const interrogative =
    normalizedQuestion.endsWith('?') &&
    /^(?:which|what|where|do you|did you|would you|could you|should|are you|is it)\b/.test(
      normalizedQuestion,
    );
  return (
    interrogative &&
    benchmarkCase.clarificationKeywords.every((keyword) =>
      normalizedQuestion.includes(keyword.toLowerCase()),
    )
  );
};

export const runCase = async (
  benchmarkCase: BenchmarkCase,
  fixture: PreparedFixture,
  provider: TargetingProvider,
): Promise<CaseResult> => {
  await clearTargetProbes(fixture.page);
  const result: CaseResult = {
    id: benchmarkCase.id,
    category: benchmarkCase.category,
    fixtureId: benchmarkCase.fixtureId,
    expectedInitialDecision: benchmarkCase.initialDecision,
    expectedElementIds: expectedIds(benchmarkCase, fixture),
    providerCalls: [],
    success: false,
    ambiguousMutation: false,
  };

  try {
    const turns = createInitialTurns(
      benchmarkCase.request,
      fixture.captured.context,
    );
    const initialProviderDecision = await provider.decide(turns);
    result.providerCalls.push(providerEvidence(initialProviderDecision));
    const initialDecision = initialProviderDecision.decision;
    result.actualInitialDecision = initialDecision.decision;
    result.initialSelectedElementIds = initialDecision.selectedElementIds;
    result.clarificationQuestion = initialDecision.clarificationQuestion;

    if (benchmarkCase.initialDecision === 'clarify') {
      if (initialDecision.decision !== 'clarify') {
        await applyProbe(fixture, initialDecision);
        result.ambiguousMutation = (await countTargetProbes(fixture.page)) > 0;
        result.failure = 'expected_initial_clarification';
        return result;
      }
      result.ambiguousMutation = (await countTargetProbes(fixture.page)) > 0;
      if (
        initialDecision.clarificationQuestion === null ||
        !isRelevantClarification(
          benchmarkCase,
          initialDecision.clarificationQuestion,
        )
      ) {
        result.failure = 'irrelevant_clarification_question';
        return result;
      }
      const answer = benchmarkCase.clarificationAnswer;
      if (answer === null) {
        throw new Error('missing_clarification_answer');
      }
      const finalProviderDecision = await provider.decide(
        appendClarificationTurns(turns, initialDecision, answer),
      );
      result.providerCalls.push(providerEvidence(finalProviderDecision));
      const finalDecision = finalProviderDecision.decision;
      result.finalSelectedElementIds = finalDecision.selectedElementIds;
      if (finalDecision.decision !== 'select') {
        result.failure = 'second_clarification_requested';
        return result;
      }
      const evaluation = evaluateSelection(
        finalDecision,
        benchmarkCase,
        fixture.captured.context,
        fixture.captured.oracle,
      );
      const probed = await applyProbe(fixture, finalDecision);
      result.success =
        evaluation.validIds &&
        evaluation.exactTargets &&
        probed === finalDecision.selectedElementIds.length &&
        !result.ambiguousMutation;
      if (!result.success) {
        result.failure = 'incorrect_final_selection';
      }
      return result;
    }

    if (initialDecision.decision !== 'select') {
      result.failure = 'unexpected_clarification';
      return result;
    }
    const evaluation = evaluateSelection(
      initialDecision,
      benchmarkCase,
      fixture.captured.context,
      fixture.captured.oracle,
    );
    const probed = await applyProbe(fixture, initialDecision);
    result.success =
      evaluation.validIds &&
      evaluation.exactTargets &&
      probed === initialDecision.selectedElementIds.length;
    if (!result.success) {
      result.failure = 'incorrect_initial_selection';
    }
    return result;
  } catch (error) {
    result.failure =
      error instanceof BenchmarkProviderError
        ? error.code
        : 'benchmark_internal_error';
    return result;
  }
};
