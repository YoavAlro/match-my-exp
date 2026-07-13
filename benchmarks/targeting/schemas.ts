import { z } from 'zod';

export const BenchmarkCategorySchema = z.enum([
  'static',
  'spa',
  'repeated',
  'responsive',
  'shadow',
]);

export const BenchmarkCaseSchema = z
  .strictObject({
    id: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9-]+$/),
    category: BenchmarkCategorySchema,
    fixtureId: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[a-z0-9-]+$/),
    request: z.string().min(1).max(500),
    initialDecision: z.enum(['select', 'clarify']),
    clarificationAnswer: z.string().min(1).max(500).nullable(),
    clarificationKeywords: z
      .array(z.string().min(2).max(40))
      .max(4)
      .default([]),
    expectedTargetKeys: z
      .array(
        z
          .string()
          .min(1)
          .max(80)
          .regex(/^[a-z0-9-]+$/),
      )
      .min(1)
      .max(8),
  })
  .refine(
    ({ initialDecision, clarificationAnswer }) =>
      initialDecision === 'clarify'
        ? clarificationAnswer !== null
        : clarificationAnswer === null,
    'Clarification answers must match the expected initial decision',
  )
  .refine(
    ({ initialDecision, clarificationKeywords }) =>
      initialDecision === 'clarify'
        ? clarificationKeywords.length >= 2
        : clarificationKeywords.length === 0,
    'Clarification cases must define relevant question keywords',
  )
  .refine(
    ({ expectedTargetKeys }) =>
      new Set(expectedTargetKeys).size === expectedTargetKeys.length,
    'Expected target keys must be unique',
  );

export const BenchmarkCorpusSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    cases: z.array(BenchmarkCaseSchema).length(25),
  })
  .refine(
    ({ cases }) => new Set(cases.map(({ id }) => id)).size === cases.length,
    'Benchmark case identifiers must be unique',
  )
  .refine(
    ({ cases }) =>
      BenchmarkCategorySchema.options.every((category) => {
        const categoryCases = cases.filter(
          (benchmarkCase) => benchmarkCase.category === category,
        );
        return (
          categoryCases.length === 5 &&
          categoryCases.filter(
            ({ initialDecision }) => initialDecision === 'clarify',
          ).length === 1
        );
      }),
    'Every category must contain five cases and one ambiguity',
  );

export const TargetingDecisionSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    decision: z.enum(['select', 'clarify']),
    selectedElementIds: z
      .array(
        z
          .string()
          .min(1)
          .max(64)
          .regex(/^element-[a-z0-9-]+$/),
      )
      .max(8),
    clarificationQuestion: z.string().max(500).nullable(),
  })
  .refine(
    ({ decision, selectedElementIds, clarificationQuestion }) =>
      decision === 'select'
        ? selectedElementIds.length > 0 && clarificationQuestion === null
        : selectedElementIds.length === 0 &&
          clarificationQuestion !== null &&
          clarificationQuestion.length > 0,
    'A targeting decision must select elements or ask one clarification',
  )
  .refine(
    ({ selectedElementIds }) =>
      new Set(selectedElementIds).size === selectedElementIds.length,
    'Selected element identifiers must be unique',
  );

export const TargetingDecisionJsonSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'schemaVersion',
    'decision',
    'selectedElementIds',
    'clarificationQuestion',
  ],
  properties: {
    schemaVersion: { type: 'integer', enum: [1] },
    decision: { type: 'string', enum: ['select', 'clarify'] },
    selectedElementIds: {
      type: 'array',
      items: { type: 'string' },
    },
    clarificationQuestion: {
      anyOf: [{ type: 'string' }, { type: 'null' }],
    },
  },
} as const;

export type BenchmarkCategory = z.infer<typeof BenchmarkCategorySchema>;
export type BenchmarkCase = z.infer<typeof BenchmarkCaseSchema>;
export type BenchmarkCorpus = z.infer<typeof BenchmarkCorpusSchema>;
export type TargetingDecision = z.infer<typeof TargetingDecisionSchema>;
