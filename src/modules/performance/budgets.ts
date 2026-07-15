import type { PageContext } from '../contracts';

export const PERFORMANCE_BUDGETS = {
  inspectionElements: 250,
  inspectionBytes: 64 * 1024,
  providerTokens: 32_000,
  observerAddedElements: 200,
  longTaskMilliseconds: 50,
  cumulativeLayoutShift: 0.1,
} as const;

export class PerformanceBudgetError extends Error {
  readonly budget: keyof typeof PERFORMANCE_BUDGETS;

  constructor(budget: keyof typeof PERFORMANCE_BUDGETS) {
    super(`Performance budget exceeded: ${budget}`);
    this.name = 'PerformanceBudgetError';
    this.budget = budget;
  }
}

export const assertContextBudget = (context: PageContext) => {
  if (context.elements.length > PERFORMANCE_BUDGETS.inspectionElements) {
    throw new PerformanceBudgetError('inspectionElements');
  }
  const bytes = new TextEncoder().encode(JSON.stringify(context)).length;
  if (bytes > PERFORMANCE_BUDGETS.inspectionBytes) {
    throw new PerformanceBudgetError('inspectionBytes');
  }
  const estimatedTokens = Math.ceil(bytes / 4);
  if (estimatedTokens > PERFORMANCE_BUDGETS.providerTokens) {
    throw new PerformanceBudgetError('providerTokens');
  }
  return { elements: context.elements.length, bytes, estimatedTokens };
};

export const assertObserverWorkBudget = (addedElements: number) => {
  if (addedElements > PERFORMANCE_BUDGETS.observerAddedElements) {
    throw new PerformanceBudgetError('observerAddedElements');
  }
};

export const assertLongTaskBudget = (duration: number) => {
  if (duration > PERFORMANCE_BUDGETS.longTaskMilliseconds) {
    throw new PerformanceBudgetError('longTaskMilliseconds');
  }
};

export const assertLayoutShiftBudget = (shifts: readonly number[]) => {
  const total = shifts.reduce((sum, shift) => sum + shift, 0);
  if (total > PERFORMANCE_BUDGETS.cumulativeLayoutShift) {
    throw new PerformanceBudgetError('cumulativeLayoutShift');
  }
  return total;
};
