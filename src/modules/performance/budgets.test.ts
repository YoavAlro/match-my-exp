import { describe, expect, it } from 'vitest';
import type { PageContext } from '../contracts';
import {
  PERFORMANCE_BUDGETS,
  PerformanceBudgetError,
  assertContextBudget,
  assertLayoutShiftBudget,
  assertLongTaskBudget,
  assertObserverWorkBudget,
} from './budgets';

const context = (count: number, text = ''): PageContext => ({
  schemaVersion: 1,
  origin: 'https://example.com',
  path: '/account',
  title: 'Account',
  elements: Array.from({ length: count }, (_, index) => ({
    elementId: `element-${index}`,
    tag: 'p',
    ...(text.length === 0 ? {} : { text }),
    attributes: [],
    computedStyles: [],
    bounds: { x: 0, y: 0, width: 0, height: 0 },
  })),
});

describe('performance budgets', () => {
  it('reports bounded context and provider-token metrics', () => {
    expect(assertContextBudget(context(10))).toMatchObject({
      elements: 10,
      estimatedTokens: expect.any(Number),
    });
  });

  it('rejects excessive inspection elements and bytes', () => {
    expect(() =>
      assertContextBudget(context(PERFORMANCE_BUDGETS.inspectionElements + 1)),
    ).toThrowError(
      expect.objectContaining<Partial<PerformanceBudgetError>>({
        budget: 'inspectionElements',
      }),
    );
    expect(() =>
      assertContextBudget(context(200, 'x'.repeat(512))),
    ).toThrowError(
      expect.objectContaining<Partial<PerformanceBudgetError>>({
        budget: 'inspectionBytes',
      }),
    );
  });

  it('enforces observer, long-task, and layout-shift thresholds', () => {
    expect(() => assertObserverWorkBudget(200)).not.toThrow();
    expect(() => assertObserverWorkBudget(201)).toThrowError(
      PerformanceBudgetError,
    );
    expect(() => assertLongTaskBudget(50)).not.toThrow();
    expect(() => assertLongTaskBudget(51)).toThrowError(PerformanceBudgetError);
    expect(assertLayoutShiftBudget([0.02, 0.03])).toBeCloseTo(0.05);
    expect(() => assertLayoutShiftBudget([0.06, 0.05])).toThrowError(
      PerformanceBudgetError,
    );
  });
});
