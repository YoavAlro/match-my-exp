import type { PageContext } from '../../src/modules/contracts';
import type { BenchmarkCase, TargetingDecision } from './schemas';

export interface DecisionEvaluation {
  validIds: boolean;
  exactTargets: boolean;
  actualElementIds: string[];
  expectedElementIds: string[];
}

export const expectedElementIds = (
  benchmarkCase: BenchmarkCase,
  oracle: Readonly<Record<string, string>>,
) =>
  benchmarkCase.expectedTargetKeys.map((key) => {
    const elementId = oracle[key];
    if (elementId === undefined) {
      throw new Error(`Missing oracle target ${key}`);
    }
    return elementId;
  });

export const evaluateSelection = (
  decision: TargetingDecision,
  benchmarkCase: BenchmarkCase,
  pageContext: PageContext,
  oracle: Readonly<Record<string, string>>,
): DecisionEvaluation => {
  const contextIds = new Set(
    pageContext.elements.map(({ elementId }) => elementId),
  );
  const expected = expectedElementIds(benchmarkCase, oracle).toSorted();
  const actual = decision.selectedElementIds.toSorted();
  return {
    validIds: actual.every((elementId) => contextIds.has(elementId)),
    exactTargets:
      actual.length === expected.length &&
      actual.every((elementId, index) => elementId === expected[index]),
    actualElementIds: actual,
    expectedElementIds: expected,
  };
};
